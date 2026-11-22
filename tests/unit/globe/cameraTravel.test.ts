import { describe, it, expect } from 'vitest';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_FAR_PLANE,
  CAMERA_NEAR_LIMIT,
  CAMERA_NEAR_PLANE,
  COASTLINE_LIFT,
  COASTLINE_MAX_SEGMENT_DEG,
  GLOBE_RADIUS,
  altitudeFraction,
  altitudeToOffset,
  isInView,
  isOnNearSide,
  latLonToVec3,
  shellOffset,
  shellThicknessUnits,
  vec3ToLatLon,
  visibleCapRadiusNm,
} from '@/globe/geoHelpers';

/**
 * The viewport every NM/px figure in the plan is taken on: 800 CSS px of
 * canvas height, a laptop once the browser chrome is gone. visibleCapRadiusNm
 * returns the cap that spans HALF the viewport height, so the divisor is 400.
 * A taller viewport has more pixels for the same cap and is strictly better.
 */
const HALF_VIEWPORT_PX = 400;
const FOV = 38;

function nmPerPixel(d: number): number {
  return visibleCapRadiusNm(d, FOV) / HALF_VIEWPORT_PX;
}

/** The symbol diameter at the near end — aircraft.ts POINT_PX_NEAR. */
const SYMBOL_PX = 14;

describe('the near end of the travel is chosen by separation, not by a round number', () => {
  it('turns the terminal radar minimum into two readable dots', () => {
    // 3 NM is the tightest horizontal separation that exists in controlled
    // airspace. Two dots read as two when their centres are more than two
    // diameters apart; at 1,9 the same 3 NM was 3,7 px against a 14 px
    // symbol, which is one dot (§2.5.1).
    const px = 3 / nmPerPixel(CAMERA_NEAR_LIMIT);
    expect(px).toBeGreaterThan(SYMBOL_PX * 2);
  });

  it('separates the en-route minimum with room to spare', () => {
    expect(5 / nmPerPixel(CAMERA_NEAR_LIMIT)).toBeGreaterThan(SYMBOL_PX * 3);
  });

  it('does NOT claim to separate one nautical mile', () => {
    // Said out loud so nobody discovers it on the globe: at the bottom of
    // the travel two aircraft 1 NM apart are 10,1 px apart and still one
    // dot. Zoom stops here for reasons D35 states; it does not stop because
    // everything is separated (D35).
    expect(1 / nmPerPixel(CAMERA_NEAR_LIMIT)).toBeLessThan(SYMBOL_PX);
  });

  it('frames a city, which is the other half of what was asked for', () => {
    // 39,6 NM of radius is 79,2 NM — 147 km — across: a metropolitan area
    // with its airports. The airport scale itself is a declared non-goal.
    const capNm = visibleCapRadiusNm(CAMERA_NEAR_LIMIT, FOV);
    expect(capNm).toBeLessThan(60);
    expect(capNm).toBeGreaterThan(25);
  });
});

describe('the altitude shell thins with the zoom and never moves at planet view', () => {
  it('is bit-for-bit what it was at the far end of the travel', () => {
    // The whole point of the taper: "keep the same graphics" is the user's
    // constraint, so planet view must not change at all. 0,025 + 0,05·u IS
    // 0,075 × (1/3 + 2/3·u), the same line written differently (D36).
    expect(altitudeToOffset(0, CAMERA_FAR_LIMIT)).toBeCloseTo(0.025, 10);
    expect(altitudeToOffset(41_000, CAMERA_FAR_LIMIT)).toBeCloseTo(0.075, 10);
    expect(altitudeToOffset(38_000, CAMERA_FAR_LIMIT)).toBeCloseTo(
      0.025 + (38_000 / 41_000) * 0.05,
      10
    );
  });

  it('reaches true scale at the near end', () => {
    // 41 000 ft is 12,497 km; over 6 371 km of Earth radius and 1,5 world
    // units that is 0,002942. At the bottom of the travel the shell is no
    // longer an exaggeration at all — it is the thing itself.
    const trueOffset = ((41_000 * 0.0003048) / 6371) * GLOBE_RADIUS;
    const shown = altitudeToOffset(41_000, CAMERA_NEAR_LIMIT);
    expect(shown / trueOffset).toBeGreaterThan(0.9);
    expect(shown / trueOffset).toBeLessThan(1.2);
  });

  it('never grows as the camera comes in', () => {
    let previous = Infinity;
    for (let d = CAMERA_FAR_LIMIT; d >= CAMERA_NEAR_LIMIT; d -= 0.05) {
      const here = shellThicknessUnits(d);
      expect(here).toBeLessThanOrEqual(previous + 1e-12);
      previous = here;
    }
  });

  it('clamps outside the travel instead of extrapolating', () => {
    expect(shellThicknessUnits(0)).toBe(shellThicknessUnits(CAMERA_NEAR_LIMIT));
    expect(shellThicknessUnits(1e6)).toBe(shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(Number.isFinite(shellThicknessUnits(Number.NaN))).toBe(true);
  });

  it('keeps the camera outside the shell at every distance it can reach', () => {
    // At 1,9 with the OLD shell the camera cleared the top by 0,325; at
    // 1,675 the near plane touched it and at 1,575 the camera was INSIDE
    // it — a 41 000 ft aircraft under the camera would have been BEHIND it
    // (§2.5.3). That is what this assertion exists to prevent.
    for (let d = CAMERA_NEAR_LIMIT; d <= CAMERA_FAR_LIMIT; d += 0.05) {
      const top = GLOBE_RADIUS + altitudeToOffset(41_000, d);
      expect(d - top).toBeGreaterThan(CAMERA_NEAR_PLANE);
    }
  });

  it('turns a quota into a fraction once, so the draw loop composes instead of computing', () => {
    expect(altitudeFraction(0)).toBe(0);
    expect(altitudeFraction(41_000)).toBe(1);
    expect(altitudeFraction(82_000)).toBe(1);
    expect(altitudeFraction(-500)).toBe(0);
    // The identity the renderer relies on (D36).
    for (const ft of [0, 9_000, 31_000, 41_000]) {
      for (const d of [CAMERA_NEAR_LIMIT, 3.0, CAMERA_FAR_LIMIT]) {
        expect(shellThicknessUnits(d) * (1 / 3 + (2 / 3) * altitudeFraction(ft))).toBeCloseTo(
          altitudeToOffset(ft, d),
          12
        );
      }
    }
  });
});

describe('the camera planes keep the depth buffer exactly as precise as it was', () => {
  it('passes under the closest thing the camera can approach', () => {
    // At the near end the surfaces are the shell top (0,047 away), the
    // coastline (0,0498 after D47) and the globe itself (0,050). The route
    // arc's apex is nearer still at 0,0466, and it is checked in Task 2's
    // routeArc.test.ts, where the arc learns about the shell (D46) — this
    // module has no opinion about arcs and must not grow one.
    //
    // COASTLINE_LIFT, not `GLOBE_RADIUS * 1.003` written out here. An
    // earlier draft of this test spelled that factor by hand, which made it
    // the FOURTH place the coastline's height was stated — and the one that
    // would have stayed green while D47 moved the other three.
    const closest = Math.min(
      CAMERA_NEAR_LIMIT - (GLOBE_RADIUS + altitudeToOffset(41_000, CAMERA_NEAR_LIMIT)),
      CAMERA_NEAR_LIMIT - (GLOBE_RADIUS + COASTLINE_LIFT)
    );
    expect(CAMERA_NEAR_PLANE).toBeLessThan(closest / 2);
  });

  it('keeps the far/near ratio at 1 000, which is what depth precision is made of', () => {
    // Lowering near alone would cost a factor five of depth resolution.
    // 100/0,1 was 1 000; 20/0,02 is 1 000 (D37).
    expect(CAMERA_FAR_PLANE / CAMERA_NEAR_PLANE).toBeCloseTo(1000, 6);
  });

  it('still contains the whole scene', () => {
    // The camera never goes past CAMERA_FAR_LIMIT and the globe extends
    // GLOBE_RADIUS beyond the centre.
    expect(CAMERA_FAR_PLANE).toBeGreaterThan(CAMERA_FAR_LIMIT + GLOBE_RADIUS);
  });
});

describe('the ground the aircraft are drawn over is at ground level', () => {
  it('is the sag of the longest chord AT the radius that chord is drawn on', () => {
    // The coastline is a polyline of CHORDS, capped at 2 degrees by
    // continents.ts, and the globe mesh's VERTICES sit on the ideal sphere —
    // so a coastline drawn at GLOBE_RADIUS exactly would pass through the
    // planet in the middle of every segment.
    //
    // The obvious lift is the sagitta on GLOBE_RADIUS, and it is wrong by its
    // own second order: the chord is drawn on GLOBE_RADIUS + lift, where it
    // sags lift × (1 − cos h) further than the sagitta accounts for. The
    // fixed point has one solution, sec and not cos, and the two differ by
    // R (1 − cos h)² / cos h = 3,48e-8 — small, and entirely on the wrong
    // side: under the cos form every 2 degree chord's midpoint lands that
    // far INSIDE GLOBE_RADIUS, measured on 15 of continents.test.ts's 20
    // chords (D47).
    const half = (COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360;
    expect(COASTLINE_LIFT).toBe(GLOBE_RADIUS * (1 / Math.cos(half) - 1));
    expect(COASTLINE_LIFT).toBeCloseTo(0.000228492, 9);

    // The invariant itself, on the two constants, in double precision — the
    // only place it CAN be stated. The drawn vertices are Float32, where one
    // ulp at 1,5 is 1,19e-7: three and a half times the whole term this test
    // is about. continents.test.ts reads that buffer and so asserts the same
    // thing to within its own quantum, not to within nothing.
    expect((GLOBE_RADIUS + COASTLINE_LIFT) * Math.cos(half)).toBeGreaterThanOrEqual(
      GLOBE_RADIUS
    );
    // And the proof that the cos form would NOT have cleared it. This is the
    // line that goes red if someone later "simplifies" the constant back.
    const sagittaOnly = GLOBE_RADIUS * (1 - Math.cos(half));
    expect((GLOBE_RADIUS + sagittaOnly) * Math.cos(half)).toBeLessThan(GLOBE_RADIUS);
  });

  it('is no longer nineteen kilometres of apparent altitude', () => {
    // R × 1,003 was 0,0045 units = 10,3 NM = 19,1 km: one and a half times
    // the WHOLE new shell and four and a half times its floor. At the
    // bottom of the travel that terrain was displaced 41,24 px at the edge
    // of the frame while a corrected aircraft at 38 000 ft was displaced
    // 25,24 px — the ground lying MORE than the correction D36 had just
    // made. A cruising aircraft came out at 1,502854, below a coast at
    // 1,5045: drawn under the land it was flying over (§2.7).
    const old = GLOBE_RADIUS * 0.003; // what continents.ts:24 used to add
    expect(old / COASTLINE_LIFT).toBeGreaterThan(19);
    // And the proof that the old value was not merely large but WRONG: it
    // stood above the shell floor an aircraft at 0 ft sits on.
    expect(old).toBeGreaterThan(altitudeToOffset(0, CAMERA_NEAR_LIMIT));
  });

  it('stays under everything that has to be above it, at EVERY distance', () => {
    // The floor of the shell exists so an aircraft at 0 ft is a dot ABOVE
    // the coastline rather than inside it (D36). That only holds while the
    // coastline is below the floor — which it was not going to be, since
    // 0,0045 is four and a half times the 0,001 the floor reaches at the
    // bottom of the travel.
    for (let d = CAMERA_NEAR_LIMIT; d <= CAMERA_FAR_LIMIT; d += 0.05) {
      expect(COASTLINE_LIFT, `d=${d}`).toBeLessThan(altitudeToOffset(0, d));
    }
  });
});

describe('rewriting the travel and the shell leaves the rest of the module alone', () => {
  it('still exports latLonToVec3, which lives BETWEEN the two blocks being replaced', () => {
    // geoHelpers.ts:25-38 sits in the middle of the range Step 3 edits, and
    // an earlier draft of that step said "replace lines 5-49" while its
    // replacement block did not redeclare this function. It is the most
    // called thing in the module — latLonAltToVec3, continents.ts,
    // airportMarkers.ts, routeArc.ts and every marker go through it — so a
    // faithful implementer would have amputated the module in silence.
    // This is the tripwire; Step 3 is written so it never fires.
    expect(typeof latLonToVec3).toBe('function');
    expect(latLonToVec3(0, 0, GLOBE_RADIUS).z).toBeCloseTo(GLOBE_RADIUS, 12);
    expect(latLonToVec3(90, 0, GLOBE_RADIUS).y).toBeCloseTo(GLOBE_RADIUS, 12);
    expect(latLonToVec3(0, 90, GLOBE_RADIUS).x).toBeCloseTo(GLOBE_RADIUS, 12);
  });

  it('still exports everything below the second block', () => {
    for (const fn of [vec3ToLatLon, visibleCapRadiusNm, isInView, isOnNearSide]) {
      expect(typeof fn).toBe('function');
    }
    const back = vec3ToLatLon(latLonToVec3(45.46, 9.19, GLOBE_RADIUS));
    expect(back.lat).toBeCloseTo(45.46, 9);
    expect(back.lon).toBeCloseTo(9.19, 9);
  });

  it('exposes the shell SHAPE on its own, so no other file has to spell it', () => {
    // aircraft.ts:270 and trails.ts:202 each inline the whole formula
    // today. shellOffset is the four operations they will call instead,
    // with no transcendental and no allocation, so the inline stays and
    // only the arithmetic moves (D36).
    expect(shellOffset(shellThicknessUnits(CAMERA_FAR_LIMIT), 0)).toBeCloseTo(0.025, 12);
    expect(shellOffset(shellThicknessUnits(CAMERA_FAR_LIMIT), 1)).toBeCloseTo(0.075, 12);
    expect(shellOffset(shellThicknessUnits(CAMERA_NEAR_LIMIT), 1)).toBeCloseTo(
      altitudeToOffset(41_000, CAMERA_NEAR_LIMIT),
      12
    );
  });
});
