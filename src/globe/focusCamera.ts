import { Vector3 } from 'three';
import { bringsIntoView, createCameraTurn, sightlineOf } from './cameraTurn';
import type { CameraTurn, CameraView } from './cameraTurn';
import type { FocusOrigin, FocusSightline } from '@/state/selectionStore';

/**
 * The camera's whole answer to one frame: whether a journey begins, whether
 * one is already under way and where it has got to, and what the panel is
 * allowed to say about the flight while it happens.
 *
 * It exists because of where those decisions used to live. The turn itself
 * (cameraTurn.ts) was pure and tested to the millisecond, but the three
 * lines that DECIDED to start it, to abandon it and to publish its
 * consequence sat inside animate() and inside a DOM listener — the one part
 * of this application a unit test cannot reach, because it wants a canvas
 * and a stream of frames. A mutation campaign made the cost of that exact:
 * six mutants planted in scene.ts and in the turn's own gate left all 612
 * tests green while inverting, one at a time, every choice the user had
 * just made. The camera chased a flight they had POINTED AT; it declined to
 * chase one they had NAMED; a drag no longer stopped it; and the panel told
 * them to drag a flight into view while the camera was already carrying it
 * there.
 *
 * The answer is the one Piano 3 used on server/index.ts, where seventeen
 * surviving mutants died the day enrich, lookupPolicy, providerLock and
 * routeCache were lifted out of the request handler: the decisions become a
 * small object with injectable state, and the render loop goes back to
 * being the thing that CALLS them rather than the thing that makes them.
 *
 * Nothing here draws, measures a canvas or touches a store. Everything that
 * reaches the outside world does so through the two ports below, which is
 * what lets a test drive a whole journey — frame by frame, on a clock it
 * owns — with no browser in sight.
 */
export interface FocusCameraPorts {
  /**
   * The globe stops turning by itself.
   *
   * Called on every frame a flight is in focus, and whenever the user puts
   * a hand on the canvas. scene.ts's own latch makes the repetition free;
   * repeating it is what keeps "focus stops the idle spin" true for the
   * SECOND flight the user focuses as well as the first.
   */
  stopAutoRotate: () => void;
  /**
   * Where the answer about the far side goes — the selection store, in the
   * application.
   *
   * Called only when the answer CHANGES, which is at most when the subject
   * crosses the limb or a turn begins or ends. Sixty writes a second of the
   * same value would wake every subscriber of that store for nothing.
   */
  publishSightline: (sightline: FocusSightline) => void;
  /**
   * How many acts of focusing happened BEFORE this camera existed.
   *
   * Not this camera's to answer: a flight already in focus when the scene
   * mounts is not a NEW act, and a camera that travelled on its first frame
   * would move a view nobody had just asked it to move.
   */
  focusSeqAtMount: number;
  /**
   * The turn itself. Injectable so a test can hand in one it drives, and so
   * this module's own tests can tell "the journey was abandoned" apart from
   * "the journey finished".
   */
  turn?: CameraTurn;
}

/**
 * Everything about this frame the decision depends on, read by the caller
 * from the stores and the camera and handed over as plain values.
 */
export interface FocusFrame {
  /**
   * Where the camera is and how wide its lens is, BEFORE this frame moves
   * it. The lens is in here because what counts as "already on screen" is
   * the cap the lens frames, not the hemisphere (D34).
   */
  camera: CameraView;
  /**
   * The focused flight's world position, or null when there is no focus or
   * the flight cannot be placed. A journey needs somewhere to go, and the
   * sentence about the far side needs something to be about.
   */
  subjectWorld: Vector3 | null;
  /**
   * Whether a flight is in focus at all.
   *
   * Deliberately NOT `subjectWorld !== null`: the globe stops turning by
   * itself the moment a flight is focused, including a flight whose
   * position the feed never sent. A globe that goes on spinning carries the
   * ONE aircraft it is drawing round behind the planet while the viewer
   * reads the card (D32), and that is just as true of an aircraft that is
   * not being drawn at all.
   */
  inFocus: boolean;
  /** See FocusAct. */
  focusSeq: number;
  focusOrigin: FocusOrigin | null;
  /**
   * The rAF timestamp. MONOTONIC, always — never Date.now(), which on this
   * machine jumps ~528 ms every ~32 s and would end a 900 ms turn before it
   * began.
   */
  nowMs: number;
  reducedMotion: boolean;
}

/**
 * The two fields that tell a NEW act of focusing from the same focus still
 * standing. Named as one thing because they are only ever read together,
 * and because an origin read one frame apart from its sequence number would
 * be an origin describing a different act.
 */
export interface FocusAct {
  focusSeq: number;
  focusOrigin: FocusOrigin | null;
}

export interface FocusCamera {
  /**
   * This frame's answer.
   *
   * @returns where to put the camera, or null to leave it exactly where the
   *   user left it. Null is the ordinary case: no journey is running, or
   *   the one that was has been abandoned.
   */
  step(frame: FocusFrame): Vector3 | null;
  /**
   * The user put a hand on the globe — a drag, a wheel.
   *
   * The idle spin stops, and any journey of ours stops where it stands and
   * does not resume. "The user always wins" is worth nothing if it only
   * wins the first time, so this is unconditional (D34).
   */
  handOverToUser(): void;
}

export function createFocusCamera(ports: FocusCameraPorts): FocusCamera {
  const turn = ports.turn ?? createCameraTurn();
  /** The last act of focusing this camera has answered. */
  let lastSeq = ports.focusSeqAtMount;
  /**
   * The last answer published. 'in-sight' because that is what the store
   * already holds at mount: publishing it again would be a write that
   * changes nothing.
   */
  let published: FocusSightline = 'in-sight';

  return {
    handOverToUser(): void {
      ports.stopAutoRotate();
      // The half that six hundred tests did not hold down. Without it a
      // drag moves the camera while the turn moves it back, sixty times a
      // second, until the turn runs out — the controls taken out of the
      // user's hands, in the one application where the globe is the
      // control.
      turn.cancel();
    },

    step(frame): Vector3 | null {
      // Entering focus stops the globe turning by itself, exactly as a drag
      // or a wheel does. Focus arrives from the panel, the list or the
      // search — none of which touches the canvas — and a globe that goes
      // on turning carries the one aircraft it is drawing round behind the
      // planet while the viewer reads the card (D32).
      if (frame.inFocus) ports.stopAutoRotate();

      if (frame.focusSeq !== lastSeq) {
        lastSeq = frame.focusSeq;
        if (
          frame.focusOrigin !== null &&
          // D34, and the whole reason focusOrigin is carried through the
          // store rather than inferred here: NAMED, not POINTED AT. A click
          // on the globe was the user looking straight at the thing, and
          // taking away the view they chose in order to show them what they
          // were already seeing is the one move this camera must not make.
          bringsIntoView(frame.focusOrigin) &&
          frame.subjectWorld !== null
        ) {
          turn.begin(frame.camera, frame.subjectWorld, frame.nowMs, frame.reducedMotion);
        } else {
          // A new focus ends the previous journey even when it asks for
          // none: a camera still flying to the last flight while the panel
          // describes this one is two answers to one question.
          turn.cancel();
        }
      }

      const moveTo = turn.active ? turn.sample(frame.nowMs, frame.subjectWorld !== null) : null;

      // AFTER the sample, so a flight just brought round is never announced
      // as being behind the planet; and WITH the turn's own state, so a
      // flight that IS behind the planet with the camera coming round to it
      // is never told to drag it into view itself. That advice was true of
      // the first frames of every rotation about to resolve it, which made
      // the line blink and said "nothing is happening" at the exact moment
      // something was (D15/D34).
      const sightline = sightlineOf(moveTo ?? frame.camera.position, frame.subjectWorld, turn.active);
      if (sightline !== published) {
        published = sightline;
        ports.publishSightline(sightline);
      }

      return moveTo;
    },
  };
}

/**
 * The canvas hands the controls back to the user: a pointer going down, a
 * wheel turning.
 *
 * Here rather than in scene.ts because the WIRING is part of the promise.
 * "A drag stops the camera" is two things — a handler that cancels, and a
 * handler that is actually attached — and a test that only exercises the
 * first proves half of it. This half is a jsdom EventTarget away from
 * testable; the render loop around it is not.
 *
 * It takes the camera and not a callback on purpose: a caller free to pass
 * its own function is a caller free to pass one that does not cancel, which
 * is exactly the defect this file was written to close.
 *
 * @returns the disposer, to be called when the scene goes away.
 */
export function attachUserTakeover(target: EventTarget, camera: FocusCamera): () => void {
  const handOver = (): void => camera.handOverToUser();
  target.addEventListener('pointerdown', handOver);
  // Passive: this never calls preventDefault, and saying so lets the
  // browser scroll without waiting to find out.
  target.addEventListener('wheel', handOver, { passive: true });
  return () => {
    target.removeEventListener('pointerdown', handOver);
    target.removeEventListener('wheel', handOver);
  };
}
