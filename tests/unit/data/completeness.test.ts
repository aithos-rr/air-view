import { describe, it, expect } from 'vitest';
import { isComplete, isCompleteExceptRoute } from '@/data/completeness';
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

describe('isCompleteExceptRoute', () => {
  // The panel needs to say how many grey aircraft are grey ONLY because the
  // route cache has not reached them yet. Measured 2026-11-21: technical
  // fields cover 99% of the fleet while routes cover 4.7%, so this number is
  // very nearly the whole grey population — and saying so turns "the globe
  // looks broken" into "the cache is still filling".
  it('accepts an aircraft that has every technical field but no route', () => {
    expect(isCompleteExceptRoute(complete({ route: null }))).toBe(true);
  });
  it('still rejects a missing technical field', () => {
    expect(isCompleteExceptRoute(complete({ route: null, registration: null }))).toBe(false);
  });
  it('agrees with isComplete once a route is present', () => {
    expect(isCompleteExceptRoute(complete())).toBe(isComplete(complete()));
  });
});
