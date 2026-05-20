// Raw aircraft state from OpenSky /states/all, normalized
export interface AircraftRaw {
  icao24: string;
  callsign: string | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitudeFt: number | null;     // converted from meters at fetch time
  velocityKt: number | null;          // converted from m/s
  headingDeg: number | null;
  onGround: boolean;
  lastContact: number;                // unix seconds from OpenSky
}

// Aircraft enriched with trail + resolved flight info
export interface Aircraft extends AircraftRaw {
  trail: Array<{ lon: number; lat: number; t: number }>; // last ~5s, interpolated
  resolved?: ResolvedFlight;          // populated lazily by data/resolveFlight.ts
}

// Result of resolving callsign against OpenFlights + OurAirports
export interface ResolvedFlight {
  airlineIcao: string;
  airlineName: string;
  flightNumber: string;
  origin: Airport | null;             // null if route lookup failed
  destination: Airport | null;
}

export interface Airport {
  iata: string;                       // 3-letter IATA code (e.g. "LHR")
  icao: string;                       // 4-letter ICAO code (e.g. "EGLL")
  name: string;                       // "London Heathrow"
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;                   // IANA, e.g. "Europe/London"
}

export interface Route {
  airlineIata: string;
  flightNumber: string;
  originIata: string;
  destinationIata: string;
}

export type PanelMode = 'closed' | 'flight' | 'list';
export type RefreshState = 'active' | 'idle' | 'background';
export type FetchStatus = 'idle' | 'fetching' | 'error';

/**
 * Geographic bounding box (degrees). lamin/lamax = latitudes (-90..+90),
 * lomin/lomax = longitudes (-180..+180). v1 doesn't use this client-side
 * (the server returns the global feed by default); kept here for v2
 * camera-driven filtering.
 */
export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}
