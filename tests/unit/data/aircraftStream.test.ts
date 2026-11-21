import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAircraftStream } from '@/data/aircraftStream';
import * as client from '@/data/statesClient';
import { makeAircraftRaw } from '../../helpers/aircraft';

// Helper: drain microtasks without firing scheduled timers
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('startAircraftStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date(),
      stale: false, capped: false,
      aircraft: [makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274', lastContact: 0 })],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls fetchStates immediately on start', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ icao24: 'a1' })]),
      expect.any(Date),
      false,
      false
    );
    stop();
  });

  it('schedules next fetch at 30s when state is active', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(2);
    stop();
  });

  it('schedules next fetch at 120s when state is background', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'background' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(119_999);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(2);
    stop();
  });

  it('passes the bounding box from getBoundingBox to fetchStates', async () => {
    const onBatch = vi.fn();
    const bbox = { lamin: 35, lomin: -15, lamax: 72, lomax: 45 };
    const stop = startAircraftStream({
      onBatch,
      getRefreshState: () => 'active',
      getBoundingBox: () => bbox,
    });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledWith(bbox, expect.anything(), null);
    stop();
  });

  it('passes null bbox when getBoundingBox is omitted', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledWith(null, expect.anything(), null);
    stop();
  });

  it('passes the view centre from getViewCentre to fetchStates', async () => {
    // Step 9's chain camera -> request. The server reads lat/lon/radius and
    // refreshes those tiles first; if the client stops sending them, that
    // whole block of Task 3 is dead code again and the region on screen ages
    // like the far side of the planet. The suite used to assert only the
    // ABSENCE of a centre, which a client that never sends one satisfies.
    const onBatch = vi.fn();
    const stop = startAircraftStream({
      onBatch,
      getRefreshState: () => 'active',
      getViewCentre: () => ({ lat: 50, lon: 8, radiusNm: 1299 }),
    });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledWith(null, expect.anything(), {
      lat: 50,
      lon: 8,
      radiusNm: 1299,
    });
    stop();
  });

  it('re-reads the view centre on every tick instead of freezing the first', async () => {
    // A centre captured once at mount is the exact error Step 9 warns about:
    // every later request still carries the framing the user had when the
    // page loaded, so the poller prioritises tiles nobody is looking at.
    const onBatch = vi.fn();
    let centre = { lat: 50, lon: 8, radiusNm: 1299 };
    const stop = startAircraftStream({
      onBatch,
      getRefreshState: () => 'active',
      getViewCentre: () => centre,
    });
    await flushMicrotasks();
    centre = { lat: -33, lon: 151, radiusNm: 2400 };
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenLastCalledWith(null, expect.anything(), {
      lat: -33,
      lon: 151,
      radiusNm: 2400,
    });
    stop();
  });

  it('forwards the stale flag the server set, rather than a constant', async () => {
    // Four layers carry this word and none of them may drop it. The shared
    // fixture is stale: false, so asserting false alone cannot tell
    // "forwarded" from "hard-coded false" - this case can.
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date(),
      stale: true, capped: false,
      aircraft: [makeAircraftRaw({ icao24: 'a1', lastContact: 0 })],
    });
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(onBatch).toHaveBeenCalledWith(expect.any(Array), expect.any(Date), true, false);
    stop();
  });

  it('stop() cancels future fetches', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    stop();
    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
  });
});
