import { describe, it, expect } from 'vitest';
import { describeVisibleFleet, SHOW_ALL } from '@/globe/visibility';
import type { DrawTarget, Shortfall, VisibilityRule } from '@/globe/visibility';
import { DR_CAP_S, STILL, deriveMotion } from '@/globe/deadReckoning';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao }), trail: [], ...over };
}

/**
 * One record of each shape the real fleet contains. Two of the four cannot
 * be drawn at all: latitude and longitude are null whenever the provider
 * sent no position, and the adapters write null on purpose rather than
 * invent one (src/data/sources/adsbLol.ts:30-31). Those two are in
 * aircraft.size, in the panel's total, and nowhere on the globe — which is
 * precisely the half-truth D15 exists to forbid.
 */
const CC = ac('cc', { complete: true });                 // complete, placeable
const PP = ac('pp', { complete: false });                // partial, placeable
const CN = ac('cn', { complete: true, latitude: null }); // complete, nowhere
const PN = ac('pn', { complete: false, longitude: null }); // partial, nowhere
const FLEET = [CC, PP, CN, PN];

function rule(
  showComplete: boolean,
  showPartial: boolean,
  focusedIcao: string | null
): VisibilityRule {
  return { showComplete, showPartial, focusedIcao };
}

interface Row {
  name: string;
  rule: VisibilityRule;
  selected: string | null;
  /**
   * What the RENDERER hands over on this frame. Left out, the walk takes
   * the settled value of the rule — which is exactly what the panel hands
   * over — so a row without it is the state as the two readers agree on
   * it, and a row with it is the frame where they do not.
   */
  brightness?: number;
  shown: number;
  hidden: Partial<Record<Shortfall, number>>;
  /** How many of hidden.focus the filters would give back (D15b). */
  released: number;
}

/**
 * Every combination of the two category switches with every form of focus —
 * at the settled brightness, and at the brightnesses only the renderer ever
 * passes. A state that is not here is a state nobody has thought about,
 * which is how all ten defects of this family were born; adding one is
 * adding a row.
 *
 * What this table does NOT reach: whose ARC is on the globe. That is not a
 * fact about this walk, so no row here could be wrong about it — and it is
 * enumerated where it belongs, in tests/unit/state/sceneView.test.ts
 * ('arcSubject — whose route the globe is drawing'), because the same
 * failure reached the screen through that door too: a line naming a route
 * the globe had stopped drawing. Said out loud here so the next reader does
 * not take this table for the whole screen.
 */
const TABLE: Row[] = [
  { name: 'nothing touched', rule: rule(true, true, null), selected: null,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  { name: 'greys off', rule: rule(true, false, null), selected: null,
    shown: 1, hidden: { filtered: 1, noPosition: 2 }, released: 0 },
  { name: 'completes off', rule: rule(false, true, null), selected: null,
    shown: 1, hidden: { filtered: 1, noPosition: 2 }, released: 0 },
  { name: 'both filters off', rule: rule(false, false, null), selected: null,
    shown: 0, hidden: { filtered: 2, noPosition: 2 }, released: 0 },
  { name: 'focus on a complete', rule: rule(true, true, 'cc'), selected: 'cc',
    shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  { name: 'focus on a grey', rule: rule(true, true, 'pp'), selected: 'pp',
    shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  { name: 'focus on a grey the filter had switched off', rule: rule(true, false, 'pp'),
    selected: 'pp', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  // The row that was a live defect before D15: the old panel computed its
  // count as (showComplete ? complete : 0) + (showPartial ? partial : 0),
  // which is 0 here — so it wrote "No aircraft shown — both filters are
  // off" over a globe that is drawing one.
  //
  // It is also the row where the PROMISE was false: `released` is 0, so
  // "Esc shows them again" was offering a sky Esc could not give — ending
  // the focus leaves the filters exactly as they were, and they are both
  // off (D15b).
  { name: 'both filters off AND one flight in focus', rule: rule(false, false, 'cc'),
    selected: 'cc', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 0 },
  // ...and the same promise is false without the globe going empty at all:
  // leaving this focus gives back nobody (the greys are switched off) while
  // CC, deselected, stays on screen because completes are on. "Esc empties
  // the globe" would be as wrong as "Esc shows them again"; only the
  // measured number is right in both.
  { name: 'focus on a complete, greys already off', rule: rule(true, false, 'cc'),
    selected: 'cc', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 0 },

  // The BORDER rows: here the renderer passes a live brightness that the
  // panel never passes. The arithmetic above was proved sound and the
  // invariant was broken here anyway, so these are rows and not an
  // afterthought.
  { name: 'the frame a focus starts, before the fade has moved',
    rule: rule(true, true, 'cc'), selected: 'cc', brightness: 1,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  { name: 'halfway into the fade — the one divergence D15 admits',
    rule: rule(true, true, 'cc'), selected: 'cc', brightness: 0.5,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  // The frames after a focus ENDS. rule.focusedIcao is already null, so
  // every placeable record is counted as shown — and the fade used to hand
  // the renderer ~0 here and draw none of them: the globe showing LESS
  // than the panel declared, in the one direction the invariant forbids.
  // createFocusFade now returns 1 whenever focusedIcao is null, and 1 is
  // the only brightness this state can be asked about.
  { name: 'the frames after a focus has ended', rule: rule(true, true, null),
    selected: null, brightness: 1, shown: 2, hidden: { noPosition: 2 }, released: 0 },
];

describe('describeVisibleFleet — the invariant, state by state', () => {
  it.each(TABLE)('$name', (row) => {
    const drawn: Array<{ icao: string; target: DrawTarget; slot: number }> = [];
    const view = describeVisibleFleet(
      FLEET,
      row.rule,
      row.selected,
      (a, target, slot) => drawn.push({ icao: a.icao24, target, slot }),
      row.brightness
    );

    // (a) the number the panel prints IS the number the renderer drew.
    // Not "agrees with": the same call produced both.
    expect(view.shown).toBe(row.shown);
    expect(drawn).toHaveLength(view.shown);

    // Nothing falls off the books: every record is either a dot or a named
    // absence. This identity is what makes a silent `continue` impossible.
    const named =
      view.hidden.filtered + view.hidden.focus + view.hidden.noPosition + view.hidden.rendererFull;
    expect(view.shown + named).toBe(view.total);
    expect(view.total).toBe(FLEET.length);

    // ...and it is the RIGHT cause, not merely some cause. A count that is
    // correct under the wrong heading is half of defect (b).
    expect(view.hidden).toEqual({
      filtered: 0, focus: 0, noPosition: 0, rendererFull: 0, ...row.hidden,
    });

    // There is always something to say when anything is missing, and never
    // a reason invented when nothing is.
    expect(view.reason === null).toBe(view.shown === view.total);

    // ...and the PROMISE is measured too: how many of the focus-hidden the
    // filters would let through once the focus ended. The note offers Esc
    // on the strength of this number, and on the rows where it is 0 the
    // old unconditional offer was a sentence the next frame refuted.
    expect(view.releasedByLeavingFocus).toBe(row.released);

    // The second identity (D19). `moving` and the two `still` buckets
    // partition what is DRAWN, exactly as the four shortfalls partition
    // what is not. A third behaviour added to the walk and forgotten in
    // the panel shows up here as a drawn record nothing accounts for.
    expect(view.moving + view.still.unmeasurable + view.still.stale).toBe(view.shown);
  });

  it('declares the aircraft the renderer had no room for, instead of dropping them', () => {
    // The 24 000 ceiling discards by a bare `continue` — no log, no flag —
    // while the HUD keeps reporting aircraft.size; the header of
    // tests/unit/globe/renderCapacity.test.ts has named that failure since
    // Piano 1. Under D15 the ceiling cannot be silent: it has a counter.
    const view = describeVisibleFleet(
      [CC, PP, ac('p2'), ac('p3')], SHOW_ALL, null, undefined, undefined,
      { perCategory: 1, selected: 8 }
    );
    expect(view.shown).toBe(2);
    expect(view.hidden.rendererFull).toBe(2);
    expect(view.reason).toBe('rendererFull');
  });

  it('keeps the dimming crowd in the count while the fade is still running', () => {
    // The one divergence D15 allows. Mid-fade the globe shows MORE than the
    // panel declares, never less, and converges within FOCUS_FADE_MS: a
    // number the eye catches up with, not one it is misled by.
    const mid = describeVisibleFleet(FLEET, rule(true, true, 'cc'), 'cc', undefined, 0.5);
    const settled = describeVisibleFleet(FLEET, rule(true, true, 'cc'), 'cc', undefined, 0);
    expect(mid.shown).toBe(2);
    expect(mid.hidden.focus).toBe(0);
    expect(settled.shown).toBe(1);
    expect(settled.hidden.focus).toBe(1);
    expect(mid.shown).toBeGreaterThanOrEqual(settled.shown);
  });

  it('counts only the aircraft a filter would NOT catch on the way back', () => {
    // Half and half: ending this focus gives the completes back and leaves
    // the greys hidden, so "Esc shows them again" is false, "Esc shows 1 of
    // them again" is true, and only a measurement can tell them apart. The
    // panel prints the number; it does not promise the comfortable case.
    const fleet = [CC, ac('c2', { complete: true }), PP];
    const view = describeVisibleFleet(fleet, rule(true, false, 'cc'), 'cc');
    expect(view.hidden.focus).toBe(2);
    expect(view.releasedByLeavingFocus).toBe(1);
  });

  it('says nothing at all when the whole fleet is on the globe', () => {
    const view = describeVisibleFleet([CC, PP], SHOW_ALL, null);
    expect(view.shown).toBe(2);
    expect(view.reason).toBeNull();
    expect(view.hidden).toEqual({ filtered: 0, focus: 0, noPosition: 0, rendererFull: 0 });
  });
});

/**
 * The second invariant this walk now carries (D19).
 *
 * D15 closed a family of defects where the screen DECLARED more than it
 * drew. Dead reckoning opens the same family on another axis: the screen
 * draws two behaviours and names one. A viewer who sees some dots glide and
 * the rest sit still concludes the only thing the picture suggests — that
 * the still ones are parked aircraft — and that is a false statement nobody
 * measured, which is D15b exactly.
 *
 * The remedy is the same remedy: one pass, one answer, two readers. These
 * three numbers are not a fifth shortfall, they are a PARTITION of `shown`,
 * and the identity below holds by construction because each drawn record
 * increments exactly one of them.
 */
function moving(over: Partial<Aircraft> = {}): Aircraft {
  const raw = ac('mv', { latitude: 50, longitude: -10, lastContact: 1_000, ...over });
  return { ...raw, motion: deriveMotion(raw, 1_000) };
}

describe('describeVisibleFleet — what moves, and what only looks parked', () => {
  it('counts a fresh extrapolable aircraft as moving, and says how far', () => {
    const seen: number[] = [];
    const view = describeVisibleFleet(
      [moving()],
      SHOW_ALL,
      null,
      (_ac, _t, _s, advanceS) => seen.push(advanceS),
      1,
      undefined,
      30
    );
    expect(view.moving).toBe(1);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 0 });
    expect(seen).toEqual([30]);
  });

  it('counts an aircraft past the ceiling as still, and names the ceiling as the cause', () => {
    // 120 s is the floor of our own tile refresh plus the client's, with
    // margin (D16). Past it the globe draws the last measured position and
    // the panel says how many are in that state.
    const stale = moving({ lastContact: 1_000 - DR_CAP_S - 5 });
    const flags: boolean[] = [];
    const view = describeVisibleFleet(
      [stale],
      SHOW_ALL,
      null,
      (_ac, _t, _s, _adv, still) => flags.push(still),
      1,
      undefined,
      0
    );
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
    expect(view.moving).toBe(0);
    expect(flags).toEqual([true]);
  });

  it('keeps a missing heading apart from a missing contact', () => {
    // Two different absences, two different sentences (D15b/D18). The
    // compass track covers 89,6% of the fleet, so the second kind is a
    // tenth of every sky, not a hypothetical.
    const view = describeVisibleFleet(
      [moving({ headingDeg: null }), moving({ lastContact: 1_000 - DR_CAP_S - 5 })],
      SHOW_ALL,
      null
    );
    expect(view.still).toEqual({ unmeasurable: 1, stale: 1 });
  });

  it('counts a record with no motion at all as unmeasurable rather than dropping it', () => {
    // Every Aircraft built outside updateBatch has no motion. It is still a
    // measured position and it is still drawn; what is missing is our
    // ability to advance it.
    const view = describeVisibleFleet([CC], SHOW_ALL, null);
    expect(view.shown).toBe(1);
    expect(view.still.unmeasurable).toBe(1);
  });

  it('leaves nothing moving when the feed stopped eight minutes ago', () => {
    // The scenario end to end, in the units the panel prints. 510 s is the
    // stretch this defect used to live in: between maxFreshMs = 90 s,
    // where the server starts calling the body stale, and maxStaleMs =
    // 600 s, where it stops serving it at all (server/feedState.ts). For
    // all eight and a half of those minutes the aircraft went on gliding,
    // because the elapsed was counted from the arrival of a body whose
    // fetchedAt never moved.
    //
    // Here it is the ELAPSED that carries the truth, not the flag:
    // aircraftStore does not re-stamp a fetchedAt it has already seen, so
    // what reaches this argument is the time that really passed (D31). The
    // flag is tested on its own below, because it has to hold even when a
    // clock does not.
    const view = describeVisibleFleet(
      [moving()], SHOW_ALL, null, undefined, undefined, undefined, 510
    );
    expect(view.moving).toBe(0);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
  });

  it('carries nothing forward while the server calls the body a photograph', () => {
    // The case the ceiling exists for, reached by the one route the
    // ceiling cannot see: the server stamps fetchedAt when it BUILDS the
    // body and then serves that body unchanged for up to 600 s, so an age
    // counted from a stamp that repeats stands still while the world moves
    // (D31). The flag is the server's own, computed on the server's own
    // clock, so no clock of ours can defeat it — and it is the same fact
    // the HUD already prints as "feed stale · last known positions".
    //
    // They land in `stale` and not in `unmeasurable`: every field is
    // there, and what is old is the measurement, not our knowledge of the
    // aircraft. Same bucket, same sentence, two routes to it (D18).
    const view = describeVisibleFleet(
      [moving()], SHOW_ALL, null, undefined, undefined, undefined, 0, true
    );
    expect(view.moving).toBe(0);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
    expect(view.shown).toBe(1);
  });

  it('hands the renderer a zero advance for everything it calls still', () => {
    // The number the panel counts and the distance the dot travels come out
    // of the same line. They cannot disagree, which is the whole of D19.
    const rows: Array<[number, boolean]> = [];
    describeVisibleFleet(
      [moving(), moving({ headingDeg: null }), moving({ lastContact: 0 })],
      SHOW_ALL,
      null,
      (_ac, _t, _s, advanceS, still) => rows.push([advanceS, still]),
      1,
      undefined,
      0
    );
    for (const [advanceS, still] of rows) {
      if (still) expect(advanceS).toBe(0);
      else expect(advanceS).toBeGreaterThanOrEqual(0);
    }
    expect(STILL).toBeLessThan(0); // the sentinel never reaches the renderer
  });
});
