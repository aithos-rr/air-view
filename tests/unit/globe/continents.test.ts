import { describe, it, expect } from 'vitest';
import { buildContinentsFromGeoJSON } from '@/globe/continents';

describe('buildContinentsFromGeoJSON', () => {
  it('builds a non-empty LineSegments from a tiny FeatureCollection', () => {
    const geojson = {
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
    const lines = buildContinentsFromGeoJSON(geojson);
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
