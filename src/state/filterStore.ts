import { create } from 'zustand';
import type { Aircraft } from '@/types';
import { isCompleteExceptRoute } from '@/data/completeness';

export interface FleetCounts {
  total: number;
  complete: number;
  partial: number;
  /**
   * Of the partial ones, how many are partial ONLY because no route is known.
   * Measured 2026-11-21: routes cover 4.7% of the fleet and technical fields
   * 99%, so this is very nearly the whole grey population — and a panel that
   * says so reads as "still filling" instead of "broken".
   */
  routeOnly: number;
}

interface FilterState {
  showComplete: boolean;
  showPartial: boolean;
  /**
   * Whether the drop-down is down. In the store rather than in the component
   * because the single Esc handler has to read it from outside React.
   */
  panelOpen: boolean;
  toggleComplete: () => void;
  togglePartial: () => void;
  setPanelOpen: (v: boolean) => void;
}

/**
 * Both categories start visible: a visitor who never opens the panel must
 * see the sky the previous version showed them.
 */
export const useFilterStore = create<FilterState>((set) => ({
  showComplete: true,
  showPartial: true,
  panelOpen: false,
  toggleComplete: () => set((s) => ({ showComplete: !s.showComplete })),
  togglePartial: () => set((s) => ({ showPartial: !s.showPartial })),
  setPanelOpen: (v) => set({ panelOpen: v }),
}));

/**
 * One pass over the fleet for every number the panel shows.
 *
 * `complete` is READ from the record, never recomputed: the server decided
 * it in enrich.ts and the globe is painting that same flag. A second
 * authority here could disagree with the colours on screen.
 */
export function countFleet(aircraft: Iterable<Aircraft>): FleetCounts {
  let total = 0;
  let complete = 0;
  let routeOnly = 0;
  for (const ac of aircraft) {
    total += 1;
    if (ac.complete) {
      complete += 1;
      continue;
    }
    if (ac.route === null && isCompleteExceptRoute(ac)) routeOnly += 1;
  }
  return { total, complete, partial: total - complete, routeOnly };
}
