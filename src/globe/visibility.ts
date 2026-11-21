import type { Aircraft } from '@/types';

export interface VisibilityRule {
  showComplete: boolean;
  showPartial: boolean;
  /** Non-null means focus: one aircraft chosen by hand, everything else gone. */
  focusedIcao: string | null;
}

/**
 * Every hiding rule in the application, in one function.
 *
 * Three features hide aircraft — the category filter, focus on one flight,
 * and the search isolating a flight — and written in three places they would
 * drift: the renderer would hide an aircraft the picker still selects, and
 * the panel's count would disagree with what is on screen. The layers, the
 * trails and the raycaster all ask THIS.
 *
 * Focus beats the filter on purpose. Switching the greys off and then
 * searching for a grey flight must show that flight: an act aimed at one
 * aircraft is more specific than a rule about a category, and the opposite
 * reads as a search box that does nothing.
 */
export function isAircraftVisible(ac: Aircraft, rule: VisibilityRule): boolean {
  if (rule.focusedIcao !== null) return ac.icao24 === rule.focusedIcao;
  return ac.complete ? rule.showComplete : rule.showPartial;
}

/**
 * Can this aircraft be the SUBJECT of a focus?
 *
 * Focus hides every other aircraft, so it is a promise that the one left is
 * on the globe. An aircraft without coordinates is not: the renderer drops
 * a record with a null latitude or longitude BEFORE it looks at who is
 * selected, and so do the trails and the picker. Focusing it would hide the
 * whole fleet to draw nobody — an empty globe, with nothing on screen to
 * say why (D13).
 *
 * Null coordinates are deliberate, not a corruption: the adapters write
 * null when the provider sent no position (src/data/sources/adsbLol.ts:
 * 30-31), rather than inventing one. Such an aircraft cannot be clicked on
 * the globe, but it IS reachable — AircraftList lists everything with a
 * callsign and the search looks up callsigns — so this is a door that is
 * open today, not a defensive hypothetical.
 */
export function isFocusable(ac: Aircraft): boolean {
  return ac.latitude !== null && ac.longitude !== null;
}

/**
 * The rule that hides nothing.
 *
 * Exists so tests and any future caller state "no filtering" explicitly
 * instead of omitting an argument. A default parameter meaning "show
 * everything" would be a second place where the rule lives, which is the
 * drift this module exists to prevent.
 */
export const SHOW_ALL: VisibilityRule = {
  showComplete: true,
  showPartial: true,
  focusedIcao: null,
};

/** Why a record in the fleet is not a dot on the globe. */
export type Shortfall = 'filtered' | 'focus' | 'noPosition' | 'rendererFull';

/** Which point set a drawn aircraft belongs to. */
export type DrawTarget = 'selected' | 'complete' | 'partial';

export interface VisibleFleet {
  /** Records in the fleet — what the HUD has counted since v1. */
  total: number;
  /** Dots on the globe. The panel prints THIS, never a derived number. */
  shown: number;
  /** total - shown, split by cause. The four always account for all of it. */
  hidden: Record<Shortfall, number>;
  /** The cause behind the largest share of the hidden, or null when none is. */
  reason: Shortfall | null;
  /**
   * How many of `hidden.focus` the filters would let through once the
   * focus ended — the MEASUREMENT behind the promise the panel is about to
   * make, not a guess at it. "Esc shows them again" was printed
   * unconditionally, and with both switches off it was false: the focus
   * was the only thing putting an aircraft on the globe, so Esc gave back
   * nobody and emptied the sky instead. A promise is a claim about the
   * next frame, and D15b forbids a claim nobody measured as firmly as it
   * forbids an unmeasured cause.
   *
   * NOT a fifth member of `hidden`: those records are already counted
   * under `focus`, and a fifth key would break the identity above.
   */
  releasedByLeavingFocus: number;
}

/**
 * MAX_PAYLOAD_AIRCRAFT in server/index.ts is 24 000, so neither category can
 * exceed it today; the cap is here to be DECLARED rather than hit silently
 * the day the payload grows, which is how v1's 18 000 ceiling emptied the
 * globe without a word.
 */
export const RENDER_CAPS = { perCategory: 24000, selected: 8 } as const;

/** Below this an additive point contributes nothing a screen can show. */
const INVISIBLE = 0.004;

const SHORTFALL_ORDER: readonly Shortfall[] = [
  'filtered', 'focus', 'noPosition', 'rendererFull',
];

/**
 * How many aircraft the globe is drawing, and the name of every reason the
 * rest are not. One pass, one answer, two readers (D15).
 *
 * The renderer passes `onDraw` and this walk IS its draw loop: it no longer
 * decides for itself who gets a point, it writes where this function says.
 * The panel calls the same function without `onDraw` and prints `shown` and
 * `hidden`. The two figures cannot disagree because they are one figure,
 * produced by one `for`. Three rounds of review found ten defects where a
 * screen showed less than it claimed; every one of them was two pieces of
 * code answering the same question apart.
 *
 * This is NOT a second predicate beside isAircraftVisible: it CALLS that
 * one, and its whole contribution is naming which clause said no. A rule
 * invented here would be the drift the module exists to prevent.
 *
 * `shown + hidden.filtered + hidden.focus + hidden.noPosition +
 * hidden.rendererFull === total` holds by construction — every record
 * increments exactly one counter and then leaves the iteration — so a
 * future `continue` cannot be added silently: it would break the identity
 * the table test asserts on every state.
 *
 * @param othersBrightness the live fade of Task 4 for the renderer. The
 *   panel passes nothing and gets the SETTLED value of the rule in hand —
 *   0 under a focus, 1 without one — because it has no render loop to read
 *   a fade from. That sentinel is DERIVED rather than fixed at 0 on
 *   purpose: a literal 0 meant both "settled" and "invisible", and the
 *   collision of those two meanings is where the exit fade hid. Entering
 *   focus the globe shows MORE than the panel declares for ~300 ms and
 *   converges within FOCUS_FADE_MS; LEAVING it there is no gap at all,
 *   because createFocusFade returns 1 the instant focusedIcao is null
 *   (Task 4, Step 3). A brightness below INVISIBLE therefore reaches this
 *   function only while a focus is in force, which is the contract the
 *   branch below depends on.
 */
export function describeVisibleFleet(
  aircraft: Iterable<Aircraft>,
  rule: VisibilityRule,
  selectedIcao: string | null,
  onDraw?: (ac: Aircraft, target: DrawTarget, slot: number) => void,
  // The settled state of the rule in hand, which is what the panel means
  // when it passes nothing: the crowd out under a focus, lit without one.
  othersBrightness = rule.focusedIcao !== null ? 0 : 1,
  caps: { perCategory: number; selected: number } = RENDER_CAPS
): VisibleFleet {
  const hidden: Record<Shortfall, number> = {
    filtered: 0, focus: 0, noPosition: 0, rendererFull: 0,
  };
  let releasedByLeavingFocus = 0;
  // Hoisted: the loop runs over up to 24 000 records at 60fps, and a fresh
  // object per aircraft would be 1,4 million allocations a second.
  const categoryRule: VisibilityRule = { ...rule, focusedIcao: null };
  let total = 0;
  let shown = 0;
  let nSelected = 0;
  let nComplete = 0;
  let nPartial = 0;

  for (const ac of aircraft) {
    total += 1;

    // First, before anything about selection: a record with no coordinates
    // is not drawable by anybody. This is the count D14 once deferred for
    // want of a measurement — and here the measurement is free.
    if (ac.latitude === null || ac.longitude === null) {
      hidden.noPosition += 1;
      continue;
    }

    // The subject of the view is drawn whatever the filters say: an act
    // aimed at one aircraft is more specific than a rule about a category
    // (D7). It is counted in `shown` for the same reason — it is on screen.
    if (ac.icao24 === selectedIcao) {
      if (nSelected >= caps.selected) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'selected', nSelected);
      nSelected += 1;
      shown += 1;
      continue;
    }

    // Under focus everyone else leaves by fading, so they are still on
    // screen — and still counted — until the fade has actually finished.
    if (rule.focusedIcao !== null && othersBrightness <= INVISIBLE) {
      hidden.focus += 1;
      // What ending the focus would actually hand back, measured in the
      // same pass and for the same reason as every other number here: the
      // panel offers Esc as the way to these aircraft, and an offer is a
      // claim about the next frame. With both switches off this stays 0,
      // and the note says so instead of promising a sky Esc cannot give.
      if (isAircraftVisible(ac, categoryRule)) releasedByLeavingFocus += 1;
      continue;
    }

    // The filter keeps applying mid-fade: an aircraft the user had already
    // switched off must not reappear because a focus started.
    if (!isAircraftVisible(ac, categoryRule)) {
      hidden.filtered += 1;
      continue;
    }

    if (ac.complete) {
      if (nComplete >= caps.perCategory) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'complete', nComplete);
      nComplete += 1;
    } else {
      if (nPartial >= caps.perCategory) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'partial', nPartial);
      nPartial += 1;
    }
    shown += 1;
  }

  let reason: Shortfall | null = null;
  for (const k of SHORTFALL_ORDER) {
    if (hidden[k] > 0 && (reason === null || hidden[k] > hidden[reason])) reason = k;
  }
  return { total, shown, hidden, reason, releasedByLeavingFocus };
}
