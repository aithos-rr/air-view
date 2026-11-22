import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  latLonToVec3,
  latLonAltToVec3,
  altitudeToOffset,
  visibleCapRadiusNm,
  isInView,
  isOnNearSide,
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
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

describe('isInView — the frame, not the hemisphere', () => {
  /** three's VERTICAL field of view, as scene.ts mounts the camera. */
  const FOV = 38;
  /** Earth radii in NM: a cap half-angle in radians IS an arc length. */
  const NM_PER_RADIAN = 3440.065;
  const nmOf = (deg: number): number => ((deg * Math.PI) / 180) * NM_PER_RADIAN;

  it('refuses a point on the visible side that the lens does not reach', () => {
    // The whole reason this exists. At the near end of the travel the
    // visible SIDE reaches 37,9 degrees off the view axis and the frame
    // reaches 5,4: four fifths of what isOnNearSide calls visible is off
    // screen. Anything deciding whether the user can SEE something has to
    // ask the second question, not the first.
    const zoomedIn = new Vector3(0, 0, CAMERA_NEAR_LIMIT);
    const rightSideWrongPlace = latLonAltToVec3(0, 20, 38000);
    expect(isOnNearSide(zoomedIn, rightSideWrongPlace)).toBe(true);
    expect(isInView(zoomedIn, rightSideWrongPlace, FOV)).toBe(false);
  });

  it('draws its edge at the radius the server is told about', () => {
    // Not a second idea of what "on screen" means: the boundary IS
    // visibleCapRadiusNm, the number viewCentre() sends with every
    // position so the poller prioritises the tiles being looked at.
    const cam = new Vector3(0, 0, 3.0);
    const capNm = visibleCapRadiusNm(3.0, FOV); // 1 299 NM — 21,64 degrees
    expect(nmOf(21.5)).toBeLessThan(capNm);
    expect(nmOf(21.8)).toBeGreaterThan(capNm);
    expect(isInView(cam, latLonToVec3(0, 21.5), FOV)).toBe(true);
    expect(isInView(cam, latLonToVec3(0, 21.8), FOV)).toBe(false);
  });

  it('widens as the user zooms out, which is what the hemisphere never did', () => {
    // One point, two zoom levels, two answers. isOnNearSide says the same
    // thing at both: that is the defect in one line.
    const tenDegreesOff = latLonAltToVec3(0, 10, 38000);
    expect(isInView(new Vector3(0, 0, CAMERA_NEAR_LIMIT), tenDegreesOff, FOV)).toBe(false);
    expect(isInView(new Vector3(0, 0, 3.0), tenDegreesOff, FOV)).toBe(true);
    expect(isOnNearSide(new Vector3(0, 0, CAMERA_NEAR_LIMIT), tenDegreesOff)).toBe(true);
    expect(isOnNearSide(new Vector3(0, 0, 3.0), tenDegreesOff)).toBe(true);
  });

  it('refuses a point just over the limb that the rounding would admit', () => {
    // visibleCapRadiusNm rounds to whole NM, and at the far end of the
    // travel the rounded cap reaches 81,3785 degrees while the horizon is
    // at 81,3731. This point is inside the cap by the arithmetic and
    // behind the planet in fact, and a point you cannot see is not in
    // view whatever the arithmetic rounds to.
    const cam = new Vector3(0, 0, CAMERA_FAR_LIMIT);
    const justOverTheLimb = latLonToVec3(0, 81.376);
    expect(nmOf(81.376)).toBeLessThan(visibleCapRadiusNm(CAMERA_FAR_LIMIT, FOV));
    expect(isOnNearSide(cam, justOverTheLimb)).toBe(false);
    expect(isInView(cam, justOverTheLimb, FOV)).toBe(false);
  });

  it('is always true straight ahead, and never true straight behind', () => {
    for (const d of [CAMERA_NEAR_LIMIT, 3.0, CAMERA_FAR_LIMIT]) {
      const cam = new Vector3(0, 0, d);
      expect(isInView(cam, latLonAltToVec3(0, 0, 38000), FOV)).toBe(true);
      expect(isInView(cam, latLonAltToVec3(0, 180, 38000), FOV)).toBe(false);
    }
  });
});
