import { describe, it, expect, beforeEach } from 'vitest';
import { CAMERA_FAR_LIMIT, shellThicknessUnits } from '@/globe/geoHelpers';
import { readFocusAct, readVisibilityRule } from '@/state/sceneView';
import { readFocusView, markerSpecs, arcSubject, arcVerdict } from '@/state/sceneView';
import { geodesicPoints } from '@/globe/routeArc';
import { routeEnds } from '@/data/airportInfo';
import { useSearchStore } from '@/state/searchStore';
import { initAirports } from '@/data/airportLookup';
import { usePanelStore } from '@/state/panelStore';
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

const LAS = {
  iata: 'LAS', icao: 'KLAS', name: 'Harry Reid International Airport',
  city: 'Las Vegas', country: 'US', lat: 36.084, lon: -115.1537,
  timezone: 'America/Los_Angeles',
};

// FRU is one of the 13 IATA codes present in the committed route cache and
// absent from public/data/airports.json (measured 2026-11-21). Leaving it
// out of the table here is not a contrivance: it is what the file is.
function route(destinationIata: string) {
  return {
    originIata: 'LAS', originName: 'Harry Reid International Airport',
    destinationIata, destinationName: 'Somewhere', airlineName: 'British Airways',
  };
}

describe('readFocusAct — which act of focusing the camera is answering', () => {
  beforeEach(() => {
    useSelectionStore.setState({
      selectedIcao: null,
      openEnd: null,
      focusSightline: 'in-sight',
      focusOrigin: null,
      focusSeq: 0,
    });
  });

  it('reports no act, and no origin, before anything is chosen', () => {
    expect(readFocusAct()).toEqual({ focusSeq: 0, focusOrigin: null });
  });

  it('carries the act and the origin out of ONE read', () => {
    // The camera's whole behaviour hangs on the pair. An origin taken a
    // frame apart from its sequence number would describe a different act:
    // the user clicks a dot while the camera is still answering the row
    // they picked, and the camera learns "search" about a click (D34).
    useSelectionStore.getState().select('a1', 'search');
    expect(readFocusAct()).toEqual({ focusSeq: 1, focusOrigin: 'search' });
    useSelectionStore.getState().select('a2', 'globe');
    expect(readFocusAct()).toEqual({ focusSeq: 2, focusOrigin: 'globe' });
  });

  it('forgets the origin when the flight is let go, and counts no act', () => {
    useSelectionStore.getState().select('a1', 'list');
    useSelectionStore.getState().select(null);
    expect(readFocusAct()).toEqual({ focusSeq: 1, focusOrigin: null });
  });
});

describe('readFocusView — what we can place, we place', () => {
  beforeEach(() => {
    initAirports([LAS]);
    usePanelStore.setState({ mode: 'flight' });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
  });

  it('plants both markers when both ends are in the table', () => {
    initAirports([LAS, { ...LAS, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', lat: 51.4775, lon: -0.4614 }]);
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('LHR') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const view = readFocusView();
    expect(view?.arc).not.toBeNull();
    expect(markerSpecs(view).map((m) => m.letter)).toEqual(['D', 'A']);
  });

  it('still plants the end it CAN place when the other has no coordinates', () => {
    // 17 routes of 4 243. The first draft returned null the moment either
    // end was unplaceable, which threw away the end we knew along with the
    // one we did not — and left the per-end tests in markerSpecs() as dead
    // branches, so nothing could catch it. One dot is less than two; it is
    // a great deal more than nothing (D15a).
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('FRU') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const view = readFocusView();
    expect(view).not.toBeNull();
    const specs = markerSpecs(view);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.letter).toBe('D');
    expect(specs[0]?.iata).toBe('LAS');
  });

  it('draws NO arc with one end missing — a geodesic needs two points', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('FRU') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readFocusView()?.arc).toBeNull();
  });

  it('returns nothing only for no flight and for no route', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readFocusView()).toBeNull(); // the grey population: "Route unknown"
    useSelectionStore.setState({ selectedIcao: null });
    expect(readFocusView()).toBeNull();
    expect(markerSpecs(null)).toEqual([]);
  });
});

const GHOST_ROUTE = {
  originIata: 'LAS', originName: 'Harry Reid International Airport',
  destinationIata: 'LHR', destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

describe('arcSubject — whose route the globe is drawing', () => {
  beforeEach(() => {
    // The describe above leaves a selection behind, and a selection is
    // exactly what makes the ghost branch unreachable: without this reset
    // the test that reads the ghost VIEW would be measuring the flight
    // branch instead.
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    useAircraftStore.setState({ aircraft: new Map() });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
  });

  it('gives the ghost route the arc while nothing is selected', () => {
    expect(
      arcSubject(null, { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE }).kind
    ).toBe('ghost');
  });

  it('gives a selected flight the arc — even when that flight draws none', () => {
    // The order `run` cannot fix: the click comes AFTER the search. Nothing
    // clears the outcome when the user picks an aircraft, so the line went
    // on announcing "BA999 · position unavailable — outside ADS-B coverage"
    // while the arc it named had been replaced by the selected flight's —
    // or by no arc at all, that flight having no route, which is 95,3% of
    // the fleet. Either way BA999's route had left the globe and the line
    // was still presenting it (D15a).
    expect(
      arcSubject('a1', { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE }).kind
    ).toBe('flight');

    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSearchStore.setState({
      query: 'BA999',
      outcome: { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE },
    });
    expect(readFocusView()).toBeNull();
  });

  it('draws the ghost route it named: an arc with nobody on it, and both markers', () => {
    // Outcome 2's whole promise is a PICTURE: a flight we know and cannot
    // see still gets its route on the globe. Asserting only that
    // arcSubject().kind === 'ghost' leaves the branch that builds the view
    // free to return nothing, and then the line reads "BAW999 · position
    // unavailable" over an empty globe — the words outliving the picture
    // (D15a), reached from the other side.
    initAirports([
      LAS,
      { ...LAS, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', lat: 51.4775, lon: -0.4614 },
    ]);
    useAircraftStore.setState({ aircraft: new Map() });
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    useSearchStore.setState({
      query: 'BA999',
      outcome: { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE },
    });
    const view = readFocusView();
    expect(view?.arc).not.toBeNull();
    // Nobody is flying it, so routeArc draws one even brightness rather
    // than splitting the line into flown and to-fly for an aircraft whose
    // position is precisely what we do not have.
    expect(view?.arc?.aircraft).toBeNull();
    const specs = markerSpecs(view);
    expect(specs.map((s) => s.letter)).toEqual(['D', 'A']);
    expect(specs.map((s) => s.iata)).toEqual(['LAS', 'LHR']);
  });
});

const CDG = {
  iata: 'CDG', icao: 'LFPG', name: 'Charles de Gaulle International Airport',
  city: 'Paris', country: 'FR', lat: 49.012798, lon: 2.55,
  timezone: 'Europe/Paris',
};

const CIRCULAR = {
  originIata: 'CDG', originName: 'Charles de Gaulle International Airport',
  destinationIata: 'CDG', destinationName: 'Charles de Gaulle International Airport',
  airlineName: 'Air France',
};

describe('readFocusView — a flight that ends where it began', () => {
  // AFR43GZ CDG->CDG, EWG48J HAM->HAM, BOX570 LEJ->LEJ: 13 of the 4 243
  // routes in the committed cache, the same order of magnitude as the 17
  // unplaceable ones the design already treats as first-class citizens.
  beforeEach(() => {
    initAirports([CDG]);
    usePanelStore.setState({ mode: 'flight' });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: CIRCULAR })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: null });
  });

  it('promises no arc that the renderer will refuse to draw', () => {
    // Both ends ARE placeable, so the unplaceable test never fires and
    // buildArc handed back an ordinary DrawableArc — which geodesicPoints
    // then rejected (omega < 1e-6) and routeArc swallowed with
    // setDrawRange(0, 0). The card read "CDG → CDG", the globe drew
    // nothing, and not one word connected the two (D15a).
    const view = readFocusView();
    expect(view).not.toBeNull();
    expect(
      geodesicPoints(
        { lat: CDG.lat, lon: CDG.lon },
        { lat: CDG.lat, lon: CDG.lon },
        shellThicknessUnits(CAMERA_FAR_LIMIT)
      )
    ).toBeNull();
    expect(view?.arc).toBeNull();
  });

  it('plants ONE marker instead of two on the same pixel', () => {
    // D and A at identical coordinates land on the same pixel, A on top of
    // D, and the departure marker cannot be reached with a mouse at all.
    const specs = markerSpecs(readFocusView());
    expect(specs).toHaveLength(1);
    expect(specs[0]?.letter).toBe('D/A');
    expect(specs[0]?.iata).toBe('CDG');
    // Still an end, so a click still has an airport card to open.
    expect(specs[0]?.end).toBe('origin');
  });

  it('names the reason, so the words can match the picture', () => {
    expect(arcVerdict(routeEnds(CIRCULAR).origin, routeEnds(CIRCULAR).destination)).toMatchObject({
      arc: false,
      why: 'samePlace',
    });
  });
});
