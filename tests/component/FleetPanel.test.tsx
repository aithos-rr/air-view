import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { FleetPanel } from '@/ui/FleetPanel';
import { useAircraftStore } from '@/state/aircraftStore';
import { useFilterStore } from '@/state/filterStore';
import { useSelectionStore } from '@/state/selectionStore';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';
import { DR_CAP_S, deriveMotion } from '@/globe/deadReckoning';

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

/**
 * A fleet as the store builds it: every record carries its own `motion`.
 *
 * Outside both describes because both need it — the first reads the
 * sentences with the clock standing still, the second reads them again
 * while it walks. `prefix` keeps the keys apart when a fleet is two groups
 * of different ages.
 */
function withMotion(
  n: number,
  over: Partial<Parameters<typeof makeAircraftRaw>[0]> = {},
  prefix = 'm'
): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  for (let i = 0; i < n; i++) {
    const raw = makeAircraftRaw({
      icao24: `${prefix}${i}`, latitude: 50, longitude: -10, velocityKt: 450,
      headingDeg: 90, lastContact: 1_000, ...over,
    });
    m.set(raw.icao24, { ...raw, trail: [], motion: deriveMotion(raw, 1_000) });
  }
  return m;
}

describe('FleetPanel — the globe moves some of them and remembers the rest', () => {
  // The first describe's beforeEach does not reach here, and these tests
  // read both switches and the selection: without this they would depend on
  // whatever the last test above them happened to leave standing.
  beforeEach(() => {
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  it('says how many are moving and how many are where they were last seen', () => {
    const fleet = withMotion(3);
    for (const [k, v] of withMotion(2, { lastContact: 1_000 - DR_CAP_S - 10 }, 's')) {
      fleet.set(k, v);
    }
    useAircraftStore.setState({ aircraft: fleet, feedFetchedAt: 1_000, feedStale: false });
    render(<FleetPanel />);
    expect(screen.getByText(/3 moving on their last reported track/i)).toBeInTheDocument();
    expect(screen.getByText(/2 shown where last seen — no contact for over 2 min/i)).toBeInTheDocument();
  });

  it('keeps a missing heading apart from an old contact', () => {
    // Two absences, two sentences. Merging them is the half-truth D15b
    // forbids, and the two have different remedies: one is the feed
    // catching up, the other never will (D18).
    useAircraftStore.setState({
      aircraft: withMotion(2, { headingDeg: null }),
      feedFetchedAt: 1_000,
      feedStale: false,
    });
    render(<FleetPanel />);
    expect(
      screen.getByText(/2 shown where last seen — no heading or speed reported/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/no contact for over/i)).not.toBeInTheDocument();
  });

  it('blames the stopped feed rather than each aircraft when the server says so', () => {
    // The contradiction this plan had on one screen: the HUD saying "feed
    // stale · last known positions" while the dots glided on. Now the feed
    // flag stops the reckoning, and the line names the cause that is
    // actually in force — these aircraft were heard from seconds ago; what
    // is old is the body we are holding (D31).
    useAircraftStore.setState({
      aircraft: withMotion(3),
      feedFetchedAt: 1_000,
      feedStale: true,
    });
    render(<FleetPanel />);
    expect(screen.getByText(/3 shown where last seen — the feed has stopped/i)).toBeInTheDocument();
    expect(screen.queryByText(/moving on their last reported track/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no contact for over/i)).not.toBeInTheDocument();
  });

  it('says nothing about motion when every aircraft is moving', () => {
    // A line that is always on screen is furniture, and furniture is not
    // read. These appear only when there is something to say.
    useAircraftStore.setState({ aircraft: withMotion(4), feedFetchedAt: 1_000, feedStale: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();
  });

  it('keeps the motion lines out of the live region', () => {
    // They change every 30 s with the feed, and a polite live region would
    // announce them twice a minute for ever. D15a asks for the declaration
    // to be ON SCREEN without opening anything, not for it to be spoken.
    useAircraftStore.setState({
      aircraft: withMotion(2, { headingDeg: null }),
      feedFetchedAt: 1_000,
      feedStale: false,
    });
    const { container } = render(<FleetPanel />);
    // The PANEL's own live region, selected the way the suite above
    // already selects it. A bare [aria-live] matches FeedStatus first —
    // it renders before these notes and carries a region of its own —
    // so the assertion would have been about the feed line instead of
    // about the shortfall notes, and would have held whatever this
    // component did with the motion lines.
    const live = container.querySelector('.fleet__notes[role="status"]');
    expect(live?.textContent ?? '').not.toMatch(/shown where last seen/i);
    expect(screen.getByText(/shown where last seen/i)).toBeInTheDocument();
  });
});

describe('FleetPanel — the clock moves even when the feed does not', () => {
  /**
   * The monotonic clock, in the test's hand.
   *
   * Spied and not faked: vi.useFakeTimers() in vitest 2.1 does NOT fake
   * `performance` — its default toFake is setTimeout, clearTimeout,
   * setInterval, clearInterval, setImmediate, clearImmediate and Date
   * (vitest/dist/config.js) — and this panel measures on performance.now(),
   * because Date.now() jumps ~528 ms every ~32 s on this machine (D21).
   * The fake timers are here to fire the interval; the spy decides what
   * that interval reads.
   */
  let clockMs = 0;

  beforeEach(() => {
    clockMs = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    vi.useFakeTimers();
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // The stamp is the one piece of store state only these tests write:
    // left behind, it would measure somebody else's fleet against this
    // file's clock.
    useAircraftStore.setState({ feedStampMs: 0 });
  });

  function putOnGlobe(fleet: Map<string, Aircraft>): void {
    useAircraftStore.setState({
      aircraft: fleet, feedFetchedAt: 1_000, feedStampMs: clockMs, feedStale: false,
    });
  }

  /**
   * Time passes and NOTHING arrives — the case the panel got wrong.
   *
   * Not one dependency of the walk is touched here: same Map, same rule,
   * same selection, same stamp, same flag. This is the 30 s of an ordinary
   * cycle, the 120 s of a backgrounded tab, or for ever if the fetch keeps
   * failing — and all that time the render loop is reading this very clock
   * sixty times a second.
   */
  function tick(seconds: number): void {
    act(() => {
      clockMs += seconds * 1_000;
      vi.advanceTimersByTime(seconds * 1_000);
    });
  }

  it('freezes the same aircraft the globe freezes, with no batch in between', () => {
    // THE defect this describe exists for. The globe ages at 60 fps; the
    // panel's walk was recomputed only when a batch landed. Three dots
    // stopped dead at the ceiling under a line still calling them moving —
    // D15's two readers separated again, one holding a clock and the other
    // holding an instant.
    putOnGlobe(withMotion(3, { lastContact: 1_000 - 60 }));
    render(<FleetPanel />);
    // 60 s old, inside the ceiling: all three are being carried forward,
    // and a panel with nothing to contrast says nothing at all.
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();

    tick(61); // 121 s of age, and not one byte has arrived
    expect(
      screen.getByText(/3 shown where last seen — no contact for over 2 min/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/moving on their last reported track/i)).not.toBeInTheDocument();
  });

  it('moves the split between the two sentences as the clock passes the ceiling', () => {
    // The line is a measurement and not a label: one fleet, two different
    // pictures 25 s apart, and the picture changes on the globe whether or
    // not the sentence follows it.
    const fleet = withMotion(2, { lastContact: 1_000 });
    for (const [k, v] of withMotion(2, { lastContact: 1_000 - 100 }, 'o')) fleet.set(k, v);
    putOnGlobe(fleet);
    render(<FleetPanel />);
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();

    tick(25); // the two 100 s fixes cross 120 s; the fresh pair is 25 s old
    expect(screen.getByText(/2 moving on their last reported track/i)).toBeInTheDocument();
    expect(
      screen.getByText(/2 shown where last seen — no contact for over 2 min/i)
    ).toBeInTheDocument();
  });

  it('stops reading the clock once nothing is left to carry forward', () => {
    // An age only grows, and advanceFor is monotone in it: an aircraft
    // goes from moving to still and never back without a new batch — and a
    // new batch re-renders this panel through its own subscriptions. So
    // `moving === 0` is not a guess, it is the proof that no further
    // reading of the clock can change a word here. Without the stop, a
    // feed that has died leaves the panel walking the whole fleet once a
    // second for ever in a tab nobody is looking at.
    //
    // FeedStatus keeps one interval of its own for the age line, which is
    // why this counts a DIFFERENCE and not a zero.
    putOnGlobe(withMotion(3, { lastContact: 1_000 }));
    render(<FleetPanel />);
    const whileCarrying = vi.getTimerCount();

    tick(DR_CAP_S + 1);
    expect(screen.getByText(/3 shown where last seen/i)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(whileCarrying - 1);
  });

  it('does not turn the live region into the metronome it was kept out of', () => {
    // The motion lines were kept out of the live region because they change
    // with every cycle; a panel that now re-renders every second must not
    // have put anything INTO that region which the clock can touch. It has
    // not, and by construction: every number in there counts what is drawn
    // or why it is not, and `draw` counts a record the same whether it is
    // carried forward or left at its fix. A filter is switched off so the
    // region has real text to be identical to.
    const fleet = withMotion(2, { lastContact: 1_000 });
    for (const [k, v] of withMotion(1, { lastContact: 1_000, complete: true }, 'c')) {
      fleet.set(k, v);
    }
    putOnGlobe(fleet);
    useFilterStore.setState({ showComplete: false, showPartial: true, panelOpen: false });
    const { container } = render(<FleetPanel />);
    // The PANEL's own live region, selected the way the suite above
    // already selects it. A bare [aria-live] matches FeedStatus first —
    // it renders before these notes and carries a region of its own —
    // so the assertion would have been about the feed line instead of
    // about the shortfall notes, and would have held whatever this
    // component did with the motion lines.
    const spoken =
      container.querySelector('.fleet__notes[role="status"]')?.textContent ?? '';
    expect(spoken).toMatch(/1 hidden by filters/i);

    tick(DR_CAP_S + 1);
    expect(
      container.querySelector('.fleet__notes[role="status"]')?.textContent ?? ''
    ).toBe(spoken);
    expect(screen.getByText(/2 shown where last seen/i)).toBeInTheDocument();
  });
});

describe('FleetPanel — the one aircraft on the globe can be behind it (D32)', () => {
  // Both switches on explicitly: this describe is outside the one with the
  // beforeEach above, and a filter left off by another test would empty the
  // globe for a reason that has nothing to do with the camera.
  beforeEach(() => {
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
  });

  function oneInFocus() {
    const raw = makeAircraftRaw({ icao24: 'f1', latitude: 50, longitude: -10 });
    useAircraftStore.setState({
      aircraft: new Map([[raw.icao24, { ...raw, trail: [] }]]),
      feedFetchedAt: 1_000,
      feedStale: false,
      feedCapped: false,
    });
    useSelectionStore.setState({ selectedIcao: 'f1' });
  }

  it('says so when the only aircraft drawn is on the far side', () => {
    // The globe empties with no act of the user at all: it auto-rotates
    // until someone touches the canvas, and focusing a flight from this
    // very panel does not. The cull of D25 then takes the one dot there
    // was, while the row above goes on saying it is shown.
    oneInFocus();
    useSelectionStore.setState({ focusBehindGlobe: true });
    render(<FleetPanel />);
    expect(screen.getByText(/behind the globe — drag to bring it round/i)).toBeInTheDocument();
  });

  it('says nothing while the flight in focus is in view', () => {
    // And this is the assertion that keeps the remedy valid whichever way
    // the open question about the camera is answered: a camera that
    // followed the focused flight would keep the subject on the near side
    // for ever, and this line would simply never appear (D32).
    oneInFocus();
    useSelectionStore.setState({ focusBehindGlobe: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/behind the globe/i)).not.toBeInTheDocument();
  });

  it('never says it about a sky with more than one aircraft in it', () => {
    // For the whole fleet the far hemisphere IS framing, and a line about
    // it would be noise that changes while the globe turns (D25).
    const fleet = new Map<string, Aircraft>();
    for (const id of ['a1', 'a2']) {
      const raw = makeAircraftRaw({ icao24: id, latitude: 50, longitude: -10 });
      fleet.set(id, { ...raw, trail: [] });
    }
    useAircraftStore.setState({
      aircraft: fleet,
      feedFetchedAt: 1_000,
      feedStale: false,
      feedCapped: false,
    });
    useSelectionStore.setState({ selectedIcao: null, focusBehindGlobe: true });
    render(<FleetPanel />);
    expect(screen.queryByText(/behind the globe/i)).not.toBeInTheDocument();
  });
});
