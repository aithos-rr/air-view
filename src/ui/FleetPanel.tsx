import { useMemo } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useFilterStore, countFleet } from '@/state/filterStore';
import { describeVisibleFleet } from '@/globe/visibility';
import type { VisibleFleet } from '@/globe/visibility';
import { readVisibilityRule } from '@/state/sceneView';
import { FeedStatus } from './FeedStatus';

/**
 * The counter the HUD already showed, with a drawer under it.
 *
 * Closed it is one line, which is what spec §6.1 asks for and what the globe
 * can afford. Open it is the only place in the product where the two
 * populations are named, counted and switched.
 *
 * The label is a plain "aircraft" and does not change with the zoom. The
 * spec imagined "IN VOLO" at planet view and "IN VISTA" over a region, for
 * a camera-driven payload that Piano 1 did not build: server/index.ts:326
 * serves the WHOLE accumulated fleet and the camera only reprioritises
 * tiles. "In view" would be a plausible word for a number that does not
 * mean it.
 *
 * What the closed row says is governed by D14: the number stops at the
 * total only while the whole fleet is on the globe. The moment a filter
 * hides something it reads "200 of 5 900 aircraft", and the line that
 * names the cause lives OUTSIDE the drawer — a drawer closes, a filter
 * does not.
 */
export function FleetPanel() {
  const aircraft = useAircraftStore((s) => s.aircraft);
  const open = useFilterStore((s) => s.panelOpen);
  const setOpen = useFilterStore((s) => s.setPanelOpen);
  const showComplete = useFilterStore((s) => s.showComplete);
  const showPartial = useFilterStore((s) => s.showPartial);
  const toggleComplete = useFilterStore((s) => s.toggleComplete);
  const togglePartial = useFilterStore((s) => s.togglePartial);

  // One pass over up to 6 000 records, recomputed only when the Map
  // identity changes — updateBatch replaces it wholesale once per cycle.
  const counts = useMemo(() => countFleet(aircraft.values()), [aircraft]);

  // Read, not subscribed: `aircraft`, the two switches above and
  // `selectedIcao` are already subscriptions, so everything that can change
  // this answer has already re-rendered the component.
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);
  const rule = readVisibilityRule();

  // What the globe is DRAWING — from the very function that draws it (D15).
  // Never derived from the category counts: that arithmetic knew nothing
  // about focus, about records with no coordinates, or about the renderer's
  // ceiling, and so it wrote sentences the picture contradicted.
  const view = useMemo(
    () => describeVisibleFleet(aircraft.values(), rule, selectedIcao),
    [aircraft, rule.showComplete, rule.showPartial, rule.focusedIcao, selectedIcao]
  );
  const bothOff = !showComplete && !showPartial;

  return (
    <div className="hud">
      <button
        type="button"
        className="hud__summary"
        aria-expanded={open}
        aria-controls="fleet-filters"
        onClick={() => setOpen(!open)}
      >
        {/* While the whole fleet is on the globe this reads exactly
            "5 900 aircraft", which is what a visitor who touched nothing
            sees and what tests/e2e/happy-path.spec.ts:8 matches. The
            moment ANYTHING hides an aircraft — a filter, a focus, a
            missing coordinate, the renderer's ceiling — the row would
            otherwise claim aircraft that are not on the globe, so it says
            both numbers instead (D14/D15). count-total is view.total, the
            same walk's count of the records, which the self-verifying test
            adds the two category counts up against: two walkers, one
            answer, or one of them is lying. */}
        <span className="hud__count">
          {view.shown < view.total && <>{view.shown.toLocaleString()} of </>}
          <span data-testid="count-total">{view.total.toLocaleString()}</span> aircraft
        </span>
        <span className="hud__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      <FeedStatus />

      {/* OUTSIDE the drawer, on purpose (D14). These lines explain the
          globe, and the globe is always on screen; the drawer is not.
          Folded inside {open && …} they would vanish on closing the panel
          while the cause stayed in force — and vanish in particular on Esc,
          the key a user presses to close things, which means the
          explanation would disappear at exactly the moment they were trying
          to find out why the sky is empty. */}
      <ShortfallNotes view={view} bothOff={bothOff} />

      {open && (
        <div id="fleet-filters" className="fleet">
          <FilterRow
            kind="complete"
            label="Full route"
            testid="count-complete"
            count={counts.complete}
            checked={showComplete}
            onChange={toggleComplete}
          />
          <FilterRow
            kind="partial"
            label="Partial data"
            testid="count-partial"
            count={counts.partial}
            checked={showPartial}
            onChange={togglePartial}
          />

          {/* This third line stays INSIDE the drawer: it does not explain
              the globe, it explains the split into two categories, which
              exists only while the drawer is open.
              Measured 2026-11-21: technical fields cover 99% of the fleet,
              routes 4,7%, and the route cache grows ~920 flights/hour. That
              growth rate is deliberately NOT on screen — it is true today
              and would be a lie next month. The count is recomputed from
              the fleet in hand, so it cannot go stale. */}
          {counts.routeOnly > 0 && (
            <p className="fleet__note">
              {counts.routeOnly.toLocaleString()} of the partial ones lack only a route
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One line per cause, for EVERY cause that has a count (D15a).
 *
 * Not "the main reason": two can hold at once — a filter switched off and a
 * flight in focus — and naming one while the other is also hiding aircraft
 * is the same half-truth in a smaller size. The lines are derived from the
 * walk, so a cause that is added to describeVisibleFleet and forgotten here
 * shows up as a shortfall the row counts and nothing explains, which is
 * what the invariant test fails on.
 */
function ShortfallNotes({ view, bothOff }: { view: VisibleFleet; bothOff: boolean }) {
  const h = view.hidden;
  // Gated on what is DRAWN, never on the switches. With both switches off
  // and a flight in focus the globe IS drawing that flight, and "No
  // aircraft shown" would be a sentence the picture contradicts three
  // millimetres away.
  const emptiedOnPurpose = bothOff && view.shown === 0;
  return (
    // A live region, because these lines appear in answer to an act — a
    // checkbox, a click on an aircraft — and a user who cannot see the
    // globe has nothing else to compare the count against. Without it the
    // only thing spoken aloud is the feed total, which is the one number
    // that does NOT change when the globe empties (D15a).
    <div className="fleet__notes" role="status" aria-live="polite">
      {view.shown < view.total && (
        <span className="sr-only">
          {view.shown.toLocaleString()} of {view.total.toLocaleString()} aircraft shown
        </span>
      )}
      {emptiedOnPurpose && (
        <p className="fleet__note">No aircraft shown — both filters are off</p>
      )}
      {h.filtered > 0 && !emptiedOnPurpose && (
        <p className="fleet__note">{h.filtered.toLocaleString()} hidden by filters</p>
      )}
      {/* The second half of this line is MEASURED, never assumed. "Esc
          shows them again" is a claim about the next frame, and with both
          switches off it was false: the focus was the only thing putting
          an aircraft on the globe, so Esc handed back nobody and emptied
          the sky instead. The walk counts how many the filters would let
          through, and the sentence follows the count (D15b). The offer
          names Esc rather than the ✕ because Esc is the one door always
          under the hand; the ladder of D12 reaches the focus once whatever
          the user opened on top of it is closed. */}
      {h.focus > 0 && (
        <p className="fleet__note">
          {h.focus.toLocaleString()} hidden while one flight is in focus
          {view.releasedByLeavingFocus === h.focus && <> — Esc shows them again</>}
          {view.releasedByLeavingFocus > 0 && view.releasedByLeavingFocus < h.focus && (
            <>
              {' '}— Esc shows {view.releasedByLeavingFocus.toLocaleString()} of them again;
              the filters hide the rest
            </>
          )}
          {view.releasedByLeavingFocus === 0 && (
            <> — the filters hide them too, so Esc brings none of them back</>
          )}
        </p>
      )}
      {/* Records the feed carries without a position. The adapters write
          null rather than invent a coordinate, so these are in
          aircraft.size and have never been dots. D14 deferred this count
          "for want of a measurement"; the walk measures it for free. */}
      {h.noPosition > 0 && (
        <p className="fleet__note">
          {h.noPosition.toLocaleString()} without a position — in the feed, not on the globe
        </p>
      )}
      {h.rendererFull > 0 && (
        <p className="fleet__note">
          {h.rendererFull.toLocaleString()} beyond what the globe can draw at once
        </p>
      )}
    </div>
  );
}

interface FilterRowProps {
  kind: 'complete' | 'partial';
  label: string;
  testid: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}

/**
 * A real <input type="checkbox"> inside a <label>, not a styled div.
 *
 * axe runs over this surface in tests/e2e/a11y.spec.ts, and the keyboard
 * behaviour of a checkbox is not worth reimplementing.
 */
function FilterRow({ kind, label, testid, count, checked, onChange }: FilterRowProps) {
  return (
    <label className="fleet__row">
      <input
        type="checkbox"
        className="fleet__box"
        data-kind={kind}
        checked={checked}
        onChange={onChange}
      />
      <span className="fleet__label">{label}</span>
      <span className="fleet__count" data-testid={testid}>
        {count.toLocaleString()}
      </span>
    </label>
  );
}
