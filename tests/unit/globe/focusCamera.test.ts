import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { attachUserTakeover, createFocusCamera } from '@/globe/focusCamera';
import type { FocusCamera, FocusFrame } from '@/globe/focusCamera';
import { TURN_MS } from '@/globe/cameraTurn';
import { isInView, isOnNearSide, latLonAltToVec3 } from '@/globe/geoHelpers';
import type { FocusOrigin, FocusSightline } from '@/state/selectionStore';

/**
 * The decisions the render loop used to MAKE, driven frame by frame on a
 * clock this file owns.
 *
 * Each of the six tests that follow a `MUTANT` comment is the answer to one
 * survivor of the 22-mutation campaign: a change that inverted the user's
 * own choice, left `tsc` at exit 0 and all 612 tests green, and could not
 * be caught anywhere because the choice was written out inside animate() or
 * inside a DOM listener. Nothing here needs a canvas, a frame or a store.
 */

/** The lens scene.ts mounts: three's VERTICAL field of view, in degrees. */
const FOV = 38;

/** The camera as scene.ts mounts it: 4,79 units out over 7,2 N 14,6 W. */
function defaultCamera(): Vector3 {
  return new Vector3(-1.2, 0.6, 4.6);
}

/** Very nearly the antipode of that view: the whole globe away. */
function farSideFlight(): Vector3 {
  return latLonAltToVec3(10, 170, 38000);
}

/** Directly under the camera, and therefore in the middle of the frame. */
function flightInFrame(): Vector3 {
  return latLonAltToVec3(7.1935, -14.6102, 38000);
}

interface Harness {
  camera: FocusCamera;
  /** One frame, with everything not named left as the last frame had it. */
  step(over?: Partial<FocusFrame>): Vector3 | null;
  /** Every sightline published, in order — not one per frame. */
  published: FocusSightline[];
  autoRotateStopped: () => number;
  /** Where the camera is, as the scene would have moved it. */
  eye(): Vector3;
}

/**
 * A camera, a clock and a subject — scene.ts's half of the contract, with
 * the browser taken out of it.
 *
 * `step` carries the previous frame's values forward the way a render loop
 * does, so a test says only what CHANGED between two frames, and applies the
 * returned position to the camera exactly as scene.ts does: the frame after
 * a turn has moved the camera must see the camera it moved.
 */
function harness(initial?: Partial<FocusFrame>): Harness {
  const published: FocusSightline[] = [];
  const stopAutoRotate = vi.fn();
  let eye = initial?.camera?.position.clone() ?? defaultCamera();
  let last: FocusFrame = {
    camera: { position: eye, fov: FOV },
    subjectWorld: null,
    inFocus: false,
    focusSeq: 0,
    focusOrigin: null,
    nowMs: 1000,
    reducedMotion: false,
    ...initial,
  };
  const camera = createFocusCamera({
    stopAutoRotate,
    publishSightline: (v) => published.push(v),
    focusSeqAtMount: last.focusSeq,
  });
  return {
    camera,
    published,
    autoRotateStopped: () => stopAutoRotate.mock.calls.length,
    eye: () => eye.clone(),
    step(over = {}) {
      last = { ...last, ...over, camera: { position: eye, fov: FOV } };
      const here = camera.step(last);
      if (here !== null) eye = here.clone();
      return here;
    },
  };
}

/** A flight put in focus by this act, on the frame it happened. */
function focusedBy(origin: FocusOrigin, where: Vector3, seq = 1): Partial<FocusFrame> {
  return { focusOrigin: origin, focusSeq: seq, subjectWorld: where, inFocus: true };
}

/** The angle between two directions, in radians. */
function angleRad(a: Vector3, b: Vector3): number {
  const ua = a.clone().normalize();
  const ub = b.clone().normalize();
  return Math.atan2(ua.clone().cross(ub).length(), ua.dot(ub));
}

describe('the camera travels for the acts that asked it to (D34)', () => {
  it('MUTANT 6 — brings in a flight the user found by its number', () => {
    // The survivor: the search stopped moving the camera. The user types a
    // flight number, the card appears, and under focus the globe draws that
    // ONE aircraft — so a subject on the far side leaves them looking at an
    // empty planet while the panel says "1 shown". The very sentence D15
    // forbids, reached through the camera.
    const h = harness();
    const flight = farSideFlight();
    expect(isOnNearSide(h.eye(), flight)).toBe(false);

    const first = h.step(focusedBy('search', flight));
    expect(first).not.toBeNull();

    const end = h.step({ nowMs: 1000 + TURN_MS });
    expect(end).not.toBeNull();
    expect(angleRad(h.eye(), flight)).toBeCloseTo(0, 9);
    expect(isInView(h.eye(), flight, FOV)).toBe(true);
  });

  it('travels for a row picked out of a list of thousands', () => {
    const h = harness();
    const flight = farSideFlight();
    h.step(focusedBy('list', flight));
    h.step({ nowMs: 1000 + TURN_MS });
    expect(isInView(h.eye(), flight, FOV)).toBe(true);
  });

  it('MUTANT 5 — leaves the view exactly as it was for a click on the globe', () => {
    // The other survivor, and the half the user asked for by name: they
    // were looking at this aircraft, it was under the cursor. Moving the
    // camera takes away the view they chose in order to show them what they
    // were already seeing.
    const h = harness();
    const before = h.eye();
    const flight = farSideFlight();

    expect(h.step(focusedBy('globe', flight))).toBeNull();
    for (let f = 1; f <= 60; f++) {
      expect(h.step({ nowMs: 1000 + f * 16 })).toBeNull();
    }
    expect(h.eye().equals(before)).toBe(true);
    // And the panel says what it has always said about a flight behind the
    // globe with nothing moving: drag it round yourself.
    expect(h.published).toEqual(['hidden']);
  });

  it('does not move for a flight that is already in the frame', () => {
    // Idempotent: there is nothing to bring round, and a turn to "improve
    // the angle" would be the camera helping itself.
    const h = harness();
    const before = h.eye();
    expect(h.step(focusedBy('search', flightInFrame()))).toBeNull();
    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).toBeNull();
    expect(h.eye().equals(before)).toBe(true);
  });

  it('does not travel to a flight it cannot place', () => {
    // Focus is granted only to an aircraft the globe can place, but the
    // feed drops aircraft between frames and a journey needs somewhere to
    // go. Nothing moves, and nothing is claimed about where it is.
    const h = harness();
    const before = h.eye();
    expect(
      h.step({ focusOrigin: 'search', focusSeq: 1, subjectWorld: null, inFocus: true })
    ).toBeNull();
    expect(h.eye().equals(before)).toBe(true);
    expect(h.published).toEqual([]);
  });

  it('treats the same flight chosen twice as two journeys', () => {
    // focusSeq is the only thing that can tell a NEW act of focusing from
    // the same focus still standing: the user picks a row, drags the globe
    // away from it, and picks the SAME row again.
    const h = harness();
    const flight = farSideFlight();
    h.step(focusedBy('list', flight));
    h.step({ nowMs: 1000 + TURN_MS / 4 });
    h.camera.handOverToUser();
    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).toBeNull();

    // Same icao, same origin, second act.
    expect(h.step({ focusSeq: 2, nowMs: 2000 })).not.toBeNull();
    h.step({ nowMs: 2000 + TURN_MS });
    expect(isInView(h.eye(), flight, FOV)).toBe(true);
  });

  it('does not answer an act of focusing that happened before it existed', () => {
    // A flight already in focus when the scene mounts is not a new act, and
    // nobody has just asked for this view to move.
    const h = harness({ focusSeq: 7, focusOrigin: 'search', inFocus: true });
    const before = h.eye();
    expect(h.step({ subjectWorld: farSideFlight() })).toBeNull();
    expect(h.eye().equals(before)).toBe(true);
  });

  it('ends the journey it was on when a new focus asks for none', () => {
    // A camera still flying to the last flight while the panel describes
    // this one is two answers to the same question.
    const h = harness();
    h.step(focusedBy('search', farSideFlight()));
    const partWay = h.step({ nowMs: 1000 + TURN_MS / 4 });
    expect(partWay).not.toBeNull();

    const clicked = latLonAltToVec3(-30, 40, 38000);
    expect(h.step({ ...focusedBy('globe', clicked, 2), nowMs: 1000 + TURN_MS / 3 })).toBeNull();
    const stopped = h.eye();
    expect(h.step({ nowMs: 1000 + TURN_MS })).toBeNull();
    expect(h.eye().equals(stopped)).toBe(true);
  });

  it('abandons the journey when the flight leaves the payload', () => {
    // The server prunes every cycle. Flying on to where a flight used to be
    // would be the camera pointing at nothing.
    const h = harness();
    h.step(focusedBy('search', farSideFlight()));
    expect(h.step({ nowMs: 1000 + TURN_MS / 4 })).not.toBeNull();
    const stopped = h.eye();
    expect(h.step({ subjectWorld: null, nowMs: 1000 + TURN_MS / 2 })).toBeNull();
    expect(h.eye().equals(stopped)).toBe(true);
  });

  it('gives prefers-reduced-motion a cut, not a shorter rotation', () => {
    const h = harness();
    const flight = farSideFlight();
    h.step({ ...focusedBy('search', flight), reducedMotion: true });
    expect(angleRad(h.eye(), flight)).toBeCloseTo(0, 9);
  });
});

describe('the user always wins (D34)', () => {
  it('MUTANT 4 — a drag ends the journey, and it does not resume', () => {
    // The survivor: handOverToUser stopped cancelling the turn. The user
    // drags the globe while the camera drags it back, sixty times a second,
    // until the turn runs out — the controls taken out of their hands in
    // the one application where the globe IS the control.
    const h = harness();
    const flight = farSideFlight();
    h.step(focusedBy('search', flight));
    expect(h.step({ nowMs: 1000 + TURN_MS / 4 })).not.toBeNull();
    const whereTheyTookOver = h.eye();

    h.camera.handOverToUser();

    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).toBeNull();
    expect(h.step({ nowMs: 1000 + TURN_MS })).toBeNull();
    expect(h.step({ nowMs: 1000 + 10 * TURN_MS })).toBeNull();
    expect(h.eye().equals(whereTheyTookOver)).toBe(true);
    // And it stops the idle spin too, which is what it did before the
    // camera ever travelled.
    expect(h.autoRotateStopped()).toBeGreaterThan(0);
  });

  it('MUTANT 4 — a pointer going down on the canvas is that drag', () => {
    // The other half of the same promise, and the half a handler tested on
    // its own cannot prove: "a drag stops the camera" is a handler that
    // cancels AND a handler that is attached to something.
    const h = harness();
    const canvas = document.createElement('canvas');
    const release = attachUserTakeover(canvas, h.camera);
    h.step(focusedBy('search', farSideFlight()));
    expect(h.step({ nowMs: 1000 + TURN_MS / 4 })).not.toBeNull();

    canvas.dispatchEvent(new Event('pointerdown'));
    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).toBeNull();
    release();
  });

  it('MUTANT 4 — a wheel is that drag as well', () => {
    const h = harness();
    const canvas = document.createElement('canvas');
    const release = attachUserTakeover(canvas, h.camera);
    h.step(focusedBy('list', farSideFlight()));
    expect(h.step({ nowMs: 1000 + TURN_MS / 4 })).not.toBeNull();

    canvas.dispatchEvent(new Event('wheel'));
    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).toBeNull();
    release();
  });

  it('lets go of the canvas when the scene does', () => {
    const h = harness();
    const canvas = document.createElement('canvas');
    attachUserTakeover(canvas, h.camera)();
    h.step(focusedBy('search', farSideFlight()));
    canvas.dispatchEvent(new Event('pointerdown'));
    // Still travelling: the listener is gone, so this event reached nobody.
    expect(h.step({ nowMs: 1000 + TURN_MS / 2 })).not.toBeNull();
  });
});

describe('what the panel may say while the camera travels (D15/D34)', () => {
  it('MUTANT 2 — never offers the drag while the camera is bringing it round', () => {
    // The survivor: the published sightline was computed as though no turn
    // were running. The user reads "drag to bring it round" while the
    // camera is already carrying the flight there — advice to do by hand
    // what is happening by itself, which says that nothing is happening at
    // the exact moment something is.
    const h = harness();
    const flight = farSideFlight();
    h.step(focusedBy('search', flight));
    expect(h.published).toEqual(['arriving']);

    // Every frame of a real 900 ms turn at 60 Hz, and 'hidden' on none of
    // them. Counted in frames and multiplied, not accumulated: adding
    // 16,667 ms fifty-four times lands a hair past the end.
    const frames = Math.ceil(TURN_MS / (1000 / 60));
    for (let f = 1; f <= frames; f++) {
      h.step({ nowMs: 1000 + Math.min((f * 1000) / 60, TURN_MS) });
    }
    expect(h.published).toEqual(['arriving', 'in-sight']);
  });

  it('offers the drag again the moment the user takes the controls', () => {
    // The turn stops where it stands and does not resume, so the globe IS
    // in the way again with nothing moving — and the way out belongs back
    // in the line.
    const h = harness();
    h.step(focusedBy('search', farSideFlight()));
    h.step({ nowMs: 1000 + TURN_MS / 8 });
    expect(h.published).toEqual(['arriving']);

    h.camera.handOverToUser();
    h.step({ nowMs: 1000 + TURN_MS / 4 });
    expect(h.published).toEqual(['arriving', 'hidden']);
  });

  it('writes to the store once per crossing, not sixty times a second', () => {
    // Every subscriber of that store wakes on a write. The answer changes
    // when the subject crosses the limb or a turn begins or ends, and that
    // is how often this may be said.
    const h = harness();
    h.step(focusedBy('globe', farSideFlight()));
    for (let f = 1; f <= 120; f++) h.step({ nowMs: 1000 + f * 16 });
    expect(h.published).toEqual(['hidden']);
  });

  it('has nothing to say about a flight that is not behind the globe', () => {
    const h = harness();
    h.step(focusedBy('globe', flightInFrame()));
    for (let f = 1; f <= 30; f++) h.step({ nowMs: 1000 + f * 16 });
    expect(h.published).toEqual([]);
  });
});

describe('focus stops the globe turning by itself (D32)', () => {
  it('stops it for a flight in focus, whatever brought the focus about', () => {
    // Focus arrives from the panel, the list or the search — none of which
    // touches the canvas — and a globe that goes on turning carries the one
    // aircraft it is drawing round behind the planet while the viewer reads
    // the card.
    const h = harness();
    h.step(focusedBy('globe', flightInFrame()));
    expect(h.autoRotateStopped()).toBe(1);
  });

  it('stops it even for a flight whose position the feed never sent', () => {
    // There is nothing to draw and nothing to travel to, and the globe must
    // still stop: the card is being read either way.
    const h = harness();
    h.step({ inFocus: true, focusSeq: 1, focusOrigin: 'list', subjectWorld: null });
    expect(h.autoRotateStopped()).toBe(1);
  });

  it('leaves it turning while nothing is in focus', () => {
    const h = harness();
    h.step({ nowMs: 1016 });
    h.step({ nowMs: 1032 });
    expect(h.autoRotateStopped()).toBe(0);
  });
});
