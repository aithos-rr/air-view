import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  TURN_MS,
  bringsIntoView,
  createCameraTurn,
  sightlineOf,
  turnPosition,
} from '@/globe/cameraTurn';
import type { CameraView } from '@/globe/cameraTurn';
import type { FocusSightline } from '@/state/selectionStore';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  isInView,
  isOnNearSide,
  latLonAltToVec3,
} from '@/globe/geoHelpers';

/** The lens scene.ts mounts: three's VERTICAL field of view, in degrees. */
const FOV = 38;

/** A camera for the turn: where it is, and how much it frames from there. */
function view(position: Vector3, fov: number = FOV): CameraView {
  return { position, fov };
}

/** The camera as scene.ts mounts it: behind the Atlantic, looking at the origin. */
function defaultCamera(): Vector3 {
  return new Vector3(-1.2, 0.6, 4.6);
}

/** A flight roughly at the antipode of that view — the whole globe away. */
function farSideFlight(): Vector3 {
  return latLonAltToVec3(10, 170, 38000, CAMERA_FAR_LIMIT);
}

/**
 * The angle between two directions, in radians.
 *
 * atan2(|a x b|, a . b) rather than acos(a . b), because the easing test
 * below subtracts these angles from one another and acos throws away half
 * its digits exactly where that subtraction happens: near 0 — the first
 * frames of a turn — and near pi, which is where a flight on the far side
 * of the planet starts out. atan2 of the cross and the dot is accurate
 * across the whole range, and the difference between two quarters of a
 * rotation is a real measurement here, not a rounding.
 */
function angleRad(a: Vector3, b: Vector3): number {
  const ua = a.clone().normalize();
  const ub = b.clone().normalize();
  return Math.atan2(ua.clone().cross(ub).length(), ua.dot(ub));
}

/**
 * The two point the same way.
 *
 * Componentwise rather than `angleRad(...) ≈ 0`, because acos is at its
 * worst exactly where that assertion lives: near a dot product of 1 it
 * resolves no finer than sqrt(eps) ≈ 1,5e-8 rad, which is about a tenth of
 * a millimetre on the ground and nothing to do with the arithmetic under
 * test. This compares the directions themselves, and is the stricter test.
 */
function expectSameDirection(a: Vector3, b: Vector3): void {
  const ua = a.clone().normalize();
  const ub = b.clone().normalize();
  expect(ua.x).toBeCloseTo(ub.x, 12);
  expect(ua.y).toBeCloseTo(ub.y, 12);
  expect(ua.z).toBeCloseTo(ub.z, 12);
}

describe('bringsIntoView — the decision itself (D34)', () => {
  it('leaves the view alone when the user pointed at the flight with the cursor', () => {
    // They were looking at it. Moving the camera would take away the view
    // they chose in order to show them what they were already seeing.
    expect(bringsIntoView('globe')).toBe(false);
  });

  it('travels when the flight was named rather than pointed at', () => {
    // A flight number typed into the box, or a row in a list of five
    // thousand: the user has no idea where on the globe it is, and under
    // focus the globe draws that one aircraft and nothing else — so if it
    // is on the far side they are shown NOTHING of what they asked for.
    expect(bringsIntoView('search')).toBe(true);
    expect(bringsIntoView('list')).toBe(true);
  });
});

describe('turnPosition — rotate, never zoom', () => {
  it('keeps the camera exactly as far out as the user left it', () => {
    // How much world to show is a deliberate choice of theirs. The turn
    // answers "where", never "how close".
    const start = defaultCamera();
    const d = start.length();
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(turnPosition(start, farSideFlight(), p).length()).toBeCloseTo(d, 12);
    }
  });

  it('starts where the camera was and ends over the flight', () => {
    const start = defaultCamera();
    const target = farSideFlight();
    expectSameDirection(turnPosition(start, target, 0), start);
    expectSameDirection(turnPosition(start, target, 1), target);
  });

  it('brings a flight on the far side round to the near one', () => {
    // The whole purpose, stated in the terms the vertex shader and the
    // picker already use.
    const start = defaultCamera();
    const target = farSideFlight();
    expect(isOnNearSide(start, target)).toBe(false);
    expect(isOnNearSide(turnPosition(start, target, 1), target)).toBe(true);
  });

  it('eases in and out instead of travelling at one rate', () => {
    // "Slow and calm", in the user's words: a constant rate starts and
    // stops with a jolt, and the jolt is what reads as the globe being
    // yanked rather than turned.
    //
    // This test carries the name of the thing it protects, and the first
    // version of it did not protect it: `at(0.25) < 0.25 * total` is a
    // comparison a LINEAR turn also passes, by whatever side of the last
    // bit the floating point happens to fall on. Deleting smoothstep from
    // turnPosition left all 598 tests green, this one included. What
    // follows measures the shape instead of brushing against it: the
    // distance covered in the first quarter of the turn against the
    // distance covered in the middle quarter. Under smoothstep those
    // stand at 0,15625 and 0,3671875 of the arc — a ratio of 2,35. At one
    // constant rate they are equal, and the ratio is exactly 1, which is
    // what "travelling at one rate" MEANS and what this now fails on.
    const start = defaultCamera();
    const target = farSideFlight();
    const total = angleRad(start, target);
    const at = (p: number): number => angleRad(start, turnPosition(start, target, p));

    const firstQuarter = at(0.25) - at(0);
    const middleQuarter = at(0.625) - at(0.375);
    const lastQuarter = at(1) - at(0.75);

    // It does move in the first quarter — an ease is not a wait.
    expect(firstQuarter).toBeGreaterThan(0);
    // The middle is more than twice as fast as the ends. 2,35 for
    // smoothstep, 1,00 for a constant rate: the margin is the measurement.
    expect(middleQuarter / firstQuarter).toBeGreaterThan(2);
    // The same gentleness at both ends, nothing favoured — and this one
    // holds for a linear turn too, which is why it is not left to stand
    // alone.
    expect(lastQuarter).toBeCloseTo(firstQuarter, 9);
    expect(at(0.5)).toBeCloseTo(0.5 * total, 9);

    // The two ends of the same statement, as absolute positions, with a
    // margin a constant rate cannot reach: smoothstep is 0,156 of the way
    // round at a quarter of the time and 0,844 at three quarters, against
    // 0,25 and 0,75.
    expect(at(0.25)).toBeLessThan(0.2 * total);
    expect(at(0.75)).toBeGreaterThan(0.8 * total);
  });

  it('clamps a progress that falls outside the turn', () => {
    // A tab returning from the background hands rAF a delta that means
    // nothing; focus.ts clamps for the same reason.
    const start = defaultCamera();
    const target = farSideFlight();
    expectSameDirection(turnPosition(start, target, -3), start);
    expectSameDirection(turnPosition(start, target, 4), target);
  });

  it('leaves the camera alone when the flight is already straight ahead', () => {
    const start = defaultCamera();
    const target = start.clone().normalize().multiplyScalar(1.53);
    expectSameDirection(turnPosition(start, target, 0.5), start);
  });

  it('still produces a camera position when the flight is at the exact antipode', () => {
    // No unique great circle joins two opposite points, and an unguarded
    // slerp divides by a sine of zero: NaN into camera.position, and a
    // blank screen with no error. Rare is not the same as impossible.
    const start = defaultCamera();
    const target = start.clone().normalize().multiplyScalar(-1.53);
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const here = turnPosition(start, target, p);
      expect(Number.isFinite(here.x)).toBe(true);
      expect(Number.isFinite(here.y)).toBe(true);
      expect(Number.isFinite(here.z)).toBe(true);
      expect(here.length()).toBeCloseTo(start.length(), 9);
    }
    expectSameDirection(turnPosition(start, target, 1), target);
  });
});

describe('createCameraTurn — when it runs, and when it gives up', () => {
  it('does not move a camera that is already framing the flight', () => {
    // Idempotent: if the subject is already on screen there is nothing to
    // bring round, and a turn to "improve the angle" would be the camera
    // helping itself.
    const turn = createCameraTurn();
    const start = defaultCamera();
    const underTheCamera = latLonAltToVec3(7, -15, 38000, CAMERA_FAR_LIMIT);
    expect(isInView(start, underTheCamera, FOV)).toBe(true);
    expect(turn.begin(view(start), underTheCamera, 1000, false)).toBe(false);
    expect(turn.active).toBe(false);
    expect(turn.sample(1000, true)).toBeNull();

    // And the same at the near end of the travel, where the frame is a
    // 40 NM cap: 0,3 degrees off the view axis is 18 NM, comfortably
    // inside it, and still nothing moves. It was 2 degrees against a
    // 321 NM cap while the travel ended at 1,9 — the same sentence, at
    // the distance the travel actually ends at now (D35).
    const zoomedIn = new Vector3(0, 0, CAMERA_NEAR_LIMIT);
    const justOffAxis = latLonAltToVec3(0, 0.3, 38000, CAMERA_FAR_LIMIT);
    expect(turn.begin(view(zoomedIn), justOffAxis, 1000, false)).toBe(false);
    expect(turn.active).toBe(false);
  });

  it('turns for a flight on the visible side that the frame does not reach', () => {
    // THE DEFECT the hemisphere gate carried. The visible SIDE is very
    // much larger than the FRAME at every zoom closer than the
    // mount distance: at the near end of the travel the near side reaches
    // 22,5 degrees off the view axis and the frame reaches 0,67 — so the
    // 20 degrees below is inside the cone with 2,5 degrees to spare, where
    // it used to have 21. That margin is what somebody would consume one
    // day without knowing, which is why it is written down here. So a
    // flight can be on the right side of the globe — isOnNearSide true,
    // old gate satisfied, camera refusing to move — and be on screen
    // nowhere at all. The user searches a flight, the card appears, the
    // globe shows nothing, which is the exact case the camera exists for.
    const turn = createCameraTurn();
    const zoomedIn = new Vector3(0, 0, CAMERA_NEAR_LIMIT);
    const rightSideWrongPlace = latLonAltToVec3(0, 20, 38000, CAMERA_FAR_LIMIT);
    expect(isOnNearSide(zoomedIn, rightSideWrongPlace)).toBe(true);
    expect(isInView(zoomedIn, rightSideWrongPlace, FOV)).toBe(false);

    expect(turn.begin(view(zoomedIn), rightSideWrongPlace, 1000, false)).toBe(true);
    expect(turn.active).toBe(true);
    // And it ends with the flight in the middle of the frame, not merely
    // somewhere on the near side of the planet.
    const end = turn.sample(1000 + TURN_MS, true)!;
    expect(isInView(end, rightSideWrongPlace, FOV)).toBe(true);
    expect(end.length()).toBeCloseTo(CAMERA_NEAR_LIMIT, 12);
  });

  it('measures "already on screen" against the lens it was handed', () => {
    // MUTANTS 1 and 3 of the campaign, and the only two that survived
    // inside this file: the gate widened to twice the lens, and halved.
    // Neither is visible from the two tests above. Widened, the camera
    // declines to move for a flight that is OFF SCREEN — the one case it
    // exists for. Halved, it rotates for a flight the user can already see,
    // which is the camera helping itself with the view they chose.
    //
    // Both are invisible at the MOUNT distance, where the horizon and not
    // the frame is what limits the cap: at 4,79 units out, 38 degrees of
    // lens and 76 give the same 4 308 NM. They are only measurable zoomed
    // in, which is where the frame is very much smaller than the
    // hemisphere — and that is the zoom a user who has gone looking for one
    // flight is sitting at.
    //
    // So: a target just inside the cap and one just outside it, at two
    // distances, with the cap the lens really frames written down beside
    // each. The margins are chosen so that a cap half or twice this wide
    // falls on the other side of both.
    const cases = [
      // 1,55 units out: the near end of the travel. The frame reaches
      // 0,666 degrees off the view axis, a half lens 0,317 and a double
      // lens 1,516 — and the near SIDE reaches 22,5, which is what makes
      // the hemisphere the wrong question. These were 4,8 and 6 against a
      // 5,363 degree frame while the travel ended at 1,9; the margins are
      // re-measured, the sentence is the same.
      { distance: CAMERA_NEAR_LIMIT, inside: 0.5, outside: 0.9 },
      // 3,0 units out: 21,64 degrees, against 9,78 and 60,0. Untouched —
      // nothing in this row depends on where the travel ends.
      { distance: 3, inside: 20, outside: 24 },
    ];

    for (const { distance, inside, outside } of cases) {
      const camera = new Vector3(0, 0, distance);
      const onScreen = latLonAltToVec3(0, inside, 38000, CAMERA_FAR_LIMIT);
      const offScreen = latLonAltToVec3(0, outside, 38000, CAMERA_FAR_LIMIT);

      // Both are on the near side of the planet. The difference between
      // them is the FRAME, and nothing else.
      expect(isOnNearSide(camera, onScreen)).toBe(true);
      expect(isOnNearSide(camera, offScreen)).toBe(true);
      expect(isInView(camera, onScreen, FOV)).toBe(true);
      expect(isInView(camera, offScreen, FOV)).toBe(false);

      const still = createCameraTurn();
      expect(still.begin(view(camera), onScreen, 1000, false)).toBe(false);
      expect(still.active).toBe(false);

      const travels = createCameraTurn();
      expect(travels.begin(view(camera), offScreen, 1000, false)).toBe(true);
      expect(travels.active).toBe(true);
      // And it ends with that flight inside the frame, not merely somewhere
      // on the near side of the planet.
      expect(isInView(travels.sample(1000 + TURN_MS, true)!, offScreen, FOV)).toBe(true);
    }
  });

  it('runs for TURN_MS on the clock it is handed', () => {
    // Date.now() jumps by ~528 ms every ~32 s on this machine, which would
    // end this turn before it began. The caller passes the rAF timestamp.
    const turn = createCameraTurn();
    const start = defaultCamera();
    const target = farSideFlight();
    expect(turn.begin(view(start), target, 1000, false)).toBe(true);

    expectSameDirection(turn.sample(1000, true)!, start);

    const half = turn.sample(1000 + TURN_MS / 2, true)!;
    expect(angleRad(half, start)).toBeGreaterThan(0);
    expect(angleRad(half, target)).toBeGreaterThan(0);
    expect(turn.active).toBe(true);

    const end = turn.sample(1000 + TURN_MS, true)!;
    expectSameDirection(end, target);
    expect(turn.active).toBe(false);
  });

  it('gives prefers-reduced-motion a cut, not a shorter rotation', () => {
    // The same treatment the focus fade already gives it (focus.ts). A long
    // rotation for someone who gets vertigo from one is the opposite of a
    // favour, and a quick one is still a rotation.
    const turn = createCameraTurn();
    const start = defaultCamera();
    const target = farSideFlight();
    expect(turn.begin(view(start), target, 1000, true)).toBe(true);
    const first = turn.sample(1000, true)!;
    expectSameDirection(first, target);
    expect(turn.active).toBe(false);
  });

  it('stops the moment the user takes the controls, and does not resume', () => {
    // Never steal the controls out of someone's hands. A drag or a wheel
    // during the turn ends it where it stands.
    const turn = createCameraTurn();
    const start = defaultCamera();
    const target = farSideFlight();
    turn.begin(view(start), target, 1000, false);
    turn.sample(1000 + TURN_MS / 4, true);
    turn.cancel();
    expect(turn.active).toBe(false);
    expect(turn.sample(1000 + TURN_MS / 2, true)).toBeNull();
    expect(turn.sample(1000 + TURN_MS, true)).toBeNull();
  });

  it('gives up when the flight leaves the payload mid-turn', () => {
    // The server prunes every cycle and updateBatch replaces the Map
    // wholesale, so the subject can vanish between two frames. Flying on to
    // where it used to be would be the camera pointing at nothing.
    const turn = createCameraTurn();
    turn.begin(view(defaultCamera()), farSideFlight(), 1000, false);
    expect(turn.sample(1000 + TURN_MS / 4, false)).toBeNull();
    expect(turn.active).toBe(false);
    expect(turn.sample(1000 + TURN_MS / 2, true)).toBeNull();
  });

  it('a second focus replaces the first instead of racing it', () => {
    const turn = createCameraTurn();
    const start = defaultCamera();
    const first = farSideFlight();
    turn.begin(view(start), first, 1000, false);
    const midway = turn.sample(1000 + TURN_MS / 2, true)!;

    // Somewhere decidedly behind wherever the first turn had got to.
    const second = midway
      .clone()
      .normalize()
      .multiplyScalar(-1)
      .add(new Vector3(0.3, 0.2, 0))
      .normalize()
      .multiplyScalar(1.53);
    expect(turn.begin(view(midway), second, 2000, false)).toBe(true);
    expectSameDirection(turn.sample(2000, true)!, midway);
    expectSameDirection(turn.sample(2000 + TURN_MS, true)!, second);
  });
});

describe('sightlineOf — what the panel may say while the camera travels', () => {
  const target = farSideFlight();

  it('has nothing to say about a flight that is not behind the globe', () => {
    const over = target.clone().normalize().multiplyScalar(4.6);
    expect(sightlineOf(over, target, false)).toBe('in-sight');
    // Not even while a turn is still running: the globe is no longer in
    // the way, and that is the only thing this line is about.
    expect(sightlineOf(over, target, true)).toBe('in-sight');
  });

  it('has nothing to say when there is no flight to speak about', () => {
    expect(sightlineOf(defaultCamera(), null, false)).toBe('in-sight');
    expect(sightlineOf(defaultCamera(), null, true)).toBe('in-sight');
  });

  it('offers the drag when the flight is behind the globe and staying there', () => {
    // Nothing is moving: the viewer's hand is the only thing that will
    // bring it round, so the line says so (D32).
    expect(isOnNearSide(defaultCamera(), target)).toBe(false);
    expect(sightlineOf(defaultCamera(), target, false)).toBe('hidden');
  });

  it('never advises a drag while the camera is already bringing it round', () => {
    // (a) of the defect. Telling someone to do by hand the thing that is
    // happening by itself is not merely redundant: it says nothing is
    // happening, at the exact moment something is.
    expect(sightlineOf(defaultCamera(), target, true)).toBe('arriving');
  });

  it('does not blink the drag advice on a single frame of a turn that resolves it', () => {
    // (b) of the defect. The line was recalculated every frame from the live
    // camera, so it was TRUE for the first frames of every rotation about
    // to settle it, printed, and withdrawn a few hundred ms later with no
    // act of the user in between. Every frame of a real turn is walked
    // here, at 60 Hz, and 'hidden' must appear on none of them.
    const turn = createCameraTurn();
    const start = defaultCamera();
    turn.begin(view(start), target, 1000, false);

    const seen = new Set<FocusSightline>();
    // Counted in FRAMES and multiplied, not accumulated: adding 16,667 ms
    // fifty-four times lands a hair past 900 and would walk one frame
    // short of the end.
    const frames = Math.ceil(TURN_MS / (1000 / 60));
    for (let f = 0; f <= frames; f++) {
      const here = turn.sample(1000 + Math.min((f * 1000) / 60, TURN_MS), true);
      expect(here).not.toBeNull();
      seen.add(sightlineOf(here!, target, turn.active));
    }

    expect(seen.has('hidden')).toBe(false);
    // It did pass behind the globe — otherwise this proves nothing — and
    // the turn did resolve it by the end.
    expect(seen.has('arriving')).toBe(true);
    expect(seen.has('in-sight')).toBe(true);
    expect(turn.active).toBe(false);
  });

  it('offers the drag again the moment the user takes the controls', () => {
    // The turn stops where it stands and does not resume, so the globe IS
    // in the way again with nothing moving — and the way out belongs back
    // in the line.
    const turn = createCameraTurn();
    const start = defaultCamera();
    turn.begin(view(start), target, 1000, false);
    const here = turn.sample(1000 + TURN_MS / 8, true)!;
    expect(sightlineOf(here, target, turn.active)).toBe('arriving');
    turn.cancel();
    expect(sightlineOf(here, target, turn.active)).toBe('hidden');
  });
});
