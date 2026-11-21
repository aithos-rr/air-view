import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchRoute } from '@/data/routeClient';
import type { FlightRouteLite } from '@/types';

const ROUTE: FlightRouteLite = {
  originIata: 'LAS',
  originName: 'Harry Reid International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchRoute — four answers, and never the wrong one', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands back the route the server knows', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', status: 'known', route: ROUTE })
    ));
    return expect(fetchRoute('BAW999')).resolves.toEqual({ status: 'known', route: ROUTE });
  });

  it('reports UNKNOWN only when the server says it ASKED and got nothing', () => {
    // `noRoute` is a measured answer: adsbdb was asked about this callsign
    // and has no route for it. That is the only thing allowed to become
    // "No flight by that number".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', status: 'noRoute', route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toEqual({ status: 'unknown' });
  });

  it('keeps "nobody has looked yet" apart from "there is no such flight"', () => {
    // The cache holds ~8 374 callsigns and grows by ~920 an hour, so this
    // is the ordinary answer for a real flight number, not the exotic one.
    // Reading it as a verdict is D15b one step below where the search
    // caught it (D15b: unreachable vs unknown).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', status: 'notLookedUpYet', route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toEqual({ status: 'notChecked' });
  });

  it('treats a lookup that never got an answer as a failure of OURS', () => {
    // Three transport failures and the resolver gives up permanently. We
    // have no measurement about the flight and no retry to promise.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', status: 'lookupFailed', route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('reports that it could not ASK when the server answers 500', () => {
    // The defect in its purest form: an outage used to return null, which
    // the store read as "unknown flight", which the screen printed as a
    // statement about the world. res.ok === false and "we asked and there
    // is nothing" are different facts and must not share a return value
    // (D15b).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false, 500)));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('reports the same when a 400 comes back, because that is not a verdict either', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false, 400)));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('reports the same when the request never completes at all', () => {
    // A dead server, a dropped connection, the dev server not running:
    // fetch rejects, and a rejection is not evidence about the flight.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('does not treat a body it cannot read as an answer', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); },
    } as unknown as Response));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('does not guess at a body whose status it does not recognise', () => {
    // A 200 whose status word we cannot read is not a verdict about the
    // flight either — it is a body we could not understand, which is the
    // definition of `unreachable` in this module.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', known: false, route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('does not call a "known" answer with no route in it known', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', status: 'known', route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });
});
