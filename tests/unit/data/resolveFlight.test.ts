import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFlight } from '@/data/resolveFlight';
import { initAirlines } from '@/data/airlineLookup';
import { initRoutes } from '@/data/routeLookup';
import { initAirports } from '@/data/airportLookup';

beforeAll(() => {
  initAirlines([
    { icao: 'BAW', iata: 'BA', name: 'British Airways' },
    { icao: 'XYZ', iata: 'XY', name: 'Mystery Air' },
  ]);
  initRoutes([{ airlineIata: 'BA', originIata: 'LHR', destinationIata: 'JFK', flightNumber: '' }]);
  initAirports([
    { iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', lat: 51.47, lon: -0.45, timezone: 'Europe/London' },
    { iata: 'JFK', icao: 'KJFK', name: 'JFK', city: 'New York', country: 'US', lat: 40.64, lon: -73.78, timezone: 'America/New_York' },
  ]);
});

describe('resolveFlight', () => {
  it('resolves BAW274 to BA / LHR → JFK', () => {
    const r = resolveFlight('BAW274');
    expect(r).not.toBeNull();
    expect(r?.airlineIcao).toBe('BAW');
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.flightNumber).toBe('274');
    expect(r?.origin?.iata).toBe('LHR');
    expect(r?.destination?.iata).toBe('JFK');
  });
  it('returns null for unparseable callsign', () => {
    expect(resolveFlight('N12345')).toBeNull();
  });
  it('returns null when airline ICAO is not in DB', () => {
    expect(resolveFlight('ZZZ999')).toBeNull();
  });
  it('returns flight with null origin/destination when airline has no routes', () => {
    const r = resolveFlight('XYZ100');
    expect(r?.airlineIcao).toBe('XYZ');
    expect(r?.origin).toBeNull();
    expect(r?.destination).toBeNull();
  });
});
