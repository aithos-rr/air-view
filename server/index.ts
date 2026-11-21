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
import { adsbLolSource } from '../src/data/sources/adsbLol.js';
import { adsbFiSource } from '../src/data/sources/adsbFi.js';
import { createSourceSelector } from '../src/data/sources/selector.js';
import type { BoundingBox } from '../src/types.js';

// The feed is assembled from tiles, not from one global sweep: adsb.lol and
// adsb.fi both cap at 250 NM (verified live 2026-11-16) and no global
// endpoint survives (/v2/all -> 400, /api/0/all -> 503). Plan 1's single
// 10 000 NM request is what answered 502 in production without a single
// upstream request ever leaving the process — the selector skipped every
// source on radius. The poller below asks for one TILE_RADIUS_NM tile at a
// time instead.
const sources = createSourceSelector([adsbLolSource, adsbFiSource]);

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
// Tiled feed: cumulative fleet, tile scheduler, payload budget.
// ----------------------------------------------------------------------------

import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createFeedState } from './feedState.js';
import { createFleet } from './fleet.js';
import { rootCause } from './errorChain.js';
import { createTilePoller } from './poller.js';
import { registerHealthRoute } from './healthRoute.js';
import { buildTileGrid, createTileScheduler, tilesNear, TILE_RADIUS_NM } from '../src/data/sources/tileGrid.js';
import { createRouteResolver } from './routeResolver.js';
import { enrichAndMark } from './enrich.js';
import { readRouteCache } from './routeCache.js';

const feed = createFeedState();
const fleet = createFleet();
const tiles = buildTileGrid();
const scheduler = createTileScheduler(tiles);
const WORLD_KEY = 'world';

const routes = createRouteResolver();
// Deliberately slow: the bulk of the cache comes from the seed file, and
// adsbdb bans at a few requests per second. One lookup every 10 s is
// ~360/hour, enough to absorb newly appearing callsigns.
const ROUTE_PUMP_MS = 10_000;

let lastCompleteCount = 0;
let lastTotalCount = 0;

/**
 * Hard ceiling on the records in one payload.
 *
 * /api/states serves the whole accumulated fleet on every request — the bbox
 * is ignored on purpose — so the body is as big as the retention window
 * makes it, not as big as what the viewer is looking at.
 *
 * Measured on 20 000 records of the fourteen fields in src/types.ts, with
 * realistic variation: 280 B each with no route attached, 414 B with one,
 * about 340 B at a plausible route coverage — against about 143 B in v1,
 * which carried neither registration nor model nor route nor the
 * completeness flag. At the retention FLOOR of 1 200 s the fleet holds
 * twenty minutes of sightings, more aircraft than any snapshot, so the body
 * lands between 5,6 and 8,3 MB. Step 15a measures the real figure rather
 * than trusting this one.
 *
 * 24 000 is that 10 MB expressed in records: 24 000 x 414 B is 9,9 MB, the
 * worst case with a route on every aircraft. It therefore does not bind in
 * the normal regime — it is the backstop for the slow-upstream one, where
 * the window stretches to MAX_RETENTION_S = 7 200 s and the fleet becomes
 * two hours of sightings. When it binds, the payload is the most recently
 * absorbed records and `capped: true` says so in the body and on /health;
 * the fix is the one Step 15 already names, shrink the grid or accept a
 * partial feed.
 */
const MAX_PAYLOAD_AIRCRAFT = 24_000;

const gzipAsync = promisify(gzip);

/**
 * The current cycle's payload, compressed once instead of once per request.
 *
 * Measured at 6,1x with no routes attached and 7,8x with a route on every
 * record: twenty thousand objects with the same fourteen keys is close to
 * the best case for a dictionary coder, so ~7 MB leaves as ~1 MB.
 * Compressing in the handler would redo that work for every client on a body
 * that changes once a cycle, and gzipSync would block the same event loop
 * that paces the tile fetches.
 *
 * Two variants, because withStaleFlag() writes the freshness INTO the body
 * and a compressed body cannot be patched afterwards. (That function is
 * declared in Step 10 below; a function declaration is hoisted, and this
 * code runs only after listen().) Null until the cycle's compression
 * resolves, and the handler serves the raw string until then.
 */
let encodedWorld: { fresh: Buffer; stale: Buffer } | null = null;
let lastPayloadAircraft = 0;
let lastPayloadBytes = 0;
let lastPayloadGzipBytes = 0;
let lastPayloadCapped = false;

/**
 * Ceiling on the radius a viewer may ask us to refresh first.
 *
 * Not a round number any more. The orbit controls in src/globe/scene.ts hold
 * the camera between 3,0 and 10,0 globe radii, and at the far limit the cap
 * it can actually see is 4 886 NM (visibleCapRadiusNm in geoHelpers.ts). The
 * old ceiling of 2 000 NM sat BELOW the smallest value the client could
 * produce, so every request arrived clamped to exactly 2 000 and the zoom
 * level never reached the server at all. This one bounds a malformed client
 * without ever truncating an honest one.
 */
const MAX_VIEW_RADIUS_NM = 5_000;
/** No lat/lon in the query: refresh a region the size of a zoomed-in view. */
const DEFAULT_VIEW_RADIUS_NM = 600;

/**
 * Floor and ceiling for the derived retention window.
 *
 * A nominal sweep is 546 tiles x 1.5 s = 819 s, so this 1200 s floor is
 * about one and a half of them: a tile always comes round again well before
 * the window expires. 546 is the worst case and also the boot case, when
 * nothing is dormant yet; the derived figure below is measured over the DUE
 * tiles, so once the ocean and edge tiles fall asleep the sweep shortens and
 * this floor legitimately wins. That is the floor doing its job, not the
 * derivation going inert — the derivation still binds in the regime it was
 * written for, an upstream slower than the 1.5 s slot, where a sweep runs
 * into hours and only MAX_RETENTION_S holds it back.
 */
const MIN_RETENTION_S = 1_200;
const MAX_RETENTION_S = 7_200;

let observedSweepSeconds = 0;
const pollerStartedMs = Date.now();

// The request pacing (TILE_INTERVAL_MS), the 429 suspension and the tile
// loop itself live in server/poller.ts, where an injected clock can measure
// them. They were unreachable while they sat in this top-level script, and
// five independent mutations of the spacing left the suite green.
/**
 * Idle delay before the next cycle starts. It does NOT pace requests — the
 * poller's slot wait does, counting from the last fetch of the PREVIOUS
 * cycle — so this can only push requests further apart, never closer. It
 * stays because a cycle that fetches nothing (suspended after a 429, or an
 * empty batch) returns at once, and the loop would otherwise spin.
 */
const TILE_CYCLE_GAP_MS = 1_000;
/**
 * Deadline for one tile fetch. undici's headersTimeout is 300 s and the
 * dispatcher above overrides only `connect`, so a single hung tile holds
 * `cycleInFlight` — and with it the whole feed — for five minutes. 60 s
 * rather than the 10 s used for the adsbdb lookups (defect #37): adsb.lol
 * answered in 0.47 s median when last measured but took 52.8 s for one tile
 * during the congested run, and aborting slow-but-healthy tiles would
 * starve the fleet instead of protecting it.
 */
const TILE_FETCH_TIMEOUT_MS = 60_000;
/** The adapters already take a `fetchImpl`, so the deadline is injected
 *  here and no signature changes. */
const fetchWithTileTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) });

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

/**
 * The paced tile loop. Its clock, its sleep and its fetch are injected, so
 * tests/unit/server/poller.test.ts can measure the request spacing and the
 * clock handed to absorb() instead of taking this file's word for them.
 */
const poller = createTilePoller({
  scheduler,
  fleet,
  // The ONLY thing the poller learns from a fetch is `aircraft`:
  // TileFetchOutcome has no `fetchedAt`, so the provider's clock cannot
  // reach absorb() even by accident.
  fetchTile: (tile) => sources.fetchRegion(tile.centre, TILE_RADIUS_NM, fetchWithTileTimeout),
  recordFailure: (message) => feed.recordFailure(message),
  log: {
    info: (obj, msg) => app.log.info(obj, msg),
    warn: (obj, msg) => app.log.warn(obj, msg),
    error: (obj, msg) => app.log.error(obj, msg),
  },
});

/**
 * Polls the next few tiles and folds them into the fleet.
 *
 * v1 only ever fetched inside the /api/states handler, so with no traffic
 * there was no feed at all — and with a Railway healthcheck gating traffic
 * that would be a deadlock. The server feeds itself.
 */
let cycleInFlight = false;

async function refreshNextTiles(): Promise<void> {
  if (cycleInFlight) return; // a slow cycle must not be overlapped by the next
  cycleInFlight = true;
  try {
    await runCycle();
  } finally {
    cycleInFlight = false;
  }
}

async function runCycle(): Promise<void> {
  // The fetching, the pacing and the 429 suspension are the poller's; what
  // is left here is what happens to a cycle's harvest afterwards.
  const outcome = await poller.runCycle();
  if (!outcome.anySuccess) return;

  const nowUnix = Math.floor(Date.now() / 1000);

  // The retention window must outlast a full sweep, or prune() deletes an
  // aircraft long before its tile comes round again and the fleet degrades
  // into a rotating smear over a fraction of the grid. The sweep period is
  // measured rather than assumed: 546 tiles at the 1.5 s floor is 819 s and
  // the slots actually observed put it at 820-1000 s (14-17 minutes), but it
  // moves with upstream load, which is why it is derived and not a constant.
  // Measured on the ROTATION, not on every tile served: priority tiles are
  // re-fetched repeatedly and counting them would make the sweep look far
  // faster than it is, and the retention window would silently lie.
  // And over the tiles the rotation actually VISITS. Multiplying by
  // tiles.length counted the dormant ones as well, which the rotation skips
  // at zero cost — and dormant ocean and edge tiles are the steady state
  // Task 2 exists to reach, so the figure this plan calls the revisit period
  // was not one, and the window derived from it was inflated. `productive`
  // is total minus dormant; a dormant tile is still retried once every
  // DEFAULT_RETRY_EVERY sweeps, which adds at most ~5% to the true period
  // and is swallowed by the factor of two below.
  const elapsedS = (Date.now() - pollerStartedMs) / 1000;
  const stats = scheduler.stats();
  const dueTiles = Math.max(1, stats.productive);
  const sweepSeconds =
    stats.rotationServed > 0 ? (elapsedS / stats.rotationServed) * dueTiles : 0;
  observedSweepSeconds = Math.round(sweepSeconds);
  fleet.setMaxAgeSeconds(
    Math.min(MAX_RETENTION_S, Math.max(MIN_RETENTION_S, Math.round(sweepSeconds * 2)))
  );

  fleet.prune(nowUnix);

  // Attaching the routes and marking completeness is server/enrich.ts's, for
  // the reason the pacing is poller.ts's: nothing in this file is reachable
  // from a test, and while this block lived here seventeen mutations of it —
  // no route attached at all, origin and destination swapped, the fleet never
  // marked, completeness computed BEFORE the routes were attached — left all
  // 205 tests green. It runs on the records fleet.snapshot() hands back,
  // which are the very objects JSON.stringify photographs below.
  const counts = enrichAndMark(fleet.snapshot(), routes);
  lastCompleteCount = counts.complete;
  lastTotalCount = counts.total;

  const payloadAircraft = fleet.snapshot(MAX_PAYLOAD_AIRCRAFT);
  lastPayloadAircraft = payloadAircraft.length;
  lastPayloadCapped = fleet.size() > payloadAircraft.length;
  const body = JSON.stringify({
    fetchedAt: new Date(nowUnix * 1000).toISOString(),
    source: 'tiled',
    bbox: null,
    // Declared, not silent. A truncated world served as the whole world is
    // the same class of failure as a frozen feed served as a live one, and
    // this project has already paid for that one.
    capped: lastPayloadCapped,
    fleetSize: fleet.size(),
    aircraft: payloadAircraft,
  });
  lastPayloadBytes = Buffer.byteLength(body);
  feed.put(WORLD_KEY, body);

  if (lastPayloadCapped) {
    app.log.warn(
      { fleet: fleet.size(), served: payloadAircraft.length, retentionS: fleet.maxAgeSeconds() },
      'payload capped — the fleet outgrew MAX_PAYLOAD_AIRCRAFT'
    );
  }

  // Compressed AFTER the cache is filled, never before: a request landing
  // mid-compression gets the raw body rather than waiting on it.
  encodedWorld = null;
  try {
    const [fresh, stale] = await Promise.all([
      gzipAsync(withStaleFlag(body, false)),
      gzipAsync(withStaleFlag(body, true)),
    ]);
    encodedWorld = { fresh, stale };
    lastPayloadGzipBytes = fresh.length;
    app.log.info(
      { aircraft: payloadAircraft.length, bytes: lastPayloadBytes, gzipBytes: fresh.length },
      'payload encoded'
    );
  } catch (e) {
    // Not fatal: without the buffers the handler falls back to the raw body.
    lastPayloadGzipBytes = 0;
    app.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'payload compression failed');
  }
}

// ----------------------------------------------------------------------------
// Health check
// ----------------------------------------------------------------------------

// Registered through a factory in healthRoute.ts rather than written here:
// the status mapping is what gates the Railway deploy, and while it lived
// inside this top-level script no test could reach it.
registerHealthRoute(app, {
  health: () => feed.health(),
  uptimeSeconds: () => process.uptime(),
  lastTileFailure: () => poller.lastFailure(),
  fleet,
  payload: () => ({
    aircraft: lastPayloadAircraft,
    bytes: lastPayloadBytes,
    gzipBytes: lastPayloadGzipBytes,
    capped: lastPayloadCapped,
    maxAircraft: MAX_PAYLOAD_AIRCRAFT,
  }),
  tiles: () => {
    const suspendedForMs = poller.suspendedForMs();
    return {
      ...scheduler.stats(),
      observedSweepSeconds,
      // Rendered from OUR wall clock at read time: the poller times the
      // suspension monotonically, so it hands back a remaining duration.
      suspendedUntil:
        suspendedForMs > 0 ? new Date(Date.now() + suspendedForMs).toISOString() : null,
    };
  },
  routes: () => routes.stats(),
  aircraft: () => ({ total: lastTotalCount, complete: lastCompleteCount }),
});

// ----------------------------------------------------------------------------
// GET /api/states — serves the server-side fleet the tile poller accumulates.
//
// It no longer proxies anything: there is no per-request upstream fetch and no
// bbox-keyed cache. The bbox is read for tile PRIORITY only and deliberately
// does not filter the body, because the client needs the whole world to draw
// it. v1 keyed a 15 s cache by bbox and served it from the catch branch with
// no age limit, which is how a dead feed went on looking alive for 25 days.
// ----------------------------------------------------------------------------

/** Injects the freshness flag into an already-serialised payload. */
function withStaleFlag(body: string, stale: boolean): string {
  return `{"stale":${stale},${body.slice(1)}`;
}

app.get('/api/states', async (req, reply) => {
  const q = req.query as Record<string, string | undefined>;
  void parseBbox(q); // kept for backward compatibility; the payload is the whole fleet

  // A viewer tells us where they are looking, and those tiles jump the
  // queue. Without this, the region on screen would be as stale as the far
  // side of the planet: a full sweep takes 820-1000 s, 14-17 minutes.
  const viewLat = Number(q.lat);
  const viewLon = Number(q.lon);
  const viewRadius = Number(q.radius);
  if (Number.isFinite(viewLat) && Number.isFinite(viewLon)) {
    // Clamped, not trusted — but the ceiling is now above what the camera
    // can produce (see MAX_VIEW_RADIUS_NM), so an honest client is never
    // truncated and the zoom level survives the trip. A negative radius is
    // floored at 0, where tilesNear simply returns nothing.
    const radius = Number.isFinite(viewRadius)
      ? Math.min(Math.max(viewRadius, 0), MAX_VIEW_RADIUS_NM)
      : DEFAULT_VIEW_RADIUS_NM;
    const wanted = tilesNear(tiles, { lat: viewLat, lon: viewLon }, radius);
    // Six, not twelve: the scheduler reserves half of each batch for the
    // rotation, so asking for more only grows a queue that cannot be served.
    scheduler.prioritise(wanted.slice(0, 6).map((t) => t.id));
  }

  const cached = feed.get(WORLD_KEY);
  if (cached !== null) {
    reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(cached.stale));

    // Load-bearing next to a public cache-control: without accept-encoding
    // in Vary a shared cache may hand the gzip body to a client that never
    // asked for one. APPENDED, never replaced: @fastify/cors has already
    // set `vary: Origin` — CORS_ORIGINS is a list with regexes — and
    // dropping that would let the same cache serve one origin's
    // Access-Control-Allow-Origin to another.
    const vary = reply.getHeader('vary');
    const varied = vary === undefined ? [] : Array.isArray(vary) ? vary.map(String) : [String(vary)];
    reply.header('vary', [...varied, 'accept-encoding'].join(', '));

    const acceptsGzip = String(req.headers['accept-encoding'] ?? '').includes('gzip');
    const encoded = encodedWorld;
    if (acceptsGzip && encoded !== null) {
      // Compressed once per cycle by refreshNextTiles(), not once per
      // client: the body changes once a cycle and every client gets the
      // same bytes.
      return reply
        .header('content-encoding', 'gzip')
        .send(cached.stale ? encoded.stale : encoded.fresh);
    }
    // No gzip accepted, or the cycle's compression has not resolved yet.
    return reply.send(withStaleFlag(cached.body, cached.stale));
  }

  // No stale fallback of unbounded age: that is what hid the v1 outage for
  // 25 days. Fail loudly instead.
  const health = feed.health();
  return reply.status(503).send({
    error: health.lastError ?? 'feed warming up',
    // Same chain as /health: a blank globe is reported here first, and
    // "fetch failed" with no ENOTFOUND under it carries no diagnosis.
    code: health.lastError === null ? null : rootCause(poller.lastFailure()).code,
    status: health.status,
    feedAgeSeconds: health.feedAgeSeconds,
    fleetSize: fleet.size(),
  });
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
// Route cache seed
// ----------------------------------------------------------------------------

const seedPath = resolve(process.cwd(), 'server/data/route-cache.json');
if (existsSync(seedPath)) {
  try {
    // Both shapes of the file — the `{ gridCursor, records }` envelope the
    // sampler writes now and the bare array older runs wrote — are read in
    // routeCache.ts, where a test can tell the difference. Only malformed
    // JSON throws into the catch below and starts the server cold.
    routes.seed(readRouteCache(readFileSync(seedPath, 'utf8')));
    app.log.info({ callsigns: routes.stats().resolved + routes.stats().unknown }, 'route cache seeded');
  } catch (e) {
    app.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'route cache unreadable — starting cold');
  }
} else {
  app.log.warn('no route cache file — starting cold, most aircraft will be incomplete');
}

// ----------------------------------------------------------------------------
// Listen
// ----------------------------------------------------------------------------

try {
  await app.listen({ host: '0.0.0.0', port: PORT });
  app.log.info(`Air View server listening on :${PORT}`);

  // Self-rescheduling loop, NOT setInterval: a cycle can take minutes when
  // the upstream is slow, and a fixed timer would pile cycles on top of one
  // another until the request rate is unbounded.
  // The poller sets the rate, and it counts from the last fetch of the
  // previous cycle, so this delay can only push requests further apart.
  // It stays because a suspended or empty cycle returns at once and the
  // loop would otherwise spin.
  const scheduleNextCycle = (): void => {
    const t = setTimeout(() => {
      void refreshNextTiles().finally(scheduleNextCycle);
    }, TILE_CYCLE_GAP_MS);
    t.unref();
  };
  void refreshNextTiles().finally(scheduleNextCycle);

  // Same shape as the tile loop, and for the same reason: a hung adsbdb
  // request must not let pumps stack. Reproduced during review — a single
  // 300 s hang with a bare setInterval produced 30 concurrent lookups
  // against the one service that bans hard and renews the ban on every
  // request sent during the penalty.
  let routePumpInFlight = false;
  const scheduleNextPump = (): void => {
    const t = setTimeout(() => {
      if (routePumpInFlight) {
        scheduleNextPump();
        return;
      }
      routePumpInFlight = true;
      void routes
        .pump()
        .finally(() => {
          routePumpInFlight = false;
          scheduleNextPump();
        });
    }, ROUTE_PUMP_MS);
    t.unref();
  };
  scheduleNextPump();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
