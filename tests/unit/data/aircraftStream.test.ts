import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAircraftStream } from '@/data/aircraftStream';
import * as client from '@/data/openSkyClient';

// Helper: drain microtasks without firing scheduled timers
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('startAircraftStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date(),
      aircraft: [
        {
          icao24: 'a1',
          callsign: 'BAW274',
          longitude: -10,
          latitude: 50,
          baroAltitudeFt: 38000,
          velocityKt: 473,
          headingDeg: 265,
          onGround: false,
          lastContact: 0,
        },
      ],
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
      expect.arrayContaining([expect.objectContaining({ icao24: 'a1' })])
    );
    stop();
  });

  it('schedules next fetch at 15s when state is active', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(2);
    stop();
  });

  it('schedules next fetch at 60s when state is background', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'background' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_999);
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
    expect(client.fetchStates).toHaveBeenCalledWith(bbox);
    stop();
  });

  it('passes null bbox when getBoundingBox is omitted', async () => {
    const onBatch = vi.fn();
    const stop = startAircraftStream({ onBatch, getRefreshState: () => 'active' });
    await flushMicrotasks();
    expect(client.fetchStates).toHaveBeenCalledWith(null);
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
