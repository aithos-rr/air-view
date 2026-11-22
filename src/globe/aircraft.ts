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
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  CAMERA_NEAR_LIMIT_BEFORE_DETAIL,
  GLOBE_RADIUS,
  altitudeFraction,
  shellOffset,
  shellThicknessUnits,
} from './geoHelpers';
import { describeVisibleFleet } from './visibility';
import type { VisibilityRule, VisibleFleet } from './visibility';
import { STILL_DIM, positionAt } from './deadReckoning';
import type { Xyz } from './deadReckoning';

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

/**
 * The symbol's diameter in CSS pixels, by camera distance.
 *
 * The old formula — `uSize * uPixelRatio * (4.0 / -mv.z)` — was a
 * perspective divide, so the dot behaved like a sphere of fixed size IN
 * THE WORLD and grew exactly as fast as the ground under it. Measured at
 * d = 3,0, the old near limit: the quad was 138,7 device px while the mean
 * nearest neighbour over Europe was 11,4 px away. Zooming moved both by
 * the same factor, which is the spec's complaint word for word — "zooming
 * separates the geography but the points stay attached" (§4.2).
 *
 * Here the radius is in SCREEN pixels and grows with the LOGARITHM of the
 * zoom: the symbol doubles across a travel over which the view opens by
 * 5,3, so every step inwards is a net gain in separation. Written in
 * TypeScript and handed to the shader as a uniform, not computed per
 * vertex, because a threshold inside a vertex shader cannot be tested —
 * the same reason markerLabelVisible lives in airportMarkers.ts:36.
 *
 * 7 px at the far end is a dot at planet view, where 11 625 aircraft are
 * 5,1 px apart on average and no size can separate them. 14 px at the near
 * end is where the SDF silhouette starts reading as an aeroplane, and it
 * sits inside the 23 px the densest real crowd leaves at that distance.
 */
export function pointSizePx(cameraDistance: number): number {
  const d = Math.min(Math.max(cameraDistance || CAMERA_NEAR_LIMIT, CAMERA_NEAR_LIMIT), CAMERA_FAR_LIMIT);
  // Anchored at the OLD floor and clamped there. Every distance the camera
  // could already reach gets exactly the size it got before; across the new
  // stretch the symbol stops growing while the geography goes on spreading,
  // which is the direction that separates aircraft rather than the one that
  // packs them (D48).
  const t = Math.min(
    1,
    Math.log(CAMERA_FAR_LIMIT / d) / Math.log(CAMERA_FAR_LIMIT / CAMERA_NEAR_LIMIT_BEFORE_DETAIL)
  );
  return POINT_PX_FAR + (POINT_PX_NEAR - POINT_PX_FAR) * t;
}
const POINT_PX_FAR = 7;
const POINT_PX_NEAR = 14;

/**
 * The hierarchy, carried where the blending can actually carry it (D27).
 *
 * The three sets are additive with depthWrite false, and addition is
 * commutative: renderOrder cannot put a complete aircraft "above" grey
 * noise, whatever the comment further down says — it can only decide which
 * draw call runs first, and the sum is the same either way. Size can, and
 * so can the reserved blue.
 */
export const POINT_SCALE_COMPLETE = 1.15;
export const POINT_SCALE_SELECTED = 1.9;
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
  /** Written once per frame from pointSizePx(); see the note there. */
  pointPx: { value: number };
}

function createPointMaterial(p: PointParams): PointMaterial {
  const brightness = { value: 1 };
  const pointPx = { value: POINT_PX_FAR };
  const material = new ShaderMaterial({
    uniforms: {
      uPointPx: pointPx,
      uCoreLum: { value: p.coreLum },
      uHaloFalloff: { value: p.haloFalloff },
      uHaloWidth: { value: p.haloWidth },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uGlobeR2: { value: GLOBE_RADIUS * GLOBE_RADIUS },
      // The fade of Task 4, for every point in this set at once. It belongs
      // on the material and not on aColor because the alpha below is what
      // the eye reads, and the alpha never looked at the colour.
      uBrightness: brightness,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aHeading;
      attribute float aLive;
      varying float vLive;
      varying vec3 vColor;
      varying float vHeading;
      uniform float uPointPx;
      uniform float uPixelRatio;
      uniform float uGlobeR2;
      void main() {
        // Behind the planet. cameraPosition is three.js's own uniform, in
        // world space, and this Group carries no transform, so position
        // is world space too: dot(C, P) >= R^2 is the exact near-side test,
        // the same one geoHelpers.isOnNearSide runs for the picker, the
        // leader line and the markers.
        //
        // The cull lives here and NOT in describeVisibleFleet on purpose.
        // "shown" has always meant "records handed to the globe to draw":
        // D15 has never counted what falls off the edge of the frame, and
        // could not, since that walk has no camera. The far side of a
        // sphere is also the one cause a viewer resolves by dragging — and
        // counting it would make the HUD churn four times a second while
        // the globe auto-rotates (D25).
        if (dot(cameraPosition, position) < uGlobeR2) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
          gl_PointSize = 0.0;
          return;
        }
        vColor   = aColor;
        vHeading = aHeading;
        vLive    = aLive;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // No perspective divide. The symbol is a fixed size on the SCREEN,
        // so zooming in separates the crowd instead of magnifying it along
        // with the ground (D23). The clamp is a backstop against a camera
        // distance pointSizePx was never handed; the real bounds are its.
        gl_PointSize = clamp(uPointPx * uPixelRatio, 2.0, 64.0);
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
      varying float vLive;
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
        // vLive is 1 for an aircraft being carried forward and STILL_DIM
        // for one drawn where it was last measured (D17). It lands on the
        // INTENSITY and not on vColor: the mix() with white below is what
        // makes the silhouette read at all, and a point dimmed through its
        // colour went on painting a mid-grey aeroplane at ~45% of its lit
        // brightness — the failure this file already records at line 121.
        float intensity = max(bodyLum, halo * 0.5) * circleMask * uBrightness * vLive;
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
  return { material, brightness, pointPx };
}

interface PointSet {
  geom: BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  headings: Float32Array;
  live: Float32Array;
  positionAttr: BufferAttribute;
  colorAttr: BufferAttribute;
  headingAttr: BufferAttribute;
  liveAttr: BufferAttribute;
}

function createPointSet(capacity: number): PointSet {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const headings = new Float32Array(capacity);
  const live = new Float32Array(capacity);
  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  const headingAttr = new BufferAttribute(headings, 1);
  headingAttr.setUsage(DynamicDrawUsage);
  const liveAttr = new BufferAttribute(live, 1);
  liveAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('aColor', colorAttr);
  geom.setAttribute('aHeading', headingAttr);
  geom.setAttribute('aLive', liveAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), SCENE_BOUND_RADIUS);
  return { geom, positions, colors, headings, live, positionAttr, colorAttr, headingAttr, liveAttr };
}

// Inline lat/lon/alt → xyz. Zero allocations per call.
function writeLatLonAlt(
  buf: Float32Array,
  offset: number,
  lat: number,
  lon: number,
  altFt: number,
  shellUnits: number
): void {
  // Still inline and still allocation-free — that was always the right
  // reason for this helper — but no longer with an opinion of its own about
  // where an aircraft is. This line used to spell the whole shell out by
  // hand, which made it the second of three copies (D36).
  const radius = GLOBE_RADIUS + shellOffset(shellUnits, altitudeFraction(altFt));
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  const sinPhi = Math.sin(phi);
  buf[offset] = radius * sinPhi * Math.sin(theta);
  buf[offset + 1] = radius * Math.cos(phi);
  buf[offset + 2] = radius * sinPhi * Math.cos(theta);
}

/**
 * What the render loop knows and this layer cannot work out for itself.
 *
 * One object per frame, built in animate(): sixty allocations a second
 * against the 700 thousand a per-aircraft object would cost.
 */
export interface FrameState {
  /** The rAF timestamp — monotonic by specification (D21). */
  nowMs: number;
  /**
   * Seconds since the batch was BUILT, on that same clock.
   *
   * Built, not received: aircraftStore sets feedStampMs back by the age the
   * body already had on arrival and does not re-stamp a body it has already
   * seen, so this number goes on growing while the server serves the same
   * photograph (D31). Nothing here has to know that — which is the point of
   * doing it once, in the store.
   */
  elapsedSinceBatchS: number;
  /** camera.position.length(), in globe-space units. */
  cameraDistance: number;
  /**
   * What the server said about the body in hand — aircraftStore.feedStale.
   *
   * It travels in the frame rather than being read from the store by each
   * layer, so the dots, the hit test and the leader line are all answering
   * about the SAME frame. Every one of them passes it to advanceFor, which
   * is the one place that decides (D29/D31).
   */
  stale: boolean;
}

/**
 * The frame a caller with no render loop is asking about: the instant the
 * batch landed, feed live, at the far end of the camera's travel. Every
 * existing unit test passes exactly this by omitting the argument.
 */
export const SETTLED_FRAME: FrameState = {
  nowMs: 0,
  elapsedSinceBatchS: 0,
  cameraDistance: 10,
  stale: false,
};

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
    othersBrightness: number,
    frame?: FrameState
  ) => VisibleFleet;
  /**
   * Where the first point of the partial set was drawn, as plain numbers.
   *
   * A debug surface with exactly one reader, tests/e2e/density-motion
   * .spec.ts, and it exists because the user's opening complaint about v1
   * was about a PIXEL: "iconcine che sembrano non spostarsi mai". Only a
   * browser can answer that, and only a position can prove it — the unit
   * suite proves the arithmetic, not that the arithmetic reaches a buffer
   * a real frame draws from.
   *
   * It COPIES out of the buffer instead of handing the buffer over, so
   * nothing outside this module can write where an aircraft is drawn.
   */
  probeHead: () => number[];
}

export function createAircraftLayer(): AircraftLayer {
  const group = new Group();

  // Draw order IS the hierarchy (spec §4.2): partial at the bottom, complete
  // above them, selected above everything. With additive blending and
  // thousands of points, a complete aircraft buried under grey noise is
  // information lost at exactly the density where it matters most.
  const partialSet = createPointSet(MAX_AIRCRAFT);
  const partialMat = createPointMaterial({ coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const partialPts = new Points(partialSet.geom, partialMat.material);
  partialPts.renderOrder = 2;
  partialPts.frustumCulled = false;
  group.add(partialPts);

  const completeSet = createPointSet(MAX_AIRCRAFT);
  const completeMat = createPointMaterial({ coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const completePts = new Points(completeSet.geom, completeMat.material);
  completePts.renderOrder = 3;
  completePts.frustumCulled = false;
  group.add(completePts);

  const selectedSet = createPointSet(8); // at most a handful selected (v1 = exactly 1)
  const selectedMat = createPointMaterial({
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
  // One scratch vector for the whole layer. 11 625 objects a frame is 700
  // thousand allocations a second, and this loop already hoists for less.
  const scratch: Xyz = { x: 0, y: 0, z: 0 };

  function writePoint(
    set: PointSet,
    i: number,
    ac: Aircraft,
    colour: [number, number, number],
    advanceS: number,
    still: boolean,
    frame: FrameState,
    shellUnits: number
  ): void {
    if (ac.motion != null) {
      // The hot path: two trig calls for an aircraft that is moving and
      // none at all for one that is not, against the four writeLatLonAlt
      // spends below (D20). The decision of HOW FAR is not taken here —
      // describeVisibleFleet took it, and this writes where it said.
      positionAt(ac.motion, advanceS, frame.nowMs, shellUnits, scratch);
      set.positions[i * 3] = scratch.x;
      set.positions[i * 3 + 1] = scratch.y;
      set.positions[i * 3 + 2] = scratch.z;
    } else {
      // No motion: a record that never went through updateBatch, which is
      // every Aircraft the unit suite builds by hand. In production there
      // are none.
      const altFt = ac.baroAltitudeFt ?? 38000;
      writeLatLonAlt(set.positions, i * 3, ac.latitude!, ac.longitude!, altFt, shellUnits);
    }
    set.colors[i * 3] = colour[0];
    set.colors[i * 3 + 1] = colour[1];
    set.colors[i * 3 + 2] = colour[2];
    set.headings[i] = (ac.headingDeg ?? 0) * DEG;
    set.live[i] = still ? STILL_DIM : 1;
  }

  function commit(set: PointSet, count: number): void {
    set.geom.setDrawRange(0, count);
    set.positionAttr.needsUpdate = true;
    set.colorAttr.needsUpdate = true;
    set.headingAttr.needsUpdate = true;
    set.liveAttr.needsUpdate = true;
  }

  function update(
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule,
    othersBrightness: number,
    frame: FrameState = SETTLED_FRAME
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

    // One reading of the camera per frame for the whole layer, three
    // uniforms written. The ratios are the hierarchy (D27).
    const px = pointSizePx(frame.cameraDistance);
    // One reading for the whole fleet: one log and one pow a frame, where a
    // per-aircraft call would be 24 000 of each. The dots, the trails and
    // the route arc all ride the shell this number names (D36).
    const shell = shellThicknessUnits(frame.cameraDistance);
    partialMat.pointPx.value = px;
    completeMat.pointPx.value = px * POINT_SCALE_COMPLETE;
    selectedMat.pointPx.value = px * POINT_SCALE_SELECTED;

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
      (ac, target, slot, advanceS, still) => {
        if (target === 'selected') {
          writePoint(selectedSet, slot, ac, SELECTED_COLOR, advanceS, still, frame, shell);
          selectedCount = slot + 1;
        } else if (target === 'complete') {
          writePoint(completeSet, slot, ac, COMPLETE_COLOR, advanceS, still, frame, shell);
          completeCount = slot + 1;
        } else {
          writePoint(partialSet, slot, ac, PARTIAL_COLOR, advanceS, still, frame, shell);
          partialCount = slot + 1;
        }
      },
      othersBrightness,
      { perCategory: MAX_AIRCRAFT, selected: selectedSet.headings.length },
      frame.elapsedSinceBatchS,
      frame.stale
    );

    commit(partialSet, partialCount);
    commit(completeSet, completeCount);
    commit(selectedSet, selectedCount);
    return view;
  }

  // See the note on AircraftLayer.probeHead: a copy, never the buffer.
  function probeHead(): number[] {
    return [
      partialSet.positions[0] ?? 0,
      partialSet.positions[1] ?? 0,
      partialSet.positions[2] ?? 0,
    ];
  }

  return { group, update, probeHead };
}
