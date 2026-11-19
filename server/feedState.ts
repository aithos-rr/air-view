export type FeedStatus = 'starting' | 'ok' | 'degraded';

export interface FeedHealth {
  status: FeedStatus;
  lastSuccessAt: string | null;
  feedAgeSeconds: number | null;
  lastError: string | null;
}

export interface FeedState {
  put(key: string, body: string): void;
  get(key: string): { body: string; stale: boolean } | null;
  recordFailure(message: string): void;
  health(): FeedHealth;
}

export interface FeedStateOptions {
  maxFreshMs?: number;
  maxStaleMs?: number;
  degradedAfterMs?: number;
  startupGraceMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_FRESH_MS = 90_000;
const DEFAULT_MAX_STALE_MS = 600_000;
const DEFAULT_DEGRADED_AFTER_MS = 300_000;
// Well beyond railway.toml's healthcheckTimeout, but finite: a feed that
// never starts must not hide behind 'starting' for ever.
const DEFAULT_STARTUP_GRACE_MS = 180_000;

/**
 * Cache and health state for the feed.
 *
 * The v1 outage lasted 25 days because the cache had no maximum age and
 * /health answered 'ok' unconditionally: the server served a frozen
 * snapshot and nothing ever reported it. Both guards live here so neither
 * can be forgotten at a call site.
 */
export function createFeedState(opts: FeedStateOptions = {}): FeedState {
  const maxFreshMs = opts.maxFreshMs ?? DEFAULT_MAX_FRESH_MS;
  const maxStaleMs = opts.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const degradedAfterMs = opts.degradedAfterMs ?? DEFAULT_DEGRADED_AFTER_MS;
  const startupGraceMs = opts.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();

  const entries = new Map<string, { body: string; storedAt: number }>();
  let lastSuccessAt: number | null = null;
  let lastError: string | null = null;

  return {
    put(key, body) {
      const t = now();
      entries.set(key, { body, storedAt: t });
      lastSuccessAt = t;
      lastError = null;
    },

    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      const age = now() - hit.storedAt;
      if (age > maxStaleMs) return null;
      return { body: hit.body, stale: age > maxFreshMs };
    },

    recordFailure(message) {
      lastError = message;
    },

    health() {
      if (lastSuccessAt === null) {
        const status: FeedStatus = now() - startedAt > startupGraceMs ? 'degraded' : 'starting';
        return { status, lastSuccessAt: null, feedAgeSeconds: null, lastError };
      }
      const ageMs = now() - lastSuccessAt;
      return {
        status: ageMs > degradedAfterMs ? 'degraded' : 'ok',
        lastSuccessAt: new Date(lastSuccessAt).toISOString(),
        feedAgeSeconds: Math.floor(ageMs / 1000),
        lastError,
      };
    },
  };
}
