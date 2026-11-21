import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapData, teardownData } from '@/data/bootstrap';
import * as client from '@/data/statesClient';
import { useAircraftStore } from '@/state/aircraftStore';
import { makeAircraftRaw } from '../../helpers/aircraft';

/**
 * The two junctions in the middle of the chain, which nothing used to touch.
 *
 * bootstrap.ts is where the camera centre enters the stream and where the
 * server's `stale` word enters the store. Both ends of the chain were well
 * guarded — the body reader, the store, the HUD — and both middles could be
 * deleted with the suite still green.
 */
describe('bootstrapData', () => {
  beforeEach(() => {
    // No request leaves this process. The two bundle loaders call fetch on
    // relative URLs, and bootstrap already tolerates their failure
    // (Promise.allSettled), so a rejecting stub is the honest stand-in.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')));
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    });
  });

  afterEach(() => {
    teardownData();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the camera centre to the stream, so it reaches fetchStates', async () => {
    const spy = vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date('2026-05-20T00:00:00Z'),
      stale: false, capped: false,
      aircraft: [],
    });
    await bootstrapData(() => ({ lat: 50, lon: 8, radiusNm: 1299 }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(null, expect.anything(), { lat: 50, lon: 8, radiusNm: 1299 });
  });

  it('carries the server stale flag into the store, where the HUD reads it', async () => {
    // The 25-day outage in one assertion: the server said the body was old,
    // and every layer that dropped the word on the way left the globe
    // drawing stale positions as if they were live.
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date('2026-05-20T00:00:00Z'),
      stale: true, capped: false,
      aircraft: [makeAircraftRaw({ icao24: 'a1' })],
    });
    await bootstrapData();
    await vi.waitFor(() => expect(useAircraftStore.getState().aircraft.size).toBe(1));
    expect(useAircraftStore.getState().feedStale).toBe(true);
  });

  it('leaves the store fresh when the server says the body is fresh', async () => {
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date('2026-05-20T00:00:00Z'),
      stale: false, capped: false,
      aircraft: [makeAircraftRaw({ icao24: 'a1' })],
    });
    useAircraftStore.setState({ feedStale: true });
    await bootstrapData();
    await vi.waitFor(() => expect(useAircraftStore.getState().aircraft.size).toBe(1));
    expect(useAircraftStore.getState().feedStale).toBe(false);
  });
});
