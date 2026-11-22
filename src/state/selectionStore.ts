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
  /**
   * The one aircraft on the globe is on the far side of it (D32).
   *
   * Written by the render loop, which is the only thing in the application
   * that has a camera, and only when the answer CHANGES — at most when the
   * subject crosses the limb. It is deliberately a boolean about ONE
   * aircraft and not a count of the far hemisphere: that count would churn
   * four times a second while the globe turns, which is the noise D25
   * refuses to dress up as an explanation.
   *
   * It lives beside selectedIcao because it is meaningless without one,
   * and because changing flight has to clear it: a line saying the flight
   * is behind the planet, left standing over the next flight, would be a
   * claim nobody has measured yet — D15b in one sentence.
   */
  focusBehindGlobe: boolean;
  setFocusBehindGlobe: (v: boolean) => void;
  select: (icao: string | null) => void;
  openAirport: (end: RouteEnd | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIcao: null,
  openEnd: null,
  focusBehindGlobe: false,
  select: (icao) => set({ selectedIcao: icao, openEnd: null, focusBehindGlobe: false }),
  setFocusBehindGlobe: (v) => set({ focusBehindGlobe: v }),
  openAirport: (end) => set({ openEnd: end }),
}));
