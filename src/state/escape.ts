import { useSelectionStore } from './selectionStore';
import { useFilterStore } from './filterStore';
import { usePanelStore } from './panelStore';
import { leaveFlight } from './flightFocus';
import { useSearchStore } from './searchStore';

/**
 * One Escape, one thing closed, innermost first.
 *
 * Before this, Escape was owned by SidePanel.tsx and closed the right-hand
 * panel. With a fleet drop-down, a focus mode, a search box and an airport
 * card, four independent listeners on the same key would all fire on the
 * same press and undo four things at once — which reads as the application
 * losing its place rather than obeying.
 *
 * The rungs above focus are added by Task 7 (the airport card) and Task 8
 * (the search), each one more specific than what it sits on.
 *
 * @returns true when this consumed the key. AppShell calls preventDefault
 *   only then, so a page with nothing of ours open still lets the browser
 *   handle Escape.
 */
export function handleEscape(): boolean {
  if (useSelectionStore.getState().openEnd !== null) {
    useSelectionStore.getState().openAirport(null);
    return true;
  }
  if (useSearchStore.getState().outcome.kind !== 'idle') {
    useSearchStore.getState().clear();
    return true;
  }
  if (useSelectionStore.getState().selectedIcao !== null) {
    // One press undoes one ACT, and choosing a flight was one act: the
    // selection and the card opened for it go together. Which is exactly
    // why this is leaveFlight() and not two lines written here — the ✕ of
    // the card wrote its own version of this and got it wrong (D15).
    leaveFlight();
    return true;
  }
  if (useFilterStore.getState().panelOpen) {
    useFilterStore.getState().setPanelOpen(false);
    return true;
  }
  if (usePanelStore.getState().mode !== 'closed') {
    usePanelStore.getState().close();
    return true;
  }
  return false;
}
