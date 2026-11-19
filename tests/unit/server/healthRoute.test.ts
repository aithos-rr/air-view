// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerHealthRoute, httpStatusForFeed } from '../../../server/healthRoute';
import { createFeedState } from '../../../server/feedState';

/**
 * The route under a controllable clock, with a REAL createFeedState behind
 * it — the mapping is only worth testing against the state machine it maps.
 *
 * feedState.test.ts already kills every mutant of that machine. Nothing
 * killed the mapping: it lived in the top-level script, and collapsing it to
 * a flat `200` — a dead feed reporting healthy for ever, which is the v1
 * failure that ran for 25 days — kept the whole suite green.
 */
function build(opts: { degradedAfterMs?: number; startupGraceMs?: number } = {}): {
  app: FastifyInstance;
  feed: ReturnType<typeof createFeedState>;
  advance: (ms: number) => void;
} {
  let clock = 1_700_000_000_000;
  const feed = createFeedState({
    degradedAfterMs: opts.degradedAfterMs ?? 300_000,
    startupGraceMs: opts.startupGraceMs ?? 180_000,
    now: () => clock,
  });
  const app = Fastify({ logger: false });
  registerHealthRoute(app, {
    health: () => feed.health(),
    uptimeSeconds: () => 42,
    lastTileFailure: () => null,
    fleet: { size: () => 7, maxAgeSeconds: () => 1_200 },
    payload: () => ({
      aircraft: 7, bytes: 100, gzipBytes: 20, capped: false, maxAircraft: 24_000,
    }),
    tiles: () => ({ total: 546, productive: 546, dormant: 0 }),
  });
  return {
    app,
    feed,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe('GET /health — the status code that gates the Railway deploy', () => {
  it('answers 200 while the feed is still STARTING', async () => {
    // railway.toml gates the deploy on this endpoint. A 503 at boot stalls
    // it for ever: no traffic is routed until the check passes, and the feed
    // is only ever healthy once it is polling. This is the exact mutant
    // `health.status === 'ok' ? 200 : 503` reintroduces.
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('starting');
    await app.close();
  });

  it('answers 200 once the feed is OK', async () => {
    const { app, feed, advance } = build();
    feed.put('world', '{}');
    advance(60_000);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    await app.close();
  });

  it('answers 503 once a feed that WAS live has gone DEGRADED', async () => {
    // The v1 failure in one line: /health answered 'ok' unconditionally
    // while the server served a frozen snapshot, and nothing reported it for
    // 25 days. A flat `reply.status(200)` here is that bug restored.
    const { app, feed, advance } = build({ degradedAfterMs: 300_000 });
    feed.put('world', '{}');
    advance(301_000);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('degraded');
    await app.close();
  });

  it('answers 503 when the feed never came up within the startup grace', async () => {
    // 'starting' must not become a hiding place: a feed that never starts
    // has to stop reporting 200 eventually.
    const { app, feed, advance } = build({ startupGraceMs: 180_000 });
    feed.recordFailure('adsb-lol: HTTP 403');
    advance(181_000);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('degraded');
    await app.close();
  });

  it('walks all three states on one instance, code and body agreeing', async () => {
    // Collapsing `status: health.status` to a literal 'ok' left the suite
    // green too: the three states have to be visible in the BODY, which is
    // what an operator reads, not only in the code Railway reads.
    const { app, feed, advance } = build({ degradedAfterMs: 300_000 });

    const starting = await app.inject({ method: 'GET', url: '/health' });
    expect([starting.statusCode, starting.json().status]).toEqual([200, 'starting']);

    feed.put('world', '{}');
    const ok = await app.inject({ method: 'GET', url: '/health' });
    expect([ok.statusCode, ok.json().status]).toEqual([200, 'ok']);

    advance(301_000);
    const degraded = await app.inject({ method: 'GET', url: '/health' });
    expect([degraded.statusCode, degraded.json().status]).toEqual([503, 'degraded']);

    // Three distinct states, not one repeated.
    expect(
      new Set([starting.json().status, ok.json().status, degraded.json().status]).size
    ).toBe(3);
    await app.close();
  });

  it('still reports the numbers an operator diagnoses from', async () => {
    const { app, feed } = build();
    feed.put('world', '{}');
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.fleet).toEqual({ size: 7, maxAgeSeconds: 1_200 });
    expect(body.payload.maxAircraft).toBe(24_000);
    expect(body.tiles.total).toBe(546);
    expect(body.uptime).toBe(42);
    await app.close();
  });
});

describe('httpStatusForFeed', () => {
  it('maps exactly one of the three states to a failure', () => {
    expect(httpStatusForFeed('starting')).toBe(200);
    expect(httpStatusForFeed('ok')).toBe(200);
    expect(httpStatusForFeed('degraded')).toBe(503);
  });
});
