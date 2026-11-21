import type { FlightRouteLite } from '@/types';

/**
 * Four answers, because there are four facts — and two of them are not
 * facts about the flight at all.
 *
 * `unknown` means ADSBDB was asked about this callsign and has no route for
 * it: a measurement, and the only answer that may become "No flight by that
 * number". `notChecked` means our server holds no answer because nobody has
 * ever looked — the ordinary case for a real flight number, with ~8 374
 * callsigns cached and ~920 added an hour — and it has now been queued.
 * `unreachable` means we never got to ask, or could not read what came
 * back. Collapsing any of them into one another is how a 500, a timeout, a
 * stopped server or a callsign nobody had looked up all became the sentence
 * "No flight by that number" — the screen claiming to have checked
 * something it never checked (D15b).
 */
export type RouteAnswer =
  | { status: 'known'; route: FlightRouteLite }
  | { status: 'unknown' }
  | { status: 'notChecked' }
  | { status: 'unreachable'; detail: string };

/**
 * Asks our own server whether it knows this flight's route.
 *
 * Our server, never adsbdb: the endpoint answers from memory and enqueues
 * what it does not know, which is the only way a search box can exist
 * without handing visitors a way to get the site rate-limited.
 *
 * Every failure is caught HERE and named, rather than thrown for a caller
 * to flatten. The caller that flattened it is exactly how this went wrong.
 */
export async function fetchRoute(
  callsign: string,
  signal?: AbortSignal
): Promise<RouteAnswer> {
  let res: Response;
  try {
    res = await fetch(`/api/route/${encodeURIComponent(callsign)}`, { signal });
  } catch (err) {
    return { status: 'unreachable', detail: String(err) };
  }
  // A refusal is not a verdict: 400 and 500 alike say the question did not
  // get an answer, not that the flight does not exist.
  if (!res.ok) return { status: 'unreachable', detail: `server answered ${res.status}` };
  let data: { status?: string; route?: FlightRouteLite | null };
  try {
    data = (await res.json()) as { status?: string; route?: FlightRouteLite | null };
  } catch (err) {
    return { status: 'unreachable', detail: String(err) };
  }
  const route = data.route ?? null;
  switch (data.status) {
    case 'known':
      // A 'known' with nothing in it is a body we cannot read, not a route.
      return route === null
        ? { status: 'unreachable', detail: 'server said known and sent no route' }
        : { status: 'known', route };
    case 'noRoute':
      return { status: 'unknown' };
    case 'notLookedUpYet':
      return { status: 'notChecked' };
    case 'lookupFailed':
      // The server tried until it gave up and nothing ever answered. We
      // have no measurement about this flight, and no retry to promise.
      return { status: 'unreachable', detail: 'the route service never answered about it' };
    default:
      // Including a body with no status at all: unreadable is unreachable,
      // and guessing from a `known` boolean is exactly the flattening this
      // endpoint stopped doing.
      return { status: 'unreachable', detail: `server answered status ${String(data.status)}` };
  }
}
