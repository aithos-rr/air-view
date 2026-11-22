import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { FlightSearch } from '@/ui/FlightSearch';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useSearchStore } from '@/state/searchStore';
import { usePanelStore } from '@/state/panelStore';
import { initAirlines } from '@/data/airlineLookup';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const AIRLINES = [
  { icao: 'BAW', iata: 'BA', name: 'British Airways' },
  { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
];

const LAS = {
  iata: 'LAS', icao: 'KLAS', name: 'Harry Reid International Airport',
  city: 'Las Vegas', country: 'US', lat: 36.084, lon: -115.1537,
  timezone: 'America/Los_Angeles',
};

const ROUTE = {
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function fleet(...callsigns: string[]): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  callsigns.forEach((cs, i) =>
    m.set(`a${i}`, { ...makeAircraftRaw({ icao24: `a${i}`, callsign: cs }), trail: [] })
  );
  return m;
}

/**
 * The server's shape, which names WHY it answers what it answers: a route,
 * a measured "we asked and there is none", a "nobody has looked yet", or a
 * lookup that never came back.
 */
function answer(route: unknown, status = route !== null ? 'known' : 'noRoute'): Response {
  return {
    ok: true,
    json: async () => ({ callsign: 'X', status, route }),
  } as unknown as Response;
}

function submit(value: string): void {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
  fireEvent.submit(screen.getByRole('search'));
}

describe('FlightSearch — the five outcomes', () => {
  beforeEach(() => {
    initAirlines(AIRLINES);
    // Empty on purpose: the airport table is module state, and a test that
    // fills it must not decide what the next one sees.
    initAirports([]);
    useAircraftStore.setState({ aircraft: fleet('BAW274', 'AAL1006') });
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
    usePanelStore.setState({ mode: 'closed' });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('1 — a flight in the feed goes into focus', async () => {
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
  });

  it('1 — and opens the flight card, like every other way of selecting', async () => {
    // Focus without the card is a globe emptied around an aircraft the user
    // cannot read: the search appears to do nothing but delete the sky.
    // scene.ts and AircraftList both pair select() with open('flight'); so
    // does this, or tests/e2e/panel-focus-search.spec.ts never finds
    // .panel__callsign after searching a flight that is right there.
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(usePanelStore.getState().mode).toBe('flight'));
  });

  it('1 — the IATA spelling finds the ICAO callsign the feed carries', async () => {
    render(<FlightSearch />);
    submit('BA274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
  });

  it('2 — a flight we know but cannot see draws its route and says why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/outside ADS-B coverage/i)).toBeInTheDocument()
    );
    expect(useSearchStore.getState().outcome.kind).toBe('offCoverage');
  });

  it('2 — and selects no aircraft, because there is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('offCoverage'));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('2 — names the AIRPORT when it is the airport we cannot place', async () => {
    // The line above is about the aircraft. With an endpoint missing from
    // airports.json the globe drew nothing at all while that line went on
    // talking about the aircraft, so the user read "position unavailable"
    // with no way to learn the silence belonged to the airport (D15b).
    // LHR is left out of the table here; 13 real IATA codes are.
    initAirports([LAS]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/LHR position unknown — no arc drawn/i)).toBeInTheDocument()
    );
  });

  it('2 — and says why a route that ends where it began draws no arc', async () => {
    // The same 13 records, reached through the search instead of a click.
    // Both ends are placeable, so the airport clause stayed silent and the
    // line promised a route the globe never drew.
    initAirports([LAS]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      answer({ ...ROUTE, destinationIata: 'LAS', destinationName: 'Harry Reid International Airport' })
    ));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/same airport/i)).toBeInTheDocument());
  });

  it('2 — lets go of a flight still in focus, so the arc it promises is the one drawn', async () => {
    // readFocusView draws the ghost route only while nothing is selected.
    // A flight focused by an earlier click would swallow the arc this
    // outcome promises, and the line would read "position unavailable"
    // over somebody else's route (D15a).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    useSelectionStore.setState({ selectedIcao: 'a0' });
    usePanelStore.setState({ mode: 'flight' });
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('offCoverage'));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('2 — stops naming the route once a selection has taken the arc', async () => {
    // The order `run` cannot fix: the click comes AFTER the search. Nothing
    // clears the outcome when the user selects an aircraft, and
    // readFocusView gives the arc to the selection — so BA999's route left
    // the globe, replaced by the selected flight's or by nothing at all
    // when that flight has no route (95,3% of the fleet), while this line
    // went on announcing it. The words outlived the picture (D15a).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/outside ADS-B coverage/i)).toBeInTheDocument()
    );
    act(() => {
      useSelectionStore.getState().select('a0', 'globe');
    });
    expect(
      screen.getByText(/route not drawn while another flight is selected/i)
    ).toBeInTheDocument();
  });

  it('3 — an unknown flight is said to be unknown, and the globe is left alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('5 — a flight nobody has looked up yet is not a flight that does not exist', async () => {
    // The cache holds ~8 374 callsigns and grows by ~920 an hour, so a real
    // flight number typed into this box is usually one the server has never
    // asked adsbdb about. "No flight by that number" there is a certainty
    // nobody measured — D15b, one step below where the search caught it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null, 'notLookedUpYet')));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/not looked up yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/no flight by that number/i)).toBeNull();
    expect(useSearchStore.getState().outcome.kind).toBe('notChecked');
  });

  it('5 — and says it has been queued, which is the one promise it may make', async () => {
    // The endpoint hands an un-asked callsign to the slow pump, so "try
    // again in a few minutes" is a statement about something that is
    // actually happening, not an apology.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null, 'notLookedUpYet')));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument());
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('4 — a lookup that never got an answer is not a verdict either', async () => {
    // Three transport failures and the resolver gives up for good. Nothing
    // was measured about this flight, and enqueue() refuses to retry it, so
    // neither "no such flight" nor "try again shortly" would be true.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null, 'lookupFailed')));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/could not check/i)).toBeInTheDocument());
    expect(screen.queryByText(/no flight by that number/i)).toBeNull();
  });

  it('4 — a broken server is not a verdict about the flight', async () => {
    // The purest member of the family: `if (!res.ok) return null` plus
    // `.catch(() => null)` turned a 500 into "No flight by that number".
    // The screen was not showing less than it claimed — it was stating a
    // fact it had never been able to check (D15b).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    ));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/could not check/i)).toBeInTheDocument());
    expect(screen.queryByText(/no flight by that number/i)).toBeNull();
    expect(useSearchStore.getState().outcome.kind).toBe('unreachable');
  });

  it('4 — and a dead server leaves the globe exactly as it was', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    useSelectionStore.setState({ selectedIcao: 'a0' });
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('unreachable'));
    expect(useSelectionStore.getState().selectedIcao).toBe('a0');
  });

  it('never reaches the network for something that is not a flight number', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<FlightSearch />);
    submit('hello');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });

  it('asks the server at most once per candidate, and there are at most three', async () => {
    // The measured maximum of ICAO codes behind one IATA code is 3 (G3).
    // The cap is that maximum, so no honest query is truncated and no query
    // can turn into a burst.
    const f = vi.fn().mockResolvedValue(answer(null));
    vi.stubGlobal('fetch', f);
    render(<FlightSearch />);
    submit('AA999');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('clearing the box puts the globe back as it was', async () => {
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(useSearchStore.getState().outcome.kind).toBe('idle');
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    // ...and the card the search opened goes with it, instead of staying
    // mounted over an aircraft that is no longer selected.
    expect(usePanelStore.getState().mode).toBe('closed');
  });
});
