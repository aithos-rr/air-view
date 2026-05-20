import { Vector3 } from 'three';

export const GLOBE_RADIUS = 1.5;

/**
 * Lat/lon (degrees) → 3D position on a sphere.
 * Convention: lon=0 lands on +Z (front), lat=90 lands on +Y (north pole),
 * lon=90 lands on +X (east). Matches the test contract in tests/unit/globe.
 */
export function latLonToVec3(lat: number, lon: number, radius: number = GLOBE_RADIUS): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  return new Vector3(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta)
  );
}

/**
 * Visual altitude offset (real ratio ~0.0018 is too tiny — exaggerated for visibility).
 */
export function altitudeToOffset(altFt: number): number {
  return 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
}

export function latLonAltToVec3(lat: number, lon: number, altFt: number): Vector3 {
  return latLonToVec3(lat, lon, GLOBE_RADIUS + altitudeToOffset(altFt));
}
