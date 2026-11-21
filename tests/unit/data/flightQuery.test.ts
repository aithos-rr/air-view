import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeQuery, expandQuery } from '@/data/flightQuery';
import { initAirlines } from '@/data/airlineLookup';

// Taken from public/data/airlines.json as it really is. VY and G3 are two of
// the 17 IATA codes measured 2026-11-21 that map to more than one ICAO.
const AIRLINES = [
  { icao: 'N/A', iata: '-', name: 'Unknown' },
  { icao: 'BAW', iata: 'BA', name: 'British Airways' },
  { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
  { icao: 'FOS', iata: 'VY', name: 'Formosa Airlines' },
  { icao: 'VLG', iata: 'VY', name: 'Vueling Airlines' },
];

describe('flight query', () => {
  beforeEach(() => initAirlines(AIRLINES));

  it('normalises spacing, hyphens and case', () => {
    expect(normalizeQuery(' ba-274 ')).toBe('BA274');
  });

  it('takes an ICAO callsign as itself', () => {
    expect(expandQuery('BAW274')).toEqual(['BAW274']);
  });

  it('expands the IATA form the way adsbdb spells it', () => {
    expect(expandQuery('BA274')).toEqual(['BAW274']);
  });

  it('offers every airline an ambiguous IATA code can mean', () => {
    // 17 of 834 IATA codes are shared. Picking one would silently search for
    // the wrong airline; the feed decides, not the table.
    expect(expandQuery('VY1234')).toEqual(['FOS1234', 'VLG1234']);
  });

  it('never reads a three-letter ICAO prefix as a two-letter IATA one', () => {
    // 'BAW274' as IATA would be 'BA' + 'W274', and W274 is not a number.
    // The two readings are disjoint, and this is the test that keeps them so.
    expect(expandQuery('BAW274')).not.toContain('BAWW274');
  });

  it('offers the unpadded number too when the query carries leading zeros', () => {
    // adsbdb spells it AA1006, never AA01006. A user copying from a boarding
    // pass may not.
    expect(expandQuery('AA0274')).toEqual(['AAL0274', 'AAL274']);
  });

  it('knows nothing about an airline the table does not list', () => {
    expect(expandQuery('ZZ100')).toEqual([]);
  });

  it('rejects something that is not a flight number at all', () => {
    expect(expandQuery('hello')).toEqual([]);
    expect(expandQuery('')).toEqual([]);
  });

  it('rejects a query too short to carry a flight number', () => {
    expect(expandQuery('B1')).toEqual([]);
  });
});
