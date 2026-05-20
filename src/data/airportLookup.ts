import type { Airport } from '@/types';

let airportByIata: Map<string, Airport> = new Map();

export function initAirports(records: Airport[]): void {
  airportByIata = new Map(records.map((r) => [r.iata, r]));
}

export function lookupAirport(iata: string): Airport | null {
  return airportByIata.get(iata.toUpperCase()) ?? null;
}

export async function loadAirportsFromBundle(): Promise<void> {
  const res = await fetch('/data/airports.json');
  if (!res.ok) throw new Error(`airports.json: HTTP ${res.status}`);
  const records = (await res.json()) as Airport[];
  initAirports(records);
}
