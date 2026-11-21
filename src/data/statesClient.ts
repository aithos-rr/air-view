import type { AircraftRaw, BoundingBox } from '@/types';

export interface FetchResult {
  fetchedAt: Date;
  /**
   * What the server said about the body it just sent: true when it served a
   * cached payload past its freshness window. It travels in the BODY because
   * this function reads only res.json() — see Task 3, Step 10.
   */
  stale: boolean;
  /** The server truncated the fleet to its payload cap, and said so. */
  capped: boolean;
  aircraft: AircraftRaw[];
}

export interface ViewQuery {
  lat: number;
  lon: number;
  radiusNm: number;
}

const ENDPOINT = '/api/states';

export async function fetchStates(
  bbox?: BoundingBox | null,
  signal?: AbortSignal,
  view?: ViewQuery | null
): Promise<FetchResult> {
  const params = new URLSearchParams();
  if (bbox) {
    params.set('lamin', String(bbox.lamin));
    params.set('lomin', String(bbox.lomin));
    params.set('lamax', String(bbox.lamax));
    params.set('lomax', String(bbox.lomax));
  }
  if (view) {
    // Tells the server which tiles to refresh first. A full sweep takes
    // 820-1000 s — 14-17 minutes — so without this the region on screen
    // would be as stale as the far side of the planet.
    params.set('lat', view.lat.toFixed(3));
    params.set('lon', view.lon.toFixed(3));
    params.set('radius', String(view.radiusNm));
  }
  const qs = params.toString();
  const res = await fetch(qs ? `${ENDPOINT}?${qs}` : ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Air View proxy: HTTP ${res.status}`);
  const data = (await res.json()) as {
    fetchedAt: string;
    stale?: boolean;
    capped?: boolean;
    aircraft: AircraftRaw[];
  };
  // Optional on the wire and defaulted to fresh: a server that predates the
  // flag must not make every batch look stale. Present and true is the only
  // thing that raises the warning, so the warning means something.
  return {
    fetchedAt: new Date(data.fetchedAt),
    stale: data.stale === true,
    // The server declares a truncated world; dropping the word here would
    // serve part of the sky as all of it.
    capped: data.capped === true,
    aircraft: data.aircraft,
  };
}
