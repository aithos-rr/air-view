import { USER_AGENT } from '../src/data/sources/userAgent.js';

export interface FlightRoute {
  callsignIcao: string;
  callsignIata: string | null;
  airlineName: string | null;
  originIata: string;
  originName: string;
  destinationIata: string;
  destinationName: string;
}

/** One entry of the pre-built cache. A null route means "asked, unknown". */
export interface SeedRecord {
  callsign: string;
  route: FlightRoute | null;
}

/**
 * What we know about a callsign — including the fact that we never asked.
 *
 * get() returns null for two facts that are not the same fact, and a caller
 * holding only that null cannot tell them apart:
 *
 *  - `noRoute` — we DID ask adsbdb and it has no route for this callsign.
 *    The 351 records of route-cache.json whose route is null, plus every
 *    404 the pump has collected since. This is a measurement.
 *  - `notLookedUpYet` — nobody has ever asked. The cache holds ~8 374
 *    callsigns and grows by ~920 an hour, so for a real flight number typed
 *    into the search box this is the ORDINARY case, not the exotic one.
 *  - `lookupFailed` — we tried until the attempt cap and nothing ever
 *    answered. Not a verdict about the flight, and not a promise either:
 *    enqueue() refuses to try an abandoned callsign again.
 *
 * Flattening the three is how "No flight by that number" came to be printed
 * about flights nobody had asked about (D15b).
 */
export type RouteKnowledgeStatus = 'known' | 'noRoute' | 'notLookedUpYet' | 'lookupFailed';

export interface RouteKnowledge {
  status: RouteKnowledgeStatus;
  /** The route — non-null only when status is 'known'. */
  route: FlightRoute | null;
}

export interface ResolverStats {
  resolved: number;
  unknown: number;
  queued: number;
  /** Callsigns given up on after repeated transport failures. */
  abandoned: number;
  suspendedUntil: string | null;
  consecutiveRateLimits: number;
  lastError: string | null;
}

export interface RouteResolverOptions {
  maxPerPump?: number;
  /** Base cooldown after a 429, doubled on each consecutive one. */
  rateLimitCooldownMs?: number;
  /** Transport failures tolerated per callsign before giving up on it. */
  maxAttempts?: number;
  /**
   * Minimum gap between two lookups inside one pump. The project floor is one
   * request per 1.5 s; a batch fired back-to-back breaks it from the inside.
   * Tests pass 0.
   */
  minIntervalMs?: number;
  /**
   * WALL clock, epoch ms. Used ONLY to render `suspendedUntil` as an instant
   * callers and /health can read. Never to measure how long anything lasts.
   */
  now?: () => number;
  /**
   * MONOTONIC clock, any origin. The 429 suspension is a DURATION and is
   * timed on this one.
   *
   * Measured on this machine: Date.now() moves by ~528 ms every ~32 s as
   * WSL2 resyncs against the host, and NTP corrects in both directions. A
   * backwards jump would merely extend the silence, which is harmless here.
   * A FORWARD jump is the one that bites: it makes the cooldown look spent
   * and sends a lookup DURING the adsbdb penalty — and a request sent during
   * the penalty RENEWS it, which is the single failure mode this suspension
   * exists to prevent. server/poller.ts draws the same line for the same
   * reason. A wall clock is not a stopwatch.
   */
  monotonicNow?: () => number;
}

export interface RouteResolver {
  seed(records: SeedRecord[]): void;
  get(callsign: string): FlightRoute | null;
  /** The route AND how we come to be saying so — see RouteKnowledge. */
  knowledge(callsign: string): RouteKnowledge;
  enqueue(callsigns: string[]): void;
  pump(fetchImpl?: typeof fetch): Promise<number>;
  /**
   * Everything learned so far, in the shape seed() consumes.
   *
   * Unknowns are included on purpose: a 404 cost a lookup against a provider
   * that bans, and forgetting it means paying for the same answer again.
   */
  entries(): SeedRecord[];
  stats(): ResolverStats;
}

interface AdsbdbAirport {
  iata_code?: string;
  name?: string;
}

interface AdsbdbResponse {
  response?:
    | string
    | {
        flightroute?: {
          callsign?: string;
          callsign_iata?: string;
          airline?: { name?: string };
          origin?: AdsbdbAirport;
          destination?: AdsbdbAirport;
        };
      };
}

const DEFAULT_MAX_PER_PUMP = 1;
// 360s, not 300: the ban was still live at 300 s and only lifted after
// 330 s of total silence. The advertised window is a floor, not a promise.
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 360_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_INTERVAL_MS = 1500;
const MAX_COOLDOWN_MS = 3_600_000;

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/** Raised by lookup() on 429 so pump() can stop the whole batch. */
class RateLimited extends Error {}

/**
 * Resolves callsigns to real origin/destination pairs via adsbdb.
 *
 * The bulk of the cache is built offline (see scripts/build-route-cache.mjs)
 * and loaded with seed(): a snapshot holds 5 900-12 500 distinct callsigns
 * depending on the hour, and adsbdb cannot be asked that many times quickly.
 * At runtime the pump only picks up callsigns the seed does not cover, and
 * it does so slowly.
 *
 * Measured live: ~1 190 lookups at 4.8 req/s produced
 * HTTP 429 {"response":"rate limited for 300 seconds"}, and requests sent
 * during the penalty RENEW it — after 330 s of total silence the block was
 * gone, while polling every 20 s it never lifted. So 429 suspends the pump
 * entirely, with exponential backoff, and no request leaves while suspended.
 *
 * Replaces v1's routeLookup, which ignored the flight number and returned
 * the airline's alphabetically first route: every BA flight showed
 * Aalborg -> Aarhus.
 */
export function createRouteResolver(opts: RouteResolverOptions = {}): RouteResolver {
  const maxPerPump = opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP;
  const baseCooldownMs = opts.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const monotonicNow = opts.monotonicNow ?? (() => performance.now());

  const resolved = new Map<string, FlightRoute>();
  const unknown = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const attempts = new Map<string, number>();
  /** Permanent record of callsigns we stopped trying, so enqueue() skips them. */
  const abandoned = new Set<string>();

  /** On the MONOTONIC clock, like every other duration in this file. */
  let suspendedUntil = 0;
  let consecutiveRateLimits = 0;
  let lastError: string | null = null;

  function key(callsign: string): string {
    return callsign.trim().toUpperCase();
  }

  async function lookup(cs: string, fetchImpl: typeof fetch): Promise<boolean> {
    // undici's default headersTimeout is 300 s: without a signal a single
    // hung request holds the only pump slot for five minutes.
    const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) throw new RateLimited('adsbdb: HTTP 429 rate limited');

    // 404 is a verdict about the callsign — private, business and military
    // flights — not a failure of the request.
    if (res.status === 404) {
      unknown.add(cs);
      return false;
    }
    if (!res.ok) throw new Error(`adsbdb: HTTP ${res.status}`);

    const data = (await res.json()) as AdsbdbResponse;
    const fr = typeof data.response === 'object' ? data.response?.flightroute : undefined;
    const originIata = fr?.origin?.iata_code;
    const originName = fr?.origin?.name;
    const destinationIata = fr?.destination?.iata_code;
    const destinationName = fr?.destination?.name;

    if (!fr || !originIata || !originName || !destinationIata || !destinationName) {
      unknown.add(cs);
      return false;
    }

    resolved.set(cs, {
      callsignIcao: fr.callsign ?? cs,
      callsignIata: fr.callsign_iata ?? null,
      airlineName: fr.airline?.name ?? null,
      originIata,
      originName,
      destinationIata,
      destinationName,
    });
    return true;
  }

  return {
    seed(records) {
      for (const rec of records) {
        const cs = key(rec.callsign);
        if (!cs) continue;
        if (rec.route === null) unknown.add(cs);
        else resolved.set(cs, rec.route);
      }
    },

    get(callsign) {
      return resolved.get(key(callsign)) ?? null;
    },

    knowledge(callsign) {
      const cs = key(callsign);
      const route = resolved.get(cs);
      if (route !== undefined) return { status: 'known', route };
      // The order matters only in that these three sets are disjoint: a
      // callsign in `unknown` was answered about, one in `abandoned` was
      // tried and never answered, and anything else has simply not been
      // reached yet — queued or not.
      if (unknown.has(cs)) return { status: 'noRoute', route: null };
      if (abandoned.has(cs)) return { status: 'lookupFailed', route: null };
      return { status: 'notLookedUpYet', route: null };
    },

    enqueue(callsigns) {
      for (const raw of callsigns) {
        const cs = key(raw);
        if (!cs) continue;
        if (resolved.has(cs) || unknown.has(cs) || queued.has(cs) || abandoned.has(cs)) continue;
        queue.push(cs);
        queued.add(cs);
      }
    },

    async pump(fetchImpl: typeof fetch = fetch) {
      if (monotonicNow() < suspendedUntil) return 0; // not one request while suspended

      let count = 0;
      const batch = queue.splice(0, maxPerPump);

      for (let i = 0; i < batch.length; i++) {
        const cs = batch[i]!;
        queued.delete(cs);
        // Space out the batch. The server pumps one at a time, but a caller
        // asking for more must not turn a single pump into a burst.
        if (i > 0) await sleep(minIntervalMs);
        // Re-check: a 429 raised earlier in this same batch must stop the
        // rest of it, not just future pumps.
        if (monotonicNow() < suspendedUntil) {
          queue.unshift(cs, ...batch.slice(i + 1));
          for (const rest of batch.slice(i)) queued.add(rest);
          return count;
        }
        try {
          if (await lookup(cs, fetchImpl)) count += 1;
          consecutiveRateLimits = 0;
          attempts.delete(cs);
        } catch (e) {
          if (e instanceof RateLimited) {
            consecutiveRateLimits += 1;
            const cooldown = Math.min(baseCooldownMs * 2 ** (consecutiveRateLimits - 1), MAX_COOLDOWN_MS);
            suspendedUntil = monotonicNow() + cooldown;
            lastError = `${e.message}; suspended for ${Math.round(cooldown / 1000)}s`;
            // Put back this callsign AND everything we had not reached, then
            // stop: further requests would renew the penalty.
            queue.unshift(cs, ...batch.slice(i + 1));
            queued.add(cs);
            for (const rest of batch.slice(i + 1)) queued.add(rest);
            return count;
          }
          lastError = e instanceof Error ? e.message : String(e);
          const tried = (attempts.get(cs) ?? 0) + 1;
          if (tried >= maxAttempts) {
            // Give up permanently. Merely dropping it from the queue is not
            // enough: the server calls enqueue() every feed cycle and the
            // callsign would come straight back, making the cap useless.
            attempts.delete(cs);
            abandoned.add(cs);
          } else {
            attempts.set(cs, tried);
            queue.push(cs);
            queued.add(cs);
          }
        }
      }
      return count;
    },

    entries() {
      const out: SeedRecord[] = [];
      for (const [callsign, route] of resolved) out.push({ callsign, route });
      for (const callsign of unknown) out.push({ callsign, route: null });
      return out;
    },

    stats() {
      // The deadline is monotonic; the instant reported is the wall clock's.
      // Converting here, once, is what keeps the two clocks from mixing.
      const remainingMs = suspendedUntil - monotonicNow();
      return {
        resolved: resolved.size,
        unknown: unknown.size,
        queued: queue.length,
        abandoned: abandoned.size,
        suspendedUntil: remainingMs > 0 ? new Date(now() + remainingMs).toISOString() : null,
        consecutiveRateLimits,
        lastError,
      };
    },
  };
}
