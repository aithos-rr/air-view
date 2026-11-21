import { useAircraftStore } from './aircraftStore';
import { useFilterStore } from './filterStore';
import { useSelectionStore } from './selectionStore';
import { isFocusable } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';

/**
 * The stores, read imperatively, for the code that runs outside React.
 *
 * scene.ts already talks to the stores this way — `useSelectionStore
 * .getState().select(icao)` from a DOM click handler — because the render
 * loop runs at 60fps and must not re-render anything. Keeping the reads in
 * one module means the pure rule in globe/visibility.ts stays testable
 * without importing a single store.
 *
 * Focus IS selection: there is no fourth state. The click handler already
 * sets selectedIcao and clearing it on empty space is already the exit.
 */
export function readVisibilityRule(): VisibilityRule {
  const f = useFilterStore.getState();
  const selected = useSelectionStore.getState().selectedIcao;
  // Focus is a claim about something that is ON the globe, so it is granted
  // only to an aircraft the fleet still carries AND that we can place.
  //
  // Both halves are ordinary operation, not hypotheses. The server prunes
  // every cycle and updateBatch replaces the Map wholesale, so the focused
  // aircraft can leave the payload between two frames. And latitude or
  // longitude is null whenever the provider sent no position (the adapters
  // write null rather than invent one — src/data/sources/adsbLol.ts:30-31)
  // while AircraftList offers every aircraft that has a callsign, position
  // or not. In either case keeping the icao here would hide the whole fleet
  // and draw nobody — a completely empty globe, which is the v1 failure in
  // a new costume.
  //
  // The SELECTION is deliberately NOT cleared (D13): leaving the sky as it
  // was without a word is the same failure seen from the other side.
  // SidePanel turns the surviving selection into "Contact lost" or into
  // "Position unknown", and says why.
  const focused =
    selected === null ? null : useAircraftStore.getState().aircraft.get(selected) ?? null;
  const focusedIcao = focused !== null && isFocusable(focused) ? focused.icao24 : null;
  return {
    showComplete: f.showComplete,
    showPartial: f.showPartial,
    focusedIcao,
  };
}
