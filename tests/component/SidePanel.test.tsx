import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidePanel } from '@/ui/SidePanel';
import { useAircraftStore } from '@/state/aircraftStore';
import { usePanelStore } from '@/state/panelStore';
import { useSelectionStore } from '@/state/selectionStore';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao, callsign: 'BAW274' }), trail: [], ...over };
}

describe('SidePanel — never an empty box', () => {
  beforeEach(() => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1')]]) });
    usePanelStore.setState({ mode: 'flight' });
    useSelectionStore.setState({ selectedIcao: null });
  });
  afterEach(cleanup);

  it('shows the flight while the feed still carries it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    expect(screen.getByText('BAW274')).toBeInTheDocument();
  });

  it('gives the sky back when the card is dismissed, not just the card', () => {
    // The ✕ called the panel's close() alone: mode went to 'closed',
    // selectedIcao stayed set, readVisibilityRule went on granting focus.
    // The globe kept showing 1 aircraft of 5 900 and the only words about
    // it had just been dismissed — the whole family of defects in one
    // click (D15). Decision D14 had even leant on the opposite: "the
    // focused flight's card is on screen".
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('says contact was lost when the aircraft leaves the payload', () => {
    // The server prunes the fleet every cycle, so this arrives by waiting.
    // Before this branch the panel fell through every condition and
    // rendered nothing at all — no card, no toggle — beside a globe that
    // had just refilled itself, with not a word about what happened. That
    // is the v1 failure in miniature: the picture changes, nobody explains.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    render(<SidePanel />);
    expect(screen.getByText(/contact lost/i)).toBeInTheDocument();
    // The record is gone, so the callsign is gone with it. The ICAO24 is
    // the one identifier we still hold, and nothing is reconstructed.
    expect(screen.getByText('A1')).toBeInTheDocument();
  });

  it('gives that card a way out that leaves nothing behind it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    render(<SidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('falls back to the toggle if it is ever asked to show no flight at all', () => {
    // Belt and braces for D13: whatever clears the selection without
    // closing the panel, the user is still left with a control to touch.
    render(<SidePanel />);
    expect(
      screen.getByRole('button', { name: /open aircraft list/i })
    ).toBeInTheDocument();
  });

  it('says the position is unknown when the fleet carries the flight but not its place', () => {
    // The other half of D13. latitude is null whenever the provider sent
    // no position — the adapters write null on purpose
    // (src/data/sources/adsbLol.ts:30-31) — and AircraftList offers every
    // aircraft that has a callsign, position or not. readVisibilityRule
    // refuses focus to it, so the globe does not change at all: without
    // this line the user has chosen a flight, watched nothing happen, and
    // has nowhere to read why.
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { latitude: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    expect(screen.getByText('BAW274')).toBeInTheDocument(); // the card is there
    expect(screen.getByText(/position unknown/i)).toBeInTheDocument();
  });

  it('says it for a missing longitude too, and not for a flight it can place', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { longitude: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const shown = render(<SidePanel />);
    expect(screen.getByText(/position unknown/i)).toBeInTheDocument();
    shown.unmount();

    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1')]]) });
    render(<SidePanel />);
    expect(screen.queryByText(/position unknown/i)).toBeNull();
  });
});
