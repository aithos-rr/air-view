import { describe, it, expect } from 'vitest';
import type { LineSegments } from 'three';
import {
  ARC_COLOR,
  MIN_ARC_SAMPLES,
  MAX_ARC_SAMPLES,
  greatCircleRad,
  arcSampleCount,
  geodesicPoints,
  flownFraction,
  createRouteArcLayer,
  ARC_BASE_FRAC,
  ARC_APEX_MIN_FRAC,
  ARC_APEX_RANGE_FRAC,
} from '@/globe/routeArc';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  CAMERA_NEAR_PLANE,
  COASTLINE_LIFT,
  GLOBE_RADIUS,
  altitudeToOffset,
  shellThicknessUnits,
  vec3ToLatLon,
} from '@/globe/geoHelpers';

const JFK = { lat: 40.6398, lon: -73.7789 };
const LHR = { lat: 51.4706, lon: -0.461941 };
// The true great-circle midpoint, computed 2026-11-21. Note it is NORTH of
// both airports — a linear lat/lon interpolation lands at 46,06.
const MID = { lat: 52.215, lon: -41.307 };

function geometryOf(layer: ReturnType<typeof createRouteArcLayer>): LineSegments['geometry'] {
  const child = layer.group.children[0];
  if (!child) throw new Error('arc layer has no drawable child');
  return (child as LineSegments).geometry;
}

describe('geodesic arc', () => {
  it('uses the one accent colour reserved for selection', () => {
    expect(ARC_COLOR).toEqual([0.16, 0.59, 1.0]); // #2997ff
  });

  it('measures the angle at the centre of the Earth, and feeds it to the sampler', () => {
    // greatCircleRad is imported here because it is EXERCISED here. With
    // `noUnusedLocals: true` and `tests` inside the include list of
    // tsconfig.json, an import nobody reads is TS6133 — and `tsc --noEmit`
    // is the first half of `npm run build`, so a decorative import stops
    // the build gate of this task and of Tasks 7, 8 and 9 with it.
    // Computed 2026-11-21: JFK->LHR subtends 0,8695 rad = 49,82 deg =
    // 2 991 NM, and that angle is the only input the sampler has.
    expect(greatCircleRad(JFK, LHR)).toBeCloseTo(0.8695, 3);
    expect(greatCircleRad(JFK, { ...JFK })).toBeCloseTo(0, 6);
    expect(arcSampleCount(greatCircleRad(JFK, LHR))).toBe(71);
  });

  it('starts and ends exactly on the two airports', () => {
    const pts = geodesicPoints(JFK, LHR, shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(pts).not.toBeNull();
    const first = vec3ToLatLon(pts![0]!);
    const last = vec3ToLatLon(pts![pts!.length - 1]!);
    expect(first.lat).toBeCloseTo(JFK.lat, 4);
    expect(first.lon).toBeCloseTo(JFK.lon, 4);
    expect(last.lat).toBeCloseTo(LHR.lat, 4);
    expect(last.lon).toBeCloseTo(LHR.lon, 4);
  });

  it('bends NORTH of both airports — a great circle, not a rhumb line', () => {
    // The whole reason this module exists. Interpolating lat/lon linearly
    // would put the midpoint at 46,06 N, south of London; the real route
    // passes at 52,2 N. Drawing the straight one is a geometric lie
    // visible to anyone who knows the North Atlantic tracks.
    const pts = geodesicPoints(JFK, LHR, shellThicknessUnits(CAMERA_FAR_LIMIT))!;
    const mid = vec3ToLatLon(pts[Math.floor(pts.length / 2)]!);
    expect(mid.lat).toBeGreaterThan(LHR.lat);
    expect(mid.lat).toBeCloseTo(MID.lat, 0);
  });

  it('samples more densely the longer the arc, within its bounds', () => {
    const short = arcSampleCount(0.02);
    const long = arcSampleCount(Math.PI * 0.95);
    expect(short).toBe(MIN_ARC_SAMPLES);
    expect(long).toBeLessThanOrEqual(MAX_ARC_SAMPLES);
    expect(long).toBeGreaterThan(short);
  });

  it('refuses two coincident points instead of dividing by zero', () => {
    expect(geodesicPoints(JFK, { ...JFK }, shellThicknessUnits(CAMERA_FAR_LIMIT))).toBeNull();
  });

  it('refuses antipodal points, which have no unique great circle', () => {
    // sin(omega) is 0 here too, and an unguarded slerp writes NaN into the
    // position buffer: invisible geometry and no error anywhere.
    expect(geodesicPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, shellThicknessUnits(CAMERA_FAR_LIMIT))).toBeNull();
  });

  it('floats the whole arc above the surface so it is never inside the globe', () => {
    for (const p of geodesicPoints(JFK, LHR, shellThicknessUnits(CAMERA_FAR_LIMIT))!) {
      expect(p.length()).toBeGreaterThan(GLOBE_RADIUS);
    }
  });

  it('measures how much of the route has been flown, and clamps outside it', () => {
    expect(flownFraction(JFK, LHR, JFK)).toBeCloseTo(0, 3);
    expect(flownFraction(JFK, LHR, LHR)).toBeCloseTo(1, 3);
    expect(flownFraction(JFK, LHR, MID)).toBeCloseTo(0.5, 1);
    // A diverted aircraft past its destination must not produce a fraction
    // above 1 and index past the end of the buffer.
    expect(flownFraction(JFK, LHR, { lat: 55, lon: 20 })).toBeLessThanOrEqual(1);
  });

  it('draws nothing at all when there is no route — the grey case', () => {
    // Spec §6.2: clicking a grey aircraft focuses it and says "Route
    // unknown". No arc, no estimate, no dashed guess.
    const layer = createRouteArcLayer();
    layer.update(null, shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(geometryOf(layer).drawRange.count).toBe(0);
  });

  it('draws the flown half dimmer than the half still ahead', () => {
    const layer = createRouteArcLayer();
    layer.update({ origin: JFK, destination: LHR, aircraft: MID }, shellThicknessUnits(CAMERA_FAR_LIMIT));
    const geom = geometryOf(layer);
    const count = geom.drawRange.count;
    expect(count).toBeGreaterThan(0);
    const col = geom.getAttribute('color').array as Float32Array;
    expect(col[0]!).toBeLessThan(col[(count - 1) * 3]!);
  });

  it('draws one even arc when no aircraft sits on it', () => {
    // Search outcome 2: the flight is known to us but outside ADS-B
    // coverage. There is no aircraft, so there is no "already flown".
    const layer = createRouteArcLayer();
    layer.update({ origin: JFK, destination: LHR, aircraft: null }, shellThicknessUnits(CAMERA_FAR_LIMIT));
    const geom = geometryOf(layer);
    const count = geom.drawRange.count;
    const col = geom.getAttribute('color').array as Float32Array;
    expect(col[0]!).toBeCloseTo(col[(count - 1) * 3]!, 5);
  });
});

/**
 * The three routes §2.7 measured, and they are three different KINDS of
 * failure rather than three samples of one: a short hop whose apex lands
 * just inside the near plane, a long haul whose apex lands well inside it,
 * and a near antipodal route whose apex lands BEHIND the camera. A single
 * threshold test would have passed on two of the three.
 */
const ARC_CASES = [
  { name: 'LHR→CDG, short hop', a: { lat: 51.4775, lon: -0.4614 }, b: { lat: 49.0097, lon: 2.5479 } },
  { name: 'JFK→LHR, long haul', a: { lat: 40.6413, lon: -73.7781 }, b: { lat: 51.47, lon: -0.4543 } },
  { name: 'MAD→AKL, near antipodal', a: { lat: 40.4719, lon: -3.5626 }, b: { lat: -37.0082, lon: 174.785 } },
];

describe('the route arc rides the shell the aircraft ride', () => {
  it('is bit-for-bit what it was at planet view', () => {
    // "Vorrei mantenere la stessa grafica" is the constraint, and these
    // three products are exact in double precision — not nearly exact.
    const far = shellThicknessUnits(CAMERA_FAR_LIMIT);
    expect(far * ARC_BASE_FRAC).toBe(0.018);
    expect(far * ARC_APEX_MIN_FRAC).toBe(0.012);
    expect(far * ARC_APEX_RANGE_FRAC).toBe(0.055);
  });

  it('stays in front of the near plane at the bottom of the travel, on all three', () => {
    // The defect, in one loop. At 1,55 with the old absolute offsets the
    // short hop's apex was 0,019044 from the camera — inside a near plane
    // of 0,02 — the long haul's 0,004776, and the near antipodal one's
    // −0,033871, i.e. behind the camera. The user is taken to the flight
    // and the route they asked for is not there (D46).
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    for (const c of ARC_CASES) {
      for (const p of geodesicPoints(c.a, c.b, shell)!) {
        // Worst case for a camera that always looks at the origin: the
        // point sits straight under it, so its clearance is d − |p|.
        expect(CAMERA_NEAR_LIMIT - p.length(), `${c.name}`).toBeGreaterThan(
          CAMERA_NEAR_PLANE
        );
      }
    }
  });

  it('never puts a vertex behind the camera, on all three', () => {
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    for (const c of ARC_CASES) {
      for (const p of geodesicPoints(c.a, c.b, shell)!) {
        expect(p.length(), `${c.name}`).toBeLessThan(CAMERA_NEAR_LIMIT);
      }
    }
  });

  it('keeps the same ratio to the shell at EVERY distance, which is what stops it separating', () => {
    // Not a threshold: a ratio. A flight and its route come apart WHILE
    // zooming exactly when this ratio moves, and no single-distance
    // assertion can see that.
    //
    // Stated on the apex HEIGHT and not on the bare ratio, for the reason
    // §2.7 states the coastline's invariant on two constants and the buffer's
    // on one ulp: the ratio is (|p| − R) / shell, and |p| is a float64 radius
    // of about 1,5 that a near antipodal slerp and a square root leave about
    // 3,4e-14 units of rounding on — MEASURED, and constant across distances:
    // 2,14e-14, 3,17e-14, 3,43e-14, 3,49e-14 at d = 6; 3; 1,9; 1,55. Dividing
    // that by a shell that shrinks 25-fold turns one fixed rounding error
    // into 6,9e-13 … 1,16e-11 of RATIO, so a fixed tolerance on the ratio
    // asks for 7 ulps at the near end and 155 at the far one. Multiplying it
    // back by the shell asks the same thing at both: that the apex sits where
    // the fraction says, to within 1e-12 units — 6e-9 px at the bottom of the
    // travel. The exact statement about planet view is the === above.
    for (const c of ARC_CASES) {
      const ratios: number[] = [];
      const shells: number[] = [];
      for (const d of [CAMERA_FAR_LIMIT, 6, 3, 1.9, CAMERA_NEAR_LIMIT]) {
        const shell = shellThicknessUnits(d);
        const pts = geodesicPoints(c.a, c.b, shell)!;
        const apex = Math.max(...pts.map((p) => p.length()));
        ratios.push((apex - GLOBE_RADIUS) / shell);
        shells.push(shell);
      }
      for (let i = 0; i < ratios.length; i++) {
        expect(Math.abs(ratios[i]! - ratios[0]!) * shells[i]!, c.name).toBeLessThan(1e-12);
      }
    }
  });

  it('passes under the aircraft that flies it and over the coastline, at both ends', () => {
    // The arc's floor is 0,24 of the shell: below the aircraft floor of
    // 1/3 and above COASTLINE_LIFT (D46/D47). Both halves at both ends of
    // the travel, because an ordering that holds only at planet view is
    // the ordering this plan is here to fix.
    for (const d of [CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT]) {
      const shell = shellThicknessUnits(d);
      const pts = geodesicPoints(ARC_CASES[0]!.a, ARC_CASES[0]!.b, shell)!;
      const lowest = Math.min(...pts.map((p) => p.length())) - GLOBE_RADIUS;
      expect(lowest, `d=${d}`).toBeLessThan(altitudeToOffset(0, d));
      expect(lowest, `d=${d}`).toBeGreaterThan(COASTLINE_LIFT);
    }
  });
});
