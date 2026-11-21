import { useSearchStore } from '@/state/searchStore';
import { routeEnds } from '@/data/airportInfo';
import { useSelectionStore } from '@/state/selectionStore';
import { arcSubject, arcVerdict } from '@/state/sceneView';
import type { ArcVerdict } from '@/state/sceneView';
import type { FlightRouteLite } from '@/types';

/**
 * Always visible, never behind a shortcut: someone arriving from a shared
 * link has no way to discover a keystroke (spec §6.3).
 *
 * It searches on SUBMIT, not on every keypress. A search per character
 * would send five requests for "BA274", each of which enqueues a callsign
 * for the adsbdb pump — and it would need a debounce, which is another
 * duration to measure correctly.
 */
export function FlightSearch() {
  const query = useSearchStore((s) => s.query);
  const outcome = useSearchStore((s) => s.outcome);
  const setQuery = useSearchStore((s) => s.setQuery);
  const clear = useSearchStore((s) => s.clear);
  const run = useSearchStore((s) => s.run);
  // Subscribed, not read: selecting an aircraft is what takes the arc away
  // from outcome 2 between two renders of this line, so the line has to
  // re-render when it happens. Nothing clears the outcome on a selection,
  // and nothing should — the answer to the user's question is still true;
  // it is the ARC the line can no longer claim.
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run(query);
      }}
    >
      <input
        type="search"
        className="search__input"
        placeholder="Flight number…"
        aria-label="Search a flight number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}>
        ✕
      </button>
      <p className="search__outcome" role="status" aria-live="polite">
        {outcome.kind === 'offCoverage' && (
          <OffCoverage
            callsign={outcome.callsign}
            route={outcome.route}
            // Asked of the one function that decides whose arc it is, with
            // the values this component is already subscribed to. Never
            // re-derived here: two authorities on one fact is the drift
            // the whole of D15 exists to prevent.
            preempted={arcSubject(selectedIcao, outcome).kind !== 'ghost'}
          />
        )}
        {/* The fifth outcome, and the commonest one for a real flight
            number: the server has never asked adsbdb about this callsign —
            ~8 374 are cached and ~920 are added an hour — and has just
            queued it. "No flight by that number" here would be a sentence
            about the world assembled out of our own backlog (D15b). The
            retry is a real promise: the endpoint enqueues what it has not
            asked about. */}
        {outcome.kind === 'notChecked' && (
          <>
            {outcome.callsign} · not looked up yet — queued with the route service, try again in
            a few minutes
          </>
        )}
        {/* Said only of a callsign adsbdb was actually asked about. */}
        {outcome.kind === 'unknown' && <>No flight by that number</>}
        {/* The fourth outcome, and the only one that is about US. "No
            flight by that number" after a 500 is the screen claiming to
            have checked something it could not even ask about (D15b). */}
        {outcome.kind === 'unreachable' && (
          <>Could not check “{outcome.query}” — the route service did not answer</>
        )}
      </p>
    </form>
  );
}

/**
 * Outcome 2: a flight we know of and cannot see.
 *
 * The first clause is about the AIRCRAFT — we have no position for it. The
 * second is about an AIRPORT, and it exists because the two were once
 * conflated: with an endpoint missing from airports.json the globe drew
 * nothing at all while the only line on screen talked about the aircraft,
 * so the user read "position unavailable" and had no way to learn that the
 * silence belonged to the airport instead (D15b). 13 IATA codes of the
 * committed cache are in exactly that position.
 *
 * The third clause is about the ARC, and it is the same sentence for a
 * third reason. `run` lets go of a focused flight before promising an arc,
 * which settles the order "search while focused"; the opposite order —
 * clicking an aircraft AFTER the search — nothing settles, because nothing
 * clears the outcome on a selection. The selection takes the arc (or draws
 * none at all, its route being unknown, which is 95,3% of the fleet) while
 * this line went on announcing BA999's route as though it were still out
 * there. The answer to the question asked stays on screen; the claim about
 * the picture does not outlive the picture (D15a).
 */
function OffCoverage({
  callsign,
  route,
  preempted,
}: {
  callsign: string;
  route: FlightRouteLite;
  preempted: boolean;
}) {
  const ends = routeEnds(route);
  // The one function the renderer obeys, asked here too. isPlaceable
  // answers a narrower question and left the 13 same-airport routes of the
  // committed cache promising an arc that was never drawn.
  const verdict = arcVerdict(ends.origin, ends.destination);
  return (
    <>
      {callsign} · position unavailable — outside ADS-B coverage
      {preempted && <> · route not drawn while another flight is selected</>}
      {/* Only worth saying while this route is the one on the globe: with
          the arc already gone to a selection, naming what we cannot draw
          would explain an absence that has a nearer cause. */}
      {!preempted && !verdict.arc && <> · {whyNoArc(verdict)}</>}
    </>
  );
}

function whyNoArc(verdict: Exclude<ArcVerdict, { arc: true }>): string {
  switch (verdict.why) {
    case 'unplaceable':
      return `${verdict.missing.map((e) => e.iata).join(' and ')} position unknown — no arc drawn`;
    case 'samePlace':
      return 'departure and arrival are the same airport — no arc drawn';
    case 'antipodal':
      return 'departure and arrival are exactly opposite on the globe — no arc drawn';
    default:
      return 'no arc drawn';
  }
}
