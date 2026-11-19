import type { AircraftRaw } from '../src/types.js';

export interface FleetOptions {
  /** An aircraft no tile has reported again within this window is dropped. */
  maxAgeSeconds?: number;
}

export interface Fleet {
  /**
   * @param atUnix when WE fetched this batch. It is stored next to each
   *   record and is the clock prune() ages on, so fleet membership never
   *   depends on the provider's own timestamps.
   * @returns how many records this batch created or updated.
   */
  absorb(aircraft: AircraftRaw[], atUnix: number): number;
  /**
   * Every record, or — with maxRecords — the most recently absorbed ones.
   *
   * The cap exists because /api/states serves the whole fleet on every
   * request: the payload grows with the retention window, and in the
   * slow-upstream regime that window stretches to two hours. Dropping the
   * oldest sightings first drops what prune() would remove next anyway.
   */
  snapshot(maxRecords?: number): AircraftRaw[];
  /** @returns how many records were removed. */
  prune(nowUnix: number): number;
  size(): number;
  /**
   * Retention must outlast a full sweep, and the sweep period is only known
   * at runtime: adsb.lol's latency varies by a factor of six between tiles.
   * A hard-coded window would be wrong in one direction or the other.
   */
  setMaxAgeSeconds(seconds: number): void;
  maxAgeSeconds(): number;
}

const DEFAULT_MAX_AGE_SECONDS = 900;

/**
 * The world, assembled from tiles.
 *
 * With a global endpoint the server could replace its whole payload on every
 * fetch. adsb.lol caps requests at 250 NM, so no single call returns the
 * world: the fleet accumulates what the tiles report and lets aircraft age
 * out when no tile has seen them for a while.
 *
 * Tiles overlap by design, so the same aircraft arrives more than once per
 * sweep — sometimes with an older fix. A staler record never overwrites a
 * fresher one; when either side's age is unknown, the record we just
 * fetched wins.
 */
export function createFleet(opts: FleetOptions = {}): Fleet {
  let maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  // Each record is kept with the moment WE absorbed it. The provider does
  // not supply that, and it is what the retention window is measured on.
  const byIcao = new Map<string, { record: AircraftRaw; absorbedAt: number }>();

  return {
    absorb(aircraft, atUnix) {
      let changed = 0;
      for (const ac of aircraft) {
        const prev = byIcao.get(ac.icao24);
        // Since 8ae051c lastContact is `number | null`, where null means
        // "the provider did not say how stale this fix is" — not "fresh".
        // Two known ages can be ordered and the older one is dropped; as
        // soon as one side is unknown they cannot be, and the tie goes to
        // the batch we just fetched, the later information we hold. Both
        // null checks are needed: a `!==` between two nullable fields does
        // not narrow either of them.
        const prevIsNewer =
          prev !== undefined &&
          prev.record.lastContact !== null &&
          ac.lastContact !== null &&
          prev.record.lastContact >= ac.lastContact;
        if (prevIsNewer) continue;
        byIcao.set(ac.icao24, { record: ac, absorbedAt: atUnix });
        changed += 1;
      }
      return changed;
    },

    snapshot(maxRecords) {
      const entries = [...byIcao.values()];
      if (maxRecords === undefined || entries.length <= maxRecords) {
        return entries.map((e) => e.record);
      }
      // Freshest first, so what falls off the end is what prune() would take
      // next. The sort only runs when the cap actually bites.
      return entries
        .sort((a, b) => b.absorbedAt - a.absorbedAt)
        .slice(0, maxRecords)
        .map((e) => e.record);
    },

    prune(nowUnix) {
      let removed = 0;
      for (const [icao, entry] of byIcao) {
        // Ageing is on absorbedAt, not on lastContact. The window measures
        // the cadence of OUR sweep — how long before a tile comes round
        // again — which is a property of the poller, not of the provider's
        // clock. And an aircraft whose staleness the provider never stated
        // would otherwise never age out at all.
        if (nowUnix - entry.absorbedAt > maxAgeSeconds) {
          byIcao.delete(icao);
          removed += 1;
        }
      }
      return removed;
    },

    size() {
      return byIcao.size;
    },

    setMaxAgeSeconds(seconds) {
      maxAgeSeconds = seconds;
    },

    maxAgeSeconds() {
      return maxAgeSeconds;
    },
  };
}
