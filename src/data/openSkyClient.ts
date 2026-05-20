import type { AircraftRaw } from '@/types';

export interface FetchResult {
  fetchedAt: Date;
  aircraft: AircraftRaw[];
}

const ENDPOINT = '/api/states';

export async function fetchStates(signal?: AbortSignal): Promise<FetchResult> {
  const res = await fetch(ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Air View proxy: HTTP ${res.status}`);
  const data = (await res.json()) as { fetchedAt: string; aircraft: AircraftRaw[] };
  return {
    fetchedAt: new Date(data.fetchedAt),
    aircraft: data.aircraft,
  };
}
