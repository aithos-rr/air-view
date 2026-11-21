import type { AircraftRaw, BoundingBox, RefreshState } from '@/types';
import { fetchStates } from './statesClient';
import type { ViewQuery } from './statesClient';

// v1 final: global feed (no bbox) returns ~2 MB per fetch. Doubled the
// adaptive intervals so we stay well inside OpenSky's daily credit budget
// (~4 000 fetches/day with the registered tier) and avoid hammering the
// browser with a 2 MB JSON parse every few seconds.
//   active:     30 s — user is interacting, prioritise freshness
//   idle:       60 s — no recent interaction, slow down (dev default)
//   background: 120 s — tab hidden, minimal pulse (prod with hidden tabs)
const REFRESH_INTERVALS: Record<RefreshState, number> = {
  active: 30_000,
  idle: 60_000,
  background: 120_000,
};

export interface StreamOptions {
  /**
   * @param fetchedAt when the SERVER assembled this batch.
   * @param stale what the server said about its own payload: true when it
   *   served a cached body past its freshness window. Passed on rather than
   *   acted on — the client declares, it does not empty the globe.
   */
  onBatch: (
    aircraft: AircraftRaw[],
    fetchedAt: Date,
    stale: boolean,
    capped: boolean
  ) => void;
  onError?: (error: Error) => void;
  getRefreshState: () => RefreshState;
  /**
   * Returns the geographic bounding box to filter aircraft by. Returning
   * null means "no filter" (the whole world — ~14k aircraft). v1 uses a
   * static Europe bbox; v2 will compute it from camera position.
   */
  getBoundingBox?: () => BoundingBox | null;
  /** Where the viewer is looking, so the server can refresh those tiles first. */
  getViewCentre?: () => ViewQuery | null;
}

/**
 * Ceiling on one request to our own server, which answers from memory.
 *
 * Shorter than the fastest refresh interval, so a slow request is abandoned
 * rather than allowed to overlap the next one.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** `undefined` where AbortSignal.timeout is missing: a cap is a bonus, not a dependency. */
function requestTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

/**
 * Rejects if the request has not settled in time, whatever the client does.
 *
 * The abort signal above is the polite way to end a hung request, but it only
 * works if whoever performs the fetch honours it. This deadline is the loop's
 * OWN guarantee: it depends on nothing but a timer, so the refresh keeps
 * running even against a transport that ignores abort entirely.
 */
function withDeadline<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Air View proxy: no answer in ${REQUEST_TIMEOUT_MS / 1000}s`)),
      REQUEST_TIMEOUT_MS
    );
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export function startAircraftStream(opts: StreamOptions): () => void {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const bbox = opts.getBoundingBox?.() ?? null;
      // A request that never answers is the one shape of dead feed Task 7 did
      // not cover: a proxy holding the connection open, a VPN dropping, a
      // laptop waking up. fetch has no timeout of its own, so without this the
      // promise simply never settles.
      const result = await withDeadline(
        fetchStates(bbox, requestTimeoutSignal(), opts.getViewCentre?.() ?? null)
      );
      if (stopped) return;
      opts.onBatch(result.aircraft, result.fetchedAt, result.stale, result.capped);
    } catch (e) {
      if (!stopped && opts.onError) opts.onError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      // In `finally`, not after the try: the reschedule used to sit below the
      // await, so a hung request killed the refresh loop outright — no retry,
      // no onError, no pending timer, and fetchStatus stuck on 'fetching',
      // which the HUD has no branch for. Frozen aircraft and no explanation is
      // precisely the v1 outage this task exists to make impossible.
      if (!stopped) {
        const interval = REFRESH_INTERVALS[opts.getRefreshState()];
        timerId = setTimeout(() => {
          void tick();
        }, interval);
      }
    }
  }

  void tick();

  return () => {
    stopped = true;
    if (timerId !== null) clearTimeout(timerId);
  };
}
