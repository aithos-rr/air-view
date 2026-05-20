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
import fastifyStatic from '@fastify/static';
import { Agent, setGlobalDispatcher } from 'undici';
import { fetchStatesAuthenticated, type BoundingBox } from '../src/data/openSkyAuth.js';

// ----------------------------------------------------------------------------
// Outbound HTTP dispatcher
// ----------------------------------------------------------------------------
// Node 20 default fetch (undici) tries IPv6 first when resolving hostnames.
// On Railway containers, IPv6 routing to opensky-network.org times out
// (UND_ERR_CONNECT_TIMEOUT after ~10 s of dead AAAA attempts). Force the
// DNS lookup to IPv4 only and bump the connect timeout to 30 s for safety.
setGlobalDispatcher(
  new Agent({
    connect: {
      timeout: 30_000,
      // family: 4 → IPv4 only; avoids the flaky AAAA path on Railway egress
      family: 4,
    },
  })
);

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
// 15-second in-memory response cache, keyed by bbox.
// Worker-local; protects OpenSky quota. Different bboxes get separate cache
// entries so the Europe default doesn't poison a request for a custom region.
// ----------------------------------------------------------------------------

const cache = new Map<string, { body: string; fetchedAt: number }>();
const CACHE_TTL_MS = 15_000;

const GLOBAL_KEY = 'global';

function bboxKey(b: BoundingBox | null): string {
  if (b === null) return GLOBAL_KEY;
  return `${b.lamin}|${b.lomin}|${b.lamax}|${b.lomax}`;
}

// v1 final: default is the GLOBAL feed (no bbox).
// Clients can still request a bbox via query params — this will be the
// hook for v2's camera-driven filter.
function parseBbox(q: Record<string, string | undefined>): BoundingBox | null {
  // If no bbox query params are present at all → return null (global feed)
  if (q.lamin === undefined && q.lomin === undefined && q.lamax === undefined && q.lomax === undefined) {
    return null;
  }
  // If partial params are present, fill in sensible defaults (-90/+90 lat, -180/+180 lon)
  const parse = (s: string | undefined, fallback: number): number => {
    if (s === undefined) return fallback;
    const parsed = Number(s);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    lamin: parse(q.lamin, -90),
    lomin: parse(q.lomin, -180),
    lamax: parse(q.lamax, 90),
    lomax: parse(q.lomax, 180),
  };
}

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
// /api/diagnose — outbound connectivity probe.
// Temporary diagnostic for the Railway egress timeout. Tests four targets in
// parallel and returns success / cause / time-ms for each. Remove once the
// root cause is identified.
// ----------------------------------------------------------------------------
async function probe(url: string): Promise<{ url: string; ok: boolean; status?: number; ms: number; cause?: string; code?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), method: 'HEAD' });
    return { url, ok: true, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    const cause =
      e && typeof e === 'object' && 'cause' in e
        ? ((e as { cause: unknown }).cause as { message?: string; code?: string })
        : null;
    return {
      url,
      ok: false,
      ms: Date.now() - t0,
      cause: cause?.message ?? (e instanceof Error ? e.message : String(e)),
      code: cause?.code,
    };
  }
}

app.get('/api/diagnose', async () => {
  const targets = [
    'https://www.google.com',
    'https://api.github.com',
    'https://auth.opensky-network.org/',
    'https://opensky-network.org/api/states/all',
  ];
  const results = await Promise.all(targets.map(probe));
  return { node: process.version, results };
});

// ----------------------------------------------------------------------------
// GET /api/states — proxies OpenSky with OAuth2 + cache
// ----------------------------------------------------------------------------

app.get('/api/states', async (req, reply) => {
  const bbox = parseBbox(req.query as Record<string, string | undefined>);
  const key = bboxKey(bbox);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(hit.body);
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
    const upstream = await fetchStatesAuthenticated({ clientId, clientSecret }, bbox);
    if (!upstream.ok) throw new Error(`OpenSky ${upstream.status}`);
    const data = (await upstream.json()) as OpenSkyResponse;
    const normalised = {
      fetchedAt: new Date().toISOString(),
      bbox,
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
    cache.set(key, { body, fetchedAt: Date.now() });
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Node's fetch wraps the real network error in `cause`. Surface it so
    // we can see ENOTFOUND / ECONNREFUSED / certificate errors at a glance
    // instead of the generic "fetch failed".
    const cause =
      e && typeof e === 'object' && 'cause' in e
        ? ((e as { cause: unknown }).cause as { message?: string; code?: string })
        : null;
    req.log.error(
      { err: msg, causeMessage: cause?.message, causeCode: cause?.code, bbox },
      'OpenSky upstream failed'
    );
    if (hit) {
      return reply
        .header('content-type', 'application/json')
        .header('x-error', msg)
        .send(hit.body);
    }
    return reply.status(502).send({
      error: msg,
      cause: cause?.message ?? null,
      code: cause?.code ?? null,
    });
  }
});

// ----------------------------------------------------------------------------
// Static frontend (production only) — serves the Vite build from dist/.
// In dev (npm run dev:full) Vite handles this on :5173 and proxies /api to us.
// We register this AFTER the API routes so /api/* and /health still resolve
// to their handlers, then add a setNotFoundHandler that returns index.html
// for any other path (SPA-friendly).
// ----------------------------------------------------------------------------

if (NODE_ENV === 'production') {
  const distDir = resolve(process.cwd(), 'dist');
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      wildcard: false, // we serve the SPA fallback ourselves below
      decorateReply: true,
    });

    app.setNotFoundHandler((req, reply) => {
      // Genuine 404 for API + health: don't masquerade as the SPA
      if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
        return reply.status(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });

    app.log.info(`Serving static frontend from ${distDir}`);
  } else {
    app.log.warn(`NODE_ENV=production but ${distDir} does not exist — no static files served`);
  }
}

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
