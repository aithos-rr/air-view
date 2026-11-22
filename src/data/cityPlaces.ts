import { Vector3 } from 'three';
import { latLonToVec3 } from '@/globe/geoHelpers';
import { useDetailStore } from '@/state/detailStore';

/**
 * One populated place, as the globe needs it.
 *
 * The file behind this has been in the bundle, unread, the whole time:
 * `grep -rn populated_places src/` found nothing, and 3,2 MB of GeoJSON were
 * downloaded by every visitor for no one. Plan 4 Task 4 turned it into an
 * 84 KB cities.json of six fields, already sorted (D45).
 */
export interface CityPlace {
  name: string;
  /**
   * Natural Earth's own statement of the map scale at which this place
   * deserves to appear. "Il nome della città non esce quando sono troppo
   * fuori, però man mano mi avvicino esce" is, word for word, what this
   * field already says — inventing a population threshold would be redoing
   * a cartographer's work worse (D43).
   */
  scalerank: number;
  labelrank: number;
  /** Null when the source does not say. Nothing reads it for a threshold. */
  popMax: number | null;
  lat: number;
  lon: number;
  /**
   * The unit direction through this place, computed ONCE here.
   *
   * 1 251 × 4 = 5 004 transcendental calls at load. Rebuilding it per frame,
   * the way projectMarker does for two markers, would be 96 calls a frame
   * for 24 labels out of 1 128 candidates — affordable, and a waste chosen
   * on purpose not to make (D43).
   */
  dir: Vector3;
}

/** The record shape build-static-data.mjs writes. */
interface RawCity {
  n?: unknown;
  s?: unknown;
  l?: unknown;
  p?: unknown;
  lat?: unknown;
  lon?: unknown;
}

/**
 * Parse cities.json, keeping the file's order.
 *
 * The array arrives sorted by (SCALERANK, LABELRANK, -POP_MAX), sorted once
 * at build time, so a map scale is a PREFIX of it and selecting is a walk
 * from index 0. Re-sorting here would be the same work on every load for an
 * answer that cannot change (D43).
 *
 * A record that cannot be PLACED is dropped rather than placed somewhere
 * plausible: a name on the wrong spot of a map is worse than a name missing.
 */
export function parseCityPlaces(text: string): CityPlace[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('cities.json: not an array');
  const out: CityPlace[] = [];
  for (const row of parsed as RawCity[]) {
    const name = typeof row.n === 'string' ? row.n : '';
    const lat = typeof row.lat === 'number' ? row.lat : null;
    const lon = typeof row.lon === 'number' ? row.lon : null;
    if (name.length === 0 || lat === null || lon === null) continue;
    out.push({
      name,
      scalerank: typeof row.s === 'number' ? row.s : 10,
      labelrank: typeof row.l === 'number' ? row.l : 10,
      popMax: typeof row.p === 'number' ? row.p : null,
      lat,
      lon,
      dir: latLonToVec3(lat, lon, 1).normalize(),
    });
  }
  return out;
}

/**
 * Fetch the places, and say on screen how it went.
 *
 * It never throws and never rejects. The globe is entirely usable without
 * city names, so taking it down over a missing file would be a worse answer
 * than going without — but going without SILENTLY is what D42 forbids, so
 * the store carries 'unavailable' and FeedStatus prints one line.
 */
export async function loadCityPlaces(): Promise<CityPlace[]> {
  try {
    const res = await fetch('/data/cities.json');
    if (!res.ok) throw new Error(`cities.json: HTTP ${res.status}`);
    const places = parseCityPlaces(await res.text());
    useDetailStore.getState().setCities('ready');
    return places;
  } catch (e) {
    console.warn('City places:', e);
    useDetailStore.getState().setCities('unavailable');
    return [];
  }
}
