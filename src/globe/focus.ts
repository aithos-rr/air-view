/**
 * 300ms, inside the 200-400ms editorial window DESIGN.md sets for state
 * changes. Below 200 the others blink out and the eye reads a glitch;
 * above 400 the user waits for the globe to finish agreeing with them.
 */
export const FOCUS_FADE_MS = 300;

/**
 * How far through the transition we are, 0 at the start and 1 at the end.
 *
 * Clamped at both ends on purpose. rAF timestamps are monotonic by
 * specification, but the first frame after a tab comes back from the
 * background carries a delta that means nothing, and an unclamped
 * smoothstep would hand the renderer a negative brightness.
 */
export function fadeAmount(elapsedMs: number, reducedMotion: boolean): number {
  // prefers-reduced-motion asked for no animation, not for a faster one.
  if (reducedMotion) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= FOCUS_FADE_MS) return 1;
  const t = elapsedMs / FOCUS_FADE_MS;
  return t * t * (3 - 2 * t); // smoothstep: no velocity jump at either end
}

export interface FocusFade {
  /**
   * @param focusedIcao who the view is about, or null.
   * @param nowMs a MONOTONIC timestamp — the argument rAF already passes to
   *   animate(). Never Date.now(): measured on this machine it moves by
   *   ~528 ms every ~32 s, which here would end the fade before it starts.
   * @returns the brightness multiplier for the aircraft that are NOT the
   *   focused one: 0 once the fade INTO focus has finished, and 1 outside
   *   focus — immediately, on the first frame after one ends. Only the
   *   entry is animated; see createFocusFade for why the exit must not be.
   */
  sample(focusedIcao: string | null, nowMs: number, reducedMotion: boolean): number;
}

/**
 * The transition's only piece of state, kept out of the stores because it
 * changes every frame and nothing outside the render loop can use it.
 *
 * ONE direction is animated, and that is the invariant rather than a
 * shortcut. Entering focus the crowd dims from 1 to 0 while the panel has
 * already dropped to the settled count: for those ~300 ms the globe shows
 * MORE than the panel declares, which is the single divergence D15 admits.
 * Leaving focus is that same divergence with the sign flipped — and that
 * one is forbidden — so leaving focus is not animated at all.
 */
export function createFocusFade(): FocusFade {
  let currentIcao: string | null = null;
  /**
   * When the CURRENT focus began. Read only while one is in force, which
   * is why there is no "nothing has happened yet" value left to get wrong.
   * The first draft kept a changedAtMs that the very first sample set to
   * nowMs even with focusedIcao already null, then returned
   * fadeAmount(0) = 0: brightness zero for every aircraft while none was
   * focused, so the globe mounted EMPTY for ~300 ms, every time. Here
   * `focusedIcao === null` answers before this number is ever looked at,
   * so that state cannot be reached from any clock reading.
   */
  let focusStartedAtMs = 0;

  return {
    sample(focusedIcao, nowMs, reducedMotion) {
      if (focusedIcao !== currentIcao) {
        currentIcao = focusedIcao;
        focusStartedAtMs = nowMs;
      }
      // No focus, full sky, on THIS frame — never a ramp back up from 0.
      // A fade-IN is D15's admitted divergence pointing the forbidden way:
      // readVisibilityRule has already dropped the focus, so
      // describeVisibleFleet counts the whole fleet in `shown`, `reason` is
      // null and ShortfallNotes prints nothing, while AircraftLayer.update
      // multiplies every point by ~0 and the globe is blank. Two to four
      // frames of a screen showing LESS than it declares, with nothing on
      // it to say so — reached with Esc, with the card's ✕, with a click on
      // empty space, and with no act of the user at all when the server
      // prunes the focused aircraft (D13).
      if (focusedIcao === null) return 1;
      return 1 - fadeAmount(nowMs - focusStartedAtMs, reducedMotion);
    },
  };
}
