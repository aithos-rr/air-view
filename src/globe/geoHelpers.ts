import { Vector3 } from 'three';

export const GLOBE_RADIUS = 1.5;

/**
 * The camera's travel, in WORLD UNITS — which is what OrbitControls
 * compares against, and not what three comments in this repo once called
 * it. GLOBE_RADIUS is 1,5, so 1,55 to 10,0 units is 1,03 to 6,67 globe
 * radii.
 *
 * The near end is chosen by SEPARATION, and the metre is aviation's, not
 * ours. At 1,55 the visible cap is 39,6 NM, i.e. 0,0989 NM per pixel on an
 * 800 px canvas: two aircraft at the 3 NM terminal radar minimum are 30,3
 * px apart, 2,2 diameters of a 14 px symbol. At 1,9 — the previous floor —
 * the same 3 NM were 3,7 px and the two aircraft were one dot, which is
 * what the user reported seeing (D35).
 *
 * Plan 2 set this floor at 1,9 for a different and, at the time, correct
 * reason: tilesNear names the tiles whose CENTRE falls inside the declared
 * radius, the grid guarantees no covered point is more than 218,0 NM from
 * a centre (tileGrid.ts:60-62), and below 1,9 a viewer could name no tile
 * at all and quietly lose the priority the region on screen depends on.
 * That reason has not stopped being true — it has stopped being the
 * camera's problem. nearestCoveringTile() now prioritises the tile that
 * CONTAINS the point being looked at, whatever radius the client declares,
 * so the 218,0 NM is no longer a floor under the zoom but the proof that
 * that function never comes back empty over a covered region (D38).
 */
export const CAMERA_NEAR_LIMIT = 1.55;
export const CAMERA_FAR_LIMIT = 10.0;

/**
 * Where the camera stands when the page opens, and how far that is.
 *
 * It was a literal inside mountScene — `camera.position.set(-1.2, 0.6, 4.6)`
 * — and a literal nobody else can read is how "planet view is unchanged"
 * came to be asserted at a distance the user is never at on load. Declared
 * here so the shell law below can be anchored to the view they actually
 * compare, and so a test can hold the two together (D48).
 */
export const CAMERA_MOUNT_POSITION: readonly [number, number, number] = [-1.2, 0.6, 4.6];
export const CAMERA_MOUNT_DISTANCE = Math.hypot(...CAMERA_MOUNT_POSITION);

/**
 * The floor of the camera's travel before this plan opened the last stretch.
 *
 * pointSizePx is anchored to it and not to CAMERA_NEAR_LIMIT, so every
 * distance the camera could ALREADY reach draws the symbol at exactly the
 * size it drew before and the new stretch is a tail on the same line rather
 * than a rescaling of it. Moving the floor from 1,9 to 1,55 had changed the
 * symbol at every distance except exactly 10,0: 10,101 px to 9,762 px at
 * the mount, measured (D48).
 */
export const CAMERA_NEAR_LIMIT_BEFORE_DETAIL = 1.9;

/**
 * The camera's near and far planes.
 *
 * At 1,55 the four things in front of the camera are the apex of the most
 * bowed route arc (0,0466 away, D46), the top of the shell (0,047), the
 * coastline (0,0498 once COASTLINE_LIFT replaces R × 1,003, D47) and the
 * globe surface (0,050). The old near of 0,1 cut all four — and cut the
 * aircraft shell already at 1,675, long before the floor.
 *
 * The far plane moves WITH it, on purpose. How depth precision is spread
 * across the scene is a function of the RATIO, and 100/0,1 was 1 000 just
 * as 20/0,02 is 1 000; the ABSOLUTE worst resolution on a 24-bit buffer
 * goes from 5,95 × 10⁻³ to 1,19 × 10⁻³ units, five times better than
 * today. The camera never goes past 10,0 and the globe extends 1,5 beyond
 * the centre, so 20 is more than twice what the scene needs; 100 was a
 * literal with no reason behind it (D37).
 */
export const CAMERA_NEAR_PLANE = 0.02;
export const CAMERA_FAR_PLANE = 20;

/**
 * The longest chord continents.ts and coastlineFine.ts may draw, in degrees.
 *
 * continents.ts:64 already subdivides above this; it is declared here so
 * that COASTLINE_LIFT below is derived from it rather than guessed beside
 * it, and so the fine level of Plan 4 cannot pick a different one — two
 * coastlines at two heights would come apart during the 300 ms crossfade.
 */
export const COASTLINE_MAX_SEGMENT_DEG = 2.0;

/**
 * How far above the surface the coastline is drawn.
 *
 * It used to be GLOBE_RADIUS × 1,003, a literal inside a function: 0,0045
 * units, i.e. 10,3 NM — 19,1 km of apparent altitude, one and a half times
 * the WHOLE shell this file now gives an aircraft at 41 000 ft and four and
 * a half times its floor. At the bottom of the travel that put the terrain
 * 41,24 px off at the edge of the frame against 25,24 px for a corrected
 * aircraft at 38 000 ft: the ground lying more than the correction. And a
 * cruising aircraft came out at 1,502854 under a coast at 1,5045 — drawn
 * beneath the land it was flying over (D47).
 *
 * The obvious reason for lifting it at all — z-fighting against the globe —
 * does not hold here and was checked rather than assumed: not one material
 * in this scene writes depth (globe.ts:67, atmosphere.ts:36,
 * continents.ts:44, trails.ts:87, aircraft.ts:222, routeArc.ts:165), so the
 * buffer never leaves its clear value, and the coastline has depthTest
 * false on top of that. There is nothing to fight with.
 *
 * The reason that DOES hold is the polyline's own geometry. A coastline is
 * chords, not arcs, and a chord of COASTLINE_MAX_SEGMENT_DEG sinks below the
 * sphere it samples, while the globe mesh's vertices sit ON that sphere: at
 * GLOBE_RADIUS exactly the coast would pass through the planet in the middle
 * of every segment — invisible today, visible and silent the day something
 * here writes depth.
 *
 * So the lift is that sag — but the sag AT THE RADIUS THE CHORD IS DRAWN ON,
 * which is not the same number and is the one that matters. A chord on
 * GLOBE_RADIUS sags R × (1 − cos half); the chord is drawn on GLOBE_RADIUS +
 * lift, where it sags lift × (1 − cos half) further. "The lift covers its
 * own sag" is a fixed point with one solution, sec and not cos:
 *
 *     L = (R + L)(1 − cos h)   ⟹   L = R (sec h − 1)
 *
 * The two differ by R (1 − cos h)² / cos h = 3,48e-8, which is small and
 * entirely on the wrong side: under the cos form every 2 degree chord's
 * midpoint lands 3,48e-8 INSIDE GLOBE_RADIUS, measured. Under this one it
 * lands on it to
 * the last bit. 0,000228492 units, 0,524 NM, 0,97 km — nineteen times lower
 * than R × 1,003, and still below the shell floor an aircraft at 0 ft sits
 * on, at every camera distance.
 *
 * Written as the formula and not as a figure, so that changing the
 * subdivision moves the lift with it.
 */
export const COASTLINE_LIFT =
  GLOBE_RADIUS * (1 / Math.cos((COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360) - 1);

/**
 * Lat/lon (degrees) → 3D position on a sphere.
 * Convention: lon=0 lands on +Z (front), lat=90 lands on +Y (north pole),
 * lon=90 lands on +X (east). Matches the test contract in tests/unit/globe.
 */
export function latLonToVec3(lat: number, lon: number, radius: number = GLOBE_RADIUS): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  return new Vector3(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta)
  );
}

/** A quota as a fraction of the shell, clamped. 41 000 ft is the top. */
export function altitudeFraction(altFt: number): number {
  if (!Number.isFinite(altFt)) return 0;
  return Math.min(1, Math.max(0, altFt) / 41000);
}

const SHELL_UNITS_FAR = 0.075;
/**
 * 41 000 ft is 12,497 km; over 6 371 km of Earth radius and 1,5 world
 * units that is 0,002942. This is 1,02 × the real thing: at the bottom of
 * the travel the shell is not an exaggeration any more.
 */
const SHELL_UNITS_NEAR = 0.003;

/**
 * The distance at and above which the shell is the one that shipped.
 *
 * The thinning below it exists because a shell lifts nothing at the centre
 * of the frame and displaces everything at its edge, so the closer the
 * camera comes the less it shows and the more it lies (D36). But "keep the
 * same graphics" is the user's constraint, and the view they compare
 * against is the one the page OPENS at — CAMERA_MOUNT_DISTANCE, 4,7917.
 * Anchoring the full shell at CAMERA_FAR_LIMIT alone left that view at 28 %
 * of the old offset: an aircraft at 38 000 ft drawn 14,67 px lower on the
 * limb of an 800 px canvas, while a test asserted an identity at 10,0, the
 * one distance nobody is at when the page loads (D48).
 *
 * 4,75 and not 4,7917: a round number just under the mount, so nudging the
 * camera does not move the planet view. A test holds CAMERA_MOUNT_DISTANCE
 * above it, which makes mounting BELOW it a decision instead of a side
 * effect.
 */
export const SHELL_FULL_DISTANCE = 4.75;

/**
 * How thick the 0 → 41 000 ft shell is, at this camera distance.
 *
 * The old altitudeToOffset knew only the quota, and it exaggerated by 26 ×:
 * 38 000 ft became 303 km of apparent altitude. At planet view that is what
 * lifts the dots off the limb and it is left exactly where it was — "keep
 * the same graphics" is the user's constraint. But a shell lifts nothing at
 * the centre of the frame (a point on the camera axis projects to the same
 * pixel at any radius) and displaces everything at the edge, so the closer
 * the camera gets the less it shows and the more it lies. Measured: at
 * d = 1,9 an aircraft at 38 000 ft at the edge of the cap was drawn 107,7 px
 * — 86,6 NM — from the ground it was over; at 1,7, 248 px, 62 % of the view
 * radius (D36).
 *
 * Geometric interpolation, like pointSizePx: the zoom is logarithmic and so
 * is this.
 */
export function shellThicknessUnits(cameraDistance: number): number {
  const d = Math.min(
    Math.max(cameraDistance || CAMERA_NEAR_LIMIT, CAMERA_NEAR_LIMIT),
    CAMERA_FAR_LIMIT
  );
  // Flat above the mount, so the whole planet view — the way the page opens
  // and everything further out — is the shell that shipped, to the last bit.
  if (d >= SHELL_FULL_DISTANCE) return SHELL_UNITS_FAR;
  // Geometric below it, like pointSizePx: the zoom is logarithmic and so is
  // this. "It only changes as you come closer" is now literally true.
  const t = Math.log(d / CAMERA_NEAR_LIMIT) / Math.log(SHELL_FULL_DISTANCE / CAMERA_NEAR_LIMIT);
  return SHELL_UNITS_NEAR * Math.pow(SHELL_UNITS_FAR / SHELL_UNITS_NEAR, t);
}

/**
 * Visual altitude offset, at this camera distance.
 *
 * `0,025 + 0,05·u` IS `0,075 × (1/3 + 2/3·u)` — the same line, factored so
 * the thickness can move while the SHAPE of the shell cannot. At every
 * distance from SHELL_FULL_DISTANCE up — the mount included — this returns
 * the old numbers exactly, not nearly: a test asserts the identity against
 * the shipped formula across that whole stretch, and separately that the
 * camera opens inside it. The one thing in planet view that does move is
 * the coastline, 1,21 px lower on the limb, because COASTLINE_LIFT replaces
 * R × 1,003 — a correction, declared above, not a style change.
 *
 * The 1/3 floor survives at every distance: an aircraft at 0 ft must still
 * be a dot ABOVE the coastline rather than inside it. At the near end that
 * floor is 0,001 units — 2,3 NM — which is 8,5 px of displacement at the
 * very edge of the frame and 0 px at its centre. Declared, not hidden.
 */
export function altitudeToOffset(altFt: number, cameraDistance: number): number {
  return shellOffset(shellThicknessUnits(cameraDistance), altitudeFraction(altFt));
}

/**
 * The SHAPE of the shell, given a thickness and a quota fraction.
 *
 * It exists as its own export for one reason: this formula had THREE
 * copies. geoHelpers was the declaration, and aircraft.ts:270 and
 * trails.ts:202 each wrote `GLOBE_RADIUS + 0.025 + (altFt/41000)*0.05` out
 * again by hand, inside private writeLatLonAlt helpers, to avoid allocating
 * a Vector3 per point. That reason was good and the inlining stays; what
 * cannot stay is a second and third opinion about where an aircraft is. A
 * thinning shell reaching the dots but not the trails would detach every
 * aircraft from its own trail at every zoom — 107,7 px at 1,9 — and
 * neither tsc nor any geoHelpers test could see it, because a copied
 * formula is not a call (D36).
 *
 * Four operations, no transcendental, no allocation: a hot loop can call
 * this per point and lose nothing.
 */
export function shellOffset(shellUnits: number, altFrac: number): number {
  return shellUnits * (1 / 3 + (2 / 3) * altFrac);
}

export function latLonAltToVec3(
  lat: number,
  lon: number,
  altFt: number,
  cameraDistance: number
): Vector3 {
  return latLonToVec3(lat, lon, GLOBE_RADIUS + altitudeToOffset(altFt, cameraDistance));
}

/**
 * 3D position → lat/lon (degrees). Inverse of latLonToVec3, same convention:
 * lon=0 on +Z, lat=90 on +Y, lon=90 on +X.
 */
export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const r = v.length();
  if (r === 0) return { lat: 0, lon: 0 };
  const lat = 90 - (Math.acos(v.y / r) * 180) / Math.PI;
  const lon = (Math.atan2(v.x, v.z) * 180) / Math.PI;
  return { lat, lon };
}

/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

/**
 * Radius, in NM along the surface, of the piece of globe actually on screen.
 *
 * Two limits, and the smaller one wins:
 *
 *  - the horizon. From `cameraDistance` nothing past acos(R/d) is visible,
 *    whatever lens you put on.
 *  - the frustum. Zoomed in, the globe overflows the viewport and the edge
 *    of the screen cuts the cap long before the horizon does.
 *
 * An earlier revision used the horizon alone, and the result was dead
 * arithmetic. The orbit controls in scene.ts hold the camera between 3,0 and
 * 10,0 globe radii, so that formula could only ever return between 3 602 and
 * 4 886 NM — and the server clamped every request to 2 000 NM. The camera
 * could not produce a number BELOW the clamp, so the server saw exactly
 * 2 000 at every zoom level: a half-angle computed, serialised, sent and
 * discarded, presented in the plan as if it carried the zoom level. With the
 * frustum term the near end is 1 299 NM and the value moves with the zoom,
 * which is the whole point of sending it.
 *
 * `fovDeg` is three.js's VERTICAL field of view, and the vertical half-angle
 * is the narrow one on a landscape viewport: this returns the cap that is
 * certainly on screen rather than the one that spills past the top and
 * bottom edges. Under-reaching costs priority on a tile at the very edge of
 * the view; over-reaching spends a priority slot — half of each poller batch
 * — on a tile nobody can see.
 */
export function visibleCapRadiusNm(cameraDistance: number, fovDeg: number): number {
  const d = Math.max(cameraDistance, GLOBE_RADIUS + 1e-6);
  const horizonRad = Math.acos(Math.min(1, GLOBE_RADIUS / d));
  const halfFovRad = ((fovDeg / 2) * Math.PI) / 180;
  // Does the edge ray of the frustum reach the sphere at all? When it misses,
  // the whole globe sits inside the view and only the horizon limits the cap.
  const disc = GLOBE_RADIUS ** 2 - (d * Math.sin(halfFovRad)) ** 2;
  let capRad = horizonRad;
  if (disc > 0) {
    const t = d * Math.cos(halfFovRad) - Math.sqrt(disc);
    const across = Math.sin(halfFovRad) * t;
    const along = d - Math.cos(halfFovRad) * t;
    capRad = Math.min(horizonRad, Math.atan2(across, along));
  }
  return Math.round(capRad * NM_PER_RADIAN);
}

/**
 * Two directions closer than this are one direction. 1e-6 rad is about 6 m
 * on the Earth's surface — the same figure arcDegeneracy() calls one point.
 */
const ONE_DIRECTION_RAD = 1e-6;

function angleBetweenUnit(a: Vector3, b: Vector3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
}

/**
 * A unit direction perpendicular to this one, chosen deterministically.
 *
 * The world axis LEAST aligned with `a` cannot be parallel to it, so the
 * cross product is never the zero vector.
 */
function perpendicularTo(a: Vector3): Vector3 {
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const axis =
    ax <= ay && ax <= az
      ? new Vector3(1, 0, 0)
      : ay <= az
        ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1);
  return axis.cross(a).normalize();
}

/**
 * Slerp between two UNIT vectors: the point `t` of the way along the great
 * circle that joins them.
 *
 * This is routeArc's arithmetic, lifted out of geodesicPoints() rather than
 * written a second time. Two callers now want the same curve for different
 * reasons — the route drawn between two airports, and the camera travelling
 * to the flight in focus (D34) — and the one thing this repo has learned
 * about a rule with two readers is that two copies of it diverge on exactly
 * the frames that matter (D29).
 *
 * The two degenerate pairs are HANDLED here rather than refused, because the
 * camera has no one to refuse to. Coincident directions return `a`.
 * Antipodal ones have no unique great circle at all and make sin(omega)
 * zero: an unguarded slerp writes NaN into a position buffer, which for the
 * arc is invisible geometry and for the camera is a blank screen with no
 * error. One is picked, deterministically, through a perpendicular axis.
 * geodesicPoints still refuses both before it ever gets here — arcDegeneracy
 * is the rule about whether a ROUTE exists, and that is a different question
 * from whether a curve can be drawn.
 *
 * @param omegaRad the angle between a and b, when the caller already has it.
 *   geodesicPoints computes it once for 256 samples and must not pay for an
 *   acos per vertex sixty times a second.
 * @param out written in place; must not alias `a` or `b`.
 */
export function slerpUnit(
  a: Vector3,
  b: Vector3,
  t: number,
  omegaRad: number = angleBetweenUnit(a, b),
  out: Vector3 = new Vector3()
): Vector3 {
  if (!Number.isFinite(omegaRad) || omegaRad < ONE_DIRECTION_RAD) return out.copy(a);
  if (omegaRad > Math.PI - ONE_DIRECTION_RAD) {
    const turned = t * Math.PI;
    return out
      .copy(a)
      .multiplyScalar(Math.cos(turned))
      .addScaledVector(perpendicularTo(a), Math.sin(turned));
  }
  const sinOmega = Math.sin(omegaRad);
  const f1 = Math.sin((1 - t) * omegaRad) / sinOmega;
  const f2 = Math.sin(t * omegaRad) / sinOmega;
  return out.set(a.x * f1 + b.x * f2, a.y * f1 + b.y * f2, a.z * f1 + b.z * f2);
}

/**
 * Is this point on the side of the globe the camera can see?
 *
 * `dot(C, P) >= R²` is the exact condition for a point P to be on the near
 * side of a sphere of radius R seen from C — the two vectors unnormalised,
 * which is why it holds for an aircraft at altitude and for an airport on
 * the surface without a second formula.
 *
 * It replaces `camDir.dot(acDir) <= 0.05`, which was cabled into
 * raycaster.ts:38, leaderLine.ts:19 and airportMarkers.ts:57. That number
 * is not an approximation of the right one: the true threshold is 0,0968
 * at the far end of the camera's travel and 0,764 at the near end, so 0,05
 * was too permissive at every distance and absurdly so once the travel
 * reached 1,9 — where it would have let a viewer click an aircraft over
 * Australia while looking at Milan.
 *
 * The vertex shader in aircraft.ts asks the SAME expression —
 * `dot(cameraPosition, position) < uGlobeR2` — because a dot you can see
 * and cannot click is the ghost D7 forbids, and two implementations of one
 * rule are how it comes back.
 */
export function isOnNearSide(cameraPos: Vector3, worldPos: Vector3): boolean {
  return cameraPos.dot(worldPos) >= GLOBE_RADIUS * GLOBE_RADIUS;
}

/**
 * Is this point inside the piece of globe the lens is actually SHOWING?
 *
 * Strictly stronger than isOnNearSide, and the difference is the whole
 * point of it. The visible SIDE is half a planet; the visible CAP is what
 * fits in the frame, and at every zoom closer than the mount distance the
 * second is far smaller than the first. At the near end of the camera's
 * travel the near side reaches ~22,5 degrees from the view axis while the
 * frame reaches 0,67 — so a flight can be on the right side of the globe,
 * pass isOnNearSide, and still be nowhere on screen.
 *
 * The radius it compares against is visibleCapRadiusNm — the same number
 * viewCentre() sends the server to prioritise tiles by, rather than a
 * second idea of what "on screen" means. Two readers of one rule is how
 * this repo's defects have always arrived (D29).
 *
 * Two deliberate imprecisions, both of them on the safe side for the one
 * caller that acts on this (the camera turn of D34), where a false "not in
 * view" costs a rotation nobody needed and a false "in view" costs the
 * user the thing they asked to be shown:
 *
 *  - the cap is the VERTICAL half-FOV's, so on a landscape viewport the
 *    sides show a little more than this admits. Under-reaching: it costs
 *    a rotation that centres a flight already visible near an edge, for a
 *    user who asked to be taken to that flight by name. On a PORTRAIT
 *    viewport the vertical is the wide axis instead and the same number
 *    over-reaches by the aspect ratio, which leaves a narrow version of
 *    the gap this function closes — a flight just off the left or right
 *    edge. One cap, the one viewCentre() sends the server, is still worth
 *    more than two definitions of "on screen" drifting apart (D29); an
 *    aspect term belongs in visibleCapRadiusNm itself, where both readers
 *    would get it.
 *  - the cap is measured on the SURFACE, and an aircraft sits above it, so
 *    a point at altitude at the very edge of the cap projects a hair
 *    further out than the surface point below it. Over-reaching, by at
 *    most the 5% the altitude exaggeration adds to the radius, and only
 *    within a hair of the edge.
 *
 * The isOnNearSide guard is not redundant despite the cap never exceeding
 * the horizon: visibleCapRadiusNm ROUNDS to whole NM, and half a nautical
 * mile of rounding is enough to let a point just over the limb through at
 * the exact horizon. A point you cannot see is not in view, whatever the
 * arithmetic rounds to.
 */
export function isInView(cameraPos: Vector3, worldPos: Vector3, fovDeg: number): boolean {
  if (!isOnNearSide(cameraPos, worldPos)) return false;
  const d = cameraPos.length();
  const r = worldPos.length();
  // Unreachable through the orbit controls, and NaN if it ever were.
  if (d === 0 || r === 0) return false;
  const separationRad = angleBetweenUnit(
    cameraPos.clone().divideScalar(d),
    worldPos.clone().divideScalar(r)
  );
  return separationRad * NM_PER_RADIAN <= visibleCapRadiusNm(d, fovDeg);
}
