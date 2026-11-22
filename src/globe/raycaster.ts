import { Camera, Vector2, Vector3 } from 'three';
import type { Aircraft } from '@/types';
import { isOnNearSide, latLonAltToVec3, shellThicknessUnits } from './geoHelpers';
import { isAircraftVisible } from './visibility';
import type { VisibilityRule } from './visibility';
import { advanceFor, positionAt } from './deadReckoning';
import { SETTLED_FRAME } from './aircraft';
import type { FrameState } from './aircraft';

/**
 * Projects each aircraft to screen space and finds the one closest to the
 * pointer within a hit radius. Radius is 16 px by default, expanded to 44 px
 * (WCAG 2.5.5 minimum touch target) when local aircraft density is below
 * 1 aircraft per 100×100 px region around the pointer.
 *
 * Far-hemisphere aircraft (occluded by the globe) are excluded.
 */
export function findAircraftAtPointer(
  pointerNDC: Vector2,
  aircraft: Iterable<Aircraft>,
  camera: Camera,
  canvas: HTMLCanvasElement,
  rule: VisibilityRule,
  frame: FrameState = SETTLED_FRAME,
  after: string | null = null
): string | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pointerPx = new Vector2(((pointerNDC.x + 1) * w) / 2, ((1 - pointerNDC.y) * h) / 2);

  const projected: Array<{ icao: string; px: Vector2 }> = [];
  for (const ac of aircraft) {
    if (ac.latitude === null || ac.longitude === null) continue;
    // An aircraft nobody can see must not answer a click. Under focus that
    // leaves only the focused flight pickable, so a click anywhere else
    // falls through to select(null) — which is the Esc-or-empty-space exit
    // the spec §6.2 describes, obtained for free.
    if (!isAircraftVisible(ac, rule)) continue;
    // The POSITION ON SCREEN, not the fix. A dot carried 25 px forward by
    // the dead reckoning and a hit test still sitting on its fix is an
    // aircraft you can see and cannot click — the ghost D7 forbids, seen
    // from the other door (D29).
    const world = worldOf(ac, frame);
    if (!isOnNearSide(camera.position, world)) continue; // behind the planet
    const p = new Vector3().copy(world).project(camera);
    const sx = ((p.x + 1) * w) / 2;
    const sy = ((1 - p.y) * h) / 2;
    projected.push({ icao: ac.icao24, px: new Vector2(sx, sy) });
  }

  // Density check: aircraft within 100×100 px region of the pointer
  const NEAR = 100;
  const nearby = projected.filter(
    (p) => Math.abs(p.px.x - pointerPx.x) < NEAR && Math.abs(p.px.y - pointerPx.y) < NEAR
  );
  const hitRadius = nearby.length > 1 ? 16 : 44;

  // Every candidate under the cursor, nearest first. Two aircraft on one
  // pixel stay two aircraft: the spec calls numeric clustering an
  // anti-reference, and the additive blending already brightens a pile-up,
  // which is a density cue nobody had to invent a number for (D26).
  const hits = projected
    .map((p) => ({ icao: p.icao, d: p.px.distanceTo(pointerPx) }))
    .filter((h) => h.d < hitRadius)
    .sort((a, b) => a.d - b.d);
  if (hits.length === 0) return null;
  if (after != null) {
    const i = hits.findIndex((h) => h.icao === after);
    // An `after` that is no longer under the cursor is not a second
    // attempt at the same target: it is a new target, and the nearest wins.
    if (i >= 0) return hits[(i + 1) % hits.length]!.icao;
  }
  return hits[0]!.icao;
}

const scratch = { x: 0, y: 0, z: 0 };

/** Where this aircraft is drawn on this frame, by the same arithmetic the layer uses. */
function worldOf(ac: Aircraft, frame: FrameState): Vector3 {
  if (ac.motion == null) {
    return latLonAltToVec3(
      ac.latitude!,
      ac.longitude!,
      ac.baroAltitudeFt ?? 38000,
      frame.cameraDistance
    );
  }
  // advanceFor, the same call describeVisibleFleet makes: if it says STILL
  // because the ceiling is past or because the server declared the body a
  // photograph, the hit test sits on the fix, which is where the dot is.
  // Two copies of that rule would differ on exactly the frames that matter.
  positionAt(
    ac.motion,
    advanceFor(ac.motion, frame.elapsedSinceBatchS, frame.stale),
    frame.nowMs,
    shellThicknessUnits(frame.cameraDistance),
    scratch
  );
  return new Vector3(scratch.x, scratch.y, scratch.z);
}
