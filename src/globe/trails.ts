import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sphere,
  Vector3,
} from 'three';
import type { Aircraft } from '@/types';
import { GLOBE_RADIUS } from './geoHelpers';

const CRUISING_BASE: [number, number, number] = [1.0, 0.902, 0.769];
const SELECTED_BASE: [number, number, number] = [0.16, 0.59, 1.0];

// Buffer pool sized for the worst case: bbox can hold ~3 000 aircraft, each
// with up to MAX_TRAIL_POINTS positions (oldest + ... + current). Each trail
// becomes (TRAIL_POINTS - 1) segments × 2 vertices each.
const MAX_AIRCRAFT = 3000;
const MAX_TRAIL_POINTS = 6;
const MAX_SEGMENTS_PER_AC = MAX_TRAIL_POINTS - 1;
const MAX_VERTICES = MAX_AIRCRAFT * MAX_SEGMENTS_PER_AC * 2; // 30 000

const POSITION_FLOATS = MAX_VERTICES * 3;
const COLOR_FLOATS = MAX_VERTICES * 3;

// Static bounding sphere covering the full globe + max aircraft altitude.
// Avoids per-frame boundingSphere recomputation while keeping frustum culling
// available for the parent scene (we still disable it on the LineSegments —
// the sphere is needed only for raycasting/Three's internal checks).
const SCENE_BOUND_RADIUS = GLOBE_RADIUS + 0.5;

export interface TrailsLayer {
  group: Group;
  update: (aircraft: Iterable<Aircraft>, selectedIcao: string | null) => void;
}

/**
 * Zero-allocation per-frame trail renderer.
 *
 * Strategy:
 *   - ONE BufferGeometry, ONE LineSegments draw call total
 *   - Pre-allocated Float32Arrays (positions + colors) sized for MAX_AIRCRAFT
 *   - Each frame we write segment pairs into the buffers and call
 *     setDrawRange() to limit drawn vertices to the active count.
 *   - latLon → xyz computed inline (no Vector3 allocations).
 *
 * For 1 949 aircraft × 5 segments × 2 vertices = ~19 500 vertices written
 * each frame. Direct typed-array writes; no GC pressure.
 */
export function createTrailsLayer(): TrailsLayer {
  const positions = new Float32Array(POSITION_FLOATS);
  const colors = new Float32Array(COLOR_FLOATS);

  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('color', colorAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), SCENE_BOUND_RADIUS);

  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const lines = new LineSegments(geom, mat);
  lines.renderOrder = 3;
  lines.frustumCulled = false; // bounding sphere covers everything anyway

  const group = new Group();
  group.add(lines);

  function update(aircraft: Iterable<Aircraft>, selectedIcao: string | null): void {
    let vertCursor = 0; // next vertex index to write

    for (const ac of aircraft) {
      if (ac.latitude === null || ac.longitude === null) continue;
      if (ac.trail.length < 1) continue;

      const base = ac.icao24 === selectedIcao ? SELECTED_BASE : CRUISING_BASE;
      const baseR = base[0];
      const baseG = base[1];
      const baseB = base[2];

      const altFt = ac.baroAltitudeFt ?? 38000;

      // Trail length capped at MAX_TRAIL_POINTS (head + last N-1 trail points).
      // We walk oldest → newest, emitting one segment between each consecutive
      // pair. Total segments = numPoints - 1, capped at MAX_SEGMENTS_PER_AC.
      const trailLen = ac.trail.length + 1; // +1 for current position
      const startIdx = Math.max(0, trailLen - MAX_TRAIL_POINTS);
      const usedPoints = trailLen - startIdx;
      const segments = usedPoints - 1;
      if (segments < 1) continue;

      // First point of the polyline
      let prevLat: number;
      let prevLon: number;
      let prevAlpha: number;
      if (startIdx < ac.trail.length) {
        const p = ac.trail[startIdx]!;
        prevLat = p.lat;
        prevLon = p.lon;
      } else {
        prevLat = ac.latitude;
        prevLon = ac.longitude;
      }
      prevAlpha = computeAlpha(0, usedPoints);

      for (let i = 1; i < usedPoints; i++) {
        if (vertCursor + 2 > MAX_VERTICES) break;

        const realIdx = startIdx + i;
        let lat: number;
        let lon: number;
        if (realIdx < ac.trail.length) {
          const p = ac.trail[realIdx]!;
          lat = p.lat;
          lon = p.lon;
        } else {
          lat = ac.latitude;
          lon = ac.longitude;
        }
        const alpha = computeAlpha(i, usedPoints);

        // Write segment: prev → current
        writeLatLonAlt(positions, vertCursor * 3, prevLat, prevLon, altFt);
        colors[vertCursor * 3] = baseR * prevAlpha;
        colors[vertCursor * 3 + 1] = baseG * prevAlpha;
        colors[vertCursor * 3 + 2] = baseB * prevAlpha;
        vertCursor++;

        writeLatLonAlt(positions, vertCursor * 3, lat, lon, altFt);
        colors[vertCursor * 3] = baseR * alpha;
        colors[vertCursor * 3 + 1] = baseG * alpha;
        colors[vertCursor * 3 + 2] = baseB * alpha;
        vertCursor++;

        prevLat = lat;
        prevLon = lon;
        prevAlpha = alpha;
        void segments; // silence "unused"; left for documentation
      }
    }

    geom.setDrawRange(0, vertCursor);
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  return { group, update };
}

// Quadratic alpha decay from oldest (0) to newest (length-1)
function computeAlpha(i: number, len: number): number {
  const t = i / Math.max(1, len - 1);
  return t * t;
}

// Inline lat/lon/alt → xyz directly into a typed array. Zero allocations.
// Mirrors the formula in geoHelpers.latLonToVec3 (lon=0 → +Z, lat=90 → +Y).
function writeLatLonAlt(
  buf: Float32Array,
  offset: number,
  lat: number,
  lon: number,
  altFt: number
): void {
  const radius = GLOBE_RADIUS + 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  const sinPhi = Math.sin(phi);
  buf[offset] = radius * sinPhi * Math.sin(theta);
  buf[offset + 1] = radius * Math.cos(phi);
  buf[offset + 2] = radius * sinPhi * Math.cos(theta);
}
