// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readRouteCache } from '../../../server/routeCache';

/**
 * The seed reader used to be two expressions inside server/index.ts's boot
 * path. Dropping the bare-array back-compat, or seeding the envelope instead
 * of its records — a cold server on top of hours of adsbdb lookups — left the
 * suite green.
 */
const ROUTE = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

describe('readRouteCache', () => {
  it('reads the records out of the { gridCursor, records } envelope', () => {
    const text = JSON.stringify({ gridCursor: 180, records: [{ callsign: 'BAW274', route: ROUTE }] });
    expect(readRouteCache(text)).toEqual([{ callsign: 'BAW274', route: ROUTE }]);
  });

  it('still accepts the bare array written before the cursor existed', () => {
    // Hours of adsbdb lookups. A reader must not throw that away.
    const text = JSON.stringify([{ callsign: 'BAW274', route: ROUTE }, { callsign: 'NJE004M', route: null }]);
    expect(readRouteCache(text)).toHaveLength(2);
    expect(readRouteCache(text)[1]).toEqual({ callsign: 'NJE004M', route: null });
  });

  it('reads an envelope with no records as an empty seed, not as the envelope', () => {
    expect(readRouteCache(JSON.stringify({ gridCursor: 7 }))).toEqual([]);
    expect(readRouteCache(JSON.stringify({ gridCursor: 7, records: 5 }))).toEqual([]);
    expect(readRouteCache('null')).toEqual([]);
  });

  it('throws on malformed JSON so the caller can say the cache is unreadable', () => {
    expect(() => readRouteCache('{"records": [')).toThrow();
  });
});
