/** Route as sent to the client. Populated server-side from adsbdb. */
export interface FlightRouteLite {
  originIata: string;
  originName: string;
  destinationIata: string;
  destinationName: string;
  airlineName: string | null;
}

// Raw aircraft state from an ADS-B source, normalized across providers.
export interface AircraftRaw {
  icao24: string;
  callsign: string | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitudeFt: number | null;
  velocityKt: number | null;
  headingDeg: number | null;
  onGround: boolean;
  lastContact: number | null;         // unix seconds; null = provider did not say how stale
  registration: string | null;        // tail number, e.g. "I-ABCD"
  modelCode: string | null;           // ICAO type code, e.g. "A320"
  modelDesc: string | null;           // long name; only adsb.fi ships it
  route: FlightRouteLite | null;      // filled by the server (Task 5) from the pre-built cache; null = adsbdb has no route for this callsign
  complete: boolean;                  // computed server-side by isComplete(); false from adapters
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
