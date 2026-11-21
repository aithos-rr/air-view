import { describe, it, expect } from 'vitest';
import { describeVisibleFleet, SHOW_ALL } from '@/globe/visibility';
import type { DrawTarget, Shortfall, VisibilityRule } from '@/globe/visibility';
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
