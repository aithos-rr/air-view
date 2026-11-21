import { describe, it, expect } from 'vitest';
import type { BufferAttribute, Object3D, Points, ShaderMaterial } from 'three';
import { createAircraftLayer } from '@/globe/aircraft';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

/**
 * What the focus fade actually puts on the SCREEN.
 *
 * tests/unit/globe/focus.test.ts proves the brightness curve is right, and
 * fleetColours.test.ts proves the draw ranges are right. Neither looks at
 * the only thing a user sees: the light each point adds to the frame. The
 * fade multiplied the `aColor` attribute alone, and the fragment shader
 * takes its alpha from uCoreLum/the halo and then does
 * `mix(vColor, white, silhouette * 0.45)` — so a point faded to colour
 * (0,0,0) went on painting a mid-grey plane at ~45% of its lit brightness
 * until describeVisibleFleet dropped it out of the draw range and ~1 900
 * aircraft left in one frame. A dissolve that ends in a pop.
 *
 * This file is a port of the fragment shader in src/globe/aircraft.ts, fed
 * from the REAL buffers and uniforms the layer commits, so it is agnostic
 * about where the brightness is applied — attribute, uniform or both — and
 * answers only the question the eye asks: how much light is left.
 */

/** children: [0] partial, [1] complete, [2] selected — the draw hierarchy. */
const PARTIAL = 0;
const COMPLETE = 1;

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

// One aircraft in focus and one of each category behind it. Same heading,
// so the two crowd points differ in COLOUR and in nothing else.
const FLEET: Aircraft[] = [
  ac({ icao24: 'foc', complete: true, latitude: 10, longitude: 10 }),
  ac({ icao24: 'cc', complete: true, latitude: 20, longitude: 20 }),
  ac({ icao24: 'pp', complete: false, latitude: 30, longitude: 30 }),
];
const FOCUSED = { showComplete: true, showPartial: true, focusedIcao: 'foc' };

type Layer = ReturnType<typeof createAircraftLayer>;

function pointsOf(layer: Layer, child: number): Points {
  const obj: Object3D | undefined = layer.group.children[child];
  if (!obj) throw new Error('layer has no drawable child');
  return obj as Points;
}

function uniformOf(mat: ShaderMaterial, name: string, fallback: number): number {
  const u = mat.uniforms[name];
  return typeof u?.value === 'number' ? u.value : fallback;
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
/** GLSL smoothstep, including the edge0 > edge1 case the shader uses. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function sdEllipse(px: number, py: number, rx: number, ry: number): number {
  return Math.hypot(px / rx, py / ry) - 1;
}

/**
 * The red light one pixel of a point adds to the frame.
 *
 * three.js AdditiveBlending is src * srcAlpha + dst * 1, so a fragment's
 * contribution is col * alpha and "invisible" means exactly zero.
 */
function pixelLight(pts: Points, slot: number, uvx: number, uvy: number): number {
  const mat = pts.material as ShaderMaterial;
  const colour = pts.geometry.getAttribute('aColor') as BufferAttribute;
  const heading = (pts.geometry.getAttribute('aHeading') as BufferAttribute).getX(slot);
  const uCoreLum = uniformOf(mat, 'uCoreLum', 1);
  const uHaloFalloff = uniformOf(mat, 'uHaloFalloff', 1);
  const uHaloWidth = uniformOf(mat, 'uHaloWidth', 1);
  // Absent before the fade reached the shader; 1 is then the neutral value.
  const uBrightness = uniformOf(mat, 'uBrightness', 1);

  const distCentre = Math.hypot(uvx, uvy);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const ox = c * uvx + s * uvy;
  const oy = -s * uvx + c * uvy;
  const fuselage = sdEllipse(ox, oy, 0.04, 0.28);
  const wings = sdEllipse(ox, oy + 0.04, 0.3, 0.06);
  const tail = sdEllipse(ox, oy - 0.2, 0.1, 0.04);
  const plane = Math.min(fuselage, wings, tail);
  const silhouette = 1 - smoothstep(-0.006, 0.02, plane);
  const halo = Math.exp(-distCentre * uHaloWidth) * uHaloFalloff;
  const circleMask = smoothstep(0.65, 0.45, distCentre);
  const bodyLum = silhouette * uCoreLum;
  const intensity = Math.max(bodyLum, halo * 0.5) * circleMask * uBrightness;
  if (intensity < 0.005) return 0; // discard
  const k = clamp(silhouette * 0.45, 0, 0.8);
  const col = colour.getX(slot) * (1 - k) + k;
  return col * clamp(intensity, 0, 1);
}

/** All the light one point adds, summed over the square it is drawn in. */
function pointLight(pts: Points, slot: number): number {
  let sum = 0;
  for (let y = -0.5; y <= 0.5; y += 0.02) {
    for (let x = -0.5; x <= 0.5; x += 0.02) sum += pixelLight(pts, slot, x, y);
  }
  return sum;
}

/** The light the crowd adds at this brightness, drawn by the real layer. */
function crowdLight(brightness: number): { complete: number; partial: number } {
  const layer = createAircraftLayer();
  layer.update(FLEET, 'foc', FOCUSED, brightness);
  const complete = pointsOf(layer, COMPLETE);
  const partial = pointsOf(layer, PARTIAL);
  return {
    complete: complete.geometry.drawRange.count > 0 ? pointLight(complete, 0) : 0,
    partial: partial.geometry.drawRange.count > 0 ? pointLight(partial, 0) : 0,
  };
}

/**
 * The dimmest brightness at which the walk still draws the crowd.
 *
 * Found rather than imported: the threshold is describeVisibleFleet's own
 * (INVISIBLE), and a copy of the number here would drift from it. Below
 * this the aircraft leave the draw range, so whatever light they are still
 * adding at this value is the size of the jump the user sees.
 */
function dimmestDrawnBrightness(): number {
  let dark = 0; // not drawn
  let lit = 1; // drawn
  for (let i = 0; i < 60; i++) {
    const mid = (dark + lit) / 2;
    const layer = createAircraftLayer();
    layer.update(FLEET, 'foc', FOCUSED, mid);
    if (pointsOf(layer, COMPLETE).geometry.drawRange.count > 0) lit = mid;
    else dark = mid;
  }
  return lit;
}

describe('the focus fade, measured in light on the screen', () => {
  it('has the crowd at nearly nothing on the last frame it is drawn', () => {
    // The pop: on the frame before the draw range collapses, every one of
    // those ~1 900 aircraft must already be at the edge of invisible. If it
    // is still painting a mid-grey plane, the dissolve is a cut.
    const dimmest = dimmestDrawnBrightness();
    expect(dimmest).toBeGreaterThan(0);
    const lit = crowdLight(1).complete;
    const last = crowdLight(dimmest).complete;
    expect(last).toBeGreaterThan(0); // still drawn there, or the test is empty
    expect(last / lit).toBeLessThan(0.01);
  });

  it('dims the crowd all the way down, not to a floor', () => {
    const lit = crowdLight(1).complete;
    const steps = [0.5, 0.25, 0.1, 0.05, 0.02].map((b) => crowdLight(b).complete / lit);
    // Each step is a real step down, and the last is already dark.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
    expect(steps[steps.length - 1]!).toBeLessThan(0.05);
  });

  it('keeps the two fleet colours apart the whole way down', () => {
    // Fading through a white term makes every aircraft the same grey before
    // it makes any of them disappear: the colour that declares the data
    // dies first, and what is left is a crowd of identical ghosts.
    const atFull = crowdLight(1);
    const atDim = crowdLight(dimmestDrawnBrightness());
    const litRatio = atFull.partial / atFull.complete;
    const dimRatio = atDim.partial / atDim.complete;
    // Not exactly equal: at full brightness uCoreLum = 1.6 saturates the
    // alpha over the body, which weights the pixels differently from the
    // way it weights them at the bottom of the fade. A few percent is that
    // clamp; the defect was a ratio of 1.00 — the grey both colours became.
    expect(dimRatio).toBeCloseTo(litRatio, 1);
  });
});
