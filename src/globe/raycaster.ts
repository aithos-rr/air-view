import { Camera, Vector2, Vector3 } from 'three';
import type { Aircraft } from '@/types';
import { latLonAltToVec3 } from './geoHelpers';

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
  canvas: HTMLCanvasElement
): string | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pointerPx = new Vector2(((pointerNDC.x + 1) * w) / 2, ((1 - pointerNDC.y) * h) / 2);

  const camDir = camera.position.clone().normalize();

  const projected: Array<{ icao: string; px: Vector2 }> = [];
  for (const ac of aircraft) {
    if (ac.latitude === null || ac.longitude === null) continue;
    const world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
    const acDir = world.clone().normalize();
    if (camDir.dot(acDir) <= 0.05) continue; // far hemisphere
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

  let bestIcao: string | null = null;
  let bestDist = Infinity;
  for (const { icao, px } of projected) {
    const d = px.distanceTo(pointerPx);
    if (d < hitRadius && d < bestDist) {
      bestDist = d;
      bestIcao = icao;
    }
  }
  return bestIcao;
}
