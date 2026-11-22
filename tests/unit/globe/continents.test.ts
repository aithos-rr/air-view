import { describe, it, expect } from 'vitest';
import { buildContinentsFromGeoJSON } from '@/globe/continents';
import { COASTLINE_LIFT, COASTLINE_MAX_SEGMENT_DEG, GLOBE_RADIUS } from '@/globe/geoHelpers';

/**
 * Ten degrees of square, which addRing subdivides into 20 chords of two.
 *
 * Three of its four sides run on the equator and on two meridians, where
 * 2 degrees of lat/lon are 2 degrees of great circle EXACTLY — the longest
 * chord the subdivision admits, and the only place the second order term of
 * the lift is visible. The fourth runs on the parallel at 10 N, where the
 * same 2 degrees of longitude are 1,9696 of great circle and the chord sags
 * less. One fixture, read by two tests, because two fixtures would be two
 * ideas of what is being drawn.
 */
const ONE_SQUARE = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { CONTINENT: 'Europe' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    },
  ],
};

describe('buildContinentsFromGeoJSON', () => {
  it('builds a non-empty LineSegments from a tiny FeatureCollection', () => {
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const posAttr = lines.geometry.getAttribute('position');
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('skips features tagged CONTINENT: Antarctica', () => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { CONTINENT: 'Antarctica' },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[0, -85], [10, -85], [10, -90], [0, -90], [0, -85]]],
          },
        },
      ],
    };
    const lines = buildContinentsFromGeoJSON(geojson);
    expect(lines.geometry.getAttribute('position').count).toBe(0);
  });
});

/**
 * One ulp of Float32 at GLOBE_RADIUS, which is in [1, 2): 2^-23 = 1,19e-7.
 *
 * Everything below reads a Float32BufferAttribute — the numbers the GPU is
 * actually handed — so this is the floor on what any of it can measure. The
 * exact statements about the lift are in cameraTravel.test.ts, in double
 * precision, on the two constants and nothing else (D47).
 */
const F32_ULP = 2 ** -23;

describe('the coastline is drawn at ground level', () => {
  it('lifts every drawn vertex just clear of the sphere and no further', () => {
    // R × 1,003 was 19,1 km of apparent altitude — taller than the whole
    // corrected shell, and 41,24 px of displacement at the edge of the
    // frame at 1,55 against the 25,24 px of a corrected aircraft. The
    // ground was lying more than the correction (D47).
    //
    // To within one Float32 ulp, and not to within 1e-12: the measured
    // spread of these radii is 4,7e-8, which is the attribute's own
    // rounding and nothing to do with the lift.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(Math.abs(r - (GLOBE_RADIUS + COASTLINE_LIFT))).toBeLessThan(F32_ULP);
    }
  });

  it('keeps every drawn CHORD outside the globe, which is the only reason the lift exists', () => {
    // The vertices are not the question: the midpoints are. A chord of
    // COASTLINE_MAX_SEGMENT_DEG sags below the sphere it samples, and the
    // globe mesh's vertices sit on that sphere, so at GLOBE_RADIUS exactly
    // the coast would pass THROUGH the planet in the middle of every
    // segment — invisible today only because nothing in this scene writes
    // depth (§2.7).
    //
    // Within one ulp, for the reason F32_ULP states: with the correct
    // constant these midpoints are ON GLOBE_RADIUS in double precision, so
    // what is left here is the sign of the rounding, which is not a fact
    // about geometry. The tolerance softens nothing — with no lift at all
    // the same midpoints sit 2,28e-4 under the surface, 1 917 ulps, and
    // this line goes red by the same margin it always did.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const mx = (pos.getX(i) + pos.getX(i + 1)) / 2;
      const my = (pos.getY(i) + pos.getY(i + 1)) / 2;
      const mz = (pos.getZ(i) + pos.getZ(i + 1)) / 2;
      expect(Math.hypot(mx, my, mz)).toBeGreaterThan(GLOBE_RADIUS - F32_ULP);
    }
  });

  it('subdivides by the same constant the lift is derived from', () => {
    // If the subdivision could grow without the lift growing, the chords
    // would sag back inside the planet. One number, two readers.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    const maxChord =
      2 * (GLOBE_RADIUS + COASTLINE_LIFT) *
      Math.sin((COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360);
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const len = Math.hypot(
        pos.getX(i + 1) - pos.getX(i),
        pos.getY(i + 1) - pos.getY(i),
        pos.getZ(i + 1) - pos.getZ(i)
      );
      expect(len).toBeLessThanOrEqual(maxChord * 1.001);
    }
  });
});
