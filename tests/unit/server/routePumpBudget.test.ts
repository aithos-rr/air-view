import { describe, it, expect } from 'vitest';
import {
  ROUTE_PUMP_MS,
  ROUTE_PUMP_BATCH,
  ADSBDB_MIN_INTERVAL_MS,
} from '../../../server/lookupPolicy';

/**
 * The runtime lookup rate, checked against the budget rather than believed.
 *
 * The first version pumped one callsign per 10 s because the seed was assumed
 * to carry the rest. Measured end to end, the seed covered 2% of a live fleet
 * and the queue grew 34x faster than it drained. Nothing in the suite noticed,
 * because the two constants lived in a file no test can import.
 */
describe('runtime route lookup budget', () => {
  it('never asks adsbdb faster than the ceiling this project promises', () => {
    // A pump of N spaces N-1 gaps inside its window; the window itself is the
    // gap before the next pump's first request.
    const requestsPerWindow = ROUTE_PUMP_BATCH;
    const effectiveIntervalMs = ROUTE_PUMP_MS / requestsPerWindow;
    expect(effectiveIntervalMs).toBeGreaterThanOrEqual(ADSBDB_MIN_INTERVAL_MS);
  });

  it('fits its own spacing inside the pump window, so pumps cannot overlap', () => {
    const spacingInsidePump = (ROUTE_PUMP_BATCH - 1) * ADSBDB_MIN_INTERVAL_MS;
    expect(spacingInsidePump).toBeLessThan(ROUTE_PUMP_MS);
  });

  it('drains fast enough to be worth having: at least 2 000 lookups an hour', () => {
    // 360/hour was the measured rate that lost to a queue growing at ~9 660.
    const perHour = (3_600_000 / ROUTE_PUMP_MS) * ROUTE_PUMP_BATCH;
    expect(perHour).toBeGreaterThanOrEqual(2_000);
  });
});
