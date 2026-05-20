import { describe, it, expect } from 'vitest';
import { parseCallsign } from '@/data/callsign';

describe('parseCallsign', () => {
  it('parses standard ICAO callsign "BAW274"', () => {
    expect(parseCallsign('BAW274')).toEqual({ airlineIcao: 'BAW', flightNumber: '274' });
  });
  it('parses alphanumeric flight number "AAL1A"', () => {
    expect(parseCallsign('AAL1A')).toEqual({ airlineIcao: 'AAL', flightNumber: '1A' });
  });
  it('uppercases and trims', () => {
    expect(parseCallsign('  baw274  ')).toEqual({ airlineIcao: 'BAW', flightNumber: '274' });
  });
  it('returns null for empty / null / undefined', () => {
    expect(parseCallsign('')).toBeNull();
    expect(parseCallsign(null)).toBeNull();
    expect(parseCallsign(undefined)).toBeNull();
  });
  it('returns null when no airline prefix (military, ferry)', () => {
    expect(parseCallsign('N12345')).toBeNull(); // tail number
    expect(parseCallsign('AB')).toBeNull();      // too short
  });
});
