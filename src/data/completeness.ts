import type { AircraftRaw } from '../types.js';

/**
 * Everything "complete" requires EXCEPT the route.
 *
 * Split out because the user's panel reports the two halves separately.
 * Measured in production on 2026-11-21: the technical fields cover 99% of
 * the fleet, the routes 4.7%, so 3.5% of aircraft are complete. Knowing how
 * many greys lack ONLY a route is the difference between a panel that looks
 * broken and one that explains itself.
 *
 * Altitude is exempt on the ground, where a null baro altitude is correct
 * rather than missing.
 */
export function isCompleteExceptRoute(ac: AircraftRaw): boolean {
  if (ac.callsign === null) return false;
  if (ac.latitude === null || ac.longitude === null) return false;
  if (ac.registration === null) return false;
  if (ac.modelCode === null) return false;
  if (ac.velocityKt === null) return false;
  if (ac.headingDeg === null) return false;
  if (!ac.onGround && ac.baroAltitudeFt === null) return false;
  return true;
}

/**
 * An aircraft is "complete" when we can show its full card AND draw its
 * route. The colour predicts the interaction: only a complete aircraft can
 * put D and A on the globe, which is what makes the filter meaningful.
 */
export function isComplete(ac: AircraftRaw): boolean {
  return ac.route !== null && isCompleteExceptRoute(ac);
}
