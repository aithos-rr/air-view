import { describe, it, expect } from 'vitest';
import {
  buildTileGrid,
  createTileScheduler,
  nearestCoveringTile,
  tilesNear,
  viewPriorityTiles,
  TILE_RADIUS_NM,
} from '@/data/sources/tileGrid';
import type { GeoPoint } from '@/data/sources/types';

/**
 * The ten declared boxes, read by the coverage test and by
 * farthestCoveredSample below. One list, because two lists would be two
 * ideas of what this grid claims to cover.
 */
const SAMPLE_BOXES: Array<[number, number, number, number]> = [
  [25, 60, -130, -60], // north-america
  [35, 62, -11, 32], // europe
  [20, 46, 100, 146], // east-asia
  [-10, 22, 95, 128], // southeast-asia
  [6, 33, 68, 90], // india
  [12, 32, 34, 60], // gulf
  [-45, -10, 113, 179], // oceania
  [-35, 12, -75, -35], // south-america
  [-35, -20, 16, 33], // southern-africa
  [28, 42, -9, 45], // north-africa
];

describe('buildTileGrid', () => {
  it('stays under the 250 NM ceiling every provider enforces', () => {
    expect(TILE_RADIUS_NM).toBeLessThanOrEqual(250);
  });

  it('covers the regions where ADS-B receivers actually exist', () => {
    const tiles = buildTileGrid();
    const regions = new Set(tiles.map((t) => t.region));
    expect(regions).toContain('north-america');
    expect(regions).toContain('europe');
    expect(regions).toContain('east-asia');
    expect(tiles.length).toBeGreaterThan(300);
    expect(tiles.length).toBeLessThan(600);
  });

  it('gives every tile a stable unique id', () => {
    const tiles = buildTileGrid();
    const ids = new Set(tiles.map((t) => t.id));
    expect(ids.size).toBe(tiles.length);
    expect(buildTileGrid()[0]!.id).toBe(tiles[0]!.id); // deterministic
  });

  it('keeps every centre inside valid coordinates', () => {
    for (const t of buildTileGrid()) {
      expect(t.centre.lat).toBeGreaterThanOrEqual(-90);
      expect(t.centre.lat).toBeLessThanOrEqual(90);
      expect(t.centre.lon).toBeGreaterThanOrEqual(-180);
      expect(t.centre.lon).toBeLessThanOrEqual(180);
    }
  });

  it('covers EVERY point of every declared box, edges included', () => {
    // The whole purpose of the grid. An earlier revision incremented by the
    // raw step and stopped at the last centre still inside the edge, which
    // left 276 of 12 883 sampled points — 2.1% of the declared area — beyond
    // 230 NM from any centre, with holes up to 387 NM.
    //
    // Sampled at half a degree (~30 NM), finer than any hole the lattice can
    // produce: the margin is 230 - 216 = 14 NM. Distance is to the nearest
    // centre of the WHOLE grid, which is how coverage works — the poller
    // fetches every tile, so a tile covers a point whatever box it came from.
    const grid = buildTileGrid();
    let sampled = 0;
    let uncovered = 0;
    let worst = 0;
    for (const [latMin, latMax, lonMin, lonMax] of SAMPLE_BOXES) {
      for (let lat = latMin; lat <= latMax + 1e-9; lat += 0.5) {
        for (let lon = lonMin; lon <= lonMax + 1e-9; lon += 0.5) {
          sampled++;
          let nearest = Infinity;
          for (const t of grid) {
            const d = haversineNm({ lat, lon }, t.centre);
            if (d < nearest) nearest = d;
          }
          if (nearest > TILE_RADIUS_NM) uncovered++;
          if (nearest > worst) worst = nearest;
        }
      }
    }
    expect(sampled).toBe(50112);
    expect(uncovered).toBe(0);
    // 216.25 NM of 230: ~14 NM of margin, so the spacing has nothing to give.
    // Raising STEP_FACTOR to 1.6 pushes this past the radius and fails here.
    expect(worst).toBeLessThan(TILE_RADIUS_NM);
    expect(worst).toBeCloseTo(216.25, 1);
  });

  it('builds 546 tiles — the figure every rate and retention budget is derived from', () => {
    // A sweep is 546 sequential fetches spaced >= 1.5 s, so this number sets
    // the floor on how stale the far side of the world may be. It is quoted
    // in the plan; if it moves, those figures have to move with it.
    const grid = buildTileGrid();
    expect(grid.length).toBe(546);
    expect(new Set(grid.map((t) => t.id)).size).toBe(546);
  });

  it('covers the four places that used to fall outside every tile', () => {
    // Three cities in the old edge strip, plus the Bay of Bengal point that
    // sat in the staircase between two rows of the india box: enclosed
    // between centres on both axes and still 308 NM from the nearest one.
    const grid = buildTileGrid();
    const nearest = (p: { lat: number; lon: number }): number =>
      Math.min(...grid.map((t) => haversineNm(p, t.centre)));
    expect(nearest({ lat: -25.92, lon: 32.573 })).toBeLessThan(TILE_RADIUS_NM); // Maputo
    expect(nearest({ lat: 45.623, lon: 126.25 })).toBeLessThan(TILE_RADIUS_NM); // Harbin
    expect(nearest({ lat: 46.161, lon: -60.048 })).toBeLessThan(TILE_RADIUS_NM); // Cape Breton
    expect(nearest({ lat: 19, lon: 89.75 })).toBeLessThan(TILE_RADIUS_NM); // Bay of Bengal
  });
});

const tiles3 = () => [
  { id: 'a', region: 'r', centre: { lat: 0, lon: 0 } },
  { id: 'b', region: 'r', centre: { lat: 1, lon: 1 } },
  { id: 'c', region: 'r', centre: { lat: 2, lon: 2 } },
];

/**
 * Great-circle distance, written out independently of the source so the
 * ordering assertions cannot be satisfied by a shared bug.
 */
function haversineNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

describe('tilesNear', () => {
  it('returns the tiles whose centre falls within the radius', () => {
    const grid = buildTileGrid();
    const radiusNm = 400;
    const camera = { lat: 50, lon: 8 };
    const near = tilesNear(grid, camera, radiusNm);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(grid.length);
    expect(near.every((t) => t.region === 'europe')).toBe(true);

    // The radius is the whole point of the function: the provider refuses
    // anything beyond 250 NM, so a tile returned from outside the asked-for
    // radius is a request that comes back empty or rejected. Both halves are
    // asserted against the test's own haversine — nothing inside may be
    // missing, nothing outside may be present.
    const returned = new Set(near.map((t) => t.id));
    for (const t of grid) {
      const inside = haversineNm(camera, t.centre) <= radiusNm;
      expect(returned.has(t.id)).toBe(inside);
    }
  });

  it('cuts the radius at the right distance in real nautical miles', () => {
    // Ordering is scale-free: a distance function off by a constant factor
    // sorts identically and would pass every other test here. The cut does
    // not. One degree of latitude is 60 NM by definition, so these two tiles
    // sit at 228 NM and 240 NM from the camera: with a 230 NM radius the
    // first is in and the second is out, and no rescaling of the source's
    // distance can satisfy both. Load-bearing because 250 NM is the
    // provider's hard ceiling — a 13% underestimate would ask for tiles
    // 264 NM away and get nothing back.
    const camera = { lat: 0, lon: 0 };
    const grid = [
      { id: 'in', region: 'r', centre: { lat: 3.8, lon: 0 } }, // 228 NM
      { id: 'out', region: 'r', centre: { lat: 4.0, lon: 0 } }, // 240 NM
    ];
    expect(haversineNm(camera, grid[0]!.centre)).toBeCloseTo(228, 0);
    expect(haversineNm(camera, grid[1]!.centre)).toBeCloseTo(240, 0);

    expect(tilesNear(grid, camera, TILE_RADIUS_NM).map((t) => t.id)).toEqual(['in']);
  });

  it('returns nothing over an uncovered ocean', () => {
    expect(tilesNear(buildTileGrid(), { lat: 0, lon: -160 }, 200)).toEqual([]);
  });

  it('orders the nearest tile first', () => {
    // Load-bearing, not cosmetic: the server prioritises only the first six
    // tiles of this list. If the order reversed, it would refresh the
    // farthest tiles inside the radius and leave the region under the camera
    // as stale as the far side of the planet — the exact failure this
    // mechanism exists to prevent.
    const camera = { lat: 50, lon: 8 };
    const grid = buildTileGrid();
    const near = tilesNear(grid, camera, 800);
    expect(near.length).toBeGreaterThan(1);

    const distances = near.map((t) => haversineNm(camera, t.centre));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
    // The head of the list is the nearest tile of the whole grid, not merely
    // the nearest of some arbitrary subset that happened to come out first.
    const nearestOfGrid = Math.min(...grid.map((t) => haversineNm(camera, t.centre)));
    expect(distances[0]!).toBeCloseTo(nearestOfGrid, 6);
  });

  it('puts the six tiles the server prioritises nearest the camera', () => {
    // Task 3 calls prioritise(tilesNear(...).slice(0, 6)): those six must be
    // the six nearest, or the priority queue refreshes the wrong region.
    const camera = { lat: 50, lon: 8 };
    const grid = buildTileGrid();
    const near = tilesNear(grid, camera, 600);
    expect(near.length).toBeGreaterThan(6);

    const allSorted = grid
      .map((t) => haversineNm(camera, t.centre))
      .sort((a, b) => a - b)
      .slice(0, 6);
    const head = near.slice(0, 6).map((t) => haversineNm(camera, t.centre));
    expect(head).toEqual(allSorted);
    // And they are genuinely close by, not a spread across the radius.
    expect(head[5]!).toBeLessThan(500);
  });
});

describe('createTileScheduler', () => {
  it('serves prioritised tiles before the rotation', () => {
    // What the user is looking at must be fresh; the rest is context.
    const s = createTileScheduler(tiles3());
    s.prioritise(['c']);
    expect(s.next(1)[0]!.id).toBe('c');
  });

  it('serves a prioritised tile even when it is dormant', () => {
    // Dormancy is overridden by a viewer's request: someone looking at a
    // region is better evidence than our own history of that tile.
    // minRefreshMs is set to 0 to isolate that rule from the freshness one,
    // which is exercised by its own test below — and which wins: a tile
    // fetched seconds ago is not re-queued even for a viewer.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, minRefreshMs: 0 });
    for (const t of s.next(3)) s.record(t.id, 0);
    s.prioritise(['b']);
    expect(s.next(1)[0]!.id).toBe('b');
  });

  it('NEVER lets priority starve the rotation', () => {
    // Simulated on this code: with an unbounded priority queue a single
    // viewer asking for 12 tiles every 30 s left the rotation at 8 tiles out
    // of 413 in two hours, sweeps at zero, and prune() deleting the world.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many);
    s.prioritise(many.slice(0, 12).map((t) => t.id));
    const served = s.next(8);
    expect(served.length).toBe(8);
    expect(s.stats().rotationServed).toBeGreaterThanOrEqual(4); // half the batch
  });

  it('gives the rotation its share even when the batch is ONE tile', () => {
    // A batch of one is the natural shape under a limit of one request every
    // 1.5 s, and a share cannot be split inside it: floor(1 * 0.5) is 0, and
    // the old max(1, ...) floor handed every single-tile batch to the
    // viewport for ever. The share is spread across batches instead.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { minRefreshMs: 0 });
    s.prioritise(many.slice(0, 12).map((t) => t.id));
    for (let poll = 0; poll < 12; poll++) s.next(1);
    expect(s.stats().rotationServed).toBe(6); // half of twelve single-tile polls
  });

  it('never returns the same tile twice in one batch', () => {
    // The caller fetches every entry, so a duplicate is a duplicate request
    // against a provider that answers 429 to bursts.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    s.prioritise(['a']);
    const batch = s.next(3);
    expect(new Set(batch.map((t) => t.id)).size).toBe(batch.length);
  });

  it('does not repeat tiles when the rotation laps inside one batch', () => {
    // The real case: fewer due tiles than the batch size. The cursor wraps
    // and would hand out the same tiles again — six fetches for three tiles.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    const batch = s.next(8); // more than the three tiles available
    expect(new Set(batch.map((t) => t.id)).size).toBe(batch.length);
    expect(batch.length).toBeLessThanOrEqual(3);
  });

  it('caps the priority queue so a moving camera cannot grow it without bound', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { maxPriorityQueue: 5 });
    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(5);
  });

  it('does not re-queue a tile it served moments ago', () => {
    let clock = 1_000_000;
    const s = createTileScheduler(tiles3(), { minRefreshMs: 60_000, now: () => clock });
    s.prioritise(['a']);
    s.next(2);
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(0);
    clock += 61_000;
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(1);
  });

  it('drops a tile from the priority set once it has been served', () => {
    const s = createTileScheduler(tiles3());
    s.prioritise(['c']);
    s.next(1);
    expect(s.stats().prioritised).toBe(0);
  });

  it('hands out tiles in rotation without repeating within a sweep', () => {
    const s = createTileScheduler(tiles3());
    const first = s.next(2).map((t) => t.id);
    const second = s.next(2).map((t) => t.id);
    expect(new Set([...first, ...second]).size).toBe(3);
  });

  it('counts a completed sweep', () => {
    const s = createTileScheduler(tiles3());
    expect(s.stats().sweepsCompleted).toBe(0);
    s.next(3);
    s.next(1);
    expect(s.stats().sweepsCompleted).toBeGreaterThanOrEqual(1);
  });

  it('marks a tile dormant after repeated empty sweeps', () => {
    // A tile over open ocean returns zero for ever. Polling it at full rate
    // wastes most of the request budget: measured live, a US tile returns
    // 660 aircraft and a Pacific one returns 0.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 2 });
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const t of s.next(3)) s.record(t.id, t.id === 'a' ? 100 : 0);
    }
    expect(s.stats().dormant).toBe(2);
    expect(s.stats().productive).toBe(1);
  });

  it('keeps serving productive tiles while skipping dormant ones', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 100 });
    for (const t of s.next(3)) s.record(t.id, t.id === 'a' ? 5 : 0);
    const served = s.next(3).map((t) => t.id);
    expect(served).toContain('a');
    expect(served.length).toBeLessThan(3);
  });

  it('retries a dormant tile occasionally — coverage changes over time', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 2 });
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    let seen = new Set<string>();
    for (let i = 0; i < 10; i++) for (const t of s.next(3)) seen.add(t.id);
    expect(seen.size).toBe(3); // all eventually retried
  });

  it('serves the NEWEST camera request first', () => {
    // An older entry describes a camera that has already moved on. Serving it
    // first refreshes where the viewer WAS before where they are now — the
    // exact delay viewport priority exists to remove. The queue therefore
    // grows at the back and is served from the back.
    const s = createTileScheduler(tiles3());
    s.prioritise(['a']);
    s.prioritise(['c']);
    // Batches of two: one tile of each goes to the viewport, so two batches
    // drain the queue and the ORDER is what is under test here.
    expect(s.next(2)[0]!.id).toBe('c');
    expect(s.next(2)[0]!.id).toBe('a');
  });

  it('drops the OLDEST entry when a moving camera overflows the queue', () => {
    // The cap and the service order must agree: the newest request is both
    // the first served and the last discarded. Asserting only the queue
    // LENGTH leaves which end is dropped free to invert.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { maxPriorityQueue: 3 });
    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(3);
    expect([s.next(2)[0]!.id, s.next(2)[0]!.id, s.next(2)[0]!.id]).toEqual(['t5', 't4', 't3']);
  });

  it('stamps a tile served by the ROTATION, not just one served by priority', () => {
    // Both paths spend the same budget against a provider that answers 429 to
    // bursts. Without the stamp on the rotation path, the next camera update
    // re-queues a tile fetched a second ago — a duplicate HTTP request.
    let clock = 1_000_000;
    const s = createTileScheduler(tiles3(), { minRefreshMs: 60_000, now: () => clock });
    const served = s.next(3).map((t) => t.id);
    expect(s.stats().rotationServed).toBe(3);
    clock += 1_000;
    s.prioritise(served);
    expect(s.stats().prioritised).toBe(0);
    clock += 60_000;
    s.prioritise(served);
    expect(s.stats().prioritised).toBe(3);
  });

  it('ignores a tile already waiting in the queue', () => {
    // Two camera updates overlapping the same tile must not put it in one
    // batch twice. The sibling test above cannot see this: its setup queues
    // 'a' once, so the duplicate never has a chance to form.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    s.prioritise(['a']);
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(1);
    expect(s.next(4).filter((t) => t.id === 'a').length).toBe(1);
  });

  it('runs on the queue cap and freshness window production actually gets', () => {
    // Task 3 builds the scheduler with no options, so the defaults ARE the
    // production values — and these two are the literal fix for the
    // starvation defect (unbounded queue, re-queued on every poll). Every
    // other scheduler test passes its options explicitly, which leaves the
    // defaults free to be reverted with the suite still green.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    let clock = 1_000_000;
    const s = createTileScheduler(many, { now: () => clock });

    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(12); // maxPriorityQueue

    const served = s.next(2)[0]!.id;
    expect(served).toBe('t39');
    s.prioritise([served]);
    expect(s.stats().prioritised).toBe(11); // 60 s freshness: not re-queued
    clock += 60_001;
    s.prioritise([served]);
    expect(s.stats().prioritised).toBe(12);
  });

  it('goes dormant on the THIRD empty sweep by default, not the second', () => {
    const s = createTileScheduler(tiles3());
    for (let i = 0; i < 2; i++) for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(0);
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
  });

  it('retries a dormant tile on every twentieth sweep by default', () => {
    const s = createTileScheduler(tiles3());
    for (let i = 0; i < 3; i++) for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    const resumedAtSweep: number[] = [];
    for (let poll = 0; poll < 30; poll++) {
      const got = s.next(3);
      if (got.length > 0) resumedAtSweep.push(s.stats().sweepsCompleted);
      for (const t of got) s.record(t.id, 0);
    }
    expect(resumedAtSweep).toEqual([20, 40, 60]);
  });

  it('wakes a dormant tile that produces again', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 1 });
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    s.record('a', 42);
    expect(s.stats().productive).toBeGreaterThanOrEqual(1);
  });

  it('marks a tile dormant when its fetch keeps FAILING, not only when it is empty', () => {
    // record() is reached only on the poller's success branch, so before
    // recordFailure() a tile that always failed stayed in the rotation for
    // ever: one 1.5 s slot per sweep, every sweep, for a tile that never
    // answers. Dormancy learned from emptiness and never from failure.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 3 });
    for (let i = 0; i < 3; i++) s.recordFailure('b');
    expect(s.stats().dormant).toBe(1);
    expect(s.stats().productive).toBe(2);
  });

  it('counts a failure and an empty answer on the SAME streak', () => {
    // Both mean the tile yielded no aircraft this time round and both cost
    // the same slot. Two separate counters would let a tile alternate
    // between failing and answering empty and never reach either threshold.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 3 });
    s.record('a', 0);
    s.recordFailure('a');
    expect(s.stats().dormant).toBe(0);
    s.record('a', 0);
    expect(s.stats().dormant).toBe(1);
  });

  it('wakes a tile that answers again after failing', () => {
    // Dormancy stays reversible whatever put the tile to sleep: an outage
    // on one region is not evidence about the next month.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 2 });
    s.recordFailure('c');
    s.recordFailure('c');
    expect(s.stats().dormant).toBe(1);
    s.record('c', 7);
    expect(s.stats().dormant).toBe(0);
    expect(s.stats().productive).toBe(3);
  });

  it('drops a failing tile out of the rotation, which is the point of all this', () => {
    // The slot is the scarce resource: one request every 1.5 s. A tile that
    // cannot be fetched has to stop spending one on every sweep.
    const s = createTileScheduler(tiles3(), {
      dormantAfterEmptySweeps: 1, dormantRetryEvery: 100, minRefreshMs: 0,
    });
    // One full sweep first: isDue() lets a dormant tile through on every
    // retryEvery-th sweep, and sweep ZERO is one of those — without this the
    // test would pass for the wrong reason, or fail for one.
    for (const t of s.next(3)) s.record(t.id, 5);
    s.recordFailure('b');
    const served = s.next(3).map((t) => t.id);
    expect(served).not.toContain('b');
    expect(served.length).toBe(2);
  });
});

describe('createTileScheduler — the priority credit must not become a bank', () => {
  const sixty = (): Array<{ id: string; region: string; centre: { lat: number; lon: number } }> =>
    Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      region: 'r',
      centre: { lat: i % 80, lon: 0 },
    }));

  /**
   * The steady state of ONE viewer with a static camera.
   *
   * The server prioritises six tiles on every /api/states, and prioritise()
   * refuses any of them fetched within minRefreshMs — so in the steady state
   * the tiles come due one at a time and the queue holds about one entry when
   * next() is called. The queue is non-empty, so credit accrues by
   * count * (1 - ROTATION_SHARE) = 4, and only the single tile actually served
   * is ever subtracted. Three tiles of credit per batch, banked for ever.
   */
  const starve = (
    s: ReturnType<typeof createTileScheduler>,
    tiles: ReturnType<typeof sixty>,
    batches: number,
    advance: (ms: number) => void
  ): void => {
    for (let i = 0; i < batches; i++) {
      s.prioritise([tiles[i % tiles.length]!.id]);
      s.next(8);
      advance(13_000);
    }
  };

  /** Batches in which the rotation received NOTHING, and its overall share. */
  const panAndMeasure = (
    s: ReturnType<typeof createTileScheduler>,
    tiles: ReturnType<typeof sixty>,
    batches: number,
    advance: (ms: number) => void
  ): { starvedBatches: number; rotationTiles: number; servedTiles: number } => {
    let starvedBatches = 0;
    let rotationTiles = 0;
    let servedTiles = 0;
    for (let b = 0; b < batches; b++) {
      s.prioritise(tiles.slice(0, 12).map((t) => t.id));
      const before = s.stats().rotationServed;
      const batch = s.next(8);
      const after = s.stats().rotationServed;
      servedTiles += batch.length;
      rotationTiles += after - before;
      if (after === before) starvedBatches += 1;
      advance(13_000);
    }
    return { starvedBatches, rotationTiles, servedTiles };
  };

  it('does not let an idle-ish queue bank credit that later swallows whole batches', () => {
    // The defect: priorityCredit accrues on every next() where the queue is
    // non-empty but only `out.length` is ever subtracted, and nothing caps
    // the surplus. A viewer with a static camera banks ~3 tiles per batch for
    // as long as the process has been up; the moment the queue fills again —
    // a pan, a reload, a second viewer — the bank is spent and the viewport
    // takes WHOLE batches. That is the starvation ROTATION_SHARE exists to
    // prevent, and it gets worse the longer the server has run.
    //
    // Downstream it is not just staleness: rotationServed freezes, so
    // sweepSeconds = (elapsedS / rotationServed) * dueTiles inflates,
    // retention pins at MAX_RETENTION_S, and every tile outside the viewport
    // is pruned before the rotation returns to it.
    const tiles = sixty();
    let clock = 1_000_000;
    const s = createTileScheduler(tiles, { now: () => clock, minRefreshMs: 0 });

    starve(s, tiles, 200, (ms) => {
      clock += ms;
    });
    const after = panAndMeasure(s, tiles, 10, (ms) => {
      clock += ms;
    });

    // Measured on the unfixed scheduler: 10 of 10 batches gave the rotation
    // zero tiles, 0 of 80 tiles served. One batch may legitimately go wholly
    // to the viewport — that is one batch of credit, which is the cap.
    expect(after.starvedBatches).toBeLessThanOrEqual(1);
    expect(after.rotationTiles / after.servedTiles).toBeGreaterThanOrEqual(0.4);
  });

  it('serves a long-idle scheduler no worse than a fresh one', () => {
    // The control that says this is about the BANK and not about a scheduler
    // that has simply run out of due tiles: the same pan workload on a fresh
    // scheduler, which has banked nothing.
    const tiles = sixty();
    let clock = 1_000_000;
    const fresh = createTileScheduler(tiles, { now: () => clock, minRefreshMs: 0 });
    const control = panAndMeasure(fresh, tiles, 10, (ms) => {
      clock += ms;
    });
    expect(control.starvedBatches).toBeLessThanOrEqual(1);
    expect(control.rotationTiles / control.servedTiles).toBeGreaterThanOrEqual(0.4);

    let clock2 = 1_000_000;
    const aged = createTileScheduler(tiles, { now: () => clock2, minRefreshMs: 0 });
    starve(aged, tiles, 200, (ms) => {
      clock2 += ms;
    });
    const agedAfter = panAndMeasure(aged, tiles, 10, (ms) => {
      clock2 += ms;
    });
    // Uptime must not be what decides whether the rotation advances.
    expect(agedAfter.rotationTiles).toBeGreaterThanOrEqual(control.rotationTiles - 8);
  });
});

/** The covered point farthest from any tile centre: the 218,0 NM worst case. */
function farthestCoveredSample(grid: ReturnType<typeof buildTileGrid>): GeoPoint {
  let worst = { lat: 0, lon: 0 };
  let worstD = -1;
  for (const [latMin, latMax, lonMin, lonMax] of SAMPLE_BOXES) {
    for (let lat = latMin; lat <= latMax + 1e-9; lat += 0.5) {
      for (let lon = lonMin; lon <= lonMax + 1e-9; lon += 0.5) {
        let nearest = Infinity;
        for (const t of grid) {
          const d = haversineNm({ lat, lon }, t.centre);
          if (d < nearest) nearest = d;
        }
        if (nearest > worstD) {
          worstD = nearest;
          worst = { lat, lon };
        }
      }
    }
  }
  return worst;
}

describe('nearestCoveringTile — which tile CONTAINS what is being looked at', () => {
  const grid = buildTileGrid();

  it('names a tile for every covered point, at any view radius', () => {
    // This is the assertion that used to live in pointSize.test.ts as a
    // floor under the camera. The grid guarantee — no covered point more
    // than 218,0 NM from a centre, on 1 224 760 samples (tileGrid.ts:60-62)
    // — stops being a constraint on the zoom and becomes the PROOF that
    // this function never comes back empty over a covered region (D38).
    for (const sample of [
      { lat: 45.46, lon: 9.19 },   // Milano
      { lat: 40.71, lon: -74.0 },  // New York
      { lat: 1.35, lon: 103.82 },  // Singapore
      { lat: -33.87, lon: 151.21 },// Sydney
      { lat: 19.07, lon: 72.88 },  // Mumbai
    ]) {
      const tile = nearestCoveringTile(grid, sample);
      expect(tile, `${sample.lat},${sample.lon}`).not.toBeNull();
      expect(haversineNm(sample, tile!.centre)).toBeLessThanOrEqual(TILE_RADIUS_NM);
    }
  });

  it('refuses rather than naming a tile that covers nothing on screen', () => {
    // Mid-Pacific: the nearest centre is thousands of NM away and
    // prioritising it would spend a slot on a tile nobody can see. Null is
    // the truth here, not a shortfall — there is no data to refresh.
    expect(nearestCoveringTile(grid, { lat: 0, lon: -150 })).toBeNull();
  });

  it('agrees with tilesNear whenever tilesNear says anything at all', () => {
    const centre = { lat: 45.46, lon: 9.19 };
    const wide = tilesNear(grid, centre, 400);
    expect(wide.length).toBeGreaterThan(0);
    expect(nearestCoveringTile(grid, centre)!.id).toBe(wide[0]!.id);
  });

  it('is what a 39,6 NM viewport gets when tilesNear gets nothing', () => {
    // The whole point. At the new zoom floor the cap is 39,6 NM and a
    // viewer can sit 218 NM from the nearest centre: tilesNear returns
    // nothing and, before this, the region on screen silently stopped
    // jumping the queue.
    const lonely = farthestCoveredSample(grid);
    expect(tilesNear(grid, lonely, 39.6)).toHaveLength(0);
    expect(nearestCoveringTile(grid, lonely)).not.toBeNull();
  });
});

describe('viewPriorityTiles — the union, where a unit test can reach it', () => {
  const grid = buildTileGrid();

  it('puts the covering tile FIRST when the radius missed it', () => {
    // This is the assertion the plan used to put in a
    // tests/unit/server/viewPriority.test.ts that no step ever created —
    // a path on a `git add` line that matched nothing, which exits 1 and
    // takes the commit with it. The union belongs in a pure function, and
    // then it belongs in this file.
    const lonely = farthestCoveredSample(grid);
    const ids = viewPriorityTiles(grid, lonely, 39.6, 6);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(nearestCoveringTile(grid, lonely)!.id);
  });

  it('does not name the covering tile twice when the radius already had it', () => {
    const centre = { lat: 45.46, lon: 9.19 };
    const ids = viewPriorityTiles(grid, centre, 400, 6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(nearestCoveringTile(grid, centre)!.id);
  });

  it('honours the limit, because half of each poller batch is the rotation', () => {
    expect(viewPriorityTiles(grid, { lat: 45.46, lon: 9.19 }, 2000, 6)).toHaveLength(6);
  });

  it('returns nothing at all over the mid-Pacific, which is the truth there', () => {
    // No tile covers it and none is within the radius: prioritising the
    // nearest centre thousands of NM away would spend a slot on a tile
    // nobody can see. Empty is not a shortfall (D38).
    expect(viewPriorityTiles(grid, { lat: 0, lon: -150 }, 39.6, 6)).toEqual([]);
  });

  it('never inflates the radius it was given', () => {
    // D15 applied to a protocol: the client declares what it is looking at
    // and the server answers that, rather than the client declaring more
    // so the old arithmetic keeps working.
    const centre = { lat: 45.46, lon: 9.19 };
    const narrow = viewPriorityTiles(grid, centre, 39.6, 6);
    const wide = viewPriorityTiles(grid, centre, 400, 6);
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow.every((id) => wide.includes(id))).toBe(true);
  });
});
