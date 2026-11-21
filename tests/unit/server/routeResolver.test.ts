import { describe, it, expect, vi } from 'vitest';
import { createRouteResolver } from '../../../server/routeResolver';

const ROUTE = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

function adsbdbOk(origin: string, dest: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      response: {
        flightroute: {
          callsign: 'BAW274',
          callsign_iata: 'BA274',
          airline: { name: 'British Airways' },
          origin: { iata_code: origin, name: `${origin} Airport` },
          destination: { iata_code: dest, name: `${dest} Airport` },
        },
      },
    }),
  };
}

// Verified live: adsbdb answers 404 — NOT 200 — for an unknown callsign.
const adsbdbUnknown = { ok: false, status: 404, json: async () => ({ response: 'unknown callsign' }) };
// Verified live: ~1190 lookups at 4.8 req/s produced this.
const adsbdbRateLimited = {
  ok: false,
  status: 429,
  json: async () => ({ response: 'rate limited for 300 seconds' }),
};

/** Tests must not actually wait between lookups. */
const mk = (opts = {}) => createRouteResolver({ minIntervalMs: 0, ...opts });

describe('createRouteResolver — cache and lookups', () => {
  it('returns null before anything has been resolved', () => {
    expect(mk().get('BAW274')).toBeNull();
  });

  it('serves a seeded route without any network call', () => {
    const fetchImpl = vi.fn();
    const r = mk();
    r.seed([{ callsign: 'BAW274', route: ROUTE }]);
    expect(r.get('BAW274')?.originIata).toBe('LAS');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.stats().resolved).toBe(1);
  });

  it('does not re-enqueue a callsign the seed already judged unknown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.seed([{ callsign: 'NJE004M', route: null }]);
    r.enqueue(['NJE004M']);
    expect(r.stats().queued).toBe(0);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves a queued callsign and serves it from cache afterwards', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('BAW274')?.originIata).toBe('LAS');
    expect(r.get('BAW274')?.destinationIata).toBe('LHR');
    expect(r.get('BAW274')?.callsignIata).toBe('BA274');
  });

  it('sends the project User-Agent to adsbdb', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/air-view/);
  });

  it('treats HTTP 404 as a VERDICT, not a transport error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbUnknown);
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('NJE004M')).toBeNull();
    expect(r.stats().unknown).toBe(1);
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps the number of lookups per pump', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('AAA', 'BBB'));
    const r = mk({ maxPerPump: 2 });
    r.enqueue(['AAA111', 'BBB222', 'CCC333', 'DDD444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.stats().queued).toBe(2);
  });

  it('ignores a resolved route missing an airport code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: { flightroute: { callsign: 'XXX1', origin: {}, destination: {} } } }),
    });
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['XXX1']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('XXX1')).toBeNull();
    expect(r.stats().unknown).toBe(1);
  });

  it('normalises the callsign to uppercase and trims it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue([' baw274 ']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.adsbdb.com/v0/callsign/BAW274');
    expect(r.get('baw274')).not.toBeNull();
  });
});

describe('createRouteResolver — rate limiting', () => {
  it('SUSPENDS on 429 and stops the batch immediately', async () => {
    // Verified live: requests sent during the penalty renew it. A resolver
    // that keeps firing never recovers on its own.
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock, monotonicNow: () => clock });
    r.enqueue(['A111', 'B222', 'C333', 'D444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // stopped at the first 429
    expect(r.stats().suspendedUntil).not.toBeNull();
    expect(r.stats().queued).toBe(4); // nothing lost
  });

  it('emits NO request at all while suspended', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock, monotonicNow: () => clock });
    r.enqueue(['A111']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    fetchImpl.mockClear();

    clock += 299_000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resumes once the cooldown has elapsed', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(adsbdbRateLimited).mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock, monotonicNow: () => clock });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    clock += 301_000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('BAW274')).not.toBeNull();
    expect(r.stats().suspendedUntil).toBeNull();
  });

  it('backs off exponentially on repeated rate limits', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock, monotonicNow: () => clock });
    r.enqueue(['A111', 'B222']);

    await r.pump(fetchImpl as unknown as typeof fetch);
    const first = new Date(r.stats().suspendedUntil!).getTime() - clock;
    clock += first + 1;
    await r.pump(fetchImpl as unknown as typeof fetch);
    const second = new Date(r.stats().suspendedUntil!).getTime() - clock;

    expect(second).toBeGreaterThan(first);
    expect(r.stats().consecutiveRateLimits).toBe(2);
  });

  it('clears the backoff counter after a success', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(adsbdbRateLimited).mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 1000, now: () => clock, monotonicNow: () => clock });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    clock += 2000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.stats().consecutiveRateLimits).toBe(0);
  });

  it('holds the SUSPENSION when the WALL CLOCK jumps FORWARD', async () => {
    // Date.now() is not a stopwatch. Measured on this machine it moves by
    // ~528 ms every ~32 s as WSL2 resyncs against the host, and NTP corrects
    // in both directions. The cooldown is a DURATION, so it is timed on the
    // monotonic clock: a forward jump of the wall clock must not make the
    // penalty look spent, because a request sent during it RENEWS it — the
    // one failure mode this whole suspension exists to prevent.
    //
    // server/poller.ts draws the same line for the same reason; see its test
    // «holds the spacing when the WALL CLOCK jumps FORWARD».
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let wall = 1_000_000;
    let mono = 5_000;
    const r = mk({
      maxPerPump: 10,
      rateLimitCooldownMs: 300_000,
      now: () => wall,
      monotonicNow: () => mono,
    });
    r.enqueue(['A111']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    fetchImpl.mockClear();

    wall += 400_000; // the resync: further than the whole cooldown
    mono += 1_000; // real time elapsed: one second
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.stats().suspendedUntil).not.toBeNull();
  });

  it('exposes the rate limit in stats so /health can report it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['A111']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.stats().lastError).toMatch(/429|rate/i);
  });

  it('gives up on a callsign after repeated transport failures', async () => {
    // Without a cap, a permanently failing callsign recirculates forever.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = mk({ maxPerPump: 1, maxAttempts: 3 });
    r.enqueue(['BAW274']);
    for (let i = 0; i < 4; i++) await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.stats().queued).toBe(0);
    expect(r.stats().abandoned).toBe(1);
  });

  it('REMEMBERS an abandoned callsign so the server cannot re-enqueue it', async () => {
    // The server calls enqueue() on every feed cycle. Without a permanent
    // record, a callsign given up on comes straight back and the attempt cap
    // achieves nothing.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = mk({ maxPerPump: 1, maxAttempts: 3 });
    r.enqueue(['BAW274']);
    for (let i = 0; i < 4; i++) await r.pump(fetchImpl as unknown as typeof fetch);

    r.enqueue(['BAW274']);
    expect(r.stats().queued).toBe(0);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // no fourth attempt
  });

  it('waits minIntervalMs between lookups inside one pump', async () => {
    // pump() with maxPerPump > 1 used to fire the whole batch back-to-back,
    // which is how the project's 1-request-per-1.5s rule got broken from the
    // inside.
    //
    // Measured on the MONOTONIC clock: Date.now() on this machine steps by
    // ~528 ms every ~32 s, which is six times the gap under test and would
    // make this assertion flake in whichever direction the resync went.
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 3, minIntervalMs: 40 });
    r.enqueue(['A111', 'B222', 'C333']);
    const started = performance.now();
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(performance.now() - started).toBeGreaterThanOrEqual(80); // two gaps, not three
  });
});
