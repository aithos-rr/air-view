import { describe, it, expect } from 'vitest';
import {
  latLonToVec3,
  latLonAltToVec3,
  altitudeToOffset,
  visibleCapRadiusNm,
  GLOBE_RADIUS,
} from '@/globe/geoHelpers';

describe('latLonToVec3', () => {
  it('maps (0, 0) to (0, 0, R) (Equator, prime meridian → +z front)', () => {
    const v = latLonToVec3(0, 0, GLOBE_RADIUS);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(GLOBE_RADIUS, 5);
  });
  it('maps North Pole (90, 0) to (0, R, 0)', () => {
    const v = latLonToVec3(90, 0, GLOBE_RADIUS);
    expect(v.y).toBeCloseTo(GLOBE_RADIUS, 5);
  });
  it('maps (0, 90) East to (R, 0, 0) (positive X)', () => {
    const v = latLonToVec3(0, 90, GLOBE_RADIUS);
    expect(v.x).toBeCloseTo(GLOBE_RADIUS, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });
});

describe('altitudeToOffset', () => {
  it('returns small offset for 0 ft (ground)', () => {
    expect(altitudeToOffset(0)).toBeCloseTo(0.025, 5);
  });
  it('returns larger offset for 41000 ft (cruise)', () => {
    expect(altitudeToOffset(41000)).toBeCloseTo(0.075, 5);
  });
});

describe('latLonAltToVec3', () => {
  it('produces vector with magnitude = GLOBE_RADIUS + altitude offset', () => {
    const v = latLonAltToVec3(0, 0, 38000);
    expect(v.length()).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38000), 5);
  });
});

describe('visibleCapRadiusNm', () => {
  // The orbit controls in src/globe/scene.ts hold the camera between 3,0 and
  // 10,0 globe radii, with a 38 degree vertical FOV. Those two distances are
  // the ends of the only range the server can ever be told about.
  it('is limited by the frustum when the camera is close in', () => {
    // Zoomed all the way in the globe overflows the viewport, so the edge of
    // the screen decides what is visible, not the horizon — which alone
    // would claim 3 602 NM here.
    expect(visibleCapRadiusNm(3.0, 38)).toBeGreaterThan(1200);
    expect(visibleCapRadiusNm(3.0, 38)).toBeLessThan(1400);
  });

  it('is limited by the horizon once the whole globe fits in the view', () => {
    expect(visibleCapRadiusNm(10.0, 38)).toBeGreaterThan(4800);
    expect(visibleCapRadiusNm(10.0, 38)).toBeLessThan(4950);
  });

  it('grows with distance across the whole zoom range', () => {
    const at = [3.0, 4.0, 5.0, 7.0, 10.0].map((d) => visibleCapRadiusNm(d, 38));
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
  });

  it('stays under the ceiling the server enforces, at every zoom level', () => {
    // The assertion the previous revision could not have passed. With the
    // horizon-only formula the SMALLEST value the camera could produce was
    // 3 602 NM against a server ceiling of 2 000 NM, so every request arrived
    // clamped to exactly 2 000 and the zoom level never reached the server at
    // all. MAX_VIEW_RADIUS_NM is now 5 000, taken from the far end of this
    // very range, and nothing here reaches it.
    for (const d of [3.0, 5.0, 10.0]) expect(visibleCapRadiusNm(d, 38)).toBeLessThan(5000);
  });

  it('never reports more than the horizon, however wide the lens', () => {
    // A lens wide enough to contain the whole globe still cannot see past
    // the horizon, so beyond that width the FOV stops mattering.
    expect(visibleCapRadiusNm(3.0, 170)).toBe(visibleCapRadiusNm(3.0, 120));
    expect(visibleCapRadiusNm(3.0, 170)).toBeGreaterThan(3500);
    expect(visibleCapRadiusNm(3.0, 170)).toBeLessThan(3700);
  });

  it('survives a camera at or inside the surface', () => {
    // The orbit controls forbid it; a division by zero in a feed path is
    // worth one line of guard anyway.
    expect(Number.isFinite(visibleCapRadiusNm(GLOBE_RADIUS, 38))).toBe(true);
    expect(Number.isFinite(visibleCapRadiusNm(0, 38))).toBe(true);
  });
});
