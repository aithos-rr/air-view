import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FleetPanel } from '@/ui/FleetPanel';
import { useAircraftStore } from '@/state/aircraftStore';
import { useFilterStore } from '@/state/filterStore';
import { useSelectionStore } from '@/state/selectionStore';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const ROUTE = {
  originIata: 'JFK',
  originName: 'John F Kennedy International Airport',
  destinationIata: 'MIA',
  destinationName: 'Miami International Airport',
  airlineName: 'American Airlines',
};

/**
 * A fleet shaped like the real one, measured 2026-11-21: 3,5% complete.
 * 200 complete and 5 700 partial is the panel the user will actually meet
 * for days, and a panel designed on an even split would be designed for a
 * sky that does not exist.
 */
function fleet(complete: number, partial: number, routeOnly = partial): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  for (let i = 0; i < complete; i++) {
    m.set(`c${i}`, {
      ...makeAircraftRaw({ icao24: `c${i}`, route: ROUTE, complete: true }),
      trail: [],
    });
  }
  for (let i = 0; i < partial; i++) {
    // Past routeOnly the aircraft is also missing a technical field, so it
    // does not count as "lacks only a route".
    const over = i < routeOnly ? {} : { registration: null };
    m.set(`p${i}`, {
      ...makeAircraftRaw({ icao24: `p${i}`, route: null, complete: false, ...over }),
      trail: [],
    });
  }
  return m;
}

describe('FleetPanel', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: fleet(200, 5_700),
      feedFetchedAt: Math.floor(Date.now() / 1000),
      feedStale: false,
      feedCapped: false,
      fetchStatus: 'idle',
    });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    // The panel's count comes from readVisibilityRule, which reads the
    // selection: a leftover selection from another test would be a focus.
    useSelectionStore.setState({ selectedIcao: null });
  });
  afterEach(cleanup);

  it('shows the total on the closed row', () => {
    // The separator is whatever toLocaleString() produces on the machine
    // running the suite — a comma here, a full stop on an Italian locale.
    // Asserting one of them would make the suite fail by geography.
    render(<FleetPanel />);
    expect(screen.getByRole('button', { name: /5[.,]900 aircraft/i })).toBeInTheDocument();
  });

  it('starts shut, with no filter controls on screen', () => {
    render(<FleetPanel />);
    expect(screen.getByRole('button', { name: /aircraft/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('opens on click and gives each category its own count', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(screen.getByRole('checkbox', { name: /full route/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /partial data/i })).toBeInTheDocument();
    expect(screen.getByTestId('count-complete')).toHaveTextContent(/^200$/);
    expect(screen.getByTestId('count-partial')).toHaveTextContent(/^5[.,]700$/);
  });

  it('keeps the two counts adding up to the total — the panel verifies itself', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    const digits = (id: string): number =>
      Number(screen.getByTestId(id).textContent?.replace(/[^0-9]/g, ''));
    const complete = digits('count-complete');
    const partial = digits('count-partial');
    const total = digits('count-total');
    expect(complete + partial).toBe(total);
  });

  it('switches the two categories INDEPENDENTLY', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /partial data/i }));
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(true);
    expect(screen.getByRole('checkbox', { name: /full route/i })).toBeChecked();
  });

  it('declares how many aircraft the filter is hiding', () => {
    // At 3,5% complete, switching the greys off removes 5 700 of 5 900. An
    // almost empty globe with no explanation is indistinguishable from the
    // v1 outage, and this application has already paid for that confusion
    // once.
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /partial data/i }));
    expect(screen.getByText(/5[.,]700 hidden by filters/i)).toBeInTheDocument();
  });

  it('says so when both filters are off instead of leaving an unexplained void', () => {
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: true });
    render(<FleetPanel />);
    expect(screen.getByText(/both filters are off/i)).toBeInTheDocument();
  });

  it('explains why so few are complete: they lack only a route', () => {
    // Technical fields cover 99% of the fleet, routes 4,7%. Saying how many
    // greys are grey for that one reason turns "broken" into "still filling".
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(
      screen.getByText(/5[.,]700 of the partial ones lack only a route/i)
    ).toBeInTheDocument();
  });

  it('does not claim a route-only shortfall that is not there', () => {
    useAircraftStore.setState({ aircraft: fleet(200, 5_700, 0) });
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(screen.queryByText(/lack only a route/i)).toBeNull();
  });

  it('KEEPS the hidden-by-filters line on screen once the drawer is shut', () => {
    // The drawer closes; the filter does not. Inside {open && …} the only
    // words explaining a near-empty globe were folded away by the same
    // click that put them there — and by Esc, the key a user presses to
    // close things, which took the explanation away at exactly the moment
    // they were trying to understand what had happened (D14).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull(); // the drawer really is shut
    expect(screen.getByText(/5[.,]700 hidden by filters/i)).toBeInTheDocument();
  });

  it('stops the shut row claiming aircraft the filter is hiding', () => {
    // "5 900 aircraft" over a globe carrying 200 is a number that is true
    // about the fleet and false about the screen. It says both (D14).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(
      screen.getByRole('button', { name: /200 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
  });

  it('says the globe was emptied on purpose even with the drawer shut', () => {
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/both filters are off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /0 of 5[.,]900 aircraft/i })).toBeInTheDocument();
  });

  it('keeps the feed warnings beside the counter', () => {
    // The stale flag crossed four layers in Piano 1 to reach the screen.
    // A panel that replaces the HUD and drops it would undo all of it.
    useAircraftStore.setState({ feedStale: true });
    render(<FleetPanel />);
    expect(screen.getByText(/feed stale/i)).toBeInTheDocument();
  });

  it('counts the one flight a focus leaves, and names what the focus took', () => {
    // D14 exempted focus on the grounds that "the focused flight's card is
    // on screen". The card has a ✕: one click and the globe is still
    // showing 1 aircraft of 5 900 with nothing on screen saying so. That
    // is how the tenth defect of this family was born (D15).
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(
      screen.getByRole('button', { name: /1 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/5[.,]899 hidden while one flight is in focus/i)
    ).toBeInTheDocument();
  });

  it('never calls the globe empty while a focused flight is on it', () => {
    // Both switches off AND a flight in focus. The old arithmetic —
    // (showComplete ? complete : 0) + (showPartial ? partial : 0) — gave 0
    // and printed "No aircraft shown" over a globe drawing one. It is a row
    // of the state table, and it was a real defect before there was a table.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/both filters are off/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: /1 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
  });

  it('promises only what leaving the focus would actually give back', () => {
    // Both switches off AND a flight in focus — row 8 of the state table.
    // "Esc shows them again" was printed unconditionally, and here it was
    // a promise the next frame breaks: Esc ends the focus, the filters are
    // still off, and the globe goes from one aircraft to none. D15b is
    // about causes nobody measured; a promise nobody measured is the same
    // sentence pointing forwards.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.getByText(/so Esc brings none of them back/i)).toBeInTheDocument();
    expect(screen.queryByText(/Esc shows them again/i)).toBeNull();
  });

  it('still offers Esc when Esc really does give the sky back', () => {
    // The typical case has to keep its short sentence: a line that hedges
    // when there is nothing to hedge about teaches the reader to skip it.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(screen.getByText(/Esc shows them again/i)).toBeInTheDocument();
  });

  it('declares the records that are in the feed but nowhere on the globe', () => {
    // latitude is null whenever the provider sent no position, and the
    // adapters write null rather than invent one. Such a record is inside
    // aircraft.size and has never been a dot. D14 put this off "for want of
    // a measurement"; the walk of D15 measures it in the same pass.
    const m = fleet(200, 5_700);
    m.set('x1', { ...makeAircraftRaw({ icao24: 'x1', latitude: null }), trail: [] });
    useAircraftStore.setState({ aircraft: m });
    render(<FleetPanel />);
    expect(screen.getByText(/1 without a position/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /5[.,]900 of 5[.,]901 aircraft/i })
    ).toBeInTheDocument();
  });

  it('KEEPS the focus explanation on screen with the drawer shut', () => {
    // Same reason as the filter line, and the same key: the drawer closes,
    // the focus does not, and Esc is what closes the drawer (D14).
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/hidden while one flight is in focus/i)).toBeInTheDocument();
  });

  it('speaks the shortfall as well as showing it', () => {
    // Before this the only thing announced was the feed total, which does
    // not move when a filter empties the globe: someone who cannot see the
    // picture heard "5 900 aircraft" over a sky holding 200, with the two
    // lines that explain it sitting silently in the page (D15a).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    const { container } = render(<FleetPanel />);
    const live = container.querySelector('.fleet__notes[role="status"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toMatch(/200 of 5[.,]900 aircraft shown/i);
    expect(live?.textContent).toMatch(/5[.,]700 hidden by filters/i);
  });

  it('keeps that live region on the page while nothing is hidden, so it can speak later', () => {
    // A live region inserted at the same instant as its text is announced
    // unreliably: it has to already be there when the news arrives.
    const { container } = render(<FleetPanel />);
    expect(container.querySelector('.fleet__notes[role="status"]')).not.toBeNull();
    expect(container.querySelector('.fleet__notes')?.textContent).toBe('');
    // Empty of NODES, not merely of text. The notes now carry their own
    // plate — styles.css .fleet__notes:not(:empty) — so that they stay
    // legible wherever the globe has turned to; a child that renders
    // nothing would put an empty box under the counter, explaining
    // nothing, in the state a visitor who touched nothing sees.
    expect(container.querySelector('.fleet__notes')?.childNodes.length).toBe(0);
  });

  it('leaves exactly ONE element carrying the .hud class', () => {
    // This panel IS the .hud box and FeedStatus renders inside it. If both
    // kept the class there would be two nested nodes with it, each
    // position: fixed at the same 32px corner, and page.locator('.hud') in
    // tests/e2e/happy-path.spec.ts:6 would resolve to two elements —
    // a strict-mode violation in Playwright, not a pick-the-first. Cheaper
    // to catch here than in a browser run that is not in this task's gate.
    const { container } = render(<FleetPanel />);
    expect(container.querySelectorAll('.hud')).toHaveLength(1);
    // ...and the live region is still inside it, warnings and all.
    expect(container.querySelector('.hud [role="status"]')).not.toBeNull();
  });
});
