import type { AircraftRaw, Motion } from '@/types';
import { GLOBE_RADIUS, altitudeFraction, shellOffset } from './geoHelpers';

/**
 * How long after a fix we are still willing to say where an aircraft is.
 *
 * Both halves of this number are measured in our own pipeline, not guessed
 * about aviation. A tile under the viewport is not re-queued before
 * DEFAULT_MIN_REFRESH_MS = 60 000 (src/data/sources/tileGrid.ts:164) and an
 * active client refreshes every 30 000 (src/data/aircraftStream.ts:13), so
 * the worst age of a fix for what the viewer is LOOKING AT is 90 s. 120
 * covers that with 30 s of margin and nothing more.
 *
 * Past it we would no longer be bridging the gap between two fixes — we
 * would be painting over a failure of ours, a tile that never came back or
 * a poller suspended by a 429. Painting over your own staleness is the v1
 * outage in a new costume: 25 days of a cached snapshot that went on
 * looking alive.
 *
 * In screen terms: 120 s at 450 kt is 15,0 NM, which is 1,7 px at planet
 * view and 25 px at the deepest zoom this plan allows.
 */
export const DR_CAP_S = 120;

/**
 * How long a correction to our own drawing takes to disappear.
 *
 * 300 ms is the editorial window DESIGN.md sets for state changes, the one
 * FOCUS_FADE_MS already occupies (src/globe/focus.ts:1-6). Same curve as
 * that fade, duplicated rather than imported on purpose: the focus
 * dissolve and a position correction are two different events, and one
 * shared knob would turn them into one.
 */
export const RECONCILE_MS = 300;

/** advanceSeconds' answer when an aircraft must be drawn where it was measured. */
export const STILL = -1;

/**
 * What a still aircraft's point is multiplied by.
 *
 * Applied to the fragment INTENSITY, never to the colour: aircraft.ts:
 * 121-130 records, with the failure in hand, that dimming aColor leaves the
 * mix() with white alight and a "dark" point goes on painting a mid-grey
 * aeroplane at ~45%. Low enough that the eye reads a memory rather than a
 * flight, high enough that a 7 px symbol still has a silhouette, and far
 * above the fragment's own 0.005 discard — "dim" must never quietly become
 * "absent", because absence is counted and dimness is not (D17).
 */
export const STILL_DIM = 0.55;

const DEG = Math.PI / 180;
/** Earth radius in NM: an angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

/**
 * The once-per-batch half of the dead reckoning (D20).
 *
 * Everything expensive happens here — six trig calls for the two unit
 * vectors — and it happens once every 30 s instead of 60 times a second.
 * 11 625 aircraft through this is about 2,4 ms per batch; the same work
 * per frame would be 1,7 million transcendental calls a second.
 *
 * @returns null when the record has no position at all. Such a record has
 *   never been a dot (describeVisibleFleet counts it under `noPosition`)
 *   and must not become one here.
 */
export function deriveMotion(ac: AircraftRaw, batchFetchedAtUnix: number): Motion | null {
  if (ac.latitude === null || ac.longitude === null) return null;

  const latRad = ac.latitude * DEG;
  const lonRad = ac.longitude * DEG;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  // Same convention as latLonToVec3 (geoHelpers.ts:10-18): lon=0 on +Z,
  // lat=90 on +Y, lon=90 on +X. Written out rather than called because the
  // caller needs the sines and cosines again for the tangent below, and
  // because this must allocate no Vector3 for 11 625 records.
  const ux = cosLat * sinLon;
  const uy = sinLat;
  const uz = cosLat * cosLon;

  const extrapolable =
    ac.lastContact !== null && ac.velocityKt !== null && ac.headingDeg !== null;

  let wx = 0;
  let wy = 0;
  let wz = 0;
  let omegaPerS = 0;
  if (extrapolable) {
    // Local north and east at this point, both unit and both orthogonal to
    // u by construction. The compass track is measured clockwise from
    // north, so the tangent is north*cos + east*sin.
    const hdg = ac.headingDeg! * DEG;
    const ch = Math.cos(hdg);
    const sh = Math.sin(hdg);
    const nx = -sinLat * sinLon;
    const ny = cosLat;
    const nz = -sinLat * cosLon;
    wx = nx * ch + cosLon * sh;
    wy = ny * ch;
    wz = nz * ch - sinLon * sh;
    omegaPerS = ac.velocityKt! / 3600 / NM_PER_RADIAN;
  }

  // Floored at zero: the provider's clock and ours are two WALL clocks and
  // either can be the one that is ahead. A negative age would fly the
  // aircraft backwards along its own track.
  const fixAgeAtBatchS =
    ac.lastContact === null ? 0 : Math.max(0, batchFetchedAtUnix - ac.lastContact);

  return {
    ux,
    uy,
    uz,
    wx,
    wy,
    wz,
    // The shell's thickness belongs to the camera, not to the batch: see
    // Motion.altFrac. The 38 000 ft default for a missing quota stays here,
    // in the one place that has ever stated it.
    altFrac: altitudeFraction(ac.baroAltitudeFt ?? 38000),
    omegaPerS,
    fixAgeAtBatchS,
    extrapolable,
    offX: 0,
    offY: 0,
    offZ: 0,
    offUntilMs: 0,
  };
}

/**
 * How many seconds of flight to add to this fix on THIS frame, or STILL.
 *
 * One function and one answer, so the counter in describeVisibleFleet and
 * the position the renderer writes cannot be two different opinions about
 * the same aircraft (D19).
 *
 * @param elapsedSinceBatchS a MONOTONIC duration — the rAF timestamp minus
 *   the batch's performance.now() stamp. Never a fresh reading of
 *   Date.now() against lastContact: that clock jumps ~528 ms every ~32 s on
 *   this machine, and measuring the same age twice with it would make the
 *   aircraft twitch backwards (D21).
 */
export function advanceSeconds(m: Motion, elapsedSinceBatchS: number): number {
  if (!m.extrapolable) return STILL;
  const age = m.fixAgeAtBatchS + Math.max(0, elapsedSinceBatchS);
  if (age > DR_CAP_S) return STILL;
  return age;
}

/**
 * How far to carry THIS record on THIS frame — the one answer, and the one
 * place the answer is decided.
 *
 * describeVisibleFleet asks it to count, the picker asks it to hit-test and
 * the leader line asks it to point. Three copies of "no motion, or past the
 * ceiling, or the feed has stopped" would drift, and the shape of that drift
 * is a dot you can see and cannot click — the ghost D7 forbids (D19/D29).
 *
 * @param feedStale what the SERVER said about the body in hand. A stale body
 *   is a photograph it is serving again, not a measurement, and extrapolating
 *   from a photograph is painting over our own staleness — the very thing
 *   DR_CAP_S exists to forbid, reached by a route the ceiling cannot see
 *   because the stamp it counts from repeats (D31). A boolean the server
 *   computed on its own clock, so no clock of ours can defeat it; and it is
 *   the same fact the HUD already prints as "feed stale · last known
 *   positions", so the words and the dots now come from one source.
 */
export function advanceFor(
  m: Motion | null,
  elapsedSinceBatchS: number,
  feedStale: boolean
): number {
  if (m === null) return STILL;
  if (feedStale) return STILL;
  return advanceSeconds(m, elapsedSinceBatchS);
}

/** smoothstep: no velocity jump at either end. Same curve as focus.ts:22. */
function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Where this aircraft is drawn, this frame.
 *
 * The hot path of the whole plan: two trig calls for an aircraft that is
 * moving, none at all for one that is not, and no allocation in either
 * case — `out` is written in place because 11 625 Vector3 per frame is 700
 * thousand objects a second.
 *
 * @param advanceS what advanceFor returned; STILL and 0 both mean "at the
 *   fix", and they differ only in what the panel says about them.
 * @param nowMs the monotonic frame clock, for the correction being slid out.
 * @param shellUnits the shell thickness for THIS frame, from
 *   shellThicknessUnits(cameraDistance). Passed in rather than computed
 *   here because it is one log and one pow for the whole fleet, and a
 *   per-aircraft call would be 24 000 of each per frame (D36).
 */
export function positionAt(
  m: Motion,
  advanceS: number,
  nowMs: number,
  shellUnits: number,
  out: Xyz
): void {
  const radius = GLOBE_RADIUS + shellOffset(shellUnits, m.altFrac);
  if (advanceS > 0 && m.omegaPerS > 0) {
    // u cos δ + w sin δ IS the great circle through u in the direction of
    // w, by definition. Interpolating lat/lon instead would draw the rhumb
    // line, which Plan 3 measured at six degrees of error on JFK->LHR
    // (routeArc.ts:82-98) — the same lie, in a smaller size.
    const delta = m.omegaPerS * advanceS;
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    out.x = (m.ux * c + m.wx * s) * radius;
    out.y = (m.uy * c + m.wy * s) * radius;
    out.z = (m.uz * c + m.wz * s) * radius;
  } else {
    out.x = m.ux * radius;
    out.y = m.uy * radius;
    out.z = m.uz * radius;
  }
  // One compare for the overwhelming majority of frames: offUntilMs is 0
  // except in the 300 ms after a batch has moved this aircraft.
  if (nowMs < m.offUntilMs) {
    const k = 1 - smoothstep01((nowMs - (m.offUntilMs - RECONCILE_MS)) / RECONCILE_MS);
    out.x += m.offX * k;
    out.y += m.offY * k;
    out.z += m.offZ * k;
  }
}

/**
 * Carry the drawing error from the previous batch into the new one (D22).
 *
 * When a tile comes back the aircraft jumps from where we were drawing it
 * to where the provider says it is. Two cases, different in KIND and not in
 * size:
 *
 *  - the gap is at most one ceiling of travel (velocityKt/3600 × DR_CAP_S,
 *    15 NM at 450 kt). That is exactly the error our own extrapolation
 *    could have made, so it is an error of DRAWING and it slides out over
 *    RECONCILE_MS. The target is always the real extrapolated position;
 *    what decays to nothing is the offset.
 *  - the gap is larger. Then it is not our error: it is a stretch of flight
 *    we never showed, because the tile had not come round for fourteen
 *    minutes. Gliding it in 300 ms would animate a journey at a speed no
 *    aircraft has. It jumps — and the jump is honest, because that aircraft
 *    was declared still before it moved.
 *
 * @param elapsedOnFreshS how long the NEW batch has already been running by
 *   the time this frame draws it. Not zero: the server stamps fetchedAt when
 *   it builds the body, so a batch can reach us already tens of seconds old
 *   (D31). Measuring the new position at its fix instead would invent an
 *   offset that was never on screen and slide the dot backwards once per
 *   cycle. The two elapsed values sit beside the motion they belong to,
 *   fresh first, so a caller cannot quietly swap them.
 * @param animate false under prefers-reduced-motion, which stops this 300
 *   ms animation and nothing else (D30).
 */
export function reconcile(
  fresh: Motion,
  elapsedOnFreshS: number,
  previous: Motion | null,
  elapsedOnPreviousS: number,
  nowMs: number,
  animate: boolean
): Motion {
  if (previous === null || !animate) return fresh;

  const was: Xyz = { x: 0, y: 0, z: 0 };
  const now: Xyz = { x: 0, y: 0, z: 0 };
  // 0, not the frame's shell, and the two reasons are different in kind.
  //
  // The first is availability: reconcile runs inside updateBatch, in the
  // store, OUTSIDE the render loop. There is no camera there, and giving
  // the store one — threading shellUnits through reconcile and down from
  // aircraftStore.ts:152 — would make a batch arrival depend on where the
  // camera happens to be pointing, which is a dependency this application
  // has never had and does not need.
  //
  // The second is correctness, and it is the better one. What reconcile
  // measures is an ANGULAR error: how far from the fix we were drawing an
  // aircraft when a new one arrived. Measuring it on the globe's own
  // surface makes `gapNm = |was − now| / GLOBE_RADIUS × NM_PER_RADIAN`
  // exactly what it already claimed to be, and it removes a defect that
  // was there before this plan: with the OLD per-aircraft radius an
  // aircraft climbing 8 000 ft between two batches moved 0,0098 units
  // radially, which reads as 22,4 NM of "gap" against a 15 NM budget — so
  // every climbing aircraft failed the budget test and SNAPPED instead of
  // sliding, for a climb, not for a drawing error.
  //
  // The price, measured: the offset is taken on the surface and then added
  // unchanged to a point one shell higher, so it is short by exactly
  // shell/GLOBE_RADIUS — 5 % at planet view, 0,2 % at the bottom of the
  // travel. On the largest correction that can exist, one DR_CAP_S of
  // travel at 450 kt = 15 NM, that is 0,75 NM = 0,06 px at planet view and
  // 0,03 NM = 0,3 px at 1,55, on a correction that is gone in 300 ms.
  // Sub-pixel at BOTH ends, which is why it is a price and not a defect.
  positionAt(previous, advanceSeconds(previous, elapsedOnPreviousS), nowMs, 0, was);
  positionAt(fresh, advanceSeconds(fresh, elapsedOnFreshS), nowMs, 0, now);

  const dx = was.x - now.x;
  const dy = was.y - now.y;
  const dz = was.z - now.z;
  // Chord over globe radius is the arc for the angles involved here: 15 NM
  // is 0,0044 rad, where chord and arc agree to one part in a million.
  const gapNm = (Math.hypot(dx, dy, dz) / GLOBE_RADIUS) * NM_PER_RADIAN;
  // Zero when the previous record was not extrapolable: nothing we drew can
  // have drifted, so there is nothing of ours to slide out.
  const budgetNm = (previous.omegaPerS * NM_PER_RADIAN) * DR_CAP_S;
  if (gapNm > budgetNm) return fresh;

  return {
    ...fresh,
    offX: dx,
    offY: dy,
    offZ: dz,
    offUntilMs: nowMs + RECONCILE_MS,
  };
}
