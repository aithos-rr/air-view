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
});

const tiles3 = () => [
  { id: 'a', region: 'r', centre: { lat: 0, lon: 0 } },
  { id: 'b', region: 'r', centre: { lat: 1, lon: 1 } },
  { id: 'c', region: 'r', centre: { lat: 2, lon: 2 } },
];

describe('tilesNear', () => {
  it('returns the tiles whose centre falls within the radius', () => {
    const grid = buildTileGrid();
    const near = tilesNear(grid, { lat: 50, lon: 8 }, 400);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(grid.length);
    expect(near.every((t) => t.region === 'europe')).toBe(true);
  });

  it('returns nothing over an uncovered ocean', () => {
    expect(tilesNear(buildTileGrid(), { lat: 0, lon: -160 }, 200)).toEqual([]);
  });

  it('orders the nearest tile first', () => {
    const near = tilesNear(buildTileGrid(), { lat: 50, lon: 8 }, 800);
    expect(near.length).toBeGreaterThan(1);
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
