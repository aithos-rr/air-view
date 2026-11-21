import { describe, it, expect } from 'vitest';
import { createRouteResolver } from '../../../server/routeResolver';
import { readRouteCache, serializeRouteCache } from '../../../server/routeCache';

const route = (o: string, d: string) => ({
  callsignIcao: 'X', callsignIata: null, airlineName: 'A',
  originIata: o, originName: o, destinationIata: d, destinationName: d,
});

/**
 * What the server learns while it runs has to survive the process.
 *
 * The offline builder spends hours against a provider that bans, and the
 * runtime resolver adds ~920 more an hour on top. Measured end to end: a
 * three-hour seed matched 2% of a live fleet, because traffic turns over, so
 * nearly everything blue comes from what the server learned since it started.
 * Held only in memory, all of it dies at the next restart — and on Railway a
 * restart is every deploy. The complete/incomplete split would reset to 2%
 * for ever instead of accumulating.
 */
describe('route knowledge survives a restart', () => {
  it('hands back everything it knows, resolved and unknown alike', () => {
    const r = createRouteResolver();
    r.seed([
      { callsign: 'AAA1', route: route('JFK', 'LHR') },
      { callsign: 'BBB2', route: null },
    ]);
    const out = r.entries();
    expect(out).toHaveLength(2);
    // An "unknown" is knowledge too: it cost a lookup and a 404, and dropping
    // it means paying for that answer again on every restart.
    expect(out.find((e) => e.callsign === 'BBB2')).toEqual({ callsign: 'BBB2', route: null });
  });

  it('round-trips through the file format without losing anything', () => {
    const r = createRouteResolver();
    r.seed([
      { callsign: 'AAA1', route: route('JFK', 'LHR') },
      { callsign: 'BBB2', route: null },
    ]);
    const reloaded = createRouteResolver();
    reloaded.seed(readRouteCache(serializeRouteCache(r.entries())));
    expect(reloaded.get('AAA1')?.destinationIata).toBe('LHR');
    expect(reloaded.stats().resolved).toBe(1);
    expect(reloaded.stats().unknown).toBe(1);
  });

  it('writes the envelope shape the offline builder also writes', () => {
    const parsed: unknown = JSON.parse(serializeRouteCache([{ callsign: 'A', route: null }]));
    expect(Object.keys(parsed as object).sort()).toEqual(['gridCursor', 'records']);
  });
});
