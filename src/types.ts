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

/**
 * Everything the render loop needs to put an aircraft where it is NOW,
 * worked out once per batch instead of once per frame.
 *
 * Declared here, beside Aircraft, and NOT next to the function that builds
 * it: this file is in the include list of both TypeScript programs
 * (tsconfig.server.json:14) and the server one is NodeNext, where the `@/`
 * alias does not exist. A type imported from `@/globe/deadReckoning` would
 * compile for the client and break `npm run build:server`. The interface is
 * plain data and imports nothing, so it belongs here.
 *
 * `u` is the unit vector of the measured fix and `w` the unit tangent at
 * that point in the direction of `headingDeg`. The plane of the great
 * circle the aircraft is flying is spanned by those two, so advancing along
 * it is a rotation inside that plane: one cos and one sin per frame,
 * against the four trig calls the lat/lon round trip costs today
 * (src/globe/aircraft.ts:177-191). At 11 625 aircraft and 60 fps that is
 * the difference between 2,79 million transcendental calls a second and
 * 205 thousand.
 */
export interface Motion {
  /** Unit vector of the last measured position (same convention as latLonToVec3). */
  ux: number;
  uy: number;
  uz: number;
  /** Unit tangent towards headingDeg at that point; zero when not extrapolable. */
  wx: number;
  wy: number;
  wz: number;
  /** Globe-space radius for this aircraft's altitude, offset included. */
  radius: number;
  /** Radians of arc per second, from velocityKt. Zero is a real answer: it is an aircraft at rest. */
  omegaPerS: number;
  /**
   * Age of the fix WHEN THE BATCH WAS ASSEMBLED, in seconds.
   *
   * A difference between two WALL instants — the provider's lastContact and
   * our server's fetchedAt — taken once and then frozen. No monotonic clock
   * can measure across two different clocks, and no wall clock may measure
   * a duration (D21).
   */
  fixAgeAtBatchS: number;
  /** False when lastContact, velocityKt or headingDeg was null (D18). */
  extrapolable: boolean;
  /** The drawing error being slid out, in globe space. Zero when there is none. */
  offX: number;
  offY: number;
  offZ: number;
  /** Monotonic ms at which that slide ends; 0 means there is no slide. */
  offUntilMs: number;
}

// Aircraft enriched with trail + resolved flight info
export interface Aircraft extends AircraftRaw {
  trail: Array<{ lon: number; lat: number; t: number }>; // last ~5s, interpolated
  /**
   * Optional because every Aircraft built outside updateBatch — which is
   * every one in the unit suite — has no motion to carry. In production
   * each record gets one, and a record without it is drawn where it was
   * last seen and counted under `still.unmeasurable` (D18).
   */
  motion?: Motion | null;
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
