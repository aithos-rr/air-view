import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';

const TRAIL_MAX = 30; // maximum trail points kept per aircraft
const STALE_SECONDS = 60; // drop aircraft not seen in this many seconds

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  fetchedAt: number;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  updateBatch: (raws: AircraftRaw[]) => void;
  removeStale: (nowUnix: number) => void;
}

export const useAircraftStore = create<AircraftState>((set) => ({
  aircraft: new Map(),
  fetchedAt: 0,
  fetchStatus: 'idle',

  setFetchStatus: (s) => set({ fetchStatus: s }),

  updateBatch: (raws) =>
    set((state) => {
      const next = new Map(state.aircraft);
      for (const r of raws) {
        const prev = next.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Append previous position to trail before overwriting (if it had coords)
        if (
          prev &&
          prev.longitude !== null &&
          prev.longitude !== undefined &&
          prev.latitude !== null &&
          prev.latitude !== undefined
        ) {
          trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        next.set(r.icao24, { ...r, trail });
      }
      return { aircraft: next, fetchedAt: Date.now() };
    }),

  removeStale: (nowUnix) =>
    set((state) => {
      const next = new Map(state.aircraft);
      for (const [icao, ac] of next) {
        if (nowUnix - ac.lastContact > STALE_SECONDS) {
          next.delete(icao);
        }
      }
      return { aircraft: next };
    }),
}));
