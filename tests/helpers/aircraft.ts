import type { AircraftRaw } from '@/types';

/**
 * Builds a valid AircraftRaw for tests. Every field has a sane default so a
 * new required field only has to be added here, not in every test literal.
 */
export function makeAircraftRaw(overrides: Partial<AircraftRaw> = {}): AircraftRaw {
  return {
    icao24: 'ad5174',
    callsign: 'BAW274',
    longitude: -10,
    latitude: 50,
    baroAltitudeFt: 38000,
    velocityKt: 472,
    headingDeg: 261.3,
    onGround: false,
    lastContact: 1_716_163_200,
    registration: 'G-ZBKA',
    modelCode: 'B789',
    modelDesc: null,
    route: null,
    complete: false,
    ...overrides,
  };
}
