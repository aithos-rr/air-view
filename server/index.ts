// --- Local .env loader -------------------------------------------------------
// Loads .env from the project root in non-production environments. Railway
// injects env vars at the platform level, so this is a no-op in production.
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
import { fetchAdsbStates } from '../src/data/adsbSource.js';
import type { BoundingBox } from '../src/types.js';

// ----------------------------------------------------------------------------
// Outbound HTTP dispatcher: force IPv4 and bump connect timeout. Node 20+
// undici tries IPv6 first by default; some container environments (Railway
// included) can't open AAAA routes, causing UND_ERR_CONNECT_TIMEOUT.
// ----------------------------------------------------------------------------
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 30_000, family: 4 },
  })
);

// ----------------------------------------------------------------------------
// 15-second in-memory response cache, keyed by bbox.
// ----------------------------------------------------------------------------

const cache = new Map<string, { body: string; fetchedAt: number }>();
const CACHE_TTL_MS = 15_000;
const GLOBAL_KEY = 'global';

function bboxKey(b: BoundingBox | null): string {
  if (b === null) return GLOBAL_KEY;
  return `${b.lamin}|${b.lomin}|${b.lamax}|${b.lomax}`;
}

function parseBbox(q: Record<string, string | undefined>): BoundingBox | null {
  if (q.lamin === undefined && q.lomin === undefined && q.lamax === undefined && q.lomax === undefined) {
    return null;
  }
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
// GET /api/states — proxies adsb.lol with bbox-keyed 15 s cache.
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

  try {
    const result = await fetchAdsbStates(bbox);
    const body = JSON.stringify({
      fetchedAt: result.fetchedAt.toISOString(),
      bbox,
      aircraft: result.aircraft,
    });
    cache.set(key, { body, fetchedAt: Date.now() });
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause =
      e && typeof e === 'object' && 'cause' in e
        ? ((e as { cause: unknown }).cause as { message?: string; code?: string })
        : null;
    req.log.error(
      { err: msg, causeMessage: cause?.message, causeCode: cause?.code, bbox },
      'adsb.lol upstream failed'
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
// ----------------------------------------------------------------------------

if (NODE_ENV === 'production') {
  const distDir = resolve(process.cwd(), 'dist');
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });

    app.setNotFoundHandler((req, reply) => {
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
