import { describe, it, expect } from 'vitest';
import {
  DR_CAP_S,
  RECONCILE_MS,
  STILL,
  advanceFor,
  advanceSeconds,
  deriveMotion,
  positionAt,
  reconcile,
} from '@/globe/deadReckoning';
import { GLOBE_RADIUS, latLonAltToVec3, vec3ToLatLon } from '@/globe/geoHelpers';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Motion } from '@/types';
import { Vector3 } from 'three';

/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

function motion(over: Parameters<typeof makeAircraftRaw>[0] = {}, fetchedAt = 1_000): Motion {
  const m = deriveMotion(makeAircraftRaw({ lastContact: 1_000, ...over }), fetchedAt);
  if (m === null) throw new Error('expected a motion');
  return m;
}

/** Where positionAt puts this aircraft, back in degrees. */
function atDeg(m: Motion, advanceS: number, nowMs = 0): { lat: number; lon: number } {
  const out = { x: 0, y: 0, z: 0 };
  positionAt(m, advanceS, nowMs, out);
  return vec3ToLatLon(new Vector3(out.x, out.y, out.z));
}

describe('deriveMotion', () => {
  it('refuses an aircraft with no position, because there is nothing to advance', () => {
    // The adapters write null rather than invent a coordinate
    // (src/data/sources/adsbLol.ts:30-31). Such a record has never been a
    // dot and must not become one here.
    expect(deriveMotion(makeAircraftRaw({ latitude: null }), 1_000)).toBeNull();
    expect(deriveMotion(makeAircraftRaw({ longitude: null }), 1_000)).toBeNull();
  });

  it('puts the unit vector exactly where latLonToVec3 puts the aircraft', () => {
    // One convention, two formulas: if they ever disagree the aircraft
    // leaves its own trail behind on the first frame.
    const m = motion({ latitude: 50, longitude: -10, baroAltitudeFt: 38_000 });
    const expected = latLonAltToVec3(50, -10, 38_000);
    const out = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, out);
    expect(out.x).toBeCloseTo(expected.x, 6);
    expect(out.y).toBeCloseTo(expected.y, 6);
    expect(out.z).toBeCloseTo(expected.z, 6);
  });

  it('declares an aircraft with no heading non-extrapolable', () => {
    // 89,6% of the fleet reports a compass track (spec §5.1). The other
    // tenth is not a hypothetical, and guessing a heading for it would be
    // a plausible value in the place of a missing one.
    expect(motion({ headingDeg: null }).extrapolable).toBe(false);
    expect(motion({ velocityKt: null }).extrapolable).toBe(false);
    expect(motion({ lastContact: null }).extrapolable).toBe(false);
    expect(motion().extrapolable).toBe(true);
  });

  it('measures the age of the fix against the batch, not against the local clock', () => {
    // Two wall instants, subtracted ONCE (D21). v1 compared lastContact
    // with the local clock on every tick and deleted the whole fleet the
    // day the feed stopped.
    expect(motion({ lastContact: 940 }, 1_000).fixAgeAtBatchS).toBe(60);
  });

  it('floors a negative age at zero rather than flying the aircraft backwards', () => {
    // The provider's clock and ours are two wall clocks; neither is a
    // stopwatch, and the provider's can be the one that is ahead.
    expect(motion({ lastContact: 1_010 }, 1_000).fixAgeAtBatchS).toBe(0);
  });
});

describe('advanceSeconds — the ceiling', () => {
  it('advances a fresh fix by its real age', () => {
    expect(advanceSeconds(motion({ lastContact: 970 }, 1_000), 10)).toBeCloseTo(40, 6);
  });

  it('refuses to advance past the ceiling instead of advancing a little less', () => {
    // 120 s is 60 s of tile floor (tileGrid.ts:164) plus 30 s of client
    // refresh (aircraftStream.ts:13) plus 30 s of margin. Past it we would
    // be painting over our OWN staleness, which is the v1 outage.
    const old = motion({ lastContact: 1_000 - DR_CAP_S - 1 }, 1_000);
    expect(advanceSeconds(old, 0)).toBe(STILL);
  });

  it('stops advancing the moment the ceiling is crossed mid-frame', () => {
    const m = motion({ lastContact: 1_000 - DR_CAP_S + 2 }, 1_000);
    expect(advanceSeconds(m, 1)).toBeCloseTo(DR_CAP_S - 1, 6);
    expect(advanceSeconds(m, 3)).toBe(STILL);
  });

  it('never advances an aircraft it cannot extrapolate, however fresh', () => {
    expect(advanceSeconds(motion({ headingDeg: null }, 1_000), 0)).toBe(STILL);
  });

  it('advances an aircraft at rest by zero, which is the truth about it', () => {
    // On the ground at 0 kt every field is present: it IS being advanced,
    // and the distance happens to be nothing. Calling it "still" would
    // report a missing measurement we have.
    const parked = motion({ velocityKt: 0, onGround: true }, 1_000);
    expect(advanceSeconds(parked, 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('advanceFor — the single answer the walk, the picker and the line share', () => {
  it('carries nothing forward while the server calls the body a photograph', () => {
    // The ceiling of D16 exists for the case where the feed has stopped,
    // and that is the one case it could never see: the server stamps
    // fetchedAt when it BUILDS the body and then serves that same body
    // for up to maxStaleMs = 600 s (server/feedState.ts), so an age
    // counted from that stamp stood still while the world moved on. The
    // flag is the server's own statement, computed on the server's own
    // clock, and it is immune to anything our two wall clocks do (D31).
    const fresh = motion({ lastContact: 1_000 }, 1_000);
    expect(advanceFor(fresh, 0, false)).toBe(0);
    expect(advanceFor(fresh, 0, true)).toBe(STILL);
  });

  it('has nothing to carry forward for a record with no motion at all', () => {
    // Every Aircraft built outside updateBatch is in this state, which is
    // every one in the unit suite: a measured position with no way to
    // advance it. One function answers for it too, so the walk that counts
    // and the picker that clicks cannot reach two different conclusions
    // about the same dot (D19/D29).
    expect(advanceFor(null, 90, false)).toBe(STILL);
  });
});

describe('positionAt — the great circle, not the rhumb line', () => {
  it('carries an aircraft the distance its own speed says', () => {
    // 450 kt for 120 s is 15,0 NM. Measured as travelled arc, which is
    // what a great circle gives and a lat/lon interpolation does not.
    const m = motion({ latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 });
    const before = latLonAltToVec3(50, -10, 38_000).normalize();
    const p = atDeg(m, 120);
    const after = latLonAltToVec3(p.lat, p.lon, 38_000).normalize();
    const nm = Math.acos(Math.min(1, before.dot(after))) * NM_PER_RADIAN;
    expect(nm).toBeCloseTo(15.0, 1);
  });

  it('turns north into a rise in latitude and east into a rise in longitude', () => {
    const north = motion({ latitude: 0, longitude: 0, velocityKt: 600, headingDeg: 0 });
    expect(atDeg(north, 60).lat).toBeGreaterThan(0);
    expect(atDeg(north, 60).lon).toBeCloseTo(0, 6);
    const east = motion({ latitude: 0, longitude: 0, velocityKt: 600, headingDeg: 90 });
    expect(atDeg(east, 60).lon).toBeGreaterThan(0);
    expect(atDeg(east, 60).lat).toBeCloseTo(0, 6);
  });

  it('bows poleward of the straight lat/lon line between its own two ends', () => {
    // The lie this formula exists to avoid, measured the way Plan 3
    // measured it on JFK->LHR: 52,21 N on the geodesic against 46,06 N on
    // the lat/lon line, at the same longitude (routeArc.ts:82-98).
    //
    // Clairaut: cos(lat) x sin(track) is constant along a great circle.
    // From 60 N on track 065 that constant is cos 60 x sin 65 = 0,453154,
    // so the track climbs to its vertex at arccos 0,453154 = 63,054 N
    // after 823,3 NM — 5 927,7 s at 500 kt — and symmetry brings it back
    // to 60,000 N after twice that. Its two ends therefore sit at the SAME
    // latitude, 56,60 deg of longitude apart, and the path between them
    // bulges 3,05 deg = 183 NM north of the straight line joining them.
    //
    // The same leg flown as a rhumb line — track 065 held all the way,
    // which is what advancing lat/lon by its components draws — ends at
    // 71,598 N, 696 NM away. No tolerance can confuse the two.
    const TO_VERTEX_S = 5_927.7;
    const m = motion({ latitude: 60, longitude: 0, velocityKt: 500, headingDeg: 65 });
    const vertex = atDeg(m, TO_VERTEX_S);
    const far = atDeg(m, TO_VERTEX_S * 2);

    expect(far.lat).toBeCloseTo(60, 3); // back where it started, 56,6 deg east
    expect(vertex.lat).toBeCloseTo(63.054, 2); // the Clairaut vertex, computed above
    expect(vertex.lat - far.lat).toBeGreaterThan(3); // 183 NM north of its own chord

    const rhumbLat = 60 + ((500 / 3600) * TO_VERTEX_S * 2 * Math.cos(65 * (Math.PI / 180))) / 60;
    expect(rhumbLat).toBeCloseTo(71.598, 2);
    expect(far.lat).toBeLessThan(rhumbLat - 11);
  });

  it('lets a due-EAST leg from 60 N only fall, because it starts on its own vertex', () => {
    // Kept as a test and not as a comment, because an earlier draft of
    // this plan asserted it backwards and sent the implementer to "fix"
    // correct arithmetic.
    //
    // Flying exactly 090 from 60 N makes the Clairaut constant
    // cos 60 x sin 90 = 0,5, which is the largest that product can be:
    // 60 N IS the vertex of that great circle and every point after it is
    // lower. A correct geodesic CANNOT climb out of this one, and an
    // implementation that makes it climb is drawing the rhumb line.
    //
    // It is also a poor discriminator at the ceiling: over 120 s the
    // geodesic and the rhumb line differ by 0,0012 deg — 0,06 NM, a tenth
    // of a pixel even at the deepest zoom this plan reaches (0,60 NM/px).
    // Which is why the test above flies for an hour and a half: positionAt
    // is pure geometry and the ceiling lives in advanceSeconds.
    const m = motion({ latitude: 60, longitude: 0, velocityKt: 500, headingDeg: 90 });
    expect(atDeg(m, 3_600).lat).toBeLessThan(60);
    expect(atDeg(m, 3_600).lat).toBeCloseTo(58.9696, 3);
    expect(atDeg(m, 3_600).lon).toBeGreaterThan(0);
  });

  it('keeps the aircraft on its own altitude shell while it moves', () => {
    const m = motion({ latitude: 20, longitude: 30, baroAltitudeFt: 41_000, velocityKt: 500 });
    const out = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, out);
    const r0 = Math.hypot(out.x, out.y, out.z);
    positionAt(m, 100, 0, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(r0, 9);
    expect(r0).toBeGreaterThan(GLOBE_RADIUS);
  });
});

describe('reconcile — our drawing error slides, a stretch of flight jumps', () => {
  const PREV = { lastContact: 1_000, latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };

  it('slides an error no larger than one ceiling of travel', () => {
    // 15 NM at 450 kt is exactly what our own extrapolation could have got
    // wrong in 120 s. Absorbing it over 300 ms corrects a DRAWING.
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    expect(out.offUntilMs).toBe(5_000 + RECONCILE_MS);
    expect(Math.hypot(out.offX, out.offY, out.offZ)).toBeGreaterThan(0);
  });

  it('aims at where the fresh batch will be DRAWN, not at its fix', () => {
    // A body the server built 40 s before it reached us is 40 s of flight
    // further on by the time the first frame draws it (D31). Both elapsed
    // arguments are therefore real: measuring the fresh batch at its fix
    // while the previous one has been running for 40 s invents a five-mile
    // error that was never on screen, and slides the dot BACKWARDS once
    // every cycle, for ever.
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(makeAircraftRaw({ ...PREV, lastContact: 1_060 }), 1_060)!;

    // Same track, same speed, both running for the same 40 s: the two
    // positions coincide and there is nothing of ours to slide out.
    const out = reconcile(fresh, 40, previous, 40, 5_000, true);
    expect(Math.hypot(out.offX, out.offY, out.offZ)).toBeCloseTo(0, 9);

    // The same call with the fresh batch measured at its fix invents one.
    const wrong = reconcile(fresh, 0, previous, 40, 5_000, true);
    expect(Math.hypot(wrong.offX, wrong.offY, wrong.offZ)).toBeGreaterThan(0.001);
  });

  it('snaps when the gap is flight nobody showed', () => {
    // A tile that has not come round for fourteen minutes brings the
    // aircraft back 100 NM away. Gliding that in 300 ms would animate a
    // journey at Mach 1200 (D22).
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_900, longitude: 3 }),
      1_900
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    expect(out.offUntilMs).toBe(0);
    expect(out.offX).toBe(0);
  });

  it('snaps when the viewer asked for less motion', () => {
    // prefers-reduced-motion stops the 300 ms animation, not the dead
    // reckoning — the target is identical either way (D30).
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    expect(reconcile(fresh, 0, previous, 0, 5_000, false).offUntilMs).toBe(0);
  });

  it('has nothing to reconcile on the first batch', () => {
    const fresh = motion(PREV, 1_000);
    expect(reconcile(fresh, 0, null, 0, 5_000, true).offUntilMs).toBe(0);
  });

  it('decays the offset to nothing by the end of the window, and no further', () => {
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    const start = atDeg(out, advanceSeconds(out, 0), 5_000);
    const end = atDeg(out, advanceSeconds(out, 0), 5_000 + RECONCILE_MS);
    const after = atDeg(out, advanceSeconds(out, 0), 5_000 + RECONCILE_MS * 3);
    expect(start.lon).not.toBeCloseTo(end.lon, 4);
    expect(after.lon).toBeCloseTo(end.lon, 9);
  });
});
