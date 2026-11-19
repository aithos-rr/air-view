import { describe, it, expect } from 'vitest';
import { buildTileGrid, createTileScheduler, tilesNear, TILE_RADIUS_NM } from '@/data/sources/tileGrid';

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

  it('leaves no hole in the interior: every cell corner is inside the radius', () => {
    // What STEP_FACTOR is for. The worst-covered point enclosed between
    // centres on both axes is the far corner of a cell, so probe exactly
    // those: for each pair of adjacent rows and each pair of adjacent
    // centres on the lower row, the midpoint of the four. Measured against
    // the nearest centre of the WHOLE grid, because the poller fetches every
    // tile regardless of region — a tile covers a point whatever bbox it
    // came from.
    const grid = buildTileGrid();
    let worst = 0;
    for (const region of new Set(grid.map((t) => t.region))) {
      const own = grid.filter((t) => t.region === region);
      const lats = [...new Set(own.map((t) => t.centre.lat))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < lats.length; i++) {
        const lons = own
          .filter((t) => t.centre.lat === lats[i])
          .map((t) => t.centre.lon)
          .sort((a, b) => a - b);
        const lat = (lats[i]! + lats[i + 1]!) / 2;
        for (let j = 0; j + 1 < lons.length; j++) {
          const p = { lat, lon: (lons[j]! + lons[j + 1]!) / 2 };
          worst = Math.max(worst, Math.min(...grid.map((t) => haversineNm(p, t.centre))));
        }
      }
    }
    // 227.9 NM, inside the 230 NM radius — the margin is 2 NM, so this is
    // not a figure to round off: raising STEP_FACTOR opens interior holes.
    expect(worst).toBeLessThan(TILE_RADIUS_NM);
    expect(worst).toBeCloseTo(227.9, 1);
  });

  it('leaves exactly the known edge strip of each box uncovered', () => {
    // The loops stop at the last centre satisfying <= latMax / <= lonMax, so
    // the final row and column fall short of the declared edge. This test
    // does not bless that gap — it measures it, so the figure quoted in the
    // source comment and in Step 5 of the plan (where extending the grid is
    // an open decision, because it would change the "exactly 413" count) is
    // one the suite enforces instead of one somebody typed.
    //
    // Same metric as the comment: sampled at 1 degree over the ten declared
    // boxes, distance to the nearest centre of the whole grid, ANY region.
    const boxes: Array<[number, number, number, number]> = [
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
    const grid = buildTileGrid();
    let sampled = 0;
    let uncovered = 0;
    for (const [latMin, latMax, lonMin, lonMax] of boxes) {
      for (let lat = latMin; lat <= latMax; lat++) {
        for (let lon = lonMin; lon <= lonMax; lon++) {
          sampled++;
          const nearest = Math.min(...grid.map((t) => haversineNm({ lat, lon }, t.centre)));
          if (nearest > TILE_RADIUS_NM) uncovered++;
        }
      }
    }
    expect(sampled).toBe(12883);
    expect(uncovered).toBe(276); // 2.1% of the declared area
  });

  it('names the cities that fall in the uncovered strip', () => {
    // Not all ocean, which is why the gap is a plan-level decision and not a
    // footnote: these three sit inside a declared box and outside every tile.
    const grid = buildTileGrid();
    const nearest = (p: { lat: number; lon: number }): number =>
      Math.min(...grid.map((t) => haversineNm(p, t.centre)));
    expect(nearest({ lat: -25.92, lon: 32.573 })).toBeCloseTo(279.1, 1); // Maputo
    expect(nearest({ lat: 45.623, lon: 126.25 })).toBeCloseTo(270.4, 1); // Harbin
    expect(nearest({ lat: 46.161, lon: -60.048 })).toBeCloseTo(316.4, 1); // Cape Breton
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

  it('wakes a dormant tile that produces again', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 1 });
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    s.record('a', 42);
    expect(s.stats().productive).toBeGreaterThanOrEqual(1);
  });
});
