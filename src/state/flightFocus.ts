import { useSelectionStore } from './selectionStore';
import { usePanelStore } from './panelStore';

/**
 * Leave the flight: the selection and the card that exists only for it,
 * together — and, from Task 7, the airport card opened from it.
 *
 * Three surfaces end a focus — the card's ✕, Escape, and the search box's
 * clear button — and written three times they drifted. The ✕ called the
 * panel's close() alone: mode became 'closed', selectedIcao stayed set,
 * readVisibilityRule went on granting focus, and the globe went on drawing
 * one aircraft out of 5 900 while the only explanation on screen had just
 * been dismissed. That is the family of defects D15 ends, in its smallest
 * form: the picture shows less than the words claim, and nothing says so.
 *
 * Idempotent, because two surfaces can fire on one gesture.
 */
export function leaveFlight(): void {
  useSelectionStore.getState().select(null);
  // Not a second thing to close: the card exists only for the selected
  // flight, and a panel left in 'flight' mode with nothing selected renders
  // neither the card nor the toggle (D13). The aircraft list is a different
  // matter — it is not about this flight — so it stays as it was.
  if (usePanelStore.getState().mode === 'flight') usePanelStore.getState().close();
}
