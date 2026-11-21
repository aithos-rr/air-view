import { describe, it, expect, beforeEach } from 'vitest';
import { readVisibilityRule } from '@/state/sceneView';
import { useAircraftStore } from '@/state/aircraftStore';
import { useFilterStore } from '@/state/filterStore';
import { useSelectionStore } from '@/state/selectionStore';
import { isAircraftVisible } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao }), trail: [], ...over };
}

describe('readVisibilityRule', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: new Map([
        ['a1', ac('a1')],
        ['a2', ac('a2')],
      ]),
    });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  it('reports no focus when nothing is selected', () => {
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('focuses the selected aircraft while the fleet still carries it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBe('a1');
  });

  it('drops the focus when the payload stops carrying that aircraft', () => {
    // The server prunes the fleet every cycle and updateBatch replaces the
    // Map wholesale, so this is ordinary operation, not a thought
    // experiment. Left alone, isAircraftVisible matches NOBODY and the
    // globe goes completely empty — the v1 failure, reachable by waiting.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map([['a2', ac('a2')]]) });
    const rule = readVisibilityRule();
    expect(rule.focusedIcao).toBeNull();
    expect(isAircraftVisible(ac('a2'), rule)).toBe(true);
  });

  it('keeps the selection itself, so the panel can say what happened', () => {
    // Clearing it here would refill the globe with no word of explanation,
    // which is the same failure read from the other side. D13: the focus
    // ends, the selection stays, SidePanel declares it.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    readVisibilityRule();
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });

  it('refuses focus to an aircraft the fleet carries but cannot PLACE', () => {
    // latitude is null whenever the provider sent no position
    // (src/data/sources/adsbLol.ts:30-31, asserted in
    // tests/unit/data/sources/adsbLol.test.ts), and AircraftList offers
    // every aircraft with a callsign, position or not. The renderer drops
    // such a record before it looks at the selection, so a focus on it
    // would hide the entire fleet to draw NOBODY: an empty globe, with
    // nothing on screen to explain it (D13).
    useAircraftStore.setState({
      aircraft: new Map([
        ['a1', ac('a1', { latitude: null })],
        ['a2', ac('a2')],
      ]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const rule = readVisibilityRule();
    expect(rule.focusedIcao).toBeNull();
    expect(isAircraftVisible(ac('a2'), rule)).toBe(true);
    // ...and the selection survives, so SidePanel can say why the globe
    // did not change when the user chose that flight.
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });

  it('refuses it for a missing longitude too', () => {
    useAircraftStore.setState({
      aircraft: new Map([['a1', ac('a1', { longitude: null })]]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('refuses it when both coordinates are missing', () => {
    useAircraftStore.setState({
      aircraft: new Map([['a1', ac('a1', { latitude: null, longitude: null })]]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('passes the two category switches through untouched', () => {
    useFilterStore.setState({ showComplete: false, showPartial: true });
    const rule = readVisibilityRule();
    expect(rule.showComplete).toBe(false);
    expect(rule.showPartial).toBe(true);
  });
});
