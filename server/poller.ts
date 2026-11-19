import type { AircraftRaw } from '../src/types.js';
import type { Tile } from '../src/data/sources/tileGrid.js';
import { rootCause, upstreamStatus } from './errorChain.js';

// Two lessons, both learned the hard way, both encoded here.
//
// One: the rate is NOT derived from the measured latency. adsb.lol answered
// in 0.47 s median one day and 28.6 s the next; an earlier revision sized
// its pace on the slow reading and ended up emitting 3.2 req/s while
// believing it was doing 0.28.
//
// Two: a rate ceiling on the AVERAGE is not enough. A revision that fired 8
// tiles at once every 8 s averaged 1.07 req/s and was still cut off:
// measured on the real server, 26 fetches succeeded and then adsb.lol
// answered 429 — and so did adsb.fi, because the selector retried the burst
// against it. The feed was dead from second 24.
//
// So tiles are fetched STRICTLY ONE AT A TIME, spaced by a fixed interval
// measured from the previous fetch — across cycle boundaries included.
// 546 tiles at one every 1.5 s is a sweep of about 13.7 minutes.
//
// This lives in its own module because for three revisions it lived inside a
// top-level `await app.listen()` script where nothing could reach it: five
// independent mutations of the spacing — removing it, resetting it at the
// top of each cycle, cutting the interval to 100 ms, never stamping the slot
// — all left the suite green. The pacing is the single behaviour with the
// longest failure history in this feed, and it is now a unit with an
// injectable clock.
export const TILE_INTERVAL_MS = 1_500;
/** Tiles taken from the scheduler per cycle; they are fetched sequentially. */
export const TILES_PER_CYCLE = 8;
/**
 * Suspension after a 429 that carried NO Retry-After. When the header is
 * there it wins: httpError.ts has already parsed it into
 * `retryAfterSeconds`, in seconds or as an HTTP-date, and a guess that
 * undershoots a number the server stated is how the penalty gets renewed
 * instead of served.
 */
export const TILE_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 300_000;
/**
 * Bounds on a Retry-After we did not write: 0 would make the suspension a
 * no-op and the next cycle would renew the ban, while an HTTP-date far
 * ahead would freeze the feed for hours.
 */
export const MIN_RATE_LIMIT_COOLDOWN_MS = 60_000;
export const MAX_RATE_LIMIT_COOLDOWN_MS = 3_600_000;

/**
 * Everything the poller is allowed to learn from one tile fetch.
 *
 * Deliberately NARROWER than the adapters' `SourceResult`, which also
 * carries `fetchedAt`. That field is the PROVIDER's clock — both adapters
 * derive it from the upstream `now` field — while prune() runs on ours, and
 * the plan states the invariant outright: «absorb riceve
 * Math.floor(Date.now() / 1000), mai result.fetchedAt». Leaving the field
 * out of this type makes reaching for it a compile error instead of a
 * regression that two clocks apart still looks plausible.
 */
export interface TileFetchOutcome {
  aircraft: AircraftRaw[];
}

/** The slice of TileScheduler the poller uses. */
export interface TileBatchSource {
  next(count: number): Tile[];
  record(tileId: string, aircraftCount: number): void;
  recordFailure(tileId: string): void;
}

/** The slice of Fleet the poller uses. */
export interface AbsorbingFleet {
  absorb(aircraft: AircraftRaw[], atUnix: number): number;
}

export interface PollerLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface TilePollerDeps {
  scheduler: TileBatchSource;
  fleet: AbsorbingFleet;
  /** Fetches ONE tile. Rejects with the chain intact; the poller reads it. */
  fetchTile(tile: Tile): Promise<TileFetchOutcome>;
  /** feed.recordFailure — the message /health surfaces. */
  recordFailure(message: string): void;
  log: PollerLog;
  /** Injectable so the spacing can be measured instead of believed. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  tilesPerCycle?: number;
  tileIntervalMs?: number;
}

export interface TileCycleOutcome {
  /** At least one tile answered — the evidence the feed itself is alive. */
  anySuccess: boolean;
  /** Fetches actually issued this cycle. */
  tilesAttempted: number;
}

export interface TilePoller {
  runCycle(): Promise<TileCycleOutcome>;
  /** Epoch ms until which every provider request is suspended, or 0. */
  suspendedUntilMs(): number;
  /** The last tile failure as THROWN: /health reads its chain, not a string. */
  lastFailure(): unknown;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches tiles one at a time, spaced, and folds them into the fleet.
 *
 * The pacing state lives in the CLOSURE, not inside runCycle(): spacing the
 * tiles only within a cycle left the boundary between two cycles
 * TILE_CYCLE_GAP_MS apart — 1 s, under the declared floor of one request
 * every 1.5 s. Same family as the burst that earned the 429: what gets
 * punished is the instantaneous pattern, not the average.
 */
export function createTilePoller(deps: TilePollerDeps): TilePoller {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const tilesPerCycle = deps.tilesPerCycle ?? TILES_PER_CYCLE;
  const tileIntervalMs = deps.tileIntervalMs ?? TILE_INTERVAL_MS;

  let tilesSuspendedUntil = 0;
  /** When the last tile fetch was issued. Kept BETWEEN cycles on purpose. */
  let lastTileFetchAtMs = 0;
  let lastFailure: unknown = null;

  /** Waits until tileIntervalMs has passed since the last fetch was issued. */
  async function waitForTileSlot(): Promise<void> {
    const waitMs = lastTileFetchAtMs + tileIntervalMs - now();
    if (waitMs > 0) await sleep(waitMs);
  }

  async function runCycle(): Promise<TileCycleOutcome> {
    if (now() < tilesSuspendedUntil) return { anySuccess: false, tilesAttempted: 0 };

    const batch = deps.scheduler.next(tilesPerCycle);
    if (batch.length === 0) return { anySuccess: false, tilesAttempted: 0 };

    // OUR clock, stamped once per cycle and handed to every absorb() below.
    // `fetchedAt` is NOT the instant of our fetch: both adapters derive it
    // from the upstream `now` field (adsbLol.ts, adsbFi.ts), so it is the
    // provider's clock — while prune() runs on Date.now(). Comparing the two
    // every cycle let the provider's drift stretch or shrink the retention
    // window in silence, and broke the invariant this task declares: fleet
    // membership depends on no one else's clock. Stamped once rather than per
    // tile so every record of a cycle ages together; a cycle lasts seconds
    // against a window of at least 1200 s, and the error is in the safe
    // direction — a record is never stamped later than it actually arrived.
    const cycleAtUnix = Math.floor(now() / 1000);

    let anySuccess = false;
    let tilesAttempted = 0;
    // Tiles whose failure may be theirs or may be the whole feed's — a
    // timeout, a transport error, a 5xx. They are charged to the tile only if
    // another tile succeeds in this same cycle; see the catch below.
    const ambiguousFailures: string[] = [];

    // Sequential, spaced. NOT Promise.all: a burst of eight is what earned the
    // 429 that killed the feed in testing, even while the average was inside
    // the ceiling.
    for (const tile of batch) {
      await waitForTileSlot();
      if (now() < tilesSuspendedUntil) break;

      // Stamped before the fetch, not after: the floor is on the interval
      // between requests leaving this process, and a tile slower than the
      // floor already spaces itself.
      lastTileFetchAtMs = now();
      tilesAttempted += 1;
      try {
        const result = await deps.fetchTile(tile);
        deps.fleet.absorb(result.aircraft, cycleAtUnix);
        deps.scheduler.record(tile.id, result.aircraft.length);
        anySuccess = true;
        // One line per successful tile: without it the request rate cannot be
        // observed from outside, and the point of the ceiling is that it must
        // be verifiable rather than believed.
        deps.log.info({ tile: tile.id, aircraft: result.aircraft.length }, 'tile fetched');
      } catch (e) {
        // `msg` is the aggregate, which names every source tried; `root` is the
        // bottom of the cause chain, where undici puts the code (defect #51).
        const msg = e instanceof Error ? e.message : String(e);
        const root = rootCause(e);
        lastFailure = e;
        deps.recordFailure(`${tile.id}: ${msg}`);

        const http = upstreamStatus(e);
        // 429 is a first-class state here too, exactly as it is for adsbdb:
        // keep asking during the penalty and it is renewed rather than served.
        // The selector carries only the FIRST source's error as `cause`, so a
        // 429 raised by the second one survives in the message alone — hence
        // the text fallback. But that text has to describe a FRESH 429: while
        // a breaker is open the selector replays the message that opened it
        // without asking anything upstream, and re-arming a five-minute
        // suspension on a quote would freeze the feed cycle after cycle.
        // Step 8k marks exactly that error `attempted: false`.
        const attempted = (e as { attempted?: unknown }).attempted;
        if (http?.status === 429 || (attempted !== false && /\b429\b/.test(msg))) {
          const retryAfterSeconds = http?.status === 429 ? http.retryAfterSeconds : null;
          const waitMs =
            retryAfterSeconds === null
              ? TILE_RATE_LIMIT_FALLBACK_COOLDOWN_MS
              : Math.min(
                  MAX_RATE_LIMIT_COOLDOWN_MS,
                  Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, retryAfterSeconds * 1000)
                );
          tilesSuspendedUntil = now() + waitMs;
          deps.log.error(
            { err: msg, code: root.code, tile: tile.id, waitSeconds: Math.round(waitMs / 1000) },
            'tile fetch rate-limited — suspending'
          );
          break;
        }
        // Dormancy has to learn from failure too: record() above is reached
        // only on the success branch, so a tile that can never be fetched kept
        // its 1.5 s slot on every sweep for ever. Only the provider answering
        // ABOUT THIS REGION is evidence about the tile, and a 4xx other than
        // 429 is exactly that, so it counts at once. A timeout, a transport
        // error or a 5xx may just as easily be the whole feed failing: those
        // are held back and charged only if another tile succeeds in this
        // cycle. Without the split, one DNS outage would send all 546 tiles
        // dormant in three sweeps and the feed would crawl back over hours.
        if (http !== null && http.status >= 400 && http.status < 500) {
          deps.scheduler.recordFailure(tile.id);
        } else {
          ambiguousFailures.push(tile.id);
        }
        deps.log.warn(
          { err: msg, code: root.code, cause: root.message, tile: tile.id },
          'tile fetch failed'
        );
      }
    }

    // A failure that might have been the feed's is charged to the tile only
    // here, with the evidence that the feed was alive: another tile answered
    // in this same cycle.
    if (anySuccess) {
      for (const id of ambiguousFailures) deps.scheduler.recordFailure(id);
    }

    return { anySuccess, tilesAttempted };
  }

  return {
    runCycle,
    suspendedUntilMs: () => tilesSuspendedUntil,
    lastFailure: () => lastFailure,
  };
}
