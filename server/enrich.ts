import type { AircraftRaw, FlightRouteLite } from '../src/types.js';
import type { RouteResolver } from './routeResolver.js';
import { isComplete } from '../src/data/completeness.js';

export interface EnrichmentCounts {
  /** Records in the fleet this cycle. */
  total: number;
  /** How many of them carry a full card AND a drawable route. */
  complete: number;
}

/**
 * Attaches the resolved routes to a cycle's harvest and marks completeness,
 * in that order, returning what /health reports.
 *
 * Its own module rather than a block inside runCycle(), for the reason
 * poller.ts and healthRoute.ts are their own modules: server/index.ts is a
 * top-level script that boots Fastify on import, so nothing in it is
 * reachable from a test. Seventeen mutations of this logic while it lived
 * there — no route attached at all, origin and destination swapped, the
 * completeness flag inverted, completeness computed BEFORE the routes are
 * attached so every aircraft stays grey for ever, no callsign ever enqueued —
 * left all 205 tests green.
 *
 * The records are mutated in place on purpose: fleet.snapshot() hands back
 * the live record objects, and the payload is serialised from them moments
 * later in the same cycle.
 */
export function enrichAndMark(
  world: AircraftRaw[],
  routes: Pick<RouteResolver, 'get' | 'enqueue'>
): EnrichmentCounts {
  const callsigns: string[] = [];
  for (const ac of world) {
    if (ac.callsign === null) continue;
    callsigns.push(ac.callsign);
    const r = routes.get(ac.callsign);
    if (r) {
      // Only the five client-facing fields: FlightRoute also carries the two
      // callsign spellings, and the payload is already 280-414 B per record.
      const lite: FlightRouteLite = {
        originIata: r.originIata,
        originName: r.originName,
        destinationIata: r.destinationIata,
        destinationName: r.destinationName,
        airlineName: r.airlineName,
      };
      ac.route = lite;
    }
  }
  // Every callsign seen, resolved or not: enqueue() itself skips the ones it
  // already knows, has given up on, or already holds in the queue.
  routes.enqueue(callsigns);

  // AFTER the loop above, never inside it and never before it: isComplete()
  // reads ac.route, so marking first leaves the whole fleet grey.
  let complete = 0;
  for (const ac of world) {
    ac.complete = isComplete(ac);
    if (ac.complete) complete += 1;
  }
  return { total: world.length, complete };
}
