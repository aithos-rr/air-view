import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, GLOBE_RADIUS, isOnNearSide, latLonAltToVec3 } from '@/globe/geoHelpers';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, lat: number, lon: number): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao, latitude: lat, longitude: lon }), trail: [] };
}

describe('isOnNearSide — the exact horizon, not a constant', () => {
  it('accepts the point under the camera and refuses its antipode', () => {
    const cam = new Vector3(0, 0, CAMERA_FAR_LIMIT);
    expect(isOnNearSide(cam, latLonAltToVec3(0, 0, 38_000))).toBe(true);
    expect(isOnNearSide(cam, latLonAltToVec3(0, 180, 38_000))).toBe(false);
  });

  it('moves with the camera, which a hard-coded 0.05 cannot', () => {
    // dot(C, P) >= R^2 is the condition for P to be on the near side. At
    // d = 15,0 that threshold is cos = 0,0968 and at d = 1,9 it is 0,764:
    // the 0.05 in raycaster.ts:38, leaderLine.ts:19 and airportMarkers.ts:57
    // is not an approximation of either, it is wrong at both ends.
    const edge = latLonAltToVec3(0, 80, 38_000);
    expect(isOnNearSide(new Vector3(0, 0, CAMERA_FAR_LIMIT), edge)).toBe(true);
    expect(isOnNearSide(new Vector3(0, 0, CAMERA_NEAR_LIMIT), edge)).toBe(false);
  });

  it('agrees with the expression the vertex shader uses', () => {
    // The same algebra in two languages, which is the only way the picker
    // and the renderer can be made to agree (D25).
    const cam = new Vector3(0, 0, 4);
    const p = latLonAltToVec3(20, 55, 38_000);
    expect(isOnNearSide(cam, p)).toBe(cam.dot(p) >= GLOBE_RADIUS * GLOBE_RADIUS);
  });
});

describe('coincident aircraft take turns under the cursor (D26)', () => {
  const camera = new PerspectiveCamera(38, 1.6, 0.1, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = { clientWidth: 800, clientHeight: 500 } as HTMLCanvasElement;
  // Two aircraft a fifth of a degree apart: one pixel at planet view.
  const fleet = [ac('a1', 0, 0), ac('a2', 0.2, 0)];

  it('returns the nearest one when nothing came before', () => {
    const hit = findAircraftAtPointer(new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL);
    expect(hit).toBe('a1');
  });

  it('returns the NEXT one when the same pixel is clicked again', () => {
    // No clustering: the spec calls it an anti-reference, and the additive
    // blending already brightens a pile-up, which is a density cue nobody
    // had to invent a number for. The ambiguity is settled by the click.
    const first = findAircraftAtPointer(new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL);
    const second = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, first
    );
    expect(second).toBe('a2');
  });

  it('wraps round rather than running out', () => {
    const third = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, 'a2'
    );
    expect(third).toBe('a1');
  });

  it('ignores an `after` that is not under the cursor at all', () => {
    const hit = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, 'zzzzzz'
    );
    expect(hit).toBe('a1');
  });

  it('refuses an aircraft behind the planet, whatever the zoom', () => {
    const far = [ac('b1', 0, 180)];
    expect(findAircraftAtPointer(new Vector2(0, 0), far, camera, canvas, SHOW_ALL)).toBeNull();
  });
});
