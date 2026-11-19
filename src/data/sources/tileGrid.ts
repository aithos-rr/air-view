import type { GeoPoint } from './types.js';

/** Margin under the 250 NM ceiling every free provider enforces. */
export const TILE_RADIUS_NM = 230;

export interface Tile {
  id: string;
  region: string;
  centre: GeoPoint;
}

/**
 * Bounding boxes where terrestrial ADS-B receivers actually exist.
 *
 * The planet would need ~1400 tiles of this radius; these regions need 546,
 * and the rest is open ocean where no volunteer receiver listens. This is a
 * statement about where the data comes from, not about where aircraft fly:
 * measured on a live snapshot, the North Atlantic held 0.1% of traffic and
 * the mid-Pacific 0.0%, against 43% over the United States.
 */
const REGIONS: Array<[string, number, number, number, number]> = [
  ['north-america', 25, 60, -130, -60],
  ['europe', 35, 62, -11, 32],
  ['east-asia', 20, 46, 100, 146],
  ['southeast-asia', -10, 22, 95, 128],
  ['india', 6, 33, 68, 90],
  ['gulf', 12, 32, 34, 60],
  ['oceania', -45, -10, 113, 179],
  ['south-america', -35, 12, -75, -35],
  ['southern-africa', -35, -20, 16, 33],
  ['north-africa', 28, 42, -9, 45],
];

const NM_PER_DEGREE_LAT = 60;
/**
 * 1.4 leaves overlap between neighbouring circles: the far corner of a cell
 * sits at sqrt(2) * 0.7 * 230 = 227.7 NM from the nearest centre, inside the
 * 230 NM radius. There is ~2 NM of margin, so this is not a figure to round
 * off — raising it to 1.6 opens holes the tests below catch.
 */
const STEP_FACTOR = 1.4;

/**
 * Centres on a lattice that INCLUDES both edges of every box.
 *
 * The step is a ceiling, not an increment: each box is divided into the
 * fewest whole steps that stay under it, so a row always ends exactly on
 * lonMax and a column exactly on latMax. An earlier revision incremented by
 * the raw step and stopped at the last centre still <= the edge, which left
 * two kinds of hole:
 *
 *  - a strip along the far edge of every box, up to a full step wide. Maputo,
 *    Harbin and Cape Breton all sat inside a declared box and outside every
 *    tile.
 *  - a staircase between rows. The longitude step depends on latitude, so
 *    adjacent rows ran out at different longitudes: (19 N, 89.75 E) in the
 *    Bay of Bengal, enclosed between centres on both axes, was 308 NM from
 *    the nearest centre of the whole grid.
 *
 * Both are gone: sampled at 0.1 degrees, all 1 224 760 points of the ten
 * boxes lie within 230 NM of a centre, the worst at 218.0 NM. The price is
 * 546 tiles instead of 413 (+32%); the extra ones are mostly edge strips over
 * water, which the scheduler marks dormant after three empty sweeps.
 */
export function buildTileGrid(): Tile[] {
  const tiles: Tile[] = [];
  const maxStepLat = (TILE_RADIUS_NM * STEP_FACTOR) / NM_PER_DEGREE_LAT;

  for (const [region, latMin, latMax, lonMin, lonMax] of REGIONS) {
    const rows = Math.max(1, Math.ceil((latMax - latMin) / maxStepLat));
    const stepLat = (latMax - latMin) / rows;

    for (let i = 0; i <= rows; i++) {
      const lat = latMin + i * stepLat;
      // Meridians converge towards the poles: widen the longitude step.
      const nmPerDegreeLon = NM_PER_DEGREE_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const maxStepLon = (TILE_RADIUS_NM * STEP_FACTOR) / nmPerDegreeLon;
      const cols = Math.max(1, Math.ceil((lonMax - lonMin) / maxStepLon));
      const stepLon = (lonMax - lonMin) / cols;

      for (let j = 0; j <= cols; j++) {
        const centre = {
          lat: Math.round(lat * 1000) / 1000,
          lon: Math.round((lonMin + j * stepLon) * 1000) / 1000,
        };
        tiles.push({ id: `${region}:${centre.lat}:${centre.lon}`, region, centre });
      }
    }
  }
  return tiles;
}

export interface SchedulerOptions {
  /** Empty sweeps after which a tile is considered dormant. */
  dormantAfterEmptySweeps?: number;
  /** A dormant tile is retried once every this many sweeps. */
  dormantRetryEvery?: number;
  /** Longest the priority queue may grow; oldest entries are dropped. */
  maxPriorityQueue?: number;
  /** A tile served more recently than this is not re-queued by prioritise(). */
  minRefreshMs?: number;
  now?: () => number;
}

export interface TileScheduler {
  next(count: number): Tile[];
  /** Marks tiles as wanted now — typically those under a viewer's camera. */
  prioritise(tileIds: string[]): void;
  record(tileId: string, aircraftCount: number): void;
  stats(): {
    total: number;
    productive: number;
    dormant: number;
    sweepsCompleted: number;
    prioritised: number;
    /** Tiles served from the rotation, not from the priority queue. */
    rotationServed: number;
  };
}

const NM_PER_RADIAN = 3440.065;

/** Great-circle distance in nautical miles. */
function distanceNm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RADIAN * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tiles whose centre lies within `radiusNm` of a point, nearest first.
 *
 * Used to turn a viewer's camera into the set of tiles worth refreshing
 * immediately. A full sweep takes ~10 minutes at adsb.lol's measured
 * latency of ~29 s per tile, so without this the region being looked at
 * would be as stale as the far side of the planet.
 */
export function tilesNear(grid: Tile[], centre: GeoPoint, radiusNm: number): Tile[] {
  return grid
    .map((tile) => ({ tile, d: distanceNm(centre, tile.centre) }))
    .filter((x) => x.d <= radiusNm)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.tile);
}

const DEFAULT_DORMANT_AFTER = 3;
const DEFAULT_RETRY_EVERY = 20;
const DEFAULT_MAX_PRIORITY_QUEUE = 12;
const DEFAULT_MIN_REFRESH_MS = 60_000;
/**
 * Share of each batch reserved for the rotation.
 *
 * Without it the priority queue eats the entire budget: a viewer asks for 12
 * tiles every 30 s while the poller serves 8 every 31-55 s, so the rotation
 * never advances, sweeps stay at zero, dormancy never engages, and prune()
 * deletes the rest of the world. Simulated on this very code: 8 rotation
 * tiles out of 413 in two hours — the grid had 413 tiles then, 546 now.
 */
const ROTATION_SHARE = 0.5;

/**
 * Hands out tiles in rotation, learning which ones are worth asking about.
 *
 * Without this, most of the request budget would go to ocean tiles that
 * never return anything. Dormancy is reversible on purpose: receiver
 * coverage shifts, and a tile that is dead today may wake up next month.
 */
export function createTileScheduler(tiles: Tile[], opts: SchedulerOptions = {}): TileScheduler {
  const dormantAfter = opts.dormantAfterEmptySweeps ?? DEFAULT_DORMANT_AFTER;
  const retryEvery = opts.dormantRetryEvery ?? DEFAULT_RETRY_EVERY;
  const maxPriorityQueue = opts.maxPriorityQueue ?? DEFAULT_MAX_PRIORITY_QUEUE;
  const minRefreshMs = opts.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS;
  const now = opts.now ?? Date.now;

  const emptyStreak = new Map<string, number>();
  const dormant = new Set<string>();
  const byId = new Map(tiles.map((t) => [t.id, t]));
  /**
   * Camera requests, oldest at the front. next() takes from the BACK and the
   * cap drops from the front, so the newest request is both served first and
   * the last to be discarded: an old entry describes a camera that has moved.
   */
  const priority: string[] = [];
  const lastServedAt = new Map<string, number>();
  let cursor = 0;
  let sweeps = 0;
  let rotationServed = 0;
  /**
   * The rotation's share cannot be split inside a batch of ONE — and a batch
   * of one is the natural shape under a limit of one request every 1.5 s.
   * `Math.floor(1 * 0.5)` is 0, and the `max(1, ...)` floor then handed the
   * whole batch to the viewport for ever: rotationServed stayed at zero, the
   * exact starvation ROTATION_SHARE exists to prevent. So the share is spread
   * ACROSS batches instead — it accrues here and is spent a whole tile at a
   * time, which makes a one-tile poller alternate.
   */
  let priorityCredit = 0;

  function isDue(tile: Tile): boolean {
    if (!dormant.has(tile.id)) return true;
    return sweeps % retryEvery === 0;
  }

  return {
    next(count) {
      const out: Tile[] = [];

      // Prioritised tiles jump the queue, dormancy included: a viewer looking
      // at a region is better evidence than our own history of that tile.
      // Freshness is the one thing priority does NOT override — prioritise()
      // refuses a tile fetched within minRefreshMs, because re-queuing it on
      // every poll is how the queue outgrows the budget.
      // But only up to a share of the batch — the rest belongs to the
      // rotation, or the globe outside the viewport is never refreshed and
      // the fleet decays into the region on screen.
      // Credit accrues only when there is something to spend it on, or an
      // idle queue would bank enough to swallow a later batch whole.
      if (priority.length > 0) priorityCredit += count * (1 - ROTATION_SHARE);
      const priorityQuota = Math.min(count, Math.max(0, Math.ceil(priorityCredit)));
      while (out.length < priorityQuota && priority.length > 0) {
        const id = priority.pop()!;
        const tile = byId.get(id);
        if (tile) {
          out.push(tile);
          lastServedAt.set(id, now());
        }
      }

      priorityCredit -= out.length; // only what the queue actually spent

      // A tile already taken from the priority queue must not be handed out
      // again by the rotation in the same batch: the caller fetches each
      // entry, so a duplicate is a duplicate HTTP request.
      const alreadyOut = new Set(out.map((t) => t.id));

      let examined = 0;
      while (out.length < count && examined < tiles.length * 2) {
        const tile = tiles[cursor % tiles.length]!;
        cursor += 1;
        examined += 1;
        if (cursor % tiles.length === 0) sweeps += 1;
        if (alreadyOut.has(tile.id)) continue;
        if (isDue(tile)) {
          out.push(tile);
          alreadyOut.add(tile.id); // without this the cursor laps and repeats
          lastServedAt.set(tile.id, now());
          rotationServed += 1;
        }
      }
      return out;
    },

    prioritise(tileIds) {
      const t = now();
      for (const id of tileIds) {
        if (!byId.has(id) || priority.includes(id)) continue;
        // A tile fetched moments ago gains nothing from being fetched again,
        // and re-queuing it on every poll is how the queue outgrows the
        // budget in the first place.
        const served = lastServedAt.get(id);
        if (served !== undefined && t - served < minRefreshMs) continue;
        priority.push(id);
      }
      // Newest requests win: an old entry describes a camera that has moved.
      while (priority.length > maxPriorityQueue) priority.shift();
    },

    record(tileId, aircraftCount) {
      if (aircraftCount > 0) {
        emptyStreak.set(tileId, 0);
        dormant.delete(tileId);
        return;
      }
      const streak = (emptyStreak.get(tileId) ?? 0) + 1;
      emptyStreak.set(tileId, streak);
      if (streak >= dormantAfter) dormant.add(tileId);
    },

    stats() {
      return {
        total: tiles.length,
        productive: tiles.length - dormant.size,
        dormant: dormant.size,
        sweepsCompleted: sweeps,
        prioritised: priority.length,
        rotationServed,
      };
    },
  };
}
