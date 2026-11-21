import { describe, it, expect, beforeEach } from 'vitest';
import { leaveFlight } from '@/state/flightFocus';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useFilterStore } from '@/state/filterStore';

describe('leaveFlight — one act, one function', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    usePanelStore.setState({ mode: 'closed' });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
  });

  it('releases the flight AND the card that exists only for it', () => {
    // Written apart, these two drifted. The card's ✕ called the panel's
    // close() alone — set({ mode: 'closed' }), nothing about the selection
    // — so readVisibilityRule went on granting focus, the globe went on
    // drawing 1 aircraft of 5 900, and the only words explaining that had
    // just been dismissed with the card (D15).
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: null });
    usePanelStore.setState({ mode: 'flight' });
    leaveFlight();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('leaves the aircraft list open, because the list is not the flight', () => {
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: null });
    usePanelStore.setState({ mode: 'list' });
    leaveFlight();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('list');
  });

  it('does not touch the fleet drawer, and a second call changes nothing', () => {
    // Idempotent on purpose: three surfaces call this, and two of them can
    // fire on the same gesture.
    useFilterStore.setState({ panelOpen: true });
    leaveFlight();
    leaveFlight();
    expect(useFilterStore.getState().panelOpen).toBe(true);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('takes the airport card with the flight it was opened from', () => {
    // The airport card is reached only THROUGH a focused flight, so a
    // selection left behind would reopen a card the user never asked for
    // the next time they click an aircraft. One act, one function (D15).
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    usePanelStore.setState({ mode: 'flight' });
    leaveFlight();
    expect(useSelectionStore.getState().openEnd).toBeNull();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });
});
