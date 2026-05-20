import type { Route } from '@/types';

let routesByAirline: Map<string, Route[]> = new Map();

export function initRoutes(records: Route[]): void {
  routesByAirline = new Map();
  for (const r of records) {
    const list = routesByAirline.get(r.airlineIata);
    if (list) list.push(r);
    else routesByAirline.set(r.airlineIata, [r]);
  }
}

/**
 * Best-effort route resolution: OpenFlights routes.dat does not include
 * flight numbers, only airline+origin+destination. For a given callsign
 * (e.g. BA 274), we cannot determine the exact route — instead we return
 * the most common route for that airline. If the airline has no recorded
 * routes, return null.
 *
 * v2 may switch to a paid API for flight-number-precise routes.
 */
export function lookupRoute(airlineIata: string, _flightNumber: string): Route | null {
  const list = routesByAirline.get(airlineIata.toUpperCase());
  if (!list || list.length === 0) return null;
  return list[0] ?? null;
}

export async function loadRoutesFromBundle(): Promise<void> {
  const res = await fetch('/data/openflights-routes.json');
  if (!res.ok) throw new Error(`routes.json: HTTP ${res.status}`);
  const records = (await res.json()) as Route[];
  initRoutes(records);
}
