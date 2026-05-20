import type { AircraftRaw, BoundingBox } from '@/types';

export interface FetchResult {
  fetchedAt: Date;
  aircraft: AircraftRaw[];
}

const ENDPOINT = '/api/states';

export async function fetchStates(
  bbox?: BoundingBox | null,
  signal?: AbortSignal
): Promise<FetchResult> {
  const url = bbox
    ? `${ENDPOINT}?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`
    : ENDPOINT;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Air View proxy: HTTP ${res.status}`);
  const data = (await res.json()) as { fetchedAt: string; aircraft: AircraftRaw[] };
  return {
    fetchedAt: new Date(data.fetchedAt),
    aircraft: data.aircraft,
  };
}
