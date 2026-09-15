import { describe, it, expect, vi } from 'vitest';
import { createSourceSelector } from '@/data/sources/selector';
import type { AircraftSource, SourceResult } from '@/data/sources/types';

const emptyResult = (): SourceResult => ({ aircraft: [], fetchedAt: new Date(0) });

function fakeSource(id: string, maxRadiusNm: number, impl: () => Promise<SourceResult>): AircraftSource {
  return { id, label: id, maxRadiusNm, fetchRegion: vi.fn(impl) };
}

describe('createSourceSelector', () => {
  it('returns the primary result and tags it with the source id', async () => {
    const primary = fakeSource('a', 10_000, async () => emptyResult());
    const selector = createSourceSelector([primary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('a');
  });

  it('falls through to the secondary when the primary throws', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    const selector = createSourceSelector([primary, secondary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('b');
  });

  it('SKIPS a source whose radius ceiling is below the request', async () => {
    // adsb.fi caps at 250 NM. Calling it with the 10 000 NM global sweep
    // would return HTTP 400 and open its breaker for nothing.
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const big = fakeSource('adsb-lol', 10_000, async () => emptyResult());
    const selector = createSourceSelector([small, big]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10_000);
    expect(small.fetchRegion).not.toHaveBeenCalled();
    expect(res.sourceId).toBe('adsb-lol');
  });

  it('uses a small-radius source when the request fits it', async () => {
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([small]);
    const res = await selector.fetchRegion({ lat: 45, lon: 9 }, 250);
    expect(res.sourceId).toBe('adsb-fi');
  });

  it('does not retry a failed source while its breaker is open', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
    clock += 30_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
  });

  it('retries a failed source once the cooldown has elapsed', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    clock += 61_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(2);
  });

  it('closes the breaker again after a success', async () => {
    let fail = true;
    const primary = fakeSource('a', 10_000, async () => {
      if (fail) throw new Error('boom');
      return emptyResult();
    });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 10, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    fail = false;
    clock += 20;
    expect((await selector.fetchRegion({ lat: 0, lon: 0 }, 10)).sourceId).toBe('a');
    clock += 1;
    expect((await selector.fetchRegion({ lat: 0, lon: 0 }, 10)).sourceId).toBe('a');
  });

  it('throws an aggregated error when every source fails', async () => {
    const a = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const b = fakeSource('b', 10_000, async () => { throw new Error('adsb-fi: HTTP 500'); });
    const selector = createSourceSelector([a, b]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403.*500/s);
  });

  it('keeps reporting the real cause while the breaker is open', async () => {
    // On the tick after a failure the source is skipped by its own breaker.
    // Without carrying the reason forward the caller would be told
    // "all sources are in cooldown" instead of the actual 403.
    const a = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
    clock += 1000; // breaker still open
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
  });

  it('reports clearly when every source was skipped for radius', async () => {
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([small]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10_000)).rejects.toThrow(/radius/i);
  });
});
