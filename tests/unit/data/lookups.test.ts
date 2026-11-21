import { describe, it, expect, beforeAll } from 'vitest';
import { lookupAirline, initAirlines } from '@/data/airlineLookup';
import { lookupAirport, initAirports } from '@/data/airportLookup';

beforeAll(() => {
  initAirlines([
    { icao: 'BAW', iata: 'BA', name: 'British Airways' },
    { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
  ]);
  initAirports([
    { iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', lat: 51.47, lon: -0.45, timezone: 'Europe/London' },
    { iata: 'JFK', icao: 'KJFK', name: 'JFK', city: 'New York', country: 'US', lat: 40.64, lon: -73.78, timezone: 'America/New_York' },
  ]);
});

describe('lookupAirline (by ICAO)', () => {
  it('returns airline for BAW', () => {
    expect(lookupAirline('BAW')).toEqual({ icao: 'BAW', iata: 'BA', name: 'British Airways' });
  });
  it('returns null for unknown', () => {
    expect(lookupAirline('XXX')).toBeNull();
  });
});

describe('lookupAirport (by IATA)', () => {
  it('returns LHR', () => {
    const a = lookupAirport('LHR');
    expect(a?.icao).toBe('EGLL');
    expect(a?.timezone).toBe('Europe/London');
  });
  it('returns null for unknown IATA', () => {
    expect(lookupAirport('XXX')).toBeNull();
  });
});
