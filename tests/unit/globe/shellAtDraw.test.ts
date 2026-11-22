import { describe, it, expect, vi } from 'vitest';
import type { LineSegments } from 'three';
import { createAircraftLayer } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { SHOW_ALL } from '@/globe/visibility';
import { deriveMotion, positionAt } from '@/globe/deadReckoning';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  GLOBE_RADIUS,
  altitudeToOffset,
  shellThicknessUnits,
} from '@/globe/geoHelpers';
import type { Aircraft, AircraftRaw } from '@/types';
import { makeAircraftRaw } from '../../helpers/aircraft';

function raw(over: Partial<AircraftRaw> = {}): AircraftRaw {
  return {
    icao24: 'abc123',
    callsign: 'TEST1',
    latitude: 45,
    longitude: 9,
    baroAltitudeFt: 38_000,
    velocityKt: 450,
    headingDeg: 90,
    lastContact: 1_700_000_000,
    complete: true,
    ...(over as object),
  } as AircraftRaw;
}

describe('the shell is composed at draw time, not frozen at batch time', () => {
  it('puts the same aircraft on a different shell at a different zoom', () => {
    // The defect this replaces: Motion.radius was GLOBE_RADIUS +
    // altitudeToOffset(alt) computed once per batch, so a shell that
    // depends on the camera could never have reached the dot (D36).
    const m = deriveMotion(raw(), 1_700_000_000);
    expect(m).not.toBeNull();
    const far = { x: 0, y: 0, z: 0 };
    const near = { x: 0, y: 0, z: 0 };
    positionAt(m!, 0, 0, shellThicknessUnits(CAMERA_FAR_LIMIT), far);
    positionAt(m!, 0, 0, shellThicknessUnits(CAMERA_NEAR_LIMIT), near);
    const rFar = Math.hypot(far.x, far.y, far.z);
    const rNear = Math.hypot(near.x, near.y, near.z);
    expect(rFar).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38_000, CAMERA_FAR_LIMIT), 10);
    expect(rNear).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38_000, CAMERA_NEAR_LIMIT), 10);
    expect(rNear).toBeLessThan(rFar);
  });

  it('keeps the direction identical whatever the shell does', () => {
    // The shell must move the dot OUT, never sideways: a taper that also
    // turned the aircraft would be a position error of its own.
    const m = deriveMotion(raw(), 1_700_000_000)!;
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, shellThicknessUnits(CAMERA_FAR_LIMIT), a);
    positionAt(m, 0, 0, shellThicknessUnits(CAMERA_NEAR_LIMIT), b);
    const na = Math.hypot(a.x, a.y, a.z);
    const nb = Math.hypot(b.x, b.y, b.z);
    expect(a.x / na).toBeCloseTo(b.x / nb, 12);
    expect(a.y / na).toBeCloseTo(b.y / nb, 12);
    expect(a.z / na).toBeCloseTo(b.z / nb, 12);
  });

  it('spends no transcendental call on the shell, per aircraft', () => {
    // Plan 2 proved its cost by COUNTING rather than by timing, because an
    // assertion in milliseconds on a CI machine fails for the weather. The
    // shell is one log and one pow per FRAME, and two multiplications per
    // aircraft: positionAt on a still aircraft must call neither (D36).
    const m = deriveMotion(raw({ velocityKt: 0, headingDeg: null }), 1_700_000_000)!;
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    const log = vi.spyOn(Math, 'log');
    const pow = vi.spyOn(Math, 'pow');
    const out = { x: 0, y: 0, z: 0 };
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    log.mockClear();
    pow.mockClear();
    for (let i = 0; i < 1000; i++) positionAt(m, 0, 0, shell, out);
    expect(sin).not.toHaveBeenCalled();
    expect(cos).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(pow).not.toHaveBeenCalled();
    sin.mockRestore();
    cos.mockRestore();
    log.mockRestore();
    pow.mockRestore();
  });

  it('stores a fraction, not a radius', () => {
    expect(deriveMotion(raw({ baroAltitudeFt: 0 }), 1_700_000_000)!.altFrac).toBe(0);
    expect(deriveMotion(raw({ baroAltitudeFt: 41_000 }), 1_700_000_000)!.altFrac).toBe(1);
    // A missing quota keeps the 38 000 ft the whole repo assumes, and the
    // assumption stays in ONE place (deadReckoning.ts:130 today).
    expect(deriveMotion(raw({ baroAltitudeFt: null }), 1_700_000_000)!.altFrac).toBeCloseTo(
      38_000 / 41_000,
      10
    );
  });
});

describe('the dots and the trails are on the SAME shell', () => {
  it('ends a trail at exactly the radius the aircraft is drawn at', () => {
    // The assertion that would have failed if trails.ts had been left out of
    // this task. The shell formula had THREE copies; thinning it in the dots
    // and not in the trails detaches every aircraft from its own trail at
    // every zoom — 107,7 px at d = 1,9 — and neither tsc nor any geoHelpers
    // test could see it, because a copied formula is not a call (D36).
    const r = makeAircraftRaw({
      icao24: 'a1',
      latitude: 45,
      longitude: 9,
      baroAltitudeFt: 38_000,
      velocityKt: 0,
      headingDeg: null,
      lastContact: 1_000,
    });
    const aircraft: Aircraft = {
      ...r,
      // Two fixes at the SAME quota as the aircraft: the last trail vertex
      // and the dot are then the same point, and the only thing that can
      // separate them is the shell each layer thinks it is on.
      trail: [
        { lat: 44.9, lon: 8.9, t: 900 },
        { lat: 45, lon: 9, t: 1_000 },
      ],
      motion: deriveMotion(r, 1_000),
    };

    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    const dots = createAircraftLayer();
    const trails = createTrailsLayer();
    dots.update([aircraft], null, SHOW_ALL, 1, {
      nowMs: 0,
      elapsedSinceBatchS: 0,
      cameraDistance: CAMERA_NEAR_LIMIT,
      stale: false,
    });
    trails.update([aircraft], null, SHOW_ALL, shell);

    const dot = dots.probeHead();
    const g = (trails.group.children[0] as LineSegments).geometry;
    const pos = g.getAttribute('position');
    const i = g.drawRange.count - 1;
    const trailRadius = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    const dotRadius = Math.hypot(dot[0]!, dot[1]!, dot[2]!);
    // Float32 on both sides: one ulp at 1,5 is 1,19e-7, and this asks for
    // the same point, not a nearby one.
    expect(Math.abs(trailRadius - dotRadius)).toBeLessThan(2 ** -22);
    expect(dotRadius).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38_000, CAMERA_NEAR_LIMIT), 6);
  });
});
