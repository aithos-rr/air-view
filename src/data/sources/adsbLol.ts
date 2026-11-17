import type { AircraftRaw } from '../../types.js';
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';
import { USER_AGENT } from './userAgent.js';

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  r?: string; // registration
  t?: string; // ICAO type code
}

interface AdsbLolResponse {
  ac?: AdsbLolAircraft[];
  now?: number; // milliseconds since epoch
}

function normalise(ac: AdsbLolAircraft & { hex: string }, nowMs: number): AircraftRaw {
  const onGround = ac.alt_baro === 'ground';
  const seenS = typeof ac.seen === 'number' ? ac.seen : 0;
  return {
    icao24: ac.hex.toLowerCase(),
    callsign: ac.flight?.trim() || null,
    longitude: typeof ac.lon === 'number' ? ac.lon : null,
    latitude: typeof ac.lat === 'number' ? ac.lat : null,
    baroAltitudeFt: !onGround && typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null,
    velocityKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
    headingDeg: typeof ac.track === 'number' ? ac.track : null,
    onGround,
    lastContact: Math.floor((nowMs - seenS * 1000) / 1000),
    registration: ac.r?.trim() || null,
    modelCode: ac.t?.trim() || null,
    modelDesc: null, // adsb.lol does not ship a long model name
    route: null, // filled server-side from adsbdb
    complete: false, // computed server-side once the route is attached
  };
}

export const adsbLolSource: AircraftSource = {
  id: 'adsb-lol',
  label: 'adsb.lol',
  // Verified live 2026-11-16: 250 NM -> 200; 251 NM and above -> 403
  // "radius exceeds 250 NM". There is no global endpoint any more:
  // /v2/all -> 400, /api/0/all -> 503, /v2/mil is military traffic only.
  maxRadiusNm: 250,

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://api.adsb.lol/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsb-lol: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbLolResponse;
    const nowMs = data.now ?? Date.now();
    const aircraft = (data.ac ?? [])
      .filter((ac): ac is AdsbLolAircraft & { hex: string } => typeof ac.hex === 'string' && ac.hex.length > 0)
      .map((ac) => normalise(ac, nowMs));
    return { aircraft, fetchedAt: new Date(nowMs) };
  },
};
