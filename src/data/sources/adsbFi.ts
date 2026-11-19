import type { AircraftRaw } from '../../types.js';
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';
import { USER_AGENT } from './userAgent.js';
import { upstreamHttpError } from './httpError.js';

interface AdsbFiAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  r?: string;
  t?: string;
  desc?: string; // long model name — adsb.fi only
}

interface AdsbFiResponse {
  aircraft?: AdsbFiAircraft[];
  now?: number; // SECONDS since epoch, unlike adsb.lol's milliseconds
}

function normalise(ac: AdsbFiAircraft & { hex: string }, nowMs: number): AircraftRaw {
  const onGround = ac.alt_baro === 'ground';

  return {
    icao24: ac.hex.toLowerCase(),
    callsign: ac.flight?.trim() || null,
    longitude: typeof ac.lon === 'number' ? ac.lon : null,
    latitude: typeof ac.lat === 'number' ? ac.lat : null,
    baroAltitudeFt: !onGround && typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null,
    velocityKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
    headingDeg: typeof ac.track === 'number' ? ac.track : null,
    onGround,
    // `seen` is how many seconds ago this record was heard. Without it the
    // staleness is UNKNOWN, and defaulting to 0 would stamp the aircraft as
    // seen at the instant of the fetch — a plausible value in place of a
    // missing one, which is the rule this project broke in v1 with routes.
    // Dead reckoning must not extrapolate from a timestamp nobody reported.
    lastContact: typeof ac.seen === 'number' ? Math.floor((nowMs - ac.seen * 1000) / 1000) : null,
    registration: ac.r?.trim() || null,
    modelCode: ac.t?.trim() || null,
    modelDesc: ac.desc?.trim() || null,
    route: null,
    complete: false,
  };
}

export const adsbFiSource: AircraftSource = {
  id: 'adsb-fi',
  label: 'adsb.fi',
  // Verified live: 250 NM -> 200; 1000 NM -> 400; 5000 and 10 000 NM -> 429.
  // Same ceiling as adsb.lol since 2026-11, so the gap that once separated
  // the two providers is gone. The tiled poller now issues every request
  // under this ceiling, so adsb.fi is a real fallback again: when adsb.lol
  // opens its breaker the same tile is served from here, instead of both
  // sources being skipped on radius and /api/states answering 502.
  maxRadiusNm: 250,

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://opendata.adsb.fi/api/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw await upstreamHttpError('adsb-fi', res);
    const data = (await res.json()) as AdsbFiResponse;
    const nowMs = typeof data.now === 'number' ? data.now * 1000 : Date.now();
    const aircraft = (data.aircraft ?? [])
      .filter((ac): ac is AdsbFiAircraft & { hex: string } => typeof ac.hex === 'string' && ac.hex.length > 0)
      .map((ac) => normalise(ac, nowMs));
    return { aircraft, fetchedAt: new Date(nowMs) };
  },
};
