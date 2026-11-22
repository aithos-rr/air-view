import { describe, it, expect } from 'vitest';
import type { Object3D, Points } from 'three';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { createAircraftLayer } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import { DR_CAP_S, STILL_DIM, deriveMotion } from '@/globe/deadReckoning';
import { latLonAltToVec3 } from '@/globe/geoHelpers';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft, AircraftRaw } from '@/types';

function ac(over: Partial<AircraftRaw> = {}): Aircraft {
  const raw = makeAircraftRaw({
    icao24: 'a1', latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90,
    lastContact: 1_000, ...over,
  });
  return { ...raw, trail: [], motion: deriveMotion(raw, 1_000) };
}

function geometryOf(obj: Object3D | undefined): Points['geometry'] {
  if (!obj) throw new Error('layer has no drawable child');
  return (obj as Points).geometry;
}

/** children: [0] partial, [1] complete, [2] selected — the draw hierarchy. */
const PARTIAL = 0;

function head(layer: ReturnType<typeof createAircraftLayer>): Vector3 {
  const g = geometryOf(layer.group.children[PARTIAL]);
  const p = g.getAttribute('position');
  return new Vector3(p.getX(0), p.getY(0), p.getZ(0));
}

const FRAME = { nowMs: 0, elapsedSinceBatchS: 0, cameraDistance: 10, stale: false };

describe('the aircraft layer draws where the aircraft is now', () => {
  it('moves the point between two frames without a new batch', () => {
    // The user's opening complaint, in one assertion: between two updates
    // the aircraft used to be redrawn in exactly the same place.
    const layer = createAircraftLayer();
    const fleet = [ac()];
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 0 });
    const a = head(layer);
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 60 });
    expect(head(layer).distanceTo(a)).toBeGreaterThan(0);
  });

  it('leaves an aircraft past the ceiling exactly where it was measured', () => {
    const layer = createAircraftLayer();
    const fleet = [ac({ lastContact: 1_000 - DR_CAP_S - 10 })];
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 0 });
    const expected = latLonAltToVec3(50, -10, 38_000);
    expect(head(layer).distanceTo(expected)).toBeLessThan(1e-6);
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 300 });
    expect(head(layer).distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('dims the still ones on the intensity, through an attribute of their own', () => {
    // Not on aColor: aircraft.ts:121-130 records, with the failure in
    // hand, that dimming the colour leaves the mix() with white alight and
    // a "dark" point goes on painting a mid-grey aeroplane at ~45% (D17).
    const layer = createAircraftLayer();
    layer.update([ac(), ac({ icao24: 'a2', headingDeg: null })], null, SHOW_ALL, 1, FRAME);
    const live = geometryOf(layer.group.children[PARTIAL]).getAttribute('aLive');
    const values = [live.getX(0), live.getX(1)].sort();
    // Compared to the precision of the buffer that carries it, not to the
    // precision of the constant. aLive is a Float32Array — it is a vertex
    // attribute — so 0,55 is handed back as 0,550000011920929: the same
    // number at the only precision the GPU will ever see it in, and an
    // exact-equality assertion here would be testing IEEE 754 rather than
    // the dimming (D17).
    expect(values[0]).toBeCloseTo(STILL_DIM, 6);
    expect(values[1]).toBe(1);
  });

  it('returns the same counts the panel will print', () => {
    const layer = createAircraftLayer();
    const view = layer.update(
      [ac(), ac({ icao24: 'a2', headingDeg: null }), ac({ icao24: 'a3', lastContact: 1 })],
      null,
      SHOW_ALL,
      1,
      FRAME
    );
    expect(view.moving + view.still.unmeasurable + view.still.stale).toBe(view.shown);
    expect(view.still).toEqual({ unmeasurable: 1, stale: 1 });
  });

  it('draws an aircraft with no motion at all, from its coordinates', () => {
    // Every Aircraft built outside updateBatch is in this state, which is
    // every one in the unit suite. A fallback that drops them would make
    // twenty existing tests pass against an empty buffer.
    const layer = createAircraftLayer();
    const raw = makeAircraftRaw({ latitude: 12, longitude: 34 });
    layer.update([{ ...raw, trail: [] }], null, SHOW_ALL, 1, FRAME);
    expect(head(layer).distanceTo(latLonAltToVec3(12, 34, 38_000))).toBeLessThan(1e-6);
  });
});

describe('the scia stays a document (D28)', () => {
  it('ends the trail at the last real fix, never at the reckoned position', () => {
    // spec §4.1: the trail draws only fixes actually received. The gap
    // that opens between the dot and the end of its own trail IS how far
    // we have reckoned it — the only honest ruler of the extrapolation on
    // screen, and exactly the kind of thing a later reader "fixes".
    const trails = createTrailsLayer();
    const a = ac({ latitude: 50, longitude: -10 });
    a.trail = [{ lat: 49.9, lon: -10.2, t: 940 }];
    trails.update([a], null, SHOW_ALL);
    const g = geometryOf(trails.group.children[0]);
    const p = g.getAttribute('position');
    const last = new Vector3(
      p.getX(g.drawRange.count - 1),
      p.getY(g.drawRange.count - 1),
      p.getZ(g.drawRange.count - 1)
    );
    expect(last.distanceTo(latLonAltToVec3(50, -10, 38_000))).toBeLessThan(1e-6);
  });
});

describe('the click follows the dot, not the fix (D29)', () => {
  it('picks an aircraft under the cursor after it has been carried forward', () => {
    const camera = new PerspectiveCamera(38, 1.6, 0.1, 100);
    camera.position.copy(latLonAltToVec3(50, -10, 0).normalize().multiplyScalar(4));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const canvas = { clientWidth: 800, clientHeight: 500 } as HTMLCanvasElement;
    const fleet = [ac({ velocityKt: 500, headingDeg: 90 })];

    // Where the dot is after 100 s of reckoning, in screen space.
    const layer = createAircraftLayer();
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 100 });
    const drawn = head(layer).clone().project(camera);

    const hit = findAircraftAtPointer(
      new Vector2(drawn.x, drawn.y),
      fleet,
      camera,
      canvas,
      SHOW_ALL,
      { ...FRAME, elapsedSinceBatchS: 100 }
    );
    expect(hit).toBe('a1');
  });
});
