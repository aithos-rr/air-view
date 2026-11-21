import { describe, it, expect } from 'vitest';
import type { Object3D, Points } from 'three';
import { createAircraftLayer } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

/**
 * The renderer must be able to draw every aircraft the server can send.
 *
 * MAX_PAYLOAD_AIRCRAFT in server/index.ts is 24 000, and the server's own
 * sizing note is written "on 20 000 records": the normal regime already sits
 * above the 18 000 both globe layers were sized for in v1, when the payload
 * was a single live snapshot of ~14 000. Everything past the ceiling leaves
 * by a bare `continue` — no log, no flag — while the HUD keeps reporting
 * aircraft.size. That is the v1 failure mode inverted: the globe is emptier
 * than the UI says, and nothing says so.
 */

function fleet(n: number, trailPoints = 0): Aircraft[] {
  const out: Aircraft[] = new Array<Aircraft>(n);
  for (let i = 0; i < n; i++) {
    const lat = ((i * 37) % 170) - 85;
    const lon = ((i * 53) % 358) - 179;
    const trail: Aircraft['trail'] = [];
    for (let k = 0; k < trailPoints; k++) {
      trail.push({ lat: lat + k * 0.01, lon: lon + k * 0.01, t: k });
    }
    out[i] = { ...makeAircraftRaw({ icao24: `a${i}`, latitude: lat, longitude: lon }), trail };
  }
  return out;
}

function geometryOf(obj: Object3D | undefined): Points['geometry'] {
  if (!obj) throw new Error('layer has no drawable child');
  return (obj as Points).geometry;
}

describe('aircraft layer capacity', () => {
  it('draws the whole fleet at the size the server actually serves', () => {
    // 20 000 is the number the server's own payload comment is measured on.
    const layer = createAircraftLayer();
    layer.update(fleet(20_000), null, SHOW_ALL, 1);
    const geom = geometryOf(layer.group.children[0]);
    expect(geom.drawRange.count).toBe(20_000);
  });

  it('draws the whole fleet at the server payload cap of 24 000', () => {
    // MAX_PAYLOAD_AIRCRAFT: the most records one body can ever contain, so
    // the most the client can ever be asked to draw.
    const layer = createAircraftLayer();
    layer.update(fleet(24_000), null, SHOW_ALL, 1);
    const geom = geometryOf(layer.group.children[0]);
    expect(geom.drawRange.count).toBe(24_000);
    // A draw range is only metadata: assert the buffer really holds those
    // vertices and that the last one was written, not left at the origin.
    const pos = geom.getAttribute('position');
    expect(pos.count).toBeGreaterThanOrEqual(24_000);
    const arr = pos.array as Float32Array;
    const last = (24_000 - 1) * 3;
    const lenSq = arr[last]! ** 2 + arr[last + 1]! ** 2 + arr[last + 2]! ** 2;
    expect(lenSq).toBeGreaterThan(0);
  });
});

describe('trails layer capacity', () => {
  it('emits every trail segment at the server payload cap of 24 000', () => {
    // Five trail points plus the current position is six points, i.e. five
    // segments and ten vertices per aircraft: 240 000 in all.
    const layer = createTrailsLayer();
    layer.update(fleet(24_000, 5), null, SHOW_ALL);
    const geom = geometryOf(layer.group.children[0]);
    expect(geom.drawRange.count).toBe(240_000);
    const pos = geom.getAttribute('position');
    expect(pos.count).toBeGreaterThanOrEqual(240_000);
  });
});
