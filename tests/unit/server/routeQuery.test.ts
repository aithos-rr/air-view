// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerRouteQueryRoute } from '../../../server/routeQuery';
import type { FlightRoute, RouteKnowledge } from '../../../server/routeResolver';

const BAW274: FlightRoute = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

/**
 * The fake answers what the real resolver answers: a STATUS, never a bare
 * null. A callsign the table does not mention has not been looked up —
 * which is what the resolver says about anything outside its three sets.
 */
function build(known: Record<string, RouteKnowledge> = {}): {
  app: ReturnType<typeof Fastify>;
  enqueued: string[];
} {
  const enqueued: string[] = [];
  const app = Fastify({ logger: false });
  registerRouteQueryRoute(app, {
    knowledge: (cs) => known[cs] ?? { status: 'notLookedUpYet', route: null },
    enqueue: (cs) => enqueued.push(...cs),
  });
  return { app, enqueued };
}

describe('GET /api/route/:callsign', () => {
  it('answers a known callsign from the cache, in the client-facing shape', async () => {
    const { app } = build({ BAW274: { status: 'known', route: BAW274 } });
    const res = await app.inject({ method: 'GET', url: '/api/route/BAW274' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      callsign: 'BAW274',
      status: 'known',
      route: {
        originIata: 'LAS',
        originName: 'McCarran International Airport',
        destinationIata: 'LHR',
        destinationName: 'London Heathrow Airport',
        airlineName: 'British Airways',
      },
    });
  });

  it('says NO ROUTE only about a callsign adsbdb was actually asked about', async () => {
    // The 351 records of route-cache.json whose route is null. This is the
    // one answer allowed to become "No flight by that number", because it
    // is the only one anybody measured.
    const { app } = build({ AAA111: { status: 'noRoute', route: null } });
    const res = await app.inject({ method: 'GET', url: '/api/route/AAA111' });
    expect(res.json()).toEqual({ callsign: 'AAA111', status: 'noRoute', route: null });
  });

  it('does NOT call a callsign nobody has ever asked about unknown', async () => {
    // The defect this status exists for: the cache holds ~8 374 callsigns
    // and grows by ~920 an hour, so a real flight number typed into the box
    // is usually one nobody has looked up. Answering that with the same
    // body as "we asked and there is no such flight" is a certainty nobody
    // measured (D15b) — and it reached the screen as a sentence about the
    // world.
    const { app } = build({ AAA111: { status: 'noRoute', route: null } });
    const asked = await app.inject({ method: 'GET', url: '/api/route/AAA111' });
    const never = await app.inject({ method: 'GET', url: '/api/route/BBB222' });
    expect(never.json()).toEqual({ callsign: 'BBB222', status: 'notLookedUpYet', route: null });
    expect(never.json()).not.toEqual(asked.json());
  });

  it('reports a callsign it gave up on as a failed lookup, not as a verdict', async () => {
    const { app, enqueued } = build({ CCC333: { status: 'lookupFailed', route: null } });
    const res = await app.inject({ method: 'GET', url: '/api/route/CCC333' });
    expect(res.json()).toEqual({ callsign: 'CCC333', status: 'lookupFailed', route: null });
    // enqueue() refuses abandoned callsigns anyway; asking it to is how a
    // caller would come to believe a retry is on its way.
    expect(enqueued).toEqual([]);
  });

  it('hands the un-asked callsign to the slow pump so a later search may win', async () => {
    const { app, enqueued } = build();
    await app.inject({ method: 'GET', url: '/api/route/BAW999' });
    expect(enqueued).toEqual(['BAW999']);
  });

  it('does not re-queue a callsign that already has its answer', async () => {
    const { app, enqueued } = build({
      BAW274: { status: 'known', route: BAW274 },
      AAA111: { status: 'noRoute', route: null },
    });
    await app.inject({ method: 'GET', url: '/api/route/BAW274' });
    await app.inject({ method: 'GET', url: '/api/route/AAA111' });
    expect(enqueued).toEqual([]);
  });

  it('performs NO network call while answering', async () => {
    // Measured in routeResolver.ts: ~1 190 lookups at 4.8 req/s earned a
    // 300 s ban, and requests sent during the penalty renew it. A search box
    // wired straight to adsbdb is a ban generator.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { app } = build();
    await app.inject({ method: 'GET', url: '/api/route/BAW999' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('refuses a callsign that is not one', async () => {
    const { app, enqueued } = build();
    const res = await app.inject({ method: 'GET', url: '/api/route/hello' });
    expect(res.statusCode).toBe(400);
    expect(enqueued).toEqual([]);
  });
});
