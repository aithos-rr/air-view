import { describe, it, expect } from 'vitest';
import { pointSizePx, POINT_SCALE_COMPLETE, POINT_SCALE_SELECTED } from '@/globe/aircraft';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_MOUNT_DISTANCE,
  CAMERA_NEAR_LIMIT,
  CAMERA_NEAR_LIMIT_BEFORE_DETAIL,
  CAMERA_NEAR_PLANE,
  GLOBE_RADIUS,
  altitudeToOffset,
  visibleCapRadiusNm,
} from '@/globe/geoHelpers';

/** The viewport the measurements in the plan are taken on. */
const SCREEN_H = 1080;
/** Mean nearest-neighbour distance over Europe: 0,5/sqrt(4 000 / (2 000 × 1 500)). */
const CROWD_NM = 13.7;

function nmPerPixel(d: number): number {
  return (2 * visibleCapRadiusNm(d, 38)) / SCREEN_H;
}

describe('pointSizePx — the symbol stops growing with the geography', () => {
  it('grows far more slowly than the view does', () => {
    // The whole defect in one assertion. The old formula was
    // uSize * uPixelRatio * (4 / -mv.z): a perspective divide, so the dot
    // grew exactly as fast as the ground under it and two aircraft that
    // overlapped at planet view overlapped at every zoom (spec §4.2).
    const zoomGain = nmPerPixel(CAMERA_FAR_LIMIT) / nmPerPixel(CAMERA_NEAR_LIMIT);
    const sizeGain = pointSizePx(CAMERA_NEAR_LIMIT) / pointSizePx(CAMERA_FAR_LIMIT);
    expect(zoomGain).toBeGreaterThan(4);
    expect(sizeGain).toBeLessThan(zoomGain / 2);
  });

  it('separates the densest real crowd at the near end of the travel', () => {
    // 4 000 aircraft over Europe sit 13,7 NM apart on average. At the
    // bottom of the new travel that is 23 px, against a symbol of 14.
    const spacingPx = CROWD_NM / nmPerPixel(CAMERA_NEAR_LIMIT);
    expect(spacingPx).toBeGreaterThan(pointSizePx(CAMERA_NEAR_LIMIT) * 1.5);
  });

  it('is smaller at the OLD near limit than the old formula was', () => {
    // At d = 3,0 the old quad was 138,7 device px while the neighbour was
    // 11,4 away: an overlap of a factor seven, which no zoom could undo.
    expect(pointSizePx(3.0) * 2).toBeLessThan(40);
  });

  it('never leaves the travel, whatever distance it is handed', () => {
    expect(pointSizePx(0)).toBe(pointSizePx(CAMERA_NEAR_LIMIT));
    expect(pointSizePx(1e6)).toBe(pointSizePx(CAMERA_FAR_LIMIT));
    expect(Number.isFinite(pointSizePx(Number.NaN))).toBe(true);
  });

  it('keeps the hierarchy in the SIZE, because the blending cannot keep it in the order', () => {
    // aircraft.ts:140-143 blends additively with depthWrite false, and
    // addition is commutative: renderOrder cannot bury a complete aircraft
    // under grey noise, whatever the comment at line 223 says. Size can (D27).
    expect(POINT_SCALE_COMPLETE).toBeGreaterThan(1);
    expect(POINT_SCALE_SELECTED).toBeGreaterThan(POINT_SCALE_COMPLETE);
  });
});

describe('the camera travel is one declaration', () => {
  it('no longer depends on the tile grid, because the server stopped needing it to', () => {
    // Plan 2 asserted visibleCapRadiusNm(NEAR) > 218 here, and that was
    // right while tilesNear was the only way a viewport reached the
    // scheduler. nearestCoveringTile prioritises the tile that CONTAINS the
    // centre whatever the radius, so the floor is free to follow the
    // separation arithmetic instead (D38). The assertion that replaces it is
    // in tests/unit/data/sources/tileGrid.test.ts — the path that actually
    // exists; an earlier draft of this plan named it one directory too high
    // and put that non-path on a `git add` line, where a pathspec matching
    // nothing exits 1 and takes the && chain, and the commit, with it.
    expect(visibleCapRadiusNm(CAMERA_NEAR_LIMIT, 38)).toBeGreaterThan(0);
  });

  it('leaves the aircraft shell in front of the near plane', () => {
    // The shell is no longer a constant 0,075: it thins with the zoom, so
    // the clearance is checked against the shell AT this distance (D36/D37).
    const top = GLOBE_RADIUS + altitudeToOffset(41_000, CAMERA_NEAR_LIMIT);
    expect(CAMERA_NEAR_LIMIT - top).toBeGreaterThan(CAMERA_NEAR_PLANE);
  });
});

describe('the new stretch of travel is a tail, not a rescaling', () => {
  /** aircraft.ts in the deployed build, where the floor was 1,9. */
  const shipped = (d: number): number => {
    const c = Math.min(Math.max(d, 1.9), CAMERA_FAR_LIMIT);
    const t = Math.log(CAMERA_FAR_LIMIT / c) / Math.log(CAMERA_FAR_LIMIT / 1.9);
    return 7 + (14 - 7) * t;
  };

  it('keeps the symbol the size it was at every distance the camera could already reach', () => {
    // Normalising on log(FAR / 1,55) instead of log(FAR / 1,9) moved the
    // symbol at every distance except exactly 10,0 — 10,101 px to 9,762 px
    // at the mount, 3,4 % smaller, on a view the user was told would not
    // change (D48).
    for (const d of [1.9, 2.5, 3, 4, CAMERA_MOUNT_DISTANCE, 6, 8, CAMERA_FAR_LIMIT]) {
      expect(Math.abs(pointSizePx(d) - shipped(d))).toBeLessThan(1e-12);
    }
  });

  it('stops growing below the old floor, so the geography separates and the symbol does not', () => {
    expect(pointSizePx(CAMERA_NEAR_LIMIT)).toBe(pointSizePx(CAMERA_NEAR_LIMIT_BEFORE_DETAIL));
    expect(pointSizePx(CAMERA_NEAR_LIMIT)).toBe(14);
  });
});
