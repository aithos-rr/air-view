// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { enrichAndMark } from '../../../server/enrich';
import type { FlightRoute } from '../../../server/routeResolver';
import { makeAircraftRaw } from '../../helpers/aircraft';

/**
 * The enrichment used to live inside runCycle() in server/index.ts, a
 * top-level script that boots Fastify on import, so no test could reach it:
 * seventeen mutations of it — never attaching a route, attaching it with
 * origin and destination swapped, never marking completeness, inverting the
 * flag, marking BEFORE the routes are attached, never enqueuing anything —
 * left the whole suite green. Same move the plan already made for the poller
 * and the health route, for the same reason.
 */
const LAS_LHR: FlightRoute = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

function stubResolver(known: Record<string, FlightRoute> = {}): {
  get(callsign: string): FlightRoute | null;
  enqueue(callsigns: string[]): void;
  enqueued: string[][];
} {
  const enqueued: string[][] = [];
  return {
    get: (callsign) => known[callsign.trim().toUpperCase()] ?? null,
    enqueue: (callsigns) => {
      enqueued.push([...callsigns]);
    },
    enqueued,
  };
}

describe('enrichAndMark', () => {
  it('attaches the resolved route, origin as origin and destination as destination', () => {
    const ac = makeAircraftRaw({ callsign: 'BAW274' });
    enrichAndMark([ac], stubResolver({ BAW274: LAS_LHR }));

    // Asserted field by field, not as one object: a swap draws every route
    // backwards on the globe and a deep-equal on a symmetric fixture would
    // not see it.
    expect(ac.route?.originIata).toBe('LAS');
    expect(ac.route?.originName).toBe('McCarran International Airport');
    expect(ac.route?.destinationIata).toBe('LHR');
    expect(ac.route?.destinationName).toBe('London Heathrow Airport');
    expect(ac.route?.airlineName).toBe('British Airways');
    // Exactly the five client-facing fields: the resolver's record also
    // carries callsignIcao and callsignIata, which the payload must not grow.
    expect(Object.keys(ac.route ?? {}).sort()).toEqual([
      'airlineName', 'destinationIata', 'destinationName', 'originIata', 'originName',
    ]);
  });

  it('marks an aircraft complete in the SAME call that attaches its route', () => {
    // The ordering assertion: completeness is computed AFTER enrichment. Mark
    // first and isComplete() still sees route === null, so the whole fleet
    // stays grey for ever — which is what five of the surviving mutants did.
    const ac = makeAircraftRaw({ callsign: 'BAW274', route: null, complete: false });
    enrichAndMark([ac], stubResolver({ BAW274: LAS_LHR }));
    expect(ac.complete).toBe(true);
  });

  it('leaves an aircraft the resolver cannot place grey, with a null route', () => {
    const ac = makeAircraftRaw({ callsign: 'NJE004M' });
    enrichAndMark([ac], stubResolver());
    expect(ac.route).toBeNull();
    expect(ac.complete).toBe(false);
  });

  it('skips an aircraft with no callsign and never enqueues one', () => {
    const ac = makeAircraftRaw({ callsign: null });
    const routes = stubResolver();
    enrichAndMark([ac], routes);
    expect(ac.route).toBeNull();
    expect(ac.complete).toBe(false);
    expect(routes.enqueued.flat()).toEqual([]);
  });

  it('enqueues the callsigns it saw, so the pump picks up what the seed missed', () => {
    const routes = stubResolver({ BAW274: LAS_LHR });
    enrichAndMark(
      [makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274' }), makeAircraftRaw({ icao24: 'a2', callsign: 'DLH400' })],
      routes
    );
    expect(routes.enqueued.flat().sort()).toEqual(['BAW274', 'DLH400']);
  });

  it('counts the whole fleet and the complete records separately', () => {
    const world = [
      makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274' }),
      makeAircraftRaw({ icao24: 'a2', callsign: 'DLH400' }),
      makeAircraftRaw({ icao24: 'a3', callsign: null }),
    ];
    const counts = enrichAndMark(world, stubResolver({ BAW274: LAS_LHR }));
    expect(counts).toEqual({ total: 3, complete: 1 });
  });

  it('does not report a fleet as complete when only its technical fields are there', () => {
    // /health said "complete" for the whole fleet in one surviving mutant.
    const world = [
      makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274' }),
      makeAircraftRaw({ icao24: 'a2', callsign: 'DLH400', registration: null }),
    ];
    const counts = enrichAndMark(world, stubResolver());
    expect(counts.complete).toBe(0);
    expect(counts.total).toBe(2);
  });
});
