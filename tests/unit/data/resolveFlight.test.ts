import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFlight } from '@/data/resolveFlight';
import { initAirlines } from '@/data/airlineLookup';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../../helpers/aircraft';

const ROUTE = {
  originIata: 'LHR',
  originName: 'London Heathrow Airport',
  destinationIata: 'JFK',
  destinationName: 'John F Kennedy International Airport',
  airlineName: 'British Airways',
};

beforeAll(() => {
  initAirlines([
    { icao: 'BAW', iata: 'BA', name: 'British Airways' },
    { icao: 'XYZ', iata: 'XY', name: 'Mystery Air' },
  ]);
  initAirports([
    { iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', lat: 51.47, lon: -0.45, timezone: 'Europe/London' },
    { iata: 'JFK', icao: 'KJFK', name: 'JFK', city: 'New York', country: 'US', lat: 40.64, lon: -73.78, timezone: 'America/New_York' },
  ]);
});

describe('resolveFlight', () => {
  it('resolves BAW274 to British Airways with the route the server supplied', () => {
    const r = resolveFlight(makeAircraftRaw({ route: ROUTE }));
    expect(r?.airlineIcao).toBe('BAW');
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.flightNumber).toBe('274');
    expect(r?.origin?.iata).toBe('LHR');
    expect(r?.destination?.iata).toBe('JFK');
  });

  it('returns null origin and destination when the server knows no route', () => {
    const r = resolveFlight(makeAircraftRaw({ route: null }));
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.origin).toBeNull();
    expect(r?.destination).toBeNull();
  });

  it('returns null for an unparseable callsign', () => {
    expect(resolveFlight(makeAircraftRaw({ callsign: 'N12345' }))).toBeNull();
  });

  it('returns null for a null callsign', () => {
    expect(resolveFlight(makeAircraftRaw({ callsign: null }))).toBeNull();
  });

  it('falls back to the route airline name when the ICAO code is unknown locally', () => {
    const r = resolveFlight(makeAircraftRaw({ callsign: 'QQQ100', route: ROUTE }));
    expect(r?.airlineName).toBe('British Airways');
  });
});
