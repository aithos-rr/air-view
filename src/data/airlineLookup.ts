interface AirlineRecord {
  icao: string;
  iata: string;
  name: string;
}

let airlineByIcao: Map<string, AirlineRecord> = new Map();

export function initAirlines(records: AirlineRecord[]): void {
  airlineByIcao = new Map(records.map((r) => [r.icao, r]));
}

export function lookupAirline(icao: string): AirlineRecord | null {
  return airlineByIcao.get(icao.toUpperCase()) ?? null;
}

export async function loadAirlinesFromBundle(): Promise<void> {
  const res = await fetch('/data/airlines.json');
  if (!res.ok) throw new Error(`airlines.json: HTTP ${res.status}`);
  const records = (await res.json()) as AirlineRecord[];
  initAirlines(records);
}
