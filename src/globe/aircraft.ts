import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Points,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import type { Aircraft } from '@/types';
import { GLOBE_RADIUS } from './geoHelpers';
import { describeVisibleFleet } from './visibility';
import type { VisibilityRule, VisibleFleet } from './visibility';

/** #ffe6c4, the warm white of PRODUCT.md §3. Unchanged since v1. */
export const COMPLETE_COLOR: [number, number, number] = [1.0, 0.902, 0.769];
/**
 * #8a93a0, cold and desaturated so it recedes.
 *
 * Until now every aircraft was painted COMPLETE_COLOR, including the 96.5%
 * the server marks `complete: false`: the flag crossed the whole chain and
 * died unread here. The colour predicts the interaction — only a complete
 * aircraft can put D and A on the globe — so a user learns the rule at the
 * first click.
 */
export const PARTIAL_COLOR: [number, number, number] = [0.541, 0.576, 0.627];
const SELECTED_COLOR: [number, number, number] = [0.16, 0.59, 1.0]; // sky-leaning Action Blue
const DEG = Math.PI / 180;
// Taken from the server's ceiling, not from a snapshot. /api/states serves
// the whole ACCUMULATED fleet on every request and caps one body at
// MAX_PAYLOAD_AIRCRAFT = 24 000 (server/index.ts), whose own sizing note is
// measured on 20 000 records: the normal regime already sits above the
// 18 000 v1 chose for a live snapshot of ~14 000. Past this ceiling aircraft
// leave by a bare `continue` — no log, no flag — while the HUD goes on
// counting aircraft.size, so the globe would be emptier than the UI claims.
// Memory cost: 24 000 × (3 + 3 + 1) × 4 B ≈ 670 KB. Trascurabile.
const MAX_AIRCRAFT = 24000;
// Two full-size sets, not one: either category can be the whole fleet. Today
// it is the partial one — 96.5% of the aircraft, measured 2026-11-21 — but a
// route cache that keeps filling at ~920 flights/hour will move that number,
// and a set sized on today's ratio would start dropping aircraft silently
// exactly as the 18 000 ceiling of v1 did. 24 000 × 7 floats × 4 B ≈ 0,67 MB
// each.
const SCENE_BOUND_RADIUS = GLOBE_RADIUS + 0.5;

interface PointParams {
  size: number;
  coreLum: number;
  haloFalloff: number;
  haloWidth: number;
}

/**
 * A material and the one uniform that is written every frame.
 *
 * The brightness is handed back by reference rather than looked up by name
 * on each frame: `ShaderMaterial.uniforms` is an index signature, so
 * `uniforms.uBrightness.value = x` type-checks even when the uniform was
 * never declared, and a rename would go on compiling while the fade
 * quietly stopped reaching the screen.
 */
interface PointMaterial {
  material: ShaderMaterial;
  brightness: { value: number };
}

function createPointMaterial(p: PointParams): PointMaterial {
  const brightness = { value: 1 };
  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: p.size },
      uCoreLum: { value: p.coreLum },
      uHaloFalloff: { value: p.haloFalloff },
      uHaloWidth: { value: p.haloWidth },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      // The fade of Task 4, for every point in this set at once. It belongs
      // on the material and not on aColor because the alpha below is what
      // the eye reads, and the alpha never looked at the colour.
      uBrightness: brightness,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aHeading;
      varying vec3 vColor;
      varying float vHeading;
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        vColor   = aColor;
        vHeading = aHeading;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = uSize * uPixelRatio * (4.0 / -mv.z);
        gl_PointSize = clamp(s, 6.0, 220.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCoreLum;
      uniform float uHaloFalloff;
      uniform float uHaloWidth;
      uniform float uBrightness;
      varying vec3 vColor;
      varying float vHeading;
      float sdEllipse(vec2 p, vec2 r) { return length(p / r) - 1.0; }
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float distCentre = length(uv);
        float c = cos(vHeading);
        float s = sin(vHeading);
        vec2 obj = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);
        float fuselage = sdEllipse(obj, vec2(0.04, 0.28));
        float wings    = sdEllipse(obj - vec2(0.0, -0.04), vec2(0.30, 0.06));
        float tail     = sdEllipse(obj - vec2(0.0,  0.20), vec2(0.10, 0.04));
        float plane = min(min(fuselage, wings), tail);
        float silhouette = 1.0 - smoothstep(-0.006, 0.020, plane);
        float halo = exp(-distCentre * uHaloWidth) * uHaloFalloff;
        float circleMask = smoothstep(0.65, 0.45, distCentre);
        float bodyLum = silhouette * uCoreLum;
        // The fade lands HERE, on the alpha, which is the only term the
        // screen obeys: under additive blending a fragment contributes
        // col * alpha, so uBrightness = 0 adds exactly nothing and the
        // discard takes the point out a hair before describeVisibleFleet
        // takes it out of the draw range. Applied to vColor instead — as
        // it was — it left the mix() with white untouched, so a point
        // faded to black went on painting a mid-grey plane at ~45% of its
        // lit brightness until the draw range collapsed and ~1 900
        // aircraft vanished in one frame. The white term is the reason the
        // silhouette reads at all; it must dim with everything else.
        float intensity = max(bodyLum, halo * 0.5) * circleMask * uBrightness;
        if (intensity < 0.005) discard;
        // vColor is now the fleet colour itself, never premultiplied: two
        // categories that differ in colour must still differ halfway
        // through the fade, not converge on one grey before they leave.
        vec3 col = mix(vColor, vec3(1.0), clamp(silhouette * 0.45, 0.0, 0.80));
        gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  return { material, brightness };
}

interface PointSet {
  geom: BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  headings: Float32Array;
  positionAttr: BufferAttribute;
  colorAttr: BufferAttribute;
  headingAttr: BufferAttribute;
}

function createPointSet(capacity: number): PointSet {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const headings = new Float32Array(capacity);
  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  const headingAttr = new BufferAttribute(headings, 1);
  headingAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('aColor', colorAttr);
  geom.setAttribute('aHeading', headingAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), SCENE_BOUND_RADIUS);
  return { geom, positions, colors, headings, positionAttr, colorAttr, headingAttr };
}

// Inline lat/lon/alt → xyz. Zero allocations per call.
function writeLatLonAlt(
  buf: Float32Array,
  offset: number,
  lat: number,
  lon: number,
  altFt: number
): void {
  const radius = GLOBE_RADIUS + 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  const sinPhi = Math.sin(phi);
  buf[offset] = radius * sinPhi * Math.sin(theta);
  buf[offset + 1] = radius * Math.cos(phi);
  buf[offset + 2] = radius * sinPhi * Math.cos(theta);
}

export interface AircraftLayer {
  group: Group;
  /**
   * @param rule who is visible at all — the single authority, shared with
   *   the trails and the raycaster.
   * @param othersBrightness the fade applied to every aircraft that is not
   *   the selected one — as a uniform on the two crowd materials, so it
   *   scales the ALPHA each point contributes and a 0 really is nothing on
   *   screen. 1 outside focus, 0 once the fade into focus has
   *   finished, and 1 again on the FIRST frame after the focus ends — the
   *   return is not animated, because a fade-in hands this loop ~0 while
   *   the panel is already declaring a full sky (D15, Task 4 Step 3). It is
   *   the visual TAIL of the animation, never a second visibility rule: the
   *   picker — the authority on who can be clicked — does not consult it.
   * @returns what this call actually drew, and the named reason for every
   *   record it did not. Returned rather than recomputed by the caller
   *   because it is the SAME walk (D15); the panel asks the same function
   *   the same question and therefore gets the same number.
   */
  update: (
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule,
    othersBrightness: number
  ) => VisibleFleet;
}

export function createAircraftLayer(): AircraftLayer {
  const group = new Group();

  // Draw order IS the hierarchy (spec §4.2): partial at the bottom, complete
  // above them, selected above everything. With additive blending and
  // thousands of points, a complete aircraft buried under grey noise is
  // information lost at exactly the density where it matters most.
  const partialSet = createPointSet(MAX_AIRCRAFT);
  const partialMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const partialPts = new Points(partialSet.geom, partialMat.material);
  partialPts.renderOrder = 2;
  partialPts.frustumCulled = false;
  group.add(partialPts);

  const completeSet = createPointSet(MAX_AIRCRAFT);
  const completeMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const completePts = new Points(completeSet.geom, completeMat.material);
  completePts.renderOrder = 3;
  completePts.frustumCulled = false;
  group.add(completePts);

  const selectedSet = createPointSet(8); // at most a handful selected (v1 = exactly 1)
  const selectedMat = createPointMaterial({
    size: 56,
    coreLum: 2.0,
    haloFalloff: 1.35,
    haloWidth: 6.5,
  });
  const selectedPts = new Points(selectedSet.geom, selectedMat.material);
  selectedPts.renderOrder = 4;
  selectedPts.frustumCulled = false;
  group.add(selectedPts);

  // The colour goes in unscaled. The fade is a property of the SET —
  // uBrightness on its material — not of each point's colour: multiplying
  // aColor dimmed one of the three terms the fragment adds up and left the
  // other two lit, which is how "the others dissolve" came out as a dim to
  // 45% followed by a cut.
  function writePoint(
    set: PointSet,
    i: number,
    ac: Aircraft,
    colour: [number, number, number]
  ): void {
    const altFt = ac.baroAltitudeFt ?? 38000;
    writeLatLonAlt(set.positions, i * 3, ac.latitude!, ac.longitude!, altFt);
    set.colors[i * 3] = colour[0];
    set.colors[i * 3 + 1] = colour[1];
    set.colors[i * 3 + 2] = colour[2];
    set.headings[i] = (ac.headingDeg ?? 0) * DEG;
  }

  function commit(set: PointSet, count: number): void {
    set.geom.setDrawRange(0, count);
    set.positionAttr.needsUpdate = true;
    set.colorAttr.needsUpdate = true;
    set.headingAttr.needsUpdate = true;
  }

  function update(
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule,
    othersBrightness: number
  ): VisibleFleet {
    let partialCount = 0;
    let completeCount = 0;
    let selectedCount = 0;

    // The crowd dims; the subject of the focus never does. Two materials
    // because the two categories are two draw calls, one value because the
    // fade is one number: the same othersBrightness the walk below uses to
    // decide when they have faded out altogether.
    partialMat.brightness.value = othersBrightness;
    completeMat.brightness.value = othersBrightness;

    // This loop no longer decides WHO is drawn — it only writes where the
    // decision says. Every rule about visibility, the fade and the ceilings
    // lives in describeVisibleFleet, which the panel calls with the same
    // arguments minus this callback. That is the whole of D15: the number
    // on screen and the number in the panel are produced by one walk, so
    // they cannot be two different answers to the same question.
    const view = describeVisibleFleet(
      aircraft,
      rule,
      selectedIcao,
      (ac, target, slot) => {
        if (target === 'selected') {
          writePoint(selectedSet, slot, ac, SELECTED_COLOR);
          selectedCount = slot + 1;
        } else if (target === 'complete') {
          writePoint(completeSet, slot, ac, COMPLETE_COLOR);
          completeCount = slot + 1;
        } else {
          writePoint(partialSet, slot, ac, PARTIAL_COLOR);
          partialCount = slot + 1;
        }
      },
      othersBrightness,
      { perCategory: MAX_AIRCRAFT, selected: selectedSet.headings.length }
    );

    commit(partialSet, partialCount);
    commit(completeSet, completeCount);
    commit(selectedSet, selectedCount);
    return view;
  }

  return { group, update };
}
