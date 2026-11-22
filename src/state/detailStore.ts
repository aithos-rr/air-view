import { create } from 'zustand';

/**
 * Which coastline the globe is actually drawing.
 *
 * Five words and not three. 'coarse' and 'coarse-only' are two different
 * FACTS — "the zoom has not asked for the fine level" and "it was asked for
 * and did not arrive" — and a viewer who cannot tell them apart cannot tell
 * a globe that is working from a globe that is broken. Merging them is the
 * half-truth D15 exists to forbid (D42).
 *
 * 'none' is a hole that predates Plan 4: scene.ts caught loadContinents
 * failing with a console.warn and left the globe with no coasts and not one
 * word about it.
 */
export type CoastlineDetail = 'none' | 'coarse' | 'loading' | 'fine' | 'coarse-only';

/**
 * Whether the city names are there. 'absent' is the honest start: nobody
 * has asked for them yet, which is not the same as having asked and failed.
 * src/data/cityPlaces.ts writes this one (Plan 4 Task 7).
 */
export type CityDetail = 'absent' | 'ready' | 'unavailable';

/**
 * The moves the coastline level may make, and the one that matters.
 *
 * 'fine' is reachable ONLY from 'loading'. 'fine' means the fine level is on
 * screen, and the only road to being on screen is fetched, decoded and
 * built — which is what 'loading' names. Every other way in is refused,
 * because a store that will say 'fine' on request is not a declaration about
 * the screen, it is a second opinion about it (D15, D42). It also makes one
 * particular mistake impossible to write: a fetch that failed leaves
 * 'coarse-only', and a builder that then announces 'fine' is ignored.
 *
 * Refused IN PLACE, never thrown: these setters are called from a fetch
 * handler and from inside the render loop, and an exception in either takes
 * the globe down over a bookkeeping mistake.
 */
const LEGAL: Record<CoastlineDetail, readonly CoastlineDetail[]> = {
  none: ['none', 'coarse'],
  coarse: ['coarse', 'loading'],
  loading: ['loading', 'fine', 'coarse-only'],
  fine: ['fine', 'coarse'],
  'coarse-only': ['coarse-only', 'loading', 'coarse'],
};

export function nextCoastline(from: CoastlineDetail, to: CoastlineDetail): CoastlineDetail {
  return LEGAL[from].includes(to) ? to : from;
}

interface DetailState {
  coastline: CoastlineDetail;
  cities: CityDetail;
  setCoastline: (v: CoastlineDetail) => void;
  setCities: (v: CityDetail) => void;
}

export const useDetailStore = create<DetailState>((set) => ({
  coastline: 'none',
  cities: 'absent',
  setCoastline: (v) => set((s) => ({ coastline: nextCoastline(s.coastline, v) })),
  setCities: (v) => set({ cities: v }),
}));
