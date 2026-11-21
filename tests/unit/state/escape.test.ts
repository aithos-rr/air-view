import { describe, it, expect, beforeEach } from 'vitest';
import { handleEscape } from '@/state/escape';
import { useSelectionStore } from '@/state/selectionStore';
import { useFilterStore } from '@/state/filterStore';
import { usePanelStore } from '@/state/panelStore';
import { useSearchStore } from '@/state/searchStore';

describe('the Escape ladder', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    usePanelStore.setState({ mode: 'closed' });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
  });

  it('closes the airport card before leaving focus', () => {
    // The card is inside the focus: Escape walks out of the innermost thing
    // first, or one press would undo two steps of the user's navigation.
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    expect(handleEscape()).toBe(true);
    expect(useSelectionStore.getState().openEnd).toBeNull();
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });

  it('leaves the flight first, and takes its card with it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'flight' });
    expect(handleEscape()).toBe(true);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    // The focus and the card opened for it are ONE act, undone together: a
    // panel still in 'flight' mode with nothing selected renders neither
    // the card nor the toggle — an empty box (D13).
    expect(usePanelStore.getState().mode).toBe('closed');
    // And exactly one act per press: the fleet drop-down has not moved.
    expect(useFilterStore.getState().panelOpen).toBe(true);
  });

  it('closes the fleet drop-down once nothing is focused', () => {
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'list' });
    expect(handleEscape()).toBe(true);
    expect(useFilterStore.getState().panelOpen).toBe(false);
    expect(usePanelStore.getState().mode).toBe('list');
  });

  it('closes the right-hand panel last', () => {
    usePanelStore.setState({ mode: 'list' });
    expect(handleEscape()).toBe(true);
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('says it consumed nothing when there is nothing to close', () => {
    // The return value is what lets AppShell leave preventDefault alone,
    // so a browser-level Escape — leaving full screen, stopping a load —
    // still works on a page where nothing of ours is open.
    expect(handleEscape()).toBe(false);
  });

  it('undoes one act per press, innermost first, then stops', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'flight' });

    expect(handleEscape()).toBe(true); // the flight, and the card it opened
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
    expect(useFilterStore.getState().panelOpen).toBe(true);

    expect(handleEscape()).toBe(true); // the fleet drop-down
    expect(useFilterStore.getState().panelOpen).toBe(false);

    expect(handleEscape()).toBe(false); // nothing of ours is open
  });

  it('clears the search before leaving focus', () => {
    // The search is what put the user in focus; undoing the search undoes
    // the focus with it, and clear() already does exactly that.
    useSearchStore.setState({ query: 'BA274', outcome: { kind: 'focused', callsign: 'BAW274' } });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(handleEscape()).toBe(true);
    expect(useSearchStore.getState().outcome.kind).toBe('idle');
  });
});
