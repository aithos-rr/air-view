import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAircraftStream } from '@/data/aircraftStream';
import * as statesClient from '@/data/statesClient';

/**
 * The v1 outage, reproduced at the one place Task 7 left open.
 *
 * Task 7 exists so a dead feed declares itself instead of emptying the globe.
 * It covers the feed that answers "stale", the feed that errors, and the
 * fetch that rejects. It did NOT cover the feed that simply never answers —
 * a proxy holding the connection, a VPN dropping, a laptop waking up. The
 * reschedule lived AFTER the await, so a promise that never settles killed
 * the refresh loop outright: no retry, no onError, no timer pending, and
 * fetchStatus stuck on 'fetching', which the HUD has no branch for. Frozen
 * aircraft and no explanation: v1, exactly.
 */
describe('startAircraftStream — a request that never answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('keeps polling when a fetch never settles', async () => {
    const spy = vi.spyOn(statesClient, 'fetchStates').mockReturnValue(new Promise(() => {}));
    const stop = startAircraftStream({
      getRefreshState: () => 'idle',
      onBatch: () => {},
      onError: () => {},
    });
    await vi.advanceTimersByTimeAsync(600_000);
    // The loop must still be alive: more than the single call that hung.
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    stop();
  });

  it('reports a hung fetch instead of going quiet', async () => {
    vi.spyOn(statesClient, 'fetchStates').mockReturnValue(new Promise(() => {}));
    const onError = vi.fn();
    const stop = startAircraftStream({
      getRefreshState: () => 'idle',
      onBatch: () => {},
      onError,
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(onError).toHaveBeenCalled();
    stop();
  });
});
