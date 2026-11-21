import { loadAirlinesFromBundle } from './airlineLookup';
import { loadAirportsFromBundle } from './airportLookup';
import { startAircraftStream } from './aircraftStream';
import { resolveFlight } from './resolveFlight';
import { useAircraftStore } from '@/state/aircraftStore';
import type { ViewQuery } from './statesClient';
import type { Aircraft, RefreshState } from '@/types';

// v1 final: fetch the global feed (~14 000 aircraft, 2 MB per fetch).
// The renderer is now buffer-pool optimized and can handle the full count.
// v2 will introduce camera-driven bbox so only the visible region is fetched.

let stopStream: (() => void) | null = null;
let lastInteraction = 0;

function onUserActivity(): void {
  lastInteraction = Date.now();
}

function getRefreshState(): RefreshState {
  if (typeof document !== 'undefined' && document.hidden) return 'background';
  if (Date.now() - lastInteraction < 30_000) return 'active';
  return 'idle';
}

export async function bootstrapData(getViewCentre?: () => ViewQuery | null): Promise<void> {
  // Load static lookups in parallel (failures don't block — the UI just shows
  // less metadata)
  await Promise.allSettled([
    loadAirlinesFromBundle(),
    loadAirportsFromBundle(),
  ]);

  lastInteraction = Date.now();
  window.addEventListener('pointermove', onUserActivity);
  window.addEventListener('keydown', onUserActivity);

  const store = useAircraftStore.getState();
  store.setFetchStatus('fetching');

  stopStream = startAircraftStream({
    getRefreshState,
    getViewCentre,
    // No getBoundingBox in v1 → server returns the global feed.
    // v2: pass a function that returns the camera-derived bbox.
    onBatch: (raws, fetchedAt, stale, capped) => {
      const batchUnix = Math.floor(fetchedAt.getTime() / 1000);
      const enriched: Aircraft[] = raws.map((r) => {
        const resolved = resolveFlight(r);
        const ac: Aircraft = { ...r, trail: [] };
        if (resolved) ac.resolved = resolved;
        return ac;
      });
      // The server says whether what it just served is stale; carrying that
      // word to the store is what lets the HUD say it out loud instead of
      // drawing old positions as if they were current.
      useAircraftStore.getState().updateBatch(enriched, batchUnix, stale, capped);
      useAircraftStore.getState().setFetchStatus('idle');
    },
    onError: (e) => {
      useAircraftStore.getState().setFetchStatus('error');
      console.warn('Stream error:', e.message);
    },
  });
}

export function teardownData(): void {
  if (stopStream) {
    stopStream();
    stopStream = null;
  }
  window.removeEventListener('pointermove', onUserActivity);
  window.removeEventListener('keydown', onUserActivity);
}
