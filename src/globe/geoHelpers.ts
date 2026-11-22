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
