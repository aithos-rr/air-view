export const config = { runtime: 'edge' };

interface OpenSkyState extends Array<unknown> {
  0: string;        // icao24
  1: string | null; // callsign
  4: number;        // last_contact (unix)
  5: number | null; // longitude
  6: number | null; // latitude
  7: number | null; // baro_altitude (m)
  8: boolean;       // on_ground
  9: number | null; // velocity (m/s)
  10: number | null;// true_track (deg)
}

interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

// In-memory cache shared across edge invocations on the same node.
// 15 s cache — protects against bursts and stays inside OpenSky free tier.
let cache: { body: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

export default async function handler(_request: Request): Promise<Response> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return new Response(cache.body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, s-maxage=10, stale-while-revalidate=20',
      },
    });
  }

  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  const url = 'https://opensky-network.org/api/states/all';
  const headers: HeadersInit = {};
  if (user && pass) headers.Authorization = 'Basic ' + btoa(`${user}:${pass}`);

  try {
    const upstream = await fetch(url, { headers });
    if (!upstream.ok) throw new Error(`OpenSky ${upstream.status}`);
    const data: OpenSkyResponse = await upstream.json();
    const normalised = {
      fetchedAt: new Date().toISOString(),
      aircraft: (data.states ?? []).map((s) => ({
        icao24: s[0],
        callsign: s[1]?.trim() || null,
        longitude: s[5],
        latitude: s[6],
        baroAltitudeFt: s[7] !== null ? Math.round(s[7] * 3.281) : null,
        velocityKt: s[9] !== null ? Math.round(s[9] * 1.944) : null,
        headingDeg: s[10],
        onGround: s[8],
        lastContact: s[4],
      })),
    };
    const body = JSON.stringify(normalised);
    cache = { body, fetchedAt: Date.now() };
    return new Response(body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, s-maxage=10, stale-while-revalidate=20',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cache)
      return new Response(cache.body, {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-error': msg },
      });
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
