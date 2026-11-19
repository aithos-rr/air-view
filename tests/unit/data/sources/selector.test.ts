import { describe, it, expect, vi } from 'vitest';
import { createSourceSelector } from '@/data/sources/selector';
import type { AircraftSource, SourceResult } from '@/data/sources/types';

const emptyResult = (): SourceResult => ({ aircraft: [], fetchedAt: new Date(0) });

function fakeSource(id: string, maxRadiusNm: number, impl: () => Promise<SourceResult>): AircraftSource {
  return { id, label: id, maxRadiusNm, fetchRegion: vi.fn(impl) };
}

describe('createSourceSelector', () => {
  it('returns the primary result and tags it with the source id', async () => {
    const primary = fakeSource('a', 250, async () => emptyResult());
    const selector = createSourceSelector([primary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('a');
  });

  it('falls through to the secondary when the primary throws', async () => {
    const primary = fakeSource('a', 250, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const secondary = fakeSource('b', 250, async () => emptyResult());
    const selector = createSourceSelector([primary, secondary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('b');
  });

  it('SKIPS a source whose radius ceiling is below the request', async () => {
    // Deliberately anonymous ceilings: this asserts the selector's own rule,
    // not a fact about any provider. No real pair can exercise this
    // fall-through, because BOTH providers cap at 250 NM (adsbLol.ts: 251 NM
    // and above -> 403; adsbFi.ts: 1000 NM -> 400, 5000/10 000 NM -> 429).
    // An earlier revision wrote this case with a fake 'adsb-lol' serving
    // 10 000 NM; it went green on mocks while production returned 502.
    const narrow = fakeSource('narrow', 250, async () => emptyResult());
    const wide = fakeSource('wide', 1_000, async () => emptyResult());
    const selector = createSourceSelector([narrow, wide]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 500);
    expect(narrow.fetchRegion).not.toHaveBeenCalled();
    expect(res.sourceId).toBe('wide');
  });

  it('uses a small-radius source when the request fits it', async () => {
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([small]);
    const res = await selector.fetchRegion({ lat: 45, lon: 9 }, 250);
    expect(res.sourceId).toBe('adsb-fi');
  });

  it('does not retry a failed source while its breaker is open', async () => {
    const primary = fakeSource('a', 250, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 250, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
    clock += 30_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
  });

  it('retries a failed source once the cooldown has elapsed', async () => {
    const primary = fakeSource('a', 250, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 250, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    clock += 61_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(2);
  });

  it('closes the breaker again after a success', async () => {
    let fail = true;
    const primary = fakeSource('a', 250, async () => {
      if (fail) throw new Error('boom');
      return emptyResult();
    });
    const secondary = fakeSource('b', 250, async () => emptyResult());
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
    const a = fakeSource('a', 250, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const b = fakeSource('b', 250, async () => { throw new Error('adsb-fi: HTTP 500'); });
    const selector = createSourceSelector([a, b]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403.*500/s);
  });

  it('keeps the ORIGINAL error as cause, not just its message', async () => {
    // server/index.ts reads e.cause to log causeMessage and causeCode — the
    // diagnostic added for the Railway egress failure. Rebuilding an Error
    // from e.message alone left those fields null exactly when a network
    // error was the thing being diagnosed.
    const original = new Error('fetch failed');
    (original as Error & { code: string }).code = 'UND_ERR_CONNECT_TIMEOUT';
    const a = fakeSource('a', 250, async () => { throw original; });
    const selector = createSourceSelector([a]);
    const thrown = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect((thrown as Error).cause).toBe(original);
    expect(((thrown as Error).cause as { code: string }).code).toBe('UND_ERR_CONNECT_TIMEOUT');
  });

  it('reports sources skipped for radius EVEN when another one failed', async () => {
    // A mixed roster used to report only the failure, so the operator read
    // "adsb-fi: HTTP 500" and never learned the primary was not asked at all.
    const wide = fakeSource('adsb-fi', 1_000, async () => { throw new Error('adsb-fi: HTTP 500'); });
    const narrow = fakeSource('adsb-lol', 250, async () => emptyResult());
    const selector = createSourceSelector([narrow, wide]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 500)).rejects.toThrow(
      'all usable ADS-B sources failed: adsb-fi: HTTP 500 | skipped for radius: adsb-lol (max 250 NM)'
    );
  });

  it('keeps reporting the real cause while the breaker is open', async () => {
    // On the tick after a failure the source is skipped by its own breaker.
    // Without carrying the reason forward the caller would be told
    // "all sources are in cooldown" instead of the actual 403.
    const a = fakeSource('a', 250, async () => { throw new Error('adsb-lol: HTTP 403'); });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
    clock += 1000; // breaker still open
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
  });

  it('reports clearly when every source was skipped for radius', async () => {
    // The real roster against a radius no caller asks for any more: both
    // providers declare 250 NM, so neither is called. This is where Plan 1's
    // 502 came from, kept as a regression test now that the poller stays
    // under the ceiling.
    const lol = fakeSource('adsb-lol', 250, async () => emptyResult());
    const fi = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([lol, fi]);
    // Assert the whole diagnostic payload, not just the word "radius": the
    // point of this error is that whoever reads it learns which sources were
    // skipped and why. A loose /radius/i match survives emptying the message.
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10_000)).rejects.toThrow(
      'no ADS-B source accepts a 10000 NM radius: adsb-lol (max 250 NM), adsb-fi (max 250 NM)'
    );
    expect(lol.fetchRegion).not.toHaveBeenCalled();
    expect(fi.fetchRegion).not.toHaveBeenCalled();
  });

  it('marks an error raised while every source was in cooldown as NOT attempted', async () => {
    // Nothing left the process on that call, so the 429 quoted in the
    // message is a replay of one from minutes ago. server/index.ts reads
    // `attempted` before letting message text re-arm the rate-limit
    // suspension: without it a stale "HTTP 429" froze the feed for five
    // more minutes on every cycle, without a single request being made.
    const a = fakeSource('a', 250, async () => {
      throw new Error('adsb-lol: HTTP 429 (retry after 90s)');
    });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });

    const live = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect((live as { attempted?: boolean }).attempted).toBe(true);

    clock += 1000; // breaker still open: the source is not asked at all
    const replayed = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect((replayed as Error).message).toMatch(/in cooldown after/);
    expect((replayed as Error).message).toMatch(/429/); // still readable by an operator
    expect((replayed as { attempted?: boolean }).attempted).toBe(false);
    expect(a.fetchRegion).toHaveBeenCalledTimes(1);
  });

  it('does not pretend to carry a cause when nothing was asked', async () => {
    // `cause: causes[0]` with an empty `causes` CREATES the property with
    // value undefined, so a reader cannot tell "no diagnosis exists" from
    // "the diagnosis was lost" — and every cooldown error looked like the
    // second. rootCause() then reports the aggregate's own message as the
    // root, which is the one message that explains nothing.
    const a = fakeSource('a', 250, async () => { throw new Error('adsb-lol: HTTP 500'); });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch(() => undefined);
    clock += 1000;
    const replayed = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect('cause' in (replayed as Error)).toBe(false);
  });

  it('still carries the original cause when a source WAS asked', async () => {
    // The guard above must not cost the diagnostic the cause exists for.
    const original = Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' });
    const a = fakeSource('a', 250, async () => { throw original; });
    const thrown = await createSourceSelector([a])
      .fetchRegion({ lat: 0, lon: 0 }, 10)
      .catch((e: unknown) => e);
    expect((thrown as Error).cause).toBe(original);
    expect((thrown as { attempted?: boolean }).attempted).toBe(true);
  });
});
