import { describe, it, expect } from 'vitest';
import { AdditiveBlending, BackSide, type BufferGeometry, type ShaderMaterial } from 'three';
import { createAtmosphere } from '@/globe/atmosphere';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, GLOBE_RADIUS } from '@/globe/geoHelpers';

const FOV = 38;
const ASPECT = 16 / 9;

/** Half the diagonal of the frustum, which is where the globe fills it. */
function halfDiagonalRad(fovDeg: number, aspect: number): number {
  const halfV = ((fovDeg / 2) * Math.PI) / 180;
  return Math.atan(Math.tan(halfV) * Math.sqrt(1 + aspect * aspect));
}

/**
 * The largest dot(n, viewDir) over the fragments three.js actually draws.
 *
 * With side: BackSide only the faces whose outward normal points AWAY from
 * the camera are drawn, which is exactly the set with dot <= 0 — and that
 * is the whole point: atmosphere.ts:27 clamps dot to [0, 1] before
 * subtracting it from 1, so on every drawn fragment the "fresnel" is
 * 1 and pow(1, 2.5) is 1. The alpha is the constant 0,18 (§2.6).
 */
function maxDotOverDrawnFragments(d: number, steps = 400): number {
  const R = GLOBE_RADIUS * 1.04;
  let worst = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI; // angle from the camera axis
    const p = [R * Math.sin(theta), 0, R * Math.cos(theta)];
    const toCam = [-p[0]!, 0, d - p[2]!];
    const lc = Math.hypot(toCam[0]!, toCam[2]!);
    if (lc === 0) continue;
    const dot = (p[0]! * toCam[0]! + p[2]! * toCam[2]!) / (R * lc);
    if (dot <= 0 && dot > worst) worst = dot;
  }
  return worst;
}

/** Distance from the origin to the nearest FACE, not the nearest vertex. */
function innerRadiusOfTessellation(geom: BufferGeometry): number {
  const pos = geom.getAttribute('position').array as ArrayLike<number>;
  const idx = geom.getIndex()!.array as ArrayLike<number>;
  let min = Infinity;
  for (let i = 0; i < idx.length; i += 3) {
    const a = [0, 1, 2].map((k) => pos[idx[i]! * 3 + k]!);
    const b = [0, 1, 2].map((k) => pos[idx[i + 1]! * 3 + k]!);
    const c = [0, 1, 2].map((k) => pos[idx[i + 2]! * 3 + k]!);
    const u = b.map((v, k) => v - a[k]!);
    const v = c.map((w, k) => w - a[k]!);
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const ln = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (ln === 0) continue;
    const dist = Math.abs((n[0]! * a[0]! + n[1]! * a[1]! + n[2]! * a[2]!) / ln);
    if (dist < min) min = dist;
  }
  return min;
}

describe('the atmosphere is a uniform veil, and this plan does not touch it', () => {
  it('exposes no zoom knob at all', () => {
    // An earlier draft of D39 added limbFadeOpacity, a uOpacity uniform and
    // setOpacity. §2.6 measured why that was wrong. This is the tripwire
    // for anyone who tries it again.
    const atm = createAtmosphere();
    expect(Object.keys(atm).sort()).toEqual(['mesh', 'setTime']);
    const mat = atm.mesh.material as ShaderMaterial;
    expect(Object.keys(mat.uniforms)).toEqual(['uTime']);
    expect(mat.fragmentShader).not.toMatch(/uOpacity/);
  });

  it('keeps the six values that ARE the graphics', () => {
    // "Vorrei mantenere la stessa grafica, lo stesso stile" is the user's
    // constraint, and this is what it means for this file.
    const atm = createAtmosphere();
    const mat = atm.mesh.material as ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(BackSide);
    expect(mat.blending).toBe(AdditiveBlending);
    expect(atm.mesh.renderOrder).toBe(0);
    expect(
      (atm.mesh.geometry as BufferGeometry & { parameters: { radius: number } }).parameters.radius
    ).toBeCloseTo(GLOBE_RADIUS * 1.04, 12);
  });

  it('paints a CONSTANT alpha, which is why fading it would darken every pixel', () => {
    // The premise the first draft rested on — "below 2,61 the glow paints
    // zero useful pixels at any opacity" — is false here: every drawn
    // fragment has dot(n, v) <= 0, so the fresnel term is dead code and
    // the alpha is 0,18 from the limb to the far pole (§2.6).
    for (const d of [CAMERA_FAR_LIMIT, 4, 3.002, 2.715, 2.61, 2, CAMERA_NEAR_LIMIT]) {
      expect(maxDotOverDrawnFragments(d), `d=${d}`).toBeLessThanOrEqual(0);
    }
  });

  it('fills the whole frame exactly where the first draft switched it off', () => {
    // The disc is the 1,56 sphere's, not the globe's: it fills the corners
    // from 1,56 / sin(35,08°) = 2,715 down. At 2,610 — where the fade
    // reached zero — coverage is 100 %, not 0 %.
    const fillsFrom = (GLOBE_RADIUS * 1.04) / Math.sin(halfDiagonalRad(FOV, ASPECT));
    expect(fillsFrom).toBeGreaterThan(2.61);
    expect(fillsFrom).toBeCloseTo(2.715, 2);
  });

  it('keeps the camera inside the TESSELLATED shell at the bottom of the travel', () => {
    // SphereGeometry(1,56, 64, 64) is a polyhedron: its inner radius is
    // 1,557653, not 1,56, and at 1,55 the camera clears it by 0,0077. Lower
    // the floor or coarsen the sphere and a facet edge sweeps the screen,
    // silently (§2.6). This is the only constraint the new floor really
    // puts on the atmosphere.
    const inner = innerRadiusOfTessellation(createAtmosphere().mesh.geometry);
    expect(inner).toBeCloseTo(1.557653, 5);
    expect(inner).toBeGreaterThan(CAMERA_NEAR_LIMIT);
  });
});
