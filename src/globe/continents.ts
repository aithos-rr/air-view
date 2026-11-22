import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import {
  COASTLINE_LIFT,
  COASTLINE_MAX_SEGMENT_DEG,
  GLOBE_RADIUS,
  latLonToVec3,
} from './geoHelpers';

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
  // R × 1,003 was 0,0045 units — 19,1 km of apparent altitude, taller than
  // the whole corrected aircraft shell, and 41,24 px of displacement at the
  // edge of the frame at the bottom of the camera's travel. COASTLINE_LIFT
  // is the sag of the longest chord addRing may draw, measured at the radius
  // that chord is drawn on (D47).
  const radius = GLOBE_RADIUS + COASTLINE_LIFT;
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

/**
 * The COARSE level's share of the picture, 0..1.
 *
 * 0,45 is the opacity this outline has always been drawn at, and it stays
 * the full-strength value: a crossfade scales it, it does not redefine it.
 * "Keep the same graphics" means the coarse level at `value = 1` is bit for
 * bit the globe the user has today (D41).
 */
export function setCoarseOpacity(lines: LineSegments, value: number): void {
  const mat = lines.material as LineBasicMaterial;
  mat.opacity = 0.45 * Math.min(1, Math.max(0, value));
  mat.visible = mat.opacity > 0;
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
    // The same constant COASTLINE_LIFT is derived from, read and not
    // repeated: longer chords would sag back inside the planet while the
    // lift stayed where it was (D47).
    const steps =
      arc > COASTLINE_MAX_SEGMENT_DEG ? Math.ceil(arc / COASTLINE_MAX_SEGMENT_DEG) : 1;
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
