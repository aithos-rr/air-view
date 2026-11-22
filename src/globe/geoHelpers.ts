import { Vector3 } from 'three';

export const GLOBE_RADIUS = 1.5;

/**
 * The camera's travel, in WORLD UNITS — which is what OrbitControls
 * compares against, and not what three comments in this repo call it.
 * GLOBE_RADIUS is 1,5, so 1,9 to 10,0 units is 1,27 to 6,67 globe radii;
 * geoHelpers.ts, airportMarkers.ts and server/index.ts have all said
 * "radii" about these numbers at one time or another, and one declaration
 * is how that stops happening a fourth time.
 *
 * The near end is not a matter of taste. At 1,9 the visible cap is 322 NM,
 * and the tile grid guarantees that no covered point is more than 218,0 NM
 * from the centre of a tile (src/data/sources/tileGrid.ts:60-62) — so
 * tilesNear still names at least one tile and the region being looked at
 * still jumps the poller's queue, which is the mechanism the dead
 * reckoning ceiling is sized on. At 1,7 the cap is 159 NM and a viewer
 * could sit somewhere whose nearest tile centre is 218 NM away: the thing
 * on screen would be the first thing to go stale.
 */
export const CAMERA_NEAR_LIMIT = 1.9;
export const CAMERA_FAR_LIMIT = 10.0;

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

/**
 * Visual altitude offset (real ratio ~0.0018 is too tiny — exaggerated for visibility).
 */
export function altitudeToOffset(altFt: number): number {
  return 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
}

export function latLonAltToVec3(lat: number, lon: number, altFt: number): Vector3 {
  return latLonToVec3(lat, lon, GLOBE_RADIUS + altitudeToOffset(altFt));
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
 * travel the near side reaches ~38 degrees from the view axis while the
 * frame reaches 5,4 — so a flight can be on the right side of the globe,
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
