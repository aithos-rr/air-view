// --- Local .env loader -------------------------------------------------------
// Loads .env from the project root in non-production environments. Railway
// injects env vars at the platform level, so this is a no-op in production.
// Zero dependencies — a 15-line dotenv-equivalent for our small key=value file.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.NODE_ENV !== 'production') {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fetchStatesAuthenticated } from '../src/data/openSkyAuth.js';

// ----------------------------------------------------------------------------
// Types — mirror the OpenSky /states/all response shape and our normalized form
// ----------------------------------------------------------------------------

interface OpenSkyState extends Array<unknown> {
  0: string; // icao24
  1: string | null; // callsign
  4: number; // last_contact (unix)
  5: number | null; // longitude
  6: number | null; // latitude
  7: number | null; // baro_altitude (m)
  8: boolean; // on_ground
  9: number | null; // velocity (m/s)
  10: number | null; // true_track (deg)
}

interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

// ----------------------------------------------------------------------------
// 15-second in-memory response cache (worker-local; protects OpenSky quota)
// ----------------------------------------------------------------------------

let cache: { body: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

// ----------------------------------------------------------------------------
// Server bootstrap
// ----------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// CORS: in dev allow Vite (localhost:5173); in prod allow Railway public
// domains + the explicit FRONTEND_ORIGIN env var if set.
const CORS_ORIGINS: (string | RegExp)[] =
  NODE_ENV === 'production'
    ? [
        ...(process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : []),
        /\.railway\.app$/,
        /\.up\.railway\.app$/,
      ]
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

await app.register(cors, { origin: CORS_ORIGINS });

// ----------------------------------------------------------------------------
// Health check
// ----------------------------------------------------------------------------

app.get('/health', async () => {
  return { status: 'ok', uptime: process.uptime() };
});

// ----------------------------------------------------------------------------
// GET /api/states — proxies OpenSky with OAuth2 + cache
// ----------------------------------------------------------------------------

app.get('/api/states', async (_req, reply) => {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(cache.body);
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return reply.status(500).send({
      error:
        'OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET not configured. ' +
        'Create an API client at https://opensky-network.org → Account → API Clients.',
    });
  }

  try {
    const upstream = await fetchStatesAuthenticated({ clientId, clientSecret });
    if (!upstream.ok) throw new Error(`OpenSky ${upstream.status}`);
    const data = (await upstream.json()) as OpenSkyResponse;
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
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cache) {
      return reply
        .header('content-type', 'application/json')
        .header('x-error', msg)
        .send(cache.body);
    }
    return reply.status(502).send({ error: msg });
  }
});

// ----------------------------------------------------------------------------
// Listen
// ----------------------------------------------------------------------------

try {
  await app.listen({ host: '0.0.0.0', port: PORT });
  app.log.info(`Air View server listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
