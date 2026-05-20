import { describe, it, expect, beforeAll } from 'vitest';
import { lookupAirline, initAirlines } from '@/data/airlineLookup';
import { lookupRoute, initRoutes } from '@/data/routeLookup';
import { lookupAirport, initAirports } from '@/data/airportLookup';

beforeAll(() => {
  initAirlines([
    { icao: 'BAW', iata: 'BA', name: 'British Airways' },
    { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
  ]);
  initRoutes([
    { airlineIata: 'BA', originIata: 'LHR', destinationIata: 'JFK', flightNumber: '' },
    { airlineIata: 'AA', originIata: 'JFK', destinationIata: 'LAX', flightNumber: '' },
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

describe('lookupRoute (by airlineIATA + flightNumber prefix)', () => {
  it('returns route for BA 274', () => {
    const r = lookupRoute('BA', '274');
    expect(r).not.toBeNull();
    expect(r?.airlineIata).toBe('BA');
  });
  it('returns null when airline has no routes', () => {
    expect(lookupRoute('XX', '999')).toBeNull();
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
