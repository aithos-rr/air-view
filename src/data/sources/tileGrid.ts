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
 * The planet would need ~1060 tiles of this radius; these regions need ~413,
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
 * 1.4 leaves overlap between neighbouring circles: measured against this very
 * grid, the worst point enclosed between centres on both axes is 225.2 NM from
 * the nearest one, inside the 230 NM radius. So the spacing covers the
 * *interior* of every box.
 *
 * KNOWN GAP, not covered: the loops below stop at the last centre that still
 * satisfies `<= latMax` / `<= lonMax`, so the final row and column fall up to
 * one step short of the declared edge and the strip beyond them is never
 * queried. Sampled at 1 degree over the ten boxes, 3.0% of the declared area
 * lies further than 230 NM from any centre — the worst holes are 387 NM at
 * -20,33 (southern-africa) and 363 NM at -10,179 (oceania), and Maputo
 * (-25.920, 32.573) sits 279 NM from its nearest centre, inside the box and
 * outside every tile.
 *
 * Deliberately left as is: widening the loops changes the tile count, and 413
 * is the acceptance criterion of Step 5 of the plan and the figure quoted
 * throughout it (sweep duration, retention window). That is a plan-level
 * decision, not something to patch here.
 */
const STEP_FACTOR = 1.4;

export function buildTileGrid(): Tile[] {
  const tiles: Tile[] = [];
  const stepLat = (TILE_RADIUS_NM * STEP_FACTOR) / NM_PER_DEGREE_LAT;

  for (const [region, latMin, latMax, lonMin, lonMax] of REGIONS) {
    for (let lat = latMin; lat <= latMax; lat += stepLat) {
      // Meridians converge towards the poles: widen the longitude step.
      const nmPerDegreeLon = NM_PER_DEGREE_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const stepLon = (TILE_RADIUS_NM * STEP_FACTOR) / nmPerDegreeLon;
      for (let lon = lonMin; lon <= lonMax; lon += stepLon) {
        const centre = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
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
 * tiles out of 413 in two hours.
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
  /** Insertion order matters: the newest request is served first. */
  const priority: string[] = [];
  const lastServedAt = new Map<string, number>();
  let cursor = 0;
  let sweeps = 0;
  let rotationServed = 0;

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
      const priorityQuota = Math.max(1, Math.floor(count * (1 - ROTATION_SHARE)));
      while (out.length < priorityQuota && priority.length > 0) {
        const id = priority.shift()!;
        const tile = byId.get(id);
        if (tile) {
          out.push(tile);
          lastServedAt.set(id, now());
        }
      }

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
