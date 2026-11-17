import type { AircraftRaw } from '../../types.js';
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';
import { USER_AGENT } from './userAgent.js';

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
    modelDesc: ac.desc?.trim() || null,
    route: null,
    complete: false,
  };
}

export const adsbFiSource: AircraftSource = {
  id: 'adsb-fi',
  label: 'adsb.fi',
  // Verified live: 250 NM -> 200; 1000 NM -> 400; 5000 and 10 000 NM -> 429.
  // Same ceiling as adsb.lol since 2026-11, so the gap that once separated the
  // two providers is gone. That does not help yet: the only caller of the
  // selector still asks for a 10 000 NM sweep, so BOTH sources are skipped for
  // radius and /api/states answers 502. adsb.fi is therefore a fallback for
  // nothing today. It will become one once the tiled feed (Task 3) issues every
  // request under 250 NM — not before.
  maxRadiusNm: 250,

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://opendata.adsb.fi/api/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsb-fi: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbFiResponse;
    const nowMs = typeof data.now === 'number' ? data.now * 1000 : Date.now();
    const aircraft = (data.aircraft ?? [])
      .filter((ac): ac is AdsbFiAircraft & { hex: string } => typeof ac.hex === 'string' && ac.hex.length > 0)
      .map((ac) => normalise(ac, nowMs));
    return { aircraft, fetchedAt: new Date(nowMs) };
  },
};
