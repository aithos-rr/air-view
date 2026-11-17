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
 * source to fall through to. The feed is therefore assembled from tiles of
 * 230 NM; see src/data/sources/tileGrid.ts.
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
        }
      }

      if (errors.length > 0) {
        throw new Error(`all usable ADS-B sources failed: ${errors.join(' | ')}`);
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
