import { Vector3 } from 'three';
import { isInView, isOnNearSide, slerpUnit } from './geoHelpers';
import { smoothstep } from './focus';
import type { FocusOrigin, FocusSightline } from '@/state/selectionStore';

/**
 * D34 — The camera brings the flight into view when the focus came from a
 * SEARCH or from the LIST, and never when it came from a click on the globe.
 *
 * The principle, which settles every case this file does not name:
 * **navigate when the user could not have known where the thing was; do not
 * navigate when they pointed at it with their finger.**
 *
 *  - A click on an aircraft ON THE GLOBE: they were looking at it, it was
 *    under the cursor. Moving the camera takes away the view they chose, in
 *    order to show them what they were already seeing.
 *  - A flight number typed into the search box, or a row in a list of
 *    thousands: they have no idea where it is. They asked to be taken to
 *    it. And focus draws ONE aircraft out of ~12 000 (D6/D7), so a subject
 *    on the far side means the screen shows them NOTHING of what they asked
 *    for, while the panel says "1 shown" — the sentence D15 forbids,
 *    reached this time through the camera.
 *
 * D32 declared this an open product decision and wrote down the one line of
 * scene.ts that would change if the answer were ever yes. This is that
 * answer, and it is yes for two of the three doors into focus. D32's other
 * half survives intact and is now live on BOTH sides: the "behind the globe"
 * note appears when the user clicked an aircraft and then dragged it out of
 * sight, and never appears after a search — which is precisely what D32 said
 * it would do if a camera ever followed.
 *
 * What it moves, and what it refuses to move:
 *
 *  - **It rotates; it never zooms.** How much world to show is a deliberate
 *    choice of the user's. turnPosition preserves |camera.position| exactly,
 *    and the orbit target stays the origin because everything else in
 *    scene.ts — viewCentre(), the leader line, the D/A markers — assumes the
 *    camera looks at the centre.
 *  - **Nothing happens when the flight is already ON SCREEN.** The test is
 *    isInView, which measures the cap the lens actually frames — not
 *    isOnNearSide, which measures half a planet. The visible SIDE is very
 *    much larger than the FRAME at every zoom closer than the
 *    mount distance: at the near end of the travel the near side reaches
 *    38 degrees off the view axis and the frame reaches 5,4. Gating on
 *    the hemisphere meant a flight could be on the right side of the
 *    globe, out of the frame, and the camera would decline to move — the
 *    user searches a flight, the card appears, and the globe shows
 *    nothing, which is the exact case this file exists for. The radius is
 *    visibleCapRadiusNm, the same number viewCentre() sends the server to
 *    prioritise tiles by, so the camera and the feed cannot disagree
 *    about what "on screen" means.
 *  - **The user always wins.** A drag or a wheel ends the turn where it
 *    stands and it does not resume. The controls are never taken out of
 *    anyone's hands.
 *  - **The subject can vanish.** The server prunes every cycle; flying on to
 *    where a flight used to be would be the camera pointing at nothing.
 *  - **prefers-reduced-motion gets a CUT, not a faster rotation** — the same
 *    treatment focus.ts gives the focus fade. A long rotation for someone
 *    who gets vertigo from one is the opposite of a favour, and a short one
 *    is still a rotation.
 */
export function bringsIntoView(origin: FocusOrigin): boolean {
  // A switch, not `origin !== 'globe'`, so that a fourth way into focus
  // cannot be added without answering this question for it: an unhandled
  // member makes this function fall off its end, and a function declared to
  // return boolean that can return undefined does not compile.
  switch (origin) {
    case 'globe':
      return false;
    case 'list':
    case 'search':
      return true;
  }
}

/**
 * 900 ms — "una bella rotazione lenta, tranquilla", in the user's words.
 *
 * Three times the 300 ms editorial window DESIGN.md sets for state changes
 * (FOCUS_FADE_MS), and the multiple IS the argument. A fade is one thing
 * becoming another in place, which the eye takes in without following it.
 * This is a TRAVEL, and a travel has to be followed to be understood —
 * "from where to where" is the entire content of the motion, and half a
 * globe crossed in 300 ms delivers only "something changed".
 *
 * Bounded from above by what the wait costs, which is almost nothing and
 * therefore not nothing: the flight card, the callsign and the route are on
 * screen from the FIRST frame of the turn, so the rotation is the only
 * thing still arriving. Past about a second a reassurance becomes an
 * animation to sit through. That upper end is a judgement, stated as one;
 * the lower end is the ratio above.
 *
 * ONE number for every angle, deliberately. A duration proportional to the
 * angle would make the same gesture take a different time on every flight,
 * and this rotation is a reassurance, not a measurement.
 */
export const TURN_MS = 900;

/**
 * Where the camera is, a fraction of the way from where it started to over
 * the flight. Pure: the whole motion is here, testable without a browser.
 *
 * @param start where the camera was when the turn BEGAN — not where it is
 *   now. Re-slerping each frame from the current position against a growing
 *   t would ease into a crawl that never arrives.
 * @param target the flight's world position. Only its direction is used;
 *   its distance is the globe's business, not the camera's.
 * @param progress 0..1, clamped. The easing is applied here so that one
 *   place decides the shape of the motion.
 */
export function turnPosition(start: Vector3, target: Vector3, progress: number): Vector3 {
  const distance = start.length();
  const reach = target.length();
  // No direction, no turn. Unreachable from scene.ts — the orbit controls
  // hold the camera at 1,9 units or more and an aircraft sits above the
  // surface — but a zero vector here would normalise to NaN and blank the
  // screen, and that is too quiet a way to fail.
  if (distance === 0 || reach === 0) return start.clone();

  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : smoothstep(progress);
  const from = start.clone().divideScalar(distance);
  const to = target.clone().divideScalar(reach);
  return slerpUnit(from, to, t).multiplyScalar(distance);
}

/**
 * What the turn needs to know about the camera: where it sits, and how
 * much of the globe its lens frames from there. A three PerspectiveCamera
 * satisfies it as it stands, so scene.ts passes the camera itself and the
 * tests build one by hand with no WebGL in sight.
 *
 * An object rather than one more positional argument, because the argument
 * it would sit beside — nowMs — is also a number, and two numbers swapped
 * at a call site compile perfectly and then run the turn against a field
 * of view of 1 000 ms.
 */
export interface CameraView {
  readonly position: Vector3;
  readonly fov: number;
}

export interface CameraTurn {
  /** A turn is in flight. */
  readonly active: boolean;
  /**
   * Begin travelling to this flight, replacing any turn already running.
   *
   * @param camera where the camera is and how wide its lens is, right now.
   * @param target the flight's world position, FROZEN here. It is not
   *   re-aimed per frame: at 472 kt a flight covers 0,12 NM in 900 ms,
   *   which is a fraction of a pixel, and a target that moved while being
   *   approached would make the motion impossible to reason about.
   * @param nowMs a MONOTONIC timestamp — the rAF argument. Never Date.now(),
   *   which on this machine jumps ~528 ms every ~32 s and would end this
   *   turn before it began.
   * @returns whether anything will move. False when the flight is already
   *   INSIDE THE FRAME, which is the ordinary case for a list row beside a
   *   dot the user can see and the reason this is idempotent. Not "on the
   *   near side": that is half a planet, most of it off screen at any
   *   zoom closer than the mount distance.
   */
  begin(camera: CameraView, target: Vector3, nowMs: number, reducedMotion: boolean): boolean;
  /**
   * The camera position for this frame, or null when nothing is in flight.
   *
   * @param subjectStillOnTheGlobe whether the flight is still in the payload
   *   and still placeable. Not a new target: a flight that has gone ends the
   *   turn.
   */
  sample(nowMs: number, subjectStillOnTheGlobe: boolean): Vector3 | null;
  /** The user took the controls. Stop here, and do not resume. */
  cancel(): void;
}

/**
 * The turn's state, kept out of the stores for the reason createFocusFade's
 * is: it changes every frame and nothing outside the render loop can use it.
 */
export function createCameraTurn(): CameraTurn {
  /** Where the camera was when this turn began — null when none is running. */
  let start: Vector3 | null = null;
  const target = new Vector3();
  let startedAtMs = 0;
  /**
   * Zero under prefers-reduced-motion, which is what makes that case a CUT
   * rather than a short rotation: the first sample is already at progress 1.
   */
  let durationMs = TURN_MS;

  return {
    get active(): boolean {
      return start !== null;
    },

    begin(camera, aircraftPos, nowMs, reducedMotion) {
      // A new focus replaces the old one whatever it decides, so a turn
      // already in flight never outlives the act that started it.
      start = null;
      // THE FRAME, not the hemisphere. See the note at the top of the file:
      // an aircraft on the near side but outside the frame is on screen
      // nowhere at all, and that is precisely the flight the user went
      // looking for by name.
      if (isInView(camera.position, aircraftPos, camera.fov)) return false;
      start = camera.position.clone();
      target.copy(aircraftPos);
      startedAtMs = nowMs;
      durationMs = reducedMotion ? 0 : TURN_MS;
      return true;
    },

    sample(nowMs, subjectStillOnTheGlobe) {
      if (start === null) return null;
      if (!subjectStillOnTheGlobe) {
        start = null;
        return null;
      }
      const progress = durationMs <= 0 ? 1 : (nowMs - startedAtMs) / durationMs;
      const here = turnPosition(start, target, progress);
      if (progress >= 1) start = null;
      return here;
    },

    cancel() {
      start = null;
    },
  };
}

/**
 * What the panel is allowed to say about where the flight in focus is.
 *
 * D32's line — "behind the globe — drag to bring it round" — was
 * recalculated every frame from the live camera, and with a camera that
 * now travels (D34) that made it lie twice over:
 *
 *  (a) DURING the rotation it told the user to drag the flight into view
 *      while the camera was already carrying it there. Advice that is not
 *      needed is bad enough; advice to do by hand what is happening by
 *      itself says that nothing is happening, which is the opposite of
 *      the truth and the one impression a reassurance must not leave.
 *  (b) It was true for the first frames of a rotation about to resolve
 *      it, so it blinked: printed, then withdrawn ~300 ms later with no
 *      act of the user in between.
 *
 * D15's principle settles it: the line declares the state, and "behind the
 * globe but already on its way" is a DIFFERENT state from "behind the
 * globe and staying there". So this returns three values and not a
 * boolean, and the impossible fourth combination — in sight and still
 * arriving — cannot be written down.
 *
 * Saying it is arriving, rather than falling silent for the length of the
 * turn: silence would re-open the very gap D32 closed. For up to 900 ms
 * the panel would go on reading "1 of 5 900 aircraft" over a globe with
 * nothing on it and offer no account of why — which is D15a's forbidden
 * sentence, reached this time through the camera. The user is owed the
 * reason the screen is empty for as long as it is empty; what they are not
 * owed is an instruction to fix it themselves.
 *
 * Pure, and therefore testable without a browser: scene.ts is the only
 * thing in the application with a camera, and nothing in it can be unit
 * tested.
 *
 * @param subjectWorld the focused flight's position, or null when there is
 *   no focus or it cannot be placed — in which case there is nothing to
 *   say about it.
 * @param turning whether a camera turn is in flight. It is the turn
 *   towards THIS flight by construction: a new focus either begins its own
 *   or cancels the one running (scene.ts).
 */
export function sightlineOf(
  cameraPos: Vector3,
  subjectWorld: Vector3 | null,
  turning: boolean
): FocusSightline {
  if (subjectWorld === null) return 'in-sight';
  // The same dot product the vertex shader culls by, so the words and the
  // picture cannot disagree about where this aircraft is (D25/D32). The
  // LIMB and not the frame: this line is about the globe standing in the
  // way, which a drag fixes; an aircraft on the near side but off the edge
  // of the screen is a different sentence, and the camera turn above is
  // what answers it.
  if (isOnNearSide(cameraPos, subjectWorld)) return 'in-sight';
  return turning ? 'arriving' : 'hidden';
}
