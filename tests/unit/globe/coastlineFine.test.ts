import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  BUCKET_DEGREES,
  BUCKET_COUNT,
  FINE_BUILD_CHUNK_VERTICES,
  FINE_CROSSFADE_MS,
  FINE_PREFETCH_DISTANCE,
  FINE_SWITCH_DISTANCE,
  bucketCentreDirection,
  bucketIndex,
  bucketVisible,
  crossfade,
} from '@/globe/coastlineFine';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, visibleCapRadiusNm } from '@/globe/geoHelpers';

const FOV = 38;
/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

function capHalfAngleRad(d: number): number {
  return visibleCapRadiusNm(d, FOV) / NM_PER_RADIAN;
}

/** A deterministic generator, so a failure is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('the buckets cover the world once, with no hole and no overlap', () => {
  it('divides the sphere into exactly 36 × 18 cells', () => {
    expect(BUCKET_DEGREES).toBe(10);
    expect(BUCKET_COUNT).toBe((360 / BUCKET_DEGREES) * (180 / BUCKET_DEGREES));
  });

  it('gives every point on the globe exactly one bucket, in range', () => {
    const rnd = lcg(12345);
    for (let i = 0; i < 20_000; i++) {
      const lat = rnd() * 180 - 90;
      const lon = rnd() * 360 - 180;
      const b = bucketIndex(lat, lon);
      expect(Number.isInteger(b), `${lat},${lon}`).toBe(true);
      expect(b, `${lat},${lon}`).toBeGreaterThanOrEqual(0);
      expect(b, `${lat},${lon}`).toBeLessThan(BUCKET_COUNT);
    }
  });

  it('puts the poles and the antimeridian in ONE bucket each, not past the end', () => {
    // The three places an off-by-one lives. A floor() that lets lat = 90 or
    // lon = 180 index one cell past the end does not throw in JavaScript: it
    // writes into a bucket nobody draws, and a strip of coastline disappears
    // in silence, which is D42 from its worst side.
    for (const [lat, lon] of [
      [90, 0],
      [-90, 0],
      [0, 180],
      [0, -180],
      [90, 180],
      [-90, -180],
    ] as const) {
      const b = bucketIndex(lat, lon);
      expect(b, `${lat},${lon}`).toBeGreaterThanOrEqual(0);
      expect(b, `${lat},${lon}`).toBeLessThan(BUCKET_COUNT);
    }
    // +180 and -180 are the same meridian, so they are the same cell.
    expect(bucketIndex(0, 180)).toBe(bucketIndex(0, -180));
  });

  it('gives every bucket a unit direction through its own centre', () => {
    for (let b = 0; b < BUCKET_COUNT; b++) {
      const dir = bucketCentreDirection(b);
      expect(dir.length(), `bucket ${b}`).toBeCloseTo(1, 12);
    }
  });
});

describe('bucket visibility is never a false negative', () => {
  it('shows the bucket of every point that is inside the cap', () => {
    // A false POSITIVE costs vertices. A false NEGATIVE is a piece of coast
    // that vanishes — and vanishing without saying so is exactly what D42
    // forbids. The test is one-sided on purpose.
    const rnd = lcg(999);
    const cameraDir = new Vector3(0, 0, 1);
    for (const d of [CAMERA_NEAR_LIMIT, 1.75, 1.9, 2.5, 4, CAMERA_FAR_LIMIT]) {
      const cap = capHalfAngleRad(d);
      for (let i = 0; i < 10_000; i++) {
        const lat = Math.asin(rnd() * 2 - 1) * (180 / Math.PI);
        const lon = rnd() * 360 - 180;
        const phi = ((90 - lat) * Math.PI) / 180;
        const theta = (lon * Math.PI) / 180;
        const p = new Vector3(
          Math.sin(phi) * Math.sin(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.cos(theta)
        );
        if (Math.acos(Math.min(1, Math.max(-1, p.dot(cameraDir)))) > cap) continue;
        expect(bucketVisible(bucketIndex(lat, lon), cameraDir, cap), `d=${d} ${lat},${lon}`).toBe(
          true
        );
      }
    }
  });

  it('switches buckets off as the frame narrows, which is the whole point', () => {
    const cameraDir = new Vector3(0, 0, 1);
    const wide = capHalfAngleRad(CAMERA_FAR_LIMIT);
    const narrow = capHalfAngleRad(CAMERA_NEAR_LIMIT);
    let visibleWide = 0;
    let visibleNarrow = 0;
    for (let b = 0; b < BUCKET_COUNT; b++) {
      if (bucketVisible(b, cameraDir, wide)) visibleWide++;
      if (bucketVisible(b, cameraDir, narrow)) visibleNarrow++;
    }
    expect(visibleNarrow).toBeLessThan(visibleWide);
    expect(visibleNarrow).toBeGreaterThan(0);
  });

  it('keeps the vertices in view under what the 50m level pushes TODAY', () => {
    // 186 010 vertices, every frame, at every zoom, for the whole planet —
    // that is the thing being replaced. The bound here is pessimistic by
    // construction: the globally largest buckets, not the adjacent ones
    // (D41).
    const cameraDir = new Vector3(0, 0, 1);
    const cap = capHalfAngleRad(FINE_SWITCH_DISTANCE);
    let visible = 0;
    for (let b = 0; b < BUCKET_COUNT; b++) if (bucketVisible(b, cameraDir, cap)) visible++;
    // 8 702 segments is the largest bucket measured on the real data, i.e.
    // 17 404 vertices; §2.3's 131 722 is that figure summed over the buckets
    // in view at this distance.
    const WORST_BUCKET_VERTICES = 2 * 8_702;
    expect(visible * WORST_BUCKET_VERTICES).toBeLessThan(186_010);
  });
});

describe('the crossfade is a 300 ms window on the frame clock', () => {
  it('hands the whole picture to the coarse level at t = 0', () => {
    expect(crossfade(0, true)).toEqual({ coarse: 1, fine: 0 });
  });

  it('hands it entirely to the fine level at the end of the window', () => {
    expect(crossfade(FINE_CROSSFADE_MS, true)).toEqual({ coarse: 0, fine: 1 });
    expect(crossfade(FINE_CROSSFADE_MS * 4, true)).toEqual({ coarse: 0, fine: 1 });
  });

  it('never goes backwards in between', () => {
    let lastFine = -1;
    let lastCoarse = Infinity;
    for (let t = 0; t <= FINE_CROSSFADE_MS; t += 5) {
      const { coarse, fine } = crossfade(t, true);
      expect(fine).toBeGreaterThanOrEqual(lastFine);
      expect(coarse).toBeLessThanOrEqual(lastCoarse);
      expect(coarse + fine).toBeCloseTo(1, 12);
      lastFine = fine;
      lastCoarse = coarse;
    }
  });

  it('is instantaneous under prefers-reduced-motion (D30)', () => {
    expect(crossfade(0, false)).toEqual({ coarse: 0, fine: 1 });
    expect(crossfade(1, false)).toEqual({ coarse: 0, fine: 1 });
  });
});

describe('the constants are the measurements, not round numbers', () => {
  it('starts downloading before the switch needs it', () => {
    // 1,91 MB at 10 Mbit/s is 1,6 s and the chunked build takes 0,25 s more,
    // so the request goes out at a distance the camera passes through on
    // its way down (D41).
    expect(FINE_PREFETCH_DISTANCE).toBeGreaterThan(FINE_SWITCH_DISTANCE);
    expect(FINE_SWITCH_DISTANCE).toBeGreaterThan(CAMERA_NEAR_LIMIT);
    expect(FINE_PREFETCH_DISTANCE).toBeLessThan(CAMERA_FAR_LIMIT);
  });

  it('builds in chunks that fit inside a frame', () => {
    // 0,0626 µs per vertex measured: 64 000 vertices is 4,0 ms, a quarter of
    // a 16,7 ms frame. One 65,1 ms pass would be four dropped frames at the
    // exact moment the user is zooming.
    expect(FINE_BUILD_CHUNK_VERTICES * 0.0626e-3).toBeLessThan(16.7 / 4 + 0.1);
    expect(FINE_CROSSFADE_MS).toBe(300);
  });
});
