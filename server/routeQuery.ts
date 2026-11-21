import type { FastifyInstance } from 'fastify';
import type { RouteKnowledge } from './routeResolver.js';
import type { FlightRouteLite } from '../src/types.js';

export interface RouteQueryDeps {
  /**
   * The resolver's in-memory cache, and WHY it is answering what it
   * answers. Never a lookup — see below.
   *
   * `knowledge` rather than `get`, because get() returns null both for a
   * callsign adsbdb told us nothing about and for one nobody has ever
   * asked about, and this endpoint is where that difference becomes a
   * sentence on somebody's screen.
   */
  knowledge: (callsign: string) => RouteKnowledge;
  enqueue: (callsigns: string[]) => void;
}

/** Same shape the ICAO callsigns in the feed take: three letters, then digits. */
const CALLSIGN_RX = /^[A-Z]{3}[0-9][A-Z0-9]{0,4}$/;

/**
 * Answers "do we know where this flight goes?" without ever asking adsbdb.
 *
 * This is search outcome 2 of spec §6.3: a flight nobody can see because it
 * is outside ADS-B coverage, whose route we nevertheless know — 8 374 of
 * them in the runtime cache, measured 2026-11-21, growing ~920/hour.
 *
 * It answers from the cache and NOTHING else. Measured in routeResolver.ts:
 * ~1 190 lookups at 4.8 req/s produced `429 rate limited for 300 seconds`,
 * and requests sent during the penalty renew it. A search box wired to a
 * live lookup would hand a visitor the ability to ban the whole site. A
 * callsign nobody has asked about is instead handed to the slow pump — and
 * SAID to be un-asked, not declared non-existent — so the same search a few
 * minutes from now can succeed.
 *
 * A factory, like registerHealthRoute, because server/index.ts boots
 * Fastify on import and nothing written inside it is reachable from a test.
 */
export function registerRouteQueryRoute(app: FastifyInstance, deps: RouteQueryDeps): void {
  app.get<{ Params: { callsign: string } }>('/api/route/:callsign', async (req, reply) => {
    const callsign = req.params.callsign.toUpperCase();
    if (!CALLSIGN_RX.test(callsign)) {
      return reply.code(400).send({ error: 'not an ICAO flight callsign' });
    }
    const { status, route } = deps.knowledge(callsign);
    if (route === null) {
      // Only the callsign nobody has reached yet goes to the pump: a
      // callsign already answered about needs nothing, and one we gave up
      // on is refused by enqueue() anyway — asking would merely invent a
      // retry for the client to wait for.
      if (status === 'notLookedUpYet') deps.enqueue([callsign]);
      // Three different facts, three different answers. A single
      // `known: false` is how "No flight by that number" came to be
      // printed about flights nobody had ever looked up (D15b).
      return reply.send({ callsign, status, route: null });
    }
    // The five client-facing fields, the same ones enrich.ts attaches to an
    // aircraft record. The two callsign spellings stay server-side.
    const lite: FlightRouteLite = {
      originIata: route.originIata,
      originName: route.originName,
      destinationIata: route.destinationIata,
      destinationName: route.destinationName,
      airlineName: route.airlineName,
    };
    return reply.send({ callsign, status, route: lite });
  });
}
