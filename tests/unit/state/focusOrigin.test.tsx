import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AircraftList } from '@/ui/AircraftList';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useSearchStore } from '@/state/searchStore';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function fleet(...callsigns: string[]): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  callsigns.forEach((cs, i) =>
    m.set(`a${i}`, { ...makeAircraftRaw({ icao24: `a${i}`, callsign: cs }), trail: [] })
  );
  return m;
}

describe('a selection says where it came from (D34)', () => {
  beforeEach(() => {
    useAircraftStore.setState({ aircraft: fleet('BAW274', 'AAL1006') });
    useSelectionStore.setState({
      selectedIcao: null,
      openEnd: null,
      focusSightline: 'in-sight',
      focusOrigin: null,
      focusSeq: 0,
    });
    usePanelStore.setState({ mode: 'closed' });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
  });
  afterEach(cleanup);

  it('carries the act that caused it, not a guess made later', () => {
    // Whether the camera travels depends entirely on this. A selection that
    // arrived without saying how would force the render loop to infer it
    // from what else happened to be on screen, and inference is where the
    // defects in this project come from.
    useSelectionStore.getState().select('a0', 'search');
    expect(useSelectionStore.getState().focusOrigin).toBe('search');
    useSelectionStore.getState().select('a1', 'globe');
    expect(useSelectionStore.getState().focusOrigin).toBe('globe');
  });

  it('forgets the origin when the flight is let go', () => {
    // An origin left standing with nothing selected is a claim about an act
    // nobody performed — and the next focus would inherit it.
    useSelectionStore.getState().select('a0', 'list');
    expect(useSelectionStore.getState().focusOrigin).toBe('list');
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().focusOrigin).toBeNull();
  });

  it('counts choosing the same flight twice as two acts', () => {
    // The render loop can only see that a NEW focus happened by this
    // number. Without it, a user who picks a flight from the list, drags
    // the globe away and picks the same row again gets nothing: the icao
    // did not change, so nothing would tell the camera to travel again.
    useSelectionStore.getState().select('a0', 'list');
    const first = useSelectionStore.getState().focusSeq;
    useSelectionStore.getState().select('a0', 'list');
    expect(useSelectionStore.getState().focusSeq).toBe(first + 1);
  });

  it('does not count letting go as an act of focusing', () => {
    useSelectionStore.getState().select('a0', 'search');
    const after = useSelectionStore.getState().focusSeq;
    expect(after).toBe(1);
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().focusSeq).toBe(after);
  });

  it('the search names itself', async () => {
    await useSearchStore.getState().run('BAW274');
    expect(useSelectionStore.getState().selectedIcao).toBe('a0');
    expect(useSelectionStore.getState().focusOrigin).toBe('search');
  });

  it('the list names itself', async () => {
    render(<AircraftList onClose={() => {}} />);
    fireEvent.click(screen.getByText('AAL1006'));
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a1'));
    expect(useSelectionStore.getState().focusOrigin).toBe('list');
  });
});
