import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadCityPlaces, parseCityPlaces } from '@/data/cityPlaces';
import { useDetailStore } from '@/state/detailStore';

const SAMPLE = [
  { n: 'Tokyo', s: 0, l: 1, p: 35_676_000, lat: 35.685, lon: 139.7514 },
  { n: 'Milan', s: 1, l: 2, p: 2_945_000, lat: 45.47, lon: 9.205 },
  { n: 'Bergamo', s: 4, l: 8, p: 120_000, lat: 45.695, lon: 9.67 },
];

describe('cityPlaces — the file that was in the bundle all along', () => {
  beforeEach(() => useDetailStore.setState({ coastline: 'coarse', cities: 'absent' }));

  it('keeps the build order, because the scale is a PREFIX of it', () => {
    // build-static-data.mjs sorts by (SCALERANK, LABELRANK, -POP_MAX) ONCE,
    // so selecting at a map scale is walking the array from index 0 and
    // stopping. Re-sorting here would be the same work sixty times a second
    // for an answer that cannot change (D43).
    const places = parseCityPlaces(JSON.stringify(SAMPLE));
    expect(places.map((p) => p.name)).toEqual(['Tokyo', 'Milan', 'Bergamo']);
    expect(places.map((p) => p.scalerank)).toEqual([0, 1, 4]);
  });

  it('precomputes a unit direction per place, and only once', () => {
    // 1 251 × 4 = 5 004 transcendental calls at load. Rebuilding them from
    // lat/lon per frame would be 96 per frame for 24 labels out of 1 128
    // candidates, for a number that never changes (D43).
    const places = parseCityPlaces(JSON.stringify(SAMPLE));
    for (const p of places) {
      expect(Math.hypot(p.dir.x, p.dir.y, p.dir.z), p.name).toBeCloseTo(1, 12);
    }
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    // Reading them back costs nothing at all.
    for (let i = 0; i < 100; i++) for (const p of places) void p.dir.x;
    expect(sin).not.toHaveBeenCalled();
    expect(cos).not.toHaveBeenCalled();
    sin.mockRestore();
    cos.mockRestore();
  });

  it('refuses a record it cannot place instead of inventing coordinates', () => {
    const places = parseCityPlaces(
      JSON.stringify([
        { n: 'Nowhere', s: 0, l: 0, p: 1, lat: null, lon: 9 },
        { n: '', s: 0, l: 0, p: 1, lat: 1, lon: 2 },
        ...SAMPLE,
      ])
    );
    expect(places.map((p) => p.name)).toEqual(['Tokyo', 'Milan', 'Bergamo']);
  });

  it('carries an unknown population as null, never as a plausible figure', () => {
    const places = parseCityPlaces(JSON.stringify([{ n: 'X', s: 0, l: 0, p: null, lat: 0, lon: 0 }]));
    expect(places[0]!.popMax).toBeNull();
  });
});

describe('loadCityPlaces says what happened, and never throws into the render loop', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  beforeEach(() => useDetailStore.setState({ coastline: 'coarse', cities: 'absent' }));

  it('declares ready when the file arrives', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SAMPLE)),
    }) as unknown as typeof fetch;
    const places = await loadCityPlaces();
    expect(places).toHaveLength(3);
    expect(useDetailStore.getState().cities).toBe('ready');
  });

  it('declares unavailable on a 404 and returns an empty list', async () => {
    // Not a throw: this is called from a fetch handler beside the render
    // loop, and the globe is perfectly usable without city names. What is
    // not acceptable is being silent about it (D42).
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(loadCityPlaces()).resolves.toEqual([]);
    expect(useDetailStore.getState().cities).toBe('unavailable');
  });

  it('declares unavailable on a malformed body rather than drawing half a list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{ not json'),
    }) as unknown as typeof fetch;
    await expect(loadCityPlaces()).resolves.toEqual([]);
    expect(useDetailStore.getState().cities).toBe('unavailable');
  });
});
