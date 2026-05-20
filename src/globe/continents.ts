import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { latLonToVec3, GLOBE_RADIUS } from './geoHelpers';

interface GeoJsonFeature {
  type: 'Feature';
  properties: { CONTINENT?: string };
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
}
interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export function buildContinentsFromGeoJSON(geojson: GeoJsonCollection): LineSegments {
  const vertices: number[] = [];
  const radius = GLOBE_RADIUS * 1.003;
  for (const f of geojson.features) {
    if (f.properties.CONTINENT === 'Antarctica') continue;
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      if (ring) addRing(vertices, ring, radius);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        const ring = poly[0];
        if (ring) addRing(vertices, ring, radius);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  const mat = new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new LineSegments(geo, mat);
  lines.renderOrder = 2;
  return lines;
}

function addRing(vertices: number[], ring: number[][], radius: number): void {
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) continue;
    const [lon1, lat1] = a;
    const [lon2, lat2] = b;
    if (lon1 === undefined || lat1 === undefined || lon2 === undefined || lat2 === undefined) continue;
    if (Math.abs(lon2 - lon1) > 180) continue; // antimeridian crossings
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const arc = Math.hypot(dLat, dLon);
    const steps = arc > 2.0 ? Math.ceil(arc / 2.0) : 1;
    for (let s = 0; s < steps; s++) {
      const ta = s / steps;
      const tb = (s + 1) / steps;
      const la = lat1 + dLat * ta;
      const oa = lon1 + dLon * ta;
      const lb = lat1 + dLat * tb;
      const ob = lon1 + dLon * tb;
      const v1 = latLonToVec3(la, oa, radius);
      const v2 = latLonToVec3(lb, ob, radius);
      vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }
  }
}

export async function loadContinents(): Promise<LineSegments> {
  const res = await fetch('/data/ne_50m_admin_0_countries.geojson');
  if (!res.ok) throw new Error(`continents: HTTP ${res.status}`);
  const json = (await res.json()) as GeoJsonCollection;
  return buildContinentsFromGeoJSON(json);
}
