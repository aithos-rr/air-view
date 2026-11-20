import { describe, it, expect } from 'vitest';
import { createTilePoller, TILE_INTERVAL_MS, TILES_PER_CYCLE } from '../../../server/poller';
import type { TilePollerDeps } from '../../../server/poller';
import type { AircraftRaw } from '../../../src/types';
import type { Tile } from '../../../src/data/sources/tileGrid';

/**
 * A clock that only moves when the code under test asks it to sleep.
 *
 * The point of the whole file: with a real clock the spacing between tile
 * fetches is a thing one believes, and five independent mutations of it —
 * removing the wait, resetting the stamp at the top of every cycle, cutting
 * the interval to 100 ms, never stamping the slot at all — all left the
 * suite green. Here a fetch costs zero virtual milliseconds, so every
 * millisecond of spacing in the recorded timestamps had to come from the
 * pacing code.
 */
function virtualClock(start = 1_700_000_000_000): {
  now: () => number;
  monotonicNow: () => number;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
  /** Shoves the WALL clock backwards, leaving the monotonic one alone. */
  jumpWallClock: (ms: number) => void;
} {
  let t = start;
  let wallSkew = 0;
  return {
    now: () => t + wallSkew,
    monotonicNow: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    jumpWallClock: (ms: number) => {
      wallSkew += ms;
    },
  };
}

function grid(n = 24): Tile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    region: 'r',
    centre: { lat: i, lon: 0 },
  }));
}

function ac(icao: string): AircraftRaw {
  return {
    icao24: icao, callsign: 'TST1', longitude: 10, latitude: 10,
    baroAltitudeFt: 30000, velocityKt: 400, headingDeg: 90, onGround: false,
    lastContact: 1, registration: 'X', modelCode: 'A320', modelDesc: null,
    route: null, complete: false,
  };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

/** A scheduler that just hands out the next `count` tiles, round-robin. */
function fakeScheduler(tiles: Tile[]): TilePollerDeps['scheduler'] & {
  recorded: string[];
  failed: string[];
} {
  let cursor = 0;
  const recorded: string[] = [];
  const failed: string[] = [];
  return {
    recorded,
    failed,
    next(count) {
      const out: Tile[] = [];
      for (let i = 0; i < count; i++) out.push(tiles[cursor++ % tiles.length]!);
      return out;
    },
    record: (id) => void recorded.push(id),
    recordFailure: (id) => void failed.push(id),
  };
}

/** A 429 shaped the way the adapters throw it, for upstreamStatus() to find. */
function rateLimited(retryAfterSeconds: number | null = null): Error {
  return Object.assign(new Error('all sources failed: adsb-lol: HTTP 429'), {
    status: 429,
    retryAfterSeconds,
  });
}

describe('createTilePoller — request spacing', () => {
  it('leaves at least 1.5 s between two consecutive tile fetches', async () => {
    // The single behaviour with the longest failure history in this feed. A
    // revision that fired 8 tiles at once every 8 s averaged 1.07 req/s and
    // was still cut off: 26 fetches succeeded and then adsb.lol answered
    // 429 — and so did adsb.fi, because the selector retried the burst
    // against it. The feed was dead from second 24. What gets punished is
    // the instantaneous pattern, not the average, so the floor is asserted
    // between EVERY adjacent pair, not on the mean.
    const clock = virtualClock();
    const at: number[] = [];
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        at.push(clock.now());
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
      // No tileIntervalMs override on purpose: the PRODUCTION default is
      // what has to hold, so cutting the constant fails this test too.
    });

    await poller.runCycle();

    expect(at.length).toBe(TILES_PER_CYCLE);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1_500);
    }
  });

  it('declares a floor of one request every 1.5 s and no faster', () => {
    // The ceiling is a contract with two free services that have already cut
    // this feed off once. It is a number, so it is pinned as one.
    expect(TILE_INTERVAL_MS).toBeGreaterThanOrEqual(1_500);
  });

  it('holds the spacing when the WALL CLOCK jumps FORWARD', async () => {
    // Date.now() is not a stopwatch. Measured on this machine, it moves
    // BACKWARDS by ~528 ms every ~32 s as WSL2 resyncs against the host.
    //
    // A backwards jump is harmless here and was a red herring: the wait is
    // computed once and then slept on a monotonic timer, so the sleep still
    // lasts its full 1.5 s and only the RECORDED departure reads early. That
    // is what made 8 of 138 logged departures look 0.98 s apart while the
    // real spacing never moved — a measurement artefact, not a breach.
    //
    // A FORWARD jump is the one that bites: it inflates `now()` while the
    // stamp stays put, the computed wait comes out short by exactly the jump,
    // and the request really does leave early — against a free service that
    // has already blocked this project once. NTP corrects in both directions,
    // so the fix is to time durations monotonically rather than to hope.
    const clock = virtualClock();
    const at: number[] = [];
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        at.push(clock.monotonicNow());
        clock.jumpWallClock(+528); // the resync, between the stamp and the wait
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
      monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    await poller.runCycle();

    // Measured on the monotonic clock: real elapsed time, not what a jumping
    // wall clock says about it.
    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    expect(gaps.length).toBe(TILES_PER_CYCLE * 2 - 1);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(TILE_INTERVAL_MS);
  });

  it('keeps the spacing ACROSS the cycle boundary', async () => {
    // Spacing the tiles only inside a cycle left the boundary between two
    // cycles TILE_CYCLE_GAP_MS apart — 1 s, under the declared floor. Same
    // family as the burst that earned the 429. The pacing state therefore
    // lives in the poller's closure and NOT inside runCycle(); this test is
    // what says so.
    const clock = virtualClock();
    const at: number[] = [];
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        at.push(clock.now());
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    const lastOfCycleOne = at[at.length - 1]!;
    // Exactly the real idle delay between cycles: TILE_CYCLE_GAP_MS is 1 s,
    // which is BELOW the floor — so the next cycle owes 500 ms before its
    // first request may leave.
    clock.advance(1_000);
    await poller.runCycle();

    const firstOfCycleTwo = at[TILES_PER_CYCLE]!;
    expect(at.length).toBe(TILES_PER_CYCLE * 2);
    expect(firstOfCycleTwo - lastOfCycleOne).toBeGreaterThanOrEqual(1_500);
    // And the whole run, boundary included, holds the floor.
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1_500);
    }
  });

  it('stamps the slot before the fetch, so a slow tile does not earn a free burst', async () => {
    // The stamp goes in before the request leaves: the floor is on the
    // interval between requests leaving this process. A tile slower than the
    // floor already spaces itself and must not bank the difference.
    const clock = virtualClock();
    const at: number[] = [];
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        at.push(clock.now());
        clock.advance(9_000); // a tile that took nine seconds upstream
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();

    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1_500);
    }
  });

  it('issues the tiles one at a time, never overlapping two fetches', async () => {
    // NOT Promise.all: a burst of eight is what earned the 429.
    const clock = virtualClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    expect(maxInFlight).toBe(1);
  });
});

describe('createTilePoller — the 429 suspension', () => {
  it('abandons the rest of the batch the moment a provider answers 429', async () => {
    // Keep asking during the penalty and it is renewed rather than served.
    // The remaining seven tiles of a batch must not keep hammering a
    // provider that has just cut us off.
    const clock = virtualClock();
    let calls = 0;
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        calls += 1;
        if (calls === 3) throw rateLimited();
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    const outcome = await poller.runCycle();

    expect(calls).toBe(3); // not 8
    expect(outcome.tilesAttempted).toBe(3);
    expect(poller.suspendedForMs()).toBe(300_000); // the 5-minute fallback, exactly
  });

  it('asks nothing at all while the suspension is still running', async () => {
    const clock = virtualClock();
    let calls = 0;
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        calls += 1;
        if (calls === 1) throw rateLimited();
        return { aircraft: [] };
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    expect(calls).toBe(1);

    clock.advance(60_000); // well inside the 300 s fallback cooldown
    const second = await poller.runCycle();
    expect(calls).toBe(1); // nothing left the process
    expect(second.tilesAttempted).toBe(0);

    clock.advance(300_000); // past it
    await poller.runCycle();
    expect(calls).toBeGreaterThan(1);
  });

  it('serves a Retry-After the provider actually stated', async () => {
    const clock = virtualClock();
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: { absorb: () => 0 },
      fetchTile: async () => {
        throw rateLimited(900);
      },
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    expect(poller.suspendedForMs()).toBe(900_000); // the Retry-After the provider stated
  });
});

describe('createTilePoller — absorb runs on OUR clock', () => {
  it('hands absorb() the injected clock and NEVER the provider fetchedAt', async () => {
    // «In concreto: absorb riceve Math.floor(Date.now() / 1000), mai
    // result.fetchedAt». fleet.test.ts proves the fleet ages on whatever
    // atUnix it is given; it cannot see what the poller gives it, and
    // swapping in the provider's clock at the call site used to leave the
    // whole suite green. This is the only place that invariant can be
    // violated, so this is where it is asserted.
    const clock = virtualClock();
    const PROVIDER_SKEW_MS = 3_600_000; // an hour behind us
    const absorbed: Array<{ count: number; atUnix: number }> = [];
    // Built as a variable, not inline: the poller's TileFetchOutcome has no
    // `fetchedAt` at all, which is the compile-time half of this guard.
    const providerResult = {
      aircraft: [ac('abc123')],
      fetchedAt: new Date(clock.now() - PROVIDER_SKEW_MS),
    };
    const cycleStart = clock.now();
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: {
        absorb: (aircraft, atUnix) => {
          absorbed.push({ count: aircraft.length, atUnix });
          return aircraft.length;
        },
      },
      fetchTile: async () => providerResult,
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();

    const ours = Math.floor(cycleStart / 1000);
    const theirs = Math.floor(providerResult.fetchedAt.getTime() / 1000);
    expect(absorbed.length).toBe(TILES_PER_CYCLE);
    for (const a of absorbed) {
      expect(a.atUnix).toBe(ours);
      expect(a.atUnix).not.toBe(theirs);
    }
    // Stamped ONCE per cycle, so every record of a cycle ages together.
    expect(new Set(absorbed.map((a) => a.atUnix)).size).toBe(1);
  });

  it('moves the stamp forward with OUR clock between cycles', async () => {
    // The companion to the test above: pinning absorb() to a constant would
    // satisfy "never the provider's clock" and still be wrong.
    const clock = virtualClock();
    const absorbed: number[] = [];
    const poller = createTilePoller({
      scheduler: fakeScheduler(grid()),
      fleet: {
        absorb: (_aircraft, atUnix) => {
          absorbed.push(atUnix);
          return 0;
        },
      },
      fetchTile: async () => ({ aircraft: [ac('abc123')] }),
      recordFailure: () => {},
      log: silentLog,
      now: clock.now,
    monotonicNow: clock.monotonicNow,
      sleep: clock.sleep,
    });

    await poller.runCycle();
    const firstCycle = absorbed[0]!;
    clock.advance(600_000);
    await poller.runCycle();
    const secondCycle = absorbed[absorbed.length - 1]!;

    expect(secondCycle - firstCycle).toBeGreaterThanOrEqual(600);
  });
});
