interface AirlineRecord {
  icao: string;
  iata: string;
  name: string;
}

let airlineByIcao: Map<string, AirlineRecord> = new Map();
let airlineIcaosByIata: Map<string, string[]> = new Map();

export function initAirlines(records: AirlineRecord[]): void {
  airlineByIcao = new Map(records.map((r) => [r.icao, r]));
  // A LIST per IATA code, not a record: measured on the bundled table
  // (1 093 rows, 834 distinct IATA codes) 17 codes belong to more than one
  // airline — VY is both Formosa and Vueling, G3 is three carriers. Keeping
  // one would silently search for the wrong airline's flight.
  airlineIcaosByIata = new Map();
  for (const r of records) {
    // 'N/A' / '-' are the table's placeholders for "unknown airline" and
    // would otherwise collect hundreds of ICAO codes under one key.
    if (!r.iata || r.iata === '-' || r.icao === 'N/A') continue;
    const list = airlineIcaosByIata.get(r.iata);
    if (list) list.push(r.icao);
    else airlineIcaosByIata.set(r.iata, [r.icao]);
  }
}

/** Every ICAO prefix an airline's IATA code can mean, in table order. */
export function lookupAirlineIcaosByIata(iata: string): string[] {
  return airlineIcaosByIata.get(iata.toUpperCase()) ?? [];
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
