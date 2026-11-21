import { describe, it, expect } from 'vitest';
import { FOCUS_FADE_MS, fadeAmount, createFocusFade } from '@/globe/focus';
import { describeVisibleFleet } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

describe('focus fade', () => {
  it('lasts inside the 200-400ms editorial window of DESIGN.md', () => {
    expect(FOCUS_FADE_MS).toBeGreaterThanOrEqual(200);
    expect(FOCUS_FADE_MS).toBeLessThanOrEqual(400);
  });

  it('runs from nothing to everything across that window', () => {
    expect(fadeAmount(0, false)).toBe(0);
    expect(fadeAmount(FOCUS_FADE_MS, false)).toBe(1);
    expect(fadeAmount(FOCUS_FADE_MS * 2, false)).toBe(1);
  });

  it('never leaves [0,1], not even if the clock runs backwards', () => {
    // rAF timestamps are monotonic by specification, but a tab restored from
    // the background hands back a first frame whose delta is meaningless.
    // Clamping is cheaper than trusting it.
    expect(fadeAmount(-5_000, false)).toBe(0);
    expect(fadeAmount(5_000, false)).toBe(1);
  });

  it('jumps straight to the end under prefers-reduced-motion', () => {
    expect(fadeAmount(0, true)).toBe(1);
    expect(fadeAmount(10, true)).toBe(1);
  });

  it('dims the others as focus starts and puts them out by the end', () => {
    const fade = createFocusFade();
    expect(fade.sample(null, 1_000, false)).toBe(1); // nothing focused: full sky
    expect(fade.sample('a1', 1_000, false)).toBe(1); // the instant of the click
    expect(fade.sample('a1', 1_000 + FOCUS_FADE_MS / 2, false)).toBeLessThan(1);
    expect(fade.sample('a1', 1_000 + FOCUS_FADE_MS, false)).toBe(0);
  });

  it('puts the sky back on the FIRST frame after focus ends, not over 300ms', () => {
    // This used to ramp 0 -> 1, and the ramp was a lie in the one direction
    // D15 forbids: from its first frame rule.focusedIcao is already null,
    // so describeVisibleFleet counts the whole fleet as shown, `reason` is
    // null, the notes print nothing — and every point is written at ~0. The
    // panel declared 5 900 aircraft over a black globe. Esc, the card's ✕,
    // a click on empty space and the server pruning the focused aircraft
    // (D13 — no act of the user at all) every one of them arrives here.
    const fade = createFocusFade();
    fade.sample('a1', 0, false);
    fade.sample('a1', FOCUS_FADE_MS, false); // settled: the crowd is out
    expect(fade.sample(null, FOCUS_FADE_MS, false)).toBe(1);
    expect(fade.sample(null, FOCUS_FADE_MS + 16, false)).toBe(1);
    expect(fade.sample(null, FOCUS_FADE_MS * 2, false)).toBe(1);
  });

  it('opens on a FULL sky, whatever the clock reads on the first frame', () => {
    // "Nothing is focused" is not a transition from anything: it is the
    // state the application mounts in. A fade that starts counting on its
    // first sample hands the renderer brightness 0 for ~300 ms, which draws
    // nothing at all, at every start-up — the empty globe of v1, produced by
    // the very animation that exists to avoid a hard cut. Three different
    // first frames, because the bug was invisible at nowMs = 0 only by luck.
    expect(createFocusFade().sample(null, 0, false)).toBe(1);
    expect(createFocusFade().sample(null, 1_763_700_000_000, false)).toBe(1);
    expect(createFocusFade().sample(null, 0, true)).toBe(1);
  });
});

/**
 * The arithmetic of D15 was taken apart on its own and held. The violations
 * that survived it were all on its BORDER: frames where two mechanisms,
 * each correct, hand over to one another and neither one's test is looking.
 * These sample the fade and ask describeVisibleFleet the same question on
 * the same frame, which is the only place the answer can be seen.
 */
describe('the fade and the count, at the frame where they meet', () => {
  const FLEET: Aircraft[] = [
    { ...makeAircraftRaw({ icao24: 'cc', complete: true }), trail: [] },
    { ...makeAircraftRaw({ icao24: 'pp', complete: false }), trail: [] },
    { ...makeAircraftRaw({ icao24: 'np', latitude: null }), trail: [] },
  ];
  const ruleFor = (focusedIcao: string | null): VisibilityRule => ({
    showComplete: true,
    showPartial: true,
    focusedIcao,
  });

  it('hands the renderer full brightness on every frame the panel calls a full sky', () => {
    const fade = createFocusFade();
    fade.sample('cc', 0, false);
    fade.sample('cc', FOCUS_FADE_MS, false); // settled inside the focus

    // The focus ends. From this frame readVisibilityRule reports none, so
    // the panel declares every placeable record SHOWN — and the brightness
    // the renderer multiplies those same records by is the whole of the
    // invariant on this frame. At ~0 they are counted and invisible, which
    // is the half-truth D15 exists to forbid, pointing the forbidden way.
    const declared = describeVisibleFleet(FLEET, ruleFor(null), null);
    expect(declared.shown).toBe(2);
    for (const dt of [0, 16, 33, 50, 150, FOCUS_FADE_MS - 1]) {
      expect(fade.sample(null, FOCUS_FADE_MS + dt, false)).toBe(1);
    }
  });

  it('keeps the one divergence D15 admits pointing the way it admits', () => {
    // Entering focus the globe shows MORE than the panel declares: the
    // crowd is still dimming while the count has already dropped. A number
    // the eye catches up with, and the only gap the invariant allows.
    const fade = createFocusFade();
    fade.sample('cc', 0, false);
    const mid = fade.sample('cc', FOCUS_FADE_MS / 2, false);
    expect(mid).toBeGreaterThan(0);

    const drawn: string[] = [];
    const rendered = describeVisibleFleet(
      FLEET,
      ruleFor('cc'),
      'cc',
      (a) => drawn.push(a.icao24),
      mid
    );
    const declared = describeVisibleFleet(FLEET, ruleFor('cc'), 'cc');
    expect(drawn).toHaveLength(rendered.shown);
    expect(rendered.shown).toBeGreaterThan(declared.shown);
  });
});
