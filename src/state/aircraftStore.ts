import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';

const TRAIL_MAX = 30;

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  /** Unix seconds of the batch currently held — NOT the local clock. */
  feedFetchedAt: number;
  /**
   * What the SERVER said about the batch currently held: true means it was
   * served from cache past its freshness window. The client shows it rather
   * than acting on it — see the HUD. The v1 outage stayed invisible for 25
   * days because no layer ever said the feed had stopped.
   */
  feedStale: boolean;
  /** The server truncated the world it served, and said so. */
  feedCapped: boolean;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  /** Replaces the fleet with what the server reports, preserving trails. */
  updateBatch: (
    raws: AircraftRaw[],
    batchFetchedAtUnix: number,
    stale: boolean,
    capped?: boolean
  ) => void;
  feedAgeSeconds: () => number;
}

export const useAircraftStore = create<AircraftState>((set, get) => ({
  aircraft: new Map(),
  feedFetchedAt: 0,
  feedStale: false,
  feedCapped: false,
  fetchStatus: 'idle',

  setFetchStatus: (s) => set({ fetchStatus: s }),

  /**
   * The payload IS the world: the server assembles it from tiles and prunes
   * it on its own schedule. The client mirrors that instead of applying a
   * second, independent staleness rule.
   *
   * v1 compared lastContact against the LOCAL clock, so a frozen feed made
   * every aircraft look infinitely stale and the whole fleet was deleted —
   * the last link in the chain that emptied the globe. Measuring against the
   * batch timestamp would have been better but still wrong here: a full
   * sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling of one
   * tile every 1.5 s and the server sizes its own retention on that observed
   * period, so any short client window would delete most of a legitimately
   * assembled fleet.
   */
  // `stale` has NO default on purpose: a missing argument used to quietly
  // clear a stale flag that was already raised. An unknown freshness is not
  // freshness, the same rule this project applies to routes and timestamps.
  updateBatch: (raws, batchFetchedAtUnix, stale, capped = false) =>
    set((state) => {
      const next = new Map<string, Aircraft>();
      for (const r of raws) {
        const prev = state.aircraft.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Only real received positions enter the trail — never computed ones.
        if (prev && prev.longitude !== null && prev.latitude !== null && prev.lastContact !== r.lastContact) {
          // lastContact is null when the provider did not say how stale the fix
          // is, and the comparison above does not rule that out: both sides are
          // nullable. A point we cannot timestamp cannot be ordered in the trail.
          if (prev.lastContact !== null) {
            trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          }
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        next.set(r.icao24, { ...r, trail });
      }
      // Aircraft absent from the payload are gone: the server already pruned.
      return { aircraft: next, feedFetchedAt: batchFetchedAtUnix, feedStale: stale, feedCapped: capped };
    }),

  feedAgeSeconds: () => {
    const at = get().feedFetchedAt;
    if (at === 0) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000) - at);
  },
}));
