import { create } from 'zustand';
import type { RouteEnd } from '@/data/airportInfo';

interface SelectionState {
  selectedIcao: string | null;
  /**
   * Which D/A marker has its card open, if any. It lives beside the
   * selection because it is meaningless without one, and because changing
   * flight has to close it: a card for LHR left floating over the next
   * flight's route would be labelled with an airport that flight never
   * touches.
   */
  openEnd: RouteEnd | null;
  select: (icao: string | null) => void;
  openAirport: (end: RouteEnd | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIcao: null,
  openEnd: null,
  select: (icao) => set({ selectedIcao: icao, openEnd: null }),
  openAirport: (end) => set({ openEnd: end }),
}));
