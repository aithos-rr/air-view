import type { AircraftSource, GeoPoint, SourceResult } from './types.js';

export interface SelectorOptions {
  /** How long a failed source is skipped before being retried. */
  breakerCooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type SelectorResult = SourceResult & { sourceId: string };

export interface SourceSelector {
  fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl?: typeof fetch): Promise<SelectorResult>;
}

const DEFAULT_COOLDOWN_MS = 120_000;

/**
 * Tries sources in order, skipping any that cannot serve the requested
 * radius and any whose breaker is open.
 *
 * The radius check is not an optimisation. Verified live 2026-11-17: BOTH
 * providers cap at 250 NM — adsb.lol answers 403 "radius exceeds 250 NM"
 * above it, adsb.fi answers 400. Asking either for more is a guaranteed
 * failure that would open its breaker for nothing, and there is no third
 * source to fall through to. That is why this module is the one that emits
 * the "no ADS-B source accepts a N NM radius" error today: the only caller,
 * server/index.ts, still asks for a single 10 000 NM sweep, so every source
 * is skipped on radius and /api/states answers 502 without issuing a single
 * upstream request. Nothing here can fix that — the caller has to stop
 * asking for more than 250 NM. It will, once the tiled feed (Task 3 of
 * docs/superpowers/plans/2026-11-16-air-view-v2-tiled-feed.md) requests one
 * tile at a time; until then this endpoint is known broken.
 *
 * The breaker exists because otherwise a provider that is down would cost
 * every request a timeout before falling through — turning an outage into
 * sitewide latency.
 */
export function createSourceSelector(
  sources: AircraftSource[],
  opts: SelectorOptions = {}
): SourceSelector {
  const cooldownMs = opts.breakerCooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = opts.now ?? Date.now;
  const openUntil = new Map<string, number>();
  const lastError = new Map<string, string>();

  return {
    async fetchRegion(centre, radiusNm, fetchImpl) {
      const errors: string[] = [];
      // The ORIGINAL error objects, not just their messages. server/index.ts
      // reads `e.cause` to log causeMessage/causeCode — the diagnostic added
      // for the Railway egress failure (UND_ERR_CONNECT_TIMEOUT, ENOTFOUND).
      // Rebuilding an Error from `e.message` alone left those fields null
      // exactly when they were needed.
      const causes: unknown[] = [];
      const skippedForRadius: string[] = [];
      const t = now();

      for (const source of sources) {
        if (radiusNm > source.maxRadiusNm) {
          skippedForRadius.push(`${source.id} (max ${source.maxRadiusNm} NM)`);
          continue;
        }
        const until = openUntil.get(source.id) ?? 0;
        if (until > t) {
          // Carry the reason forward: otherwise, on the tick after a failure,
          // every source is skipped by its breaker, `errors` is empty, and the
          // caller is told "all sources are in cooldown" instead of the actual
          // upstream error — the one thing an operator needs to see.
          errors.push(`${source.id}: in cooldown after ${lastError.get(source.id) ?? 'unknown error'}`);
          continue;
        }

        try {
          const result = await source.fetchRegion(centre, radiusNm, fetchImpl);
          openUntil.delete(source.id); // success closes the breaker
          lastError.delete(source.id);
          return { ...result, sourceId: source.id };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          openUntil.set(source.id, now() + cooldownMs);
          lastError.set(source.id, msg);
          errors.push(msg);
          causes.push(e);
        }
      }

      if (errors.length > 0) {
        // A source skipped for radius is still part of the picture: without
        // this, a mixed roster reports only "adsb-fi: HTTP 500" and the
        // operator never learns the primary was never asked at all.
        const alsoSkipped =
          skippedForRadius.length > 0
            ? ` | skipped for radius: ${skippedForRadius.join(', ')}`
            : '';
        throw new Error(`all usable ADS-B sources failed: ${errors.join(' | ')}${alsoSkipped}`, {
          cause: causes[0],
        });
      }
      if (skippedForRadius.length > 0) {
        throw new Error(
          `no ADS-B source accepts a ${radiusNm} NM radius: ${skippedForRadius.join(', ')}`
        );
      }
      throw new Error('all ADS-B sources are in cooldown');
    },
  };
}
