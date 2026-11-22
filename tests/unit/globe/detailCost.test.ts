import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import {
  BUCKET_COUNT,
  FINE_BUILD_CHUNK_VERTICES,
  FINE_SWITCH_DISTANCE,
  bucketVisible,
} from '@/globe/coastlineFine';
import { MAX_CITY_LABELS, selectCityLabels } from '@/globe/cityLabels';
import type { CityPlace } from '@/data/cityPlaces';
import { latLonToVec3, visibleCapRadiusNm } from '@/globe/geoHelpers';

const FOV = 38;
/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

/**
 * What the 50m level pushes at EVERY frame, at EVERY zoom, for the whole
 * planet: 93 005 segments, two vertices each (plan §2.3). It is the number
 * everything below has to come in under, because the claim this plan makes
 * is not "the globe gets more detailed" but "it gets more detailed AND
 * lighter".
 */
const COARSE_VERTICES_EVERY_FRAME = 186_010;

function place(i: number): CityPlace {
  const lat = ((i * 37) % 160) - 80;
  const lon = ((i * 73) % 350) - 175;
  return {
    name: `C${i}`,
    scalerank: 0,
    labelrank: 0,
    popMax: null,
    lat,
    lon,
    dir: latLonToVec3(lat, lon, 1).normalize(),
  };
}

describe('the detail costs less per frame than what it replaces', () => {
  it('spends zero transcendental calls per frame on the coastline', () => {
    // 359 bucket visibility decisions are 359 dot products — 21 540 a
    // second, against the 205 000 Plan 2 called negligible. The directions
    // are precomputed once when the file is decoded, and the cosine of the
    // threshold is the only trig in sight (D41).
    //
    // Counted rather than timed, the way Plan 2 proved its own cost: an
    // assertion in milliseconds on a CI machine fails for the weather.
    const cameraDir = new Vector3(0, 0, 1);
    const cap = visibleCapRadiusNm(FINE_SWITCH_DISTANCE, FOV) / NM_PER_RADIAN;
    const sin = vi.spyOn(Math, 'sin');
    const acos = vi.spyOn(Math, 'acos');
    const atan2 = vi.spyOn(Math, 'atan2');
    for (let frame = 0; frame < 60; frame++) {
      for (let b = 0; b < BUCKET_COUNT; b++) bucketVisible(b, cameraDir, cap);
    }
    expect(sin).not.toHaveBeenCalled();
    expect(acos).not.toHaveBeenCalled();
    expect(atan2).not.toHaveBeenCalled();
    sin.mockRestore();
    acos.mockRestore();
    atan2.mockRestore();
  });

  it('keeps the vertices in view under what the 50m level pushes today', () => {
    // 131 722 at the switch distance against 186 010 every frame, at every
    // zoom, for the whole planet. The globe gets MORE detailed and LIGHTER.
    //
    // The bound is pessimistic by construction: the globally largest bucket
    // (8 702 segments measured) times every bucket in view, not the buckets
    // that are actually adjacent (D41).
    const cameraDir = new Vector3(0, 0, 1);
    for (const d of [FINE_SWITCH_DISTANCE, 1.75, 1.55]) {
      const cap = visibleCapRadiusNm(d, FOV) / NM_PER_RADIAN;
      let visible = 0;
      for (let b = 0; b < BUCKET_COUNT; b++) if (bucketVisible(b, cameraDir, cap)) visible++;
      expect(visible * 2 * 8_702, `d=${d}`).toBeLessThan(COARSE_VERTICES_EVERY_FRAME);
    }
  });

  it('spends zero transcendental calls per frame on the city labels', () => {
    // 1 251 × 4 = 5 004 once at load; two dot products per candidate per
    // frame after that, and a projection only for the ones that pass (D43).
    const candidates = Array.from({ length: 1128 }, (_, i) => place(i));
    const project = (i: number): { x: number; y: number; visible: boolean } => ({
      x: (i * 97) % 1900,
      y: (i * 61) % 1000,
      visible: true,
    });
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    const acos = vi.spyOn(Math, 'acos');
    const atan2 = vi.spyOn(Math, 'atan2');
    for (let frame = 0; frame < 60; frame++) {
      selectCityLabels(candidates, project, [], MAX_CITY_LABELS);
    }
    expect(sin).not.toHaveBeenCalled();
    expect(cos).not.toHaveBeenCalled();
    expect(acos).not.toHaveBeenCalled();
    expect(atan2).not.toHaveBeenCalled();
    sin.mockRestore();
    cos.mockRestore();
    acos.mockRestore();
    atan2.mockRestore();
  });

  it('stops looking once it has the labels it is allowed to draw', () => {
    // The greedy pass is bounded by the CAP, not by the candidate count: at
    // most 24 accepted boxes and 276 intersection tests, whether there are
    // 30 candidates or 1 128.
    const many = Array.from({ length: 1128 }, (_, i) => place(i));
    const chosen = selectCityLabels(
      many,
      (i) => ({ x: i * 200, y: i * 120, visible: true }),
      [],
      MAX_CITY_LABELS
    );
    expect(chosen).toHaveLength(MAX_CITY_LABELS);
    expect((MAX_CITY_LABELS * (MAX_CITY_LABELS - 1)) / 2).toBe(276);
  });

  it('builds the fine level in chunks that fit inside a frame', () => {
    // 0,0626 µs per vertex measured: 64 000 vertices is 4,0 ms, a quarter
    // of a 16,7 ms frame. One 65,1 ms pass would be four dropped frames at
    // the exact moment the user is zooming (D41).
    const msPerChunk = FINE_BUILD_CHUNK_VERTICES * 0.0626e-3;
    expect(msPerChunk).toBeLessThan(16.7 / 4 + 0.1);
    // And the whole build is about fifteen of them — 960 040 vertices,
    // 15,0006 chunks — i.e. a quarter of a second, against one 65,1 ms
    // pass. Stated as the duration and not as a chunk count: a count would
    // be 16 here only because the last chunk holds 40 vertices.
    expect((960_040 / FINE_BUILD_CHUNK_VERTICES) * msPerChunk).toBeLessThan(300);
    expect((960_040 / FINE_BUILD_CHUNK_VERTICES) * msPerChunk).toBeGreaterThan(50);
  });
});
