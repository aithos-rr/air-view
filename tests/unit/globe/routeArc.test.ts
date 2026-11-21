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
} from '@/globe/routeArc';
import { GLOBE_RADIUS, vec3ToLatLon } from '@/globe/geoHelpers';

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
    const pts = geodesicPoints(JFK, LHR);
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
    const pts = geodesicPoints(JFK, LHR)!;
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
    expect(geodesicPoints(JFK, { ...JFK })).toBeNull();
  });

  it('refuses antipodal points, which have no unique great circle', () => {
    // sin(omega) is 0 here too, and an unguarded slerp writes NaN into the
    // position buffer: invisible geometry and no error anywhere.
    expect(geodesicPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeNull();
  });

  it('floats the whole arc above the surface so it is never inside the globe', () => {
    for (const p of geodesicPoints(JFK, LHR)!) {
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
    layer.update(null);
    expect(geometryOf(layer).drawRange.count).toBe(0);
  });

  it('draws the flown half dimmer than the half still ahead', () => {
    const layer = createRouteArcLayer();
    layer.update({ origin: JFK, destination: LHR, aircraft: MID });
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
    layer.update({ origin: JFK, destination: LHR, aircraft: null });
    const geom = geometryOf(layer);
    const count = geom.drawRange.count;
    const col = geom.getAttribute('color').array as Float32Array;
    expect(col[0]!).toBeCloseTo(col[(count - 1) * 3]!, 5);
  });
});
