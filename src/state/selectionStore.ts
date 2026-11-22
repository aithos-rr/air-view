import { create } from 'zustand';
import type { RouteEnd } from '@/data/airportInfo';

/**
 * Which act put this flight in focus — the three doors there are.
 *
 * It exists because the camera's behaviour depends entirely on it (D34),
 * and a selection that arrived without saying how would leave the render
 * loop to INFER the answer from whatever else was on screen. Every defect
 * this project has had came from two readers of one truth, one of which was
 * guessing; `select` therefore takes it as a required argument rather than
 * defaulting, so a fourth door cannot be opened without naming itself.
 */
export type FocusOrigin = 'globe' | 'list' | 'search';

/**
 * Where the one aircraft on the globe is, as far as the viewer is
 * concerned — and, when the globe is in the way, whether anything is
 * already being done about it.
 *
 * Three values and not a boolean, because with a camera that travels
 * (D34) "behind the globe" stopped being one state. A flight behind the
 * limb with the camera coming round to it and a flight behind the limb
 * with nothing moving look identical to a dot product and need opposite
 * sentences: the first needs an account of why the screen is empty, the
 * second needs that AND a way out. A boolean made the panel offer the way
 * out in both cases — telling the user to drag a flight into view while
 * the camera was already carrying it there, which reads as nothing
 * happening — and made it blink, true for the first frames of a rotation
 * about to resolve it. See sightlineOf in globe/cameraTurn.ts, which is
 * where the three are told apart, and D15: the line declares the state.
 */
export type FocusSightline =
  /** Not behind the globe. The panel has nothing to add. */
  | 'in-sight'
  /** Behind the globe, and nothing is moving: only a drag will fix it. */
  | 'hidden'
  /** Behind the globe, and the camera is already bringing it round. */
  | 'arriving';

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
   * Whether the one aircraft on the globe is on the far side of it, and
   * whether the camera is already on its way there (D32/D34).
   *
   * Written by the render loop, which is the only thing in the application
   * that has a camera, and only when the answer CHANGES — at most when the
   * subject crosses the limb or a turn begins or ends. It is deliberately
   * about ONE aircraft and not a count of the far hemisphere: that count
   * would churn four times a second while the globe turns, which is the
   * noise D25 refuses to dress up as an explanation.
   *
   * It lives beside selectedIcao because it is meaningless without one,
   * and because changing flight has to clear it: a line saying the flight
   * is behind the planet, left standing over the next flight, would be a
   * claim nobody has measured yet — D15b in one sentence.
   */
  focusSightline: FocusSightline;
  /** How the current focus was reached, or null when nothing is selected. */
  focusOrigin: FocusOrigin | null;
  /**
   * How many times a flight has been put in focus, ever.
   *
   * The render loop has no other way to tell a NEW act of focusing from the
   * same focus still standing. Without it, a user who picks a flight from
   * the list, drags the globe away from it and picks the same row again
   * gets nothing at all: `selectedIcao` never changed, so nothing would say
   * the camera has a second journey to make. Letting go does not count —
   * clearing a selection is not an act of focusing.
   */
  focusSeq: number;
  setFocusSightline: (v: FocusSightline) => void;
  /**
   * Choosing a flight REQUIRES saying which act chose it; letting go takes
   * no origin, because there is none. Two signatures rather than an
   * optional argument: an origin that could be omitted would be an origin
   * someone downstream has to guess (D34).
   */
  select: {
    (icao: null): void;
    (icao: string, from: FocusOrigin): void;
  };
  openAirport: (end: RouteEnd | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIcao: null,
  openEnd: null,
  focusSightline: 'in-sight',
  focusOrigin: null,
  focusSeq: 0,
  select: (icao: string | null, from?: FocusOrigin) =>
    set((s) => ({
      selectedIcao: icao,
      openEnd: null,
      focusSightline: 'in-sight',
      // The signatures above make an omitted origin impossible to write in
      // TypeScript. Should one arrive anyway, it is recorded as null — an
      // unnamed origin never travels, which is the reversible side of the
      // choice: not moving someone's view can be undone by them, moving it
      // cannot.
      focusOrigin: icao === null ? null : from ?? null,
      focusSeq: icao === null ? s.focusSeq : s.focusSeq + 1,
    })),
  setFocusSightline: (v) => set({ focusSightline: v }),
  openAirport: (end) => set({ openEnd: end }),
}));
