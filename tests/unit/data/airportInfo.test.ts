import { describe, it, expect, beforeEach } from 'vitest';
import { airportInfoFor, routeEnds, isPlaceable } from '@/data/airportInfo';
import { initAirports } from '@/data/airportLookup';
import type { FlightRouteLite } from '@/types';

const JFK = {
  iata: 'JFK',
  icao: 'KJFK',
  name: 'John F Kennedy International Airport',
  city: 'New York',
  country: 'US',
  lat: 40.639801,
  lon: -73.7789,
  timezone: 'America/New_York',
};

// FRU is one of the 13 IATA codes that the real route cache contains and
// public/data/airports.json does not (measured 2026-11-21: ADS APC BBX BLM
// FOK FRU JCI MEV MSC MVY OXC SUA TNT). It is left OUT of the table here on
// purpose: these are the 17 routes of 4 243 that cannot be drawn.
const ROUTE: FlightRouteLite = {
  originIata: 'JFK',
  originName: 'Kennedy',
  destinationIata: 'FRU',
  destinationName: 'Manas International Airport',
  airlineName: 'Somebody',
};

describe('airportInfoFor', () => {
  beforeEach(() => initAirports([JFK]));

  it('takes the name from adsbdb, which answered about THIS flight', () => {
    // The bundled table is a generic OpenFlights dump; the route record is
    // what the provider said about this callsign. When they disagree the
    // specific one wins.
    expect(airportInfoFor('origin', ROUTE).name).toBe('Kennedy');
  });

  it('fills code, city and coordinates from the bundled table', () => {
    const a = airportInfoFor('origin', ROUTE);
    expect(a.icao).toBe('KJFK');
    expect(a.city).toBe('New York');
    expect(a.lat).toBeCloseTo(40.6398, 3);
    expect(a.lon).toBeCloseTo(-73.7789, 3);
  });

  it('leaves every table field null for a code the table does not know', () => {
    // 13 such codes in the committed cache. Guessing a position from a name
    // is exactly the v1 failure in another costume.
    const a = airportInfoFor('destination', ROUTE);
    expect(a.name).toBe('Manas International Airport'); // adsbdb still told us
    expect(a.icao).toBeNull();
    expect(a.city).toBeNull();
    expect(a.lat).toBeNull();
    expect(a.lon).toBeNull();
  });

  it('never invents a terminal', () => {
    // No free source exposes terminals (spec §2). The field exists so the
    // card can render it IF one ever arrives, and it stays null.
    expect(airportInfoFor('origin', ROUTE).terminal).toBeNull();
    expect(airportInfoFor('destination', ROUTE).terminal).toBeNull();
  });

  it('falls back to the table name only when adsbdb sent an empty one', () => {
    const blank = { ...ROUTE, originName: '   ' };
    expect(airportInfoFor('origin', blank).name).toBe('John F Kennedy International Airport');
  });

  it('marks as placeable only what has both coordinates', () => {
    const ends = routeEnds(ROUTE);
    expect(ends.origin.end).toBe('origin');
    expect(ends.destination.end).toBe('destination');
    expect(isPlaceable(ends.origin)).toBe(true);
    expect(isPlaceable(ends.destination)).toBe(false);
  });
});
