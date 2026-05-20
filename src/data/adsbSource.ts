import type { AircraftRaw, BoundingBox } from '../types.js';

/**
 * Community-driven ADS-B aggregator (no auth, no IP-based rate limit).
 * Replaces OpenSky, whose firewall blocks Railway's egress IP range.
 *
 * v1 always hits /v2/all (global feed, ~14k aircraft, ~2 MB JSON).
 * v2 may switch to /v2/lat/<lat>/lon/<lon>/dist/<nm> for camera-bounded
 * queries — adsb.lol doesn't accept a lat/lon bbox, only center+radius,
 * so we'd convert bbox → centroid + radius nautical miles at that point.
 */
const STATES_URL = 'https://api.adsb.lol/v2/all';

interface AdsbAircraft {
  hex: string; // ICAO24 (lowercase)
  flight?: string; // callsign, may have trailing spaces
  lat?: number;
  lon?: number;
  // alt_baro is either a number (feet) or the literal string "ground"
  alt_baro?: number | 'ground';
  gs?: number; // ground speed in knots
  track?: number; // true track in degrees
  seen?: number; // seconds since this aircraft was last seen
}

interface AdsbResponse {
  ac?: AdsbAircraft[];
  now?: number; // ms since epoch
  msg?: string;
}

export interface AdsbResult {
  aircraft: AircraftRaw[];
  fetchedAt: Date;
}

/**
 * Fetches the current ADS-B snapshot and normalises every entry to the
 * AircraftRaw shape the rest of the codebase already understands.
 *
 * @param _bbox  Reserved for v2 camera-driven filtering. Ignored for now —
 *               adsb.lol's bbox endpoint is shape-incompatible (centre+radius)
 *               and we still want the global feed in v1.
 * @param fetchImpl Injectable for unit testing.
 */
export async function fetchAdsbStates(
  _bbox: BoundingBox | null = null,
  fetchImpl: typeof fetch = fetch
): Promise<AdsbResult> {
  const res = await fetchImpl(STATES_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`adsb.lol /v2/all: HTTP ${res.status}`);
  const data = (await res.json()) as AdsbResponse;
  const nowMs = data.now ?? Date.now();
  const aircraft: AircraftRaw[] = (data.ac ?? [])
    .filter((ac) => typeof ac.hex === 'string' && ac.hex.length > 0)
    .map((ac) => normalise(ac, nowMs));
  return { aircraft, fetchedAt: new Date(nowMs) };
}

function normalise(ac: AdsbAircraft, nowMs: number): AircraftRaw {
  const onGround = ac.alt_baro === 'ground';
  const baroAltitudeFt =
    !onGround && typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null;
  const seenS = typeof ac.seen === 'number' ? ac.seen : 0;
  const lastContact = Math.floor((nowMs - seenS * 1000) / 1000);

  return {
    icao24: ac.hex.toLowerCase(),
    callsign: ac.flight?.trim() || null,
    longitude: typeof ac.lon === 'number' ? ac.lon : null,
    latitude: typeof ac.lat === 'number' ? ac.lat : null,
    baroAltitudeFt,
    velocityKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
    headingDeg: typeof ac.track === 'number' ? ac.track : null,
    onGround,
    lastContact,
  };
}
