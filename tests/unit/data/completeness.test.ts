import { describe, it, expect } from 'vitest';
import { isComplete } from '@/data/completeness';
import { makeAircraftRaw } from '../../helpers/aircraft';

const ROUTE = {
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

const complete = (over = {}) => makeAircraftRaw({ route: ROUTE, ...over });

describe('isComplete', () => {
  it('accepts an aircraft with a real route and every technical field', () => {
    expect(isComplete(complete())).toBe(true);
  });
  it('rejects an aircraft without a route — this is the grey population', () => {
    expect(isComplete(complete({ route: null }))).toBe(false);
  });
  it('rejects a missing callsign', () => {
    expect(isComplete(complete({ callsign: null }))).toBe(false);
  });
  it('rejects a missing registration', () => {
    expect(isComplete(complete({ registration: null }))).toBe(false);
  });
  it('rejects a missing model code', () => {
    expect(isComplete(complete({ modelCode: null }))).toBe(false);
  });
  it('rejects a missing ground speed', () => {
    expect(isComplete(complete({ velocityKt: null }))).toBe(false);
  });
  it('rejects a missing track', () => {
    expect(isComplete(complete({ headingDeg: null }))).toBe(false);
  });
  it('rejects a missing position', () => {
    expect(isComplete(complete({ latitude: null }))).toBe(false);
  });
  it('rejects a missing altitude while airborne', () => {
    expect(isComplete(complete({ baroAltitudeFt: null }))).toBe(false);
  });
  it('accepts a null altitude when the aircraft is on the ground', () => {
    expect(isComplete(complete({ onGround: true, baroAltitudeFt: null }))).toBe(true);
  });
});
