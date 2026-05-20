import { describe, it, expect } from 'vitest';
import { latLonToVec3, latLonAltToVec3, altitudeToOffset, GLOBE_RADIUS } from '@/globe/geoHelpers';

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
