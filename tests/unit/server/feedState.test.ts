import { describe, it, expect } from 'vitest';
import { createFeedState } from '../../../server/feedState';

describe('createFeedState — cache', () => {
  it('serves a fresh body unmarked', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 10_000;
    expect(s.get('world')).toEqual({ body: '{"a":1}', stale: false });
  });

  it('serves a body past freshness but marks it stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 120_000;
    expect(s.get('world')).toEqual({ body: '{"a":1}', stale: true });
  });

  it('REFUSES a body past the stale ceiling — v1 had no ceiling at all', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 601_000;
    expect(s.get('world')).toBeNull();
  });
});

describe('createFeedState — health', () => {
  it('reports starting before any fetch has succeeded — NOT degraded', () => {
    // railway.toml gates the deploy on /health. Answering 503 at boot would
    // stall it: no traffic is routed until the check passes.
    const s = createFeedState({ now: () => 1_000_000 });
    const h = s.health();
    expect(h.status).toBe('starting');
    expect(h.feedAgeSeconds).toBeNull();
  });

  it('reports ok while the last success is recent', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 60_000;
    expect(s.health().status).toBe('ok');
    expect(s.health().feedAgeSeconds).toBe(60);
  });

  it('reports degraded once a previously live feed has gone stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 301_000;
    expect(s.health().status).toBe('degraded');
  });

  it('gives up on starting once the grace window expires', () => {
    // Otherwise a feed that never comes up — the exact 2026-08 scenario —
    // leaves /health answering 200 for ever.
    let clock = 1_000_000;
    const s = createFeedState({ startupGraceMs: 180_000, now: () => clock });
    s.recordFailure('adsb-lol: HTTP 403');
    clock += 181_000;
    expect(s.health().status).toBe('degraded');
  });

  it('surfaces the last error without prematurely declaring degraded', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 10_000;
    s.recordFailure('adsb-lol: HTTP 403');
    expect(s.health().lastError).toMatch(/403/);
    expect(s.health().status).toBe('ok');
  });
});
