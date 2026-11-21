import { useAircraftStore } from './aircraftStore';
import { useFilterStore } from './filterStore';
import { useSelectionStore } from './selectionStore';
import { isFocusable } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';
import { routeEnds } from '@/data/airportInfo';
import type { AirportInfo } from '@/data/airportInfo';
import type { Aircraft } from '@/types';
import { arcDegeneracy } from '@/globe/routeArc';
import type { DrawableArc, GeoPointDeg } from '@/globe/routeArc';
import type { MarkerSpec } from '@/globe/airportMarkers';
import { useSearchStore } from './searchStore';
import type { SearchOutcome } from './searchStore';
import type { FlightRouteLite } from '@/types';

/**
 * The stores, read imperatively, for the code that runs outside React.
 *
 * scene.ts already talks to the stores this way — `useSelectionStore
 * .getState().select(icao)` from a DOM click handler — because the render
 * loop runs at 60fps and must not re-render anything. Keeping the reads in
 * one module means the pure rule in globe/visibility.ts stays testable
 * without importing a single store.
 *
 * Focus IS selection: there is no fourth state. The click handler already
 * sets selectedIcao and clearing it on empty space is already the exit.
 */
export function readVisibilityRule(): VisibilityRule {
  const f = useFilterStore.getState();
  const selected = useSelectionStore.getState().selectedIcao;
  // Focus is a claim about something that is ON the globe, so it is granted
  // only to an aircraft the fleet still carries AND that we can place.
  //
  // Both halves are ordinary operation, not hypotheses. The server prunes
  // every cycle and updateBatch replaces the Map wholesale, so the focused
  // aircraft can leave the payload between two frames. And latitude or
  // longitude is null whenever the provider sent no position (the adapters
  // write null rather than invent one — src/data/sources/adsbLol.ts:30-31)
  // while AircraftList offers every aircraft that has a callsign, position
  // or not. In either case keeping the icao here would hide the whole fleet
  // and draw nobody — a completely empty globe, which is the v1 failure in
  // a new costume.
  //
  // The SELECTION is deliberately NOT cleared (D13): leaving the sky as it
  // was without a word is the same failure seen from the other side.
  // SidePanel turns the surviving selection into "Contact lost" or into
  // "Position unknown", and says why.
  const focused =
    selected === null ? null : useAircraftStore.getState().aircraft.get(selected) ?? null;
  const focusedIcao = focused !== null && isFocusable(focused) ? focused.icao24 : null;
  return {
    showComplete: f.showComplete,
    showPartial: f.showPartial,
    focusedIcao,
  };
}

export interface FocusView {
  /**
   * The geodesic, or null when one of the two ends has no coordinates.
   *
   * null here means "no ARC", never "no view": the end we CAN place still
   * gets its marker. An arc needs both ends; a dot needs one.
   */
  arc: DrawableArc | null;
  origin: AirportInfo;
  destination: AirportInfo;
}

/**
 * The two ends of the focused flight's route, and the arc between them when
 * there is one. Resolved once: the markers need exactly the resolution the
 * arc needed, and doing it twice per frame would be two places free to
 * disagree about where LHR is.
 *
 * Three honest reasons to return nothing AT ALL: no flight in focus; a
 * flight whose route adsbdb does not know (the grey population — spec §6.2
 * draws no arc and the card says "Route unknown"); and an aircraft the feed
 * dropped between the click and this frame.
 *
 * A missing airport position is NOT one of them. The first draft returned
 * null whenever either end lacked coordinates, which threw away the end we
 * knew along with the one we did not: the 17 routes of 4 243 whose IATA is
 * absent from airports.json got no marker at all — and that made the
 * per-end tests inside markerSpecs() dead branches, which is how a defect
 * hides from its own test. The user is told what we know (one dot, the
 * card's "Airport position unknown") instead of nothing at all (D15a).
 */
/**
 * Whose route the globe is drawing: the selected flight's, the search's
 * ghost route, or nobody's.
 *
 * ONE answer, read by the renderer AND by the line that talks about it.
 * `run` lets go of a focused flight before promising an arc, which settles
 * the order "search while focused"; nothing settles the opposite order,
 * because nothing clears the outcome when the user picks an aircraft — and
 * then the selection takes the arc while the line goes on naming it, which
 * is the invariant reached through the words instead of the picture
 * (D15a). Pure, so the component can ask it with the values it has already
 * subscribed to rather than re-deriving the rule beside it.
 */
export type ArcSubject =
  | { kind: 'flight'; icao: string }
  | { kind: 'ghost'; callsign: string; route: FlightRouteLite }
  | { kind: 'none' };

export function arcSubject(
  selectedIcao: string | null,
  outcome: SearchOutcome
): ArcSubject {
  // The selection wins, and it wins even when it yields no arc at all: a
  // flight whose route adsbdb does not know draws nothing, and the globe
  // is still about THAT flight. 95,3% of the fleet is in that state.
  if (selectedIcao !== null) return { kind: 'flight', icao: selectedIcao };
  if (outcome.kind === 'offCoverage') {
    return { kind: 'ghost', callsign: outcome.callsign, route: outcome.route };
  }
  return { kind: 'none' };
}

export function readArcSubject(): ArcSubject {
  return arcSubject(
    useSelectionStore.getState().selectedIcao,
    useSearchStore.getState().outcome
  );
}

export function readFocusView(): FocusView | null {
  const subject = readArcSubject();
  if (subject.kind === 'none') return null;
  if (subject.kind === 'ghost') {
    // Search outcome 2: a route with no aircraft on it. The SAME buildArc
    // the focused branch uses — no aircraft, so routeArc draws it at one
    // even brightness — and the same consequence when an airport cannot be
    // placed: no arc, but the end we know still gets its marker, and
    // FlightSearch names the airport that is missing.
    const { origin, destination } = routeEnds(subject.route);
    return { origin, destination, arc: buildArc(origin, destination, null) };
  }
  const ac = useAircraftStore.getState().aircraft.get(subject.icao);
  if (ac === undefined || ac.route === null) return null;
  const { origin, destination } = routeEnds(ac.route);
  return { origin, destination, arc: buildArc(origin, destination, ac) };
}

/**
 * Whether these two ends make an arc at all — and when they do not, WHY.
 *
 * One function, asked by everything that has anything to say about the
 * line: buildArc for the renderer, markerSpecs for the dots, the flight
 * card and the search line for the words. The alternative is what was here
 * before: buildArc tested only for missing coordinates, geodesicPoints
 * refused coincident and antipodal pairs on its own, and routeArc swallowed
 * the difference with setDrawRange(0, 0). 13 of the 4 243 routes in the
 * committed cache depart and arrive at the SAME airport (AFR43GZ CDG->CDG,
 * EWG48J HAM->HAM, BOX570 LEJ->LEJ), and for every one of them the card
 * announced "CDG → CDG" over a globe that drew nothing and said nothing —
 * the words and the picture disagreeing with no one to notice (D15a).
 */
export type ArcVerdict =
  | { arc: true; origin: GeoPointDeg; destination: GeoPointDeg }
  /** 17 routes of 4 243: an IATA code the bundled table does not carry. */
  | { arc: false; why: 'unplaceable'; missing: AirportInfo[] }
  /** The two ends are one point — within ~6 m, so within one pixel too. */
  | { arc: false; why: 'samePlace'; at: GeoPointDeg }
  | { arc: false; why: 'antipodal' | 'unmeasurable' };

function pointOf(a: AirportInfo): GeoPointDeg | null {
  return a.lat === null || a.lon === null ? null : { lat: a.lat, lon: a.lon };
}

export function arcVerdict(origin: AirportInfo, destination: AirportInfo): ArcVerdict {
  const o = pointOf(origin);
  const d = pointOf(destination);
  if (o === null || d === null) {
    return {
      arc: false,
      why: 'unplaceable',
      missing: [origin, destination].filter((e) => pointOf(e) === null),
    };
  }
  // The renderer's own rule, asked BEFORE an arc is promised rather than
  // after one has been handed over.
  const degenerate = arcDegeneracy(o, d);
  if (degenerate === 'samePlace') return { arc: false, why: 'samePlace', at: o };
  if (degenerate !== null) return { arc: false, why: degenerate };
  return { arc: true, origin: o, destination: d };
}

/**
 * The geodesic, when there is one.
 *
 * Shared by the focused flight and by the search's ghost route (Task 8) so
 * the two cannot drift into two different ideas of when an arc is drawable.
 *
 * @param ac the aircraft flying it, or null when there is none — the
 *   search's outcome 2 is a route with nobody on it, so routeArc draws it
 *   at one even brightness rather than split into flown and to-fly.
 */
function buildArc(
  origin: AirportInfo,
  destination: AirportInfo,
  ac: Aircraft | null
): DrawableArc | null {
  const verdict = arcVerdict(origin, destination);
  if (!verdict.arc) return null;
  return {
    origin: verdict.origin,
    destination: verdict.destination,
    aircraft:
      ac !== null && ac.latitude !== null && ac.longitude !== null
        ? { lat: ac.latitude, lon: ac.longitude }
        : null,
  };
}

/**
 * D for departure, A for arrival — the letters the user asked for.
 *
 * One end at a time, on purpose: a route with one placeable end gets one
 * marker. These two tests are live branches, not belt and braces — 17 of
 * 4 243 routes take them today.
 *
 * And one marker for BOTH ends when the two are the same point, which 13
 * of those 4 243 are: two dots there occupy one pixel, A covers D, and the
 * departure cannot be clicked at all.
 */
export function markerSpecs(view: FocusView | null): MarkerSpec[] {
  if (view === null) return [];
  const verdict = arcVerdict(view.origin, view.destination);
  if (!verdict.arc && verdict.why === 'samePlace') {
    // One point, one marker. Two of them would land on the same pixel with
    // A on top of D, and the departure marker could not be reached with a
    // mouse at all — the user would be left clicking the arrival and
    // wondering why the card never changes. The same rule that says there
    // is no line says there is one dot.
    return [
      {
        end: 'origin',
        letter: 'D/A',
        iata:
          view.origin.iata === view.destination.iata
            ? view.origin.iata
            : `${view.origin.iata}/${view.destination.iata}`,
        lat: verdict.at.lat,
        lon: verdict.at.lon,
      },
    ];
  }
  const out: MarkerSpec[] = [];
  if (view.origin.lat !== null && view.origin.lon !== null) {
    out.push({
      end: 'origin', letter: 'D', iata: view.origin.iata,
      lat: view.origin.lat, lon: view.origin.lon,
    });
  }
  if (view.destination.lat !== null && view.destination.lon !== null) {
    out.push({
      end: 'destination', letter: 'A', iata: view.destination.iata,
      lat: view.destination.lat, lon: view.destination.lon,
    });
  }
  return out;
}

/** The AirportInfo behind whichever marker has its card open. */
export function readOpenAirport(): AirportInfo | null {
  const end = useSelectionStore.getState().openEnd;
  if (end === null) return null;
  const view = readFocusView();
  if (view === null) return null;
  return end === 'origin' ? view.origin : view.destination;
}
