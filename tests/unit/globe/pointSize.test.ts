import { describe, it, expect } from 'vitest';
import { pointSizePx, POINT_SCALE_COMPLETE, POINT_SCALE_SELECTED } from '@/globe/aircraft';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, visibleCapRadiusNm } from '@/globe/geoHelpers';

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
  it('stops where the tile grid can still name a tile under the viewer', () => {
    // tilesNear takes tiles whose CENTRE is inside the radius, and no
    // covered point is more than 218,0 NM from a centre (tileGrid.ts:60-62).
    // Below that the region on screen would quietly stop jumping the
    // queue, which is the mechanism D16 sizes the ceiling on.
    expect(visibleCapRadiusNm(CAMERA_NEAR_LIMIT, 38)).toBeGreaterThan(218);
  });

  it('leaves the aircraft shell in front of the near plane', () => {
    // Aircraft sit at most at 1,5 + 0,075 = 1,575 (geoHelpers.ts:23-25) and
    // the camera's near plane is 0,1 (scene.ts:39).
    expect(CAMERA_NEAR_LIMIT - 1.575).toBeGreaterThan(0.1);
  });
});
