import type { AircraftRaw, RefreshState } from '@/types';
import type { BoundingBox } from './openSkyAuth';
import { fetchStates } from './openSkyClient';

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
  onBatch: (aircraft: AircraftRaw[]) => void;
  onError?: (error: Error) => void;
  getRefreshState: () => RefreshState;
  /**
   * Returns the geographic bounding box to filter aircraft by. Returning
   * null means "no filter" (the whole world — ~14k aircraft). v1 uses a
   * static Europe bbox; v2 will compute it from camera position.
   */
  getBoundingBox?: () => BoundingBox | null;
}

export function startAircraftStream(opts: StreamOptions): () => void {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const bbox = opts.getBoundingBox?.() ?? null;
      const result = await fetchStates(bbox);
      if (stopped) return;
      opts.onBatch(result.aircraft);
    } catch (e) {
      if (!stopped && opts.onError) opts.onError(e instanceof Error ? e : new Error(String(e)));
    }
    if (stopped) return;
    const interval = REFRESH_INTERVALS[opts.getRefreshState()];
    timerId = setTimeout(() => {
      void tick();
    }, interval);
  }

  void tick();

  return () => {
    stopped = true;
    if (timerId !== null) clearTimeout(timerId);
  };
}
