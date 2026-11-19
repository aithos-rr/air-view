import type { FastifyInstance } from 'fastify';
import type { FeedStatus } from './feedState.js';
import type { FeedHealth } from './feedState.js';
import { rootCause } from './errorChain.js';

/**
 * The feed status expressed as an HTTP status code.
 *
 * 'starting' answers 200 on purpose: railway.toml gates the deploy on
 * /health and a 503 at boot would stall it for ever — no traffic is routed
 * until the check passes, and the feed only becomes healthy once it is
 * polling. Only 'degraded' — a feed that WAS live and has stopped, or one
 * that never came up within the startup grace — reports failure.
 *
 * Its own function, and registered through a factory, because this mapping
 * is what actually gates the deploy and it used to sit inside a top-level
 * script: feedState.test.ts killed every mutant of the three-state machine
 * while all three mutants of THIS line survived — including collapsing it to
 * a flat 200, which is the v1 failure mode where a dead feed reported healthy
 * for 25 days, and `ok ? 200 : 503`, which is the deploy stall above.
 */
export function httpStatusForFeed(status: FeedStatus): number {
  return status === 'degraded' ? 503 : 200;
}

export interface HealthPayloadNumbers {
  aircraft: number;
  bytes: number;
  gzipBytes: number;
  capped: boolean;
  maxAircraft: number;
}

export interface HealthRouteDeps {
  health(): FeedHealth;
  uptimeSeconds(): number;
  /** The last tile failure as THROWN, so its cause chain survives. */
  lastTileFailure(): unknown;
  fleet: { size(): number; maxAgeSeconds(): number };
  payload(): HealthPayloadNumbers;
  tiles(): Record<string, unknown>;
}

export function registerHealthRoute(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get('/health', async (_req, reply) => {
    const health = deps.health();
    return reply.status(httpStatusForFeed(health.status)).send({
      status: health.status,
      uptime: deps.uptimeSeconds(),
      feedAgeSeconds: health.feedAgeSeconds,
      lastSuccessAt: health.lastSuccessAt,
      lastError: health.lastError,
      // The code an operator greps for — UND_ERR_CONNECT_TIMEOUT, ENOTFOUND —
      // sits at the bottom of the cause chain, not on the aggregate error the
      // selector throws. Tied to lastError's lifecycle, so a cleared failure
      // cannot leave a stale code behind.
      lastErrorCode: health.lastError === null ? null : rootCause(deps.lastTileFailure()).code,
      fleet: { size: deps.fleet.size(), maxAgeSeconds: deps.fleet.maxAgeSeconds() },
      // Measured, not assumed. /api/states serves the whole fleet on every
      // request and the body grows with the retention window, so without these
      // numbers the payload can only be guessed at from outside — and a guess
      // is what this plan is replacing everywhere else.
      payload: deps.payload(),
      tiles: deps.tiles(),
    });
  });
}
