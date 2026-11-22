import { useEffect, useMemo, useState } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import type { FocusSightline } from '@/state/selectionStore';
import { useFilterStore, countFleet } from '@/state/filterStore';
import { describeVisibleFleet } from '@/globe/visibility';
import type { VisibleFleet } from '@/globe/visibility';
import { readVisibilityRule } from '@/state/sceneView';
import { DR_CAP_S } from '@/globe/deadReckoning';

/**
 * How often the panel re-reads the clock while the globe is carrying
 * aircraft forward.
 *
 * A BOUND, not a taste: the panel can be behind the picture by one tick and
 * no more. What a tick of lag costs is measurable — the fleet is a mosaic
 * assembled over an 819 s sweep, so fixes cross the 120 s ceiling at about
 * fleet/819 a second, 14 of 11 625 — against the whole moving bucket, which
 * is what a panel with no clock at all gets wrong after one cycle.
 *
 * What the tick costs is measurable too, and it is nothing:
 * describeVisibleFleet is the same walk the render loop already runs sixty
 * times a second over up to 24 000 records (visibility.ts:160-161), with no
 * trigonometry and no allocation in it — advanceFor is an addition and a
 * comparison. Once a second is a sixtieth of a cost this plan has already
 * budgeted. The category counts are NOT re-walked: countFleet is memoised
 * on the Map.
 */
const MOTION_TICK_MS = 1_000;
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
  const focusSightline = useSelectionStore((s) => s.focusSightline);
  const rule = readVisibilityRule();

  const feedStampMs = useAircraftStore((s) => s.feedStampMs);
  const feedStale = useAircraftStore((s) => s.feedStale);

  // The panel's reading of the same monotonic clock the render loop reads.
  // In STATE, not inside the memo: see the defect spelled out in the plan
  // for this step. performance.now() and not Date.now(), because what is
  // being measured is a DURATION and the wall clock on this machine jumps
  // ~528 ms every ~32 s (D21).
  const [clockMs, setClockMs] = useState(() => performance.now());

  // What the globe is DRAWING — from the very function that draws it (D15).
  // The elapsed is measured on the same monotonic clock the render loop
  // reads: performance.now() and the rAF timestamp share
  // performance.timeOrigin by specification, so the panel and the renderer
  // are asking about the same frame to within one tick of MOTION_TICK_MS,
  // and never to within "one batch ago".
  //
  // No Math.max on the elapsed here, on purpose: advanceSeconds already
  // floors a negative one at zero, and the floor belongs in the one place
  // that decides how far an aircraft is carried, not in two.
  //
  // feedStale is subscribed, not read: it is one of the two inputs here
  // that can change WITHOUT a new fleet arriving — the server re-serving
  // the body it already served raises it while the Map identity stays put
  // (D31) — and a panel that missed that change would go on printing
  // "moving" under a HUD that says the feed has stopped. The other is the
  // clock, which is the subject of this step.
  const view = useMemo(
    () =>
      describeVisibleFleet(
        aircraft.values(),
        rule,
        selectedIcao,
        undefined,
        undefined,
        undefined,
        feedStampMs === 0 ? 0 : (clockMs - feedStampMs) / 1000,
        feedStale
      ),
    [
      aircraft,
      rule.showComplete,
      rule.showPartial,
      rule.focusedIcao,
      selectedIcao,
      feedStampMs,
      feedStale,
      clockMs,
    ]
  );

  // The clock walks while there is something to carry forward, and then
  // stops.
  //
  // An age only grows, and advanceFor is monotone in it: an aircraft goes
  // from moving to still and never back without a new batch — and a new
  // batch re-renders this component by itself, through the subscriptions
  // above. So `moving === 0` is not a heuristic, it is the proof that no
  // further reading of the clock can change a word of this panel. Without
  // the stop, a dead feed would leave the panel walking the fleet once a
  // second for ever, in a tab nobody is looking at.
  //
  // When a batch does arrive, the reading in hand was taken before it
  // landed: advanceSeconds floors a negative elapsed at zero, so the worst
  // that reading can say is "as at the instant the batch was built" — and
  // it says it for at most one tick, which is exactly the bound declared
  // above. One mechanism, one bound.
  const carryingForward = view.moving > 0;
  useEffect(() => {
    if (!carryingForward) return;
    const id = setInterval(() => setClockMs(performance.now()), MOTION_TICK_MS);
    return () => clearInterval(id);
  }, [carryingForward]);
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
      <ShortfallNotes view={view} bothOff={bothOff} sightline={focusSightline} />
      <MotionNotes view={view} feedStale={feedStale} />

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
function ShortfallNotes({
  view,
  bothOff,
  sightline,
}: {
  view: VisibleFleet;
  bothOff: boolean;
  sightline: FocusSightline;
}) {
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
      {/* The far side of the globe is framing and not a shortfall while
          there are eleven thousand aircraft on it: the viewer resolves it
          by dragging, and counting it would churn four times a second
          while the globe turns (D25). With ONE aircraft drawn that stops
          being true — the aircraft that went out of sight is everything
          there was, and the row three centimetres above says "1 of 5 900
          aircraft" over an empty globe.
          Measured in the render loop, which is the only thing here that
          has a camera, and gated on view.shown so it can never appear
          about a sky the viewer can still see something in.
          D32 wrote this as a measurement and not as a decision about the
          camera, and said that if the camera ever followed the focused
          flight the line would simply stop appearing. D34's camera
          follows, and it was nearly that simple — except during the
          900 ms of the rotation, when the flight IS still behind the
          globe and the screen IS still empty. Falling silent there would
          hand back D15a's forbidden sentence: "1 of 5 900 aircraft" over
          nothing, with no account of why. So the state has three values
          and not two, and the second half of the line follows it: an
          account in both cases, an instruction only when there is nobody
          else doing the work (sightlineOf, globe/cameraTurn.ts). */}
      {sightline !== 'in-sight' && view.shown === 1 && (
        <p className="fleet__note">
          The flight in focus is behind the globe —{' '}
          {sightline === 'arriving' ? 'turning to bring it round' : 'drag to bring it round'}
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

/**
 * What the globe is DOING with the dots it draws (D19).
 *
 * D15 made the screen say how many aircraft it draws and why the rest are
 * missing. Dead reckoning opens the same family on another axis: the globe
 * now draws two behaviours — some dots are carried forward from their last
 * fix, the others sit where they were measured — and showing two while
 * naming one leaves the viewer to conclude the only thing the picture
 * suggests, that the still ones are parked aircraft. That is a false
 * statement nobody measured.
 *
 * The numbers come from the same walk that drew the points, so the sentence
 * and the picture are one measurement: `moving + still.unmeasurable +
 * still.stale === shown`, by construction. And they are measured on the
 * same clock, re-read while anything is still being carried forward, so
 * the sentence cannot be one batch behind the picture (D33).
 *
 * NOT a live region, unlike ShortfallNotes above. Those lines answer an ACT
 * — a checkbox, a click on an aircraft — and appear when the user has just
 * done something. These are a standing property of the feed and change on
 * every cycle and between cycles — every time a fix crosses the ceiling —
 * so aria-live would announce them twice a minute at best and once a
 * second at worst, for ever.
 */
function MotionNotes({ view, feedStale }: { view: VisibleFleet; feedStale: boolean }) {
  const { moving, still } = view;
  if (moving === 0 && still.unmeasurable === 0 && still.stale === 0) return null;
  // Nothing to explain while every dot behaves the same way: a line that is
  // always on screen is furniture, and furniture does not get read.
  if (still.unmeasurable === 0 && still.stale === 0) return null;
  return (
    <div className="fleet__notes">
      {moving > 0 && (
        <p className="fleet__note">
          {moving.toLocaleString()} moving on their last reported track
        </p>
      )}
      {/* One bucket, two causes, and the sentence names the one in force.
          Saying "no contact for over 2 min" while the whole feed has
          stopped would blame the aircraft for a failure of ours — and it
          would be false besides, since their contact may be a few seconds
          old and it is the BODY we are holding that is a repeat (D31).
          The ceiling is spoken from the constant itself, so that sentence
          cannot drift from the rule: 120 s is the 60 s floor on refreshing
          a tile under the viewport plus the client's 30 s, with margin
          (D16). */}
      {still.stale > 0 && (
        <p className="fleet__note">
          {still.stale.toLocaleString()} shown where last seen —{' '}
          {feedStale ? (
            <>the feed has stopped</>
          ) : (
            <>no contact for over {Math.round(DR_CAP_S / 60)} min</>
          )}
        </p>
      )}
      {/* A different absence, and a different future: the feed catching up
          fixes the line above and will never fix this one. The compass
          track covers 89,6% of the fleet (spec §5.1). */}
      {still.unmeasurable > 0 && (
        <p className="fleet__note">
          {still.unmeasurable.toLocaleString()} shown where last seen — no heading or speed
          reported
        </p>
      )}
    </div>
  );
}
