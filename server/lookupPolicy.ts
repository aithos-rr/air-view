/**
 * What an adsbdb answer means to the offline cache builder, and what to do
 * about it.
 *
 * Its own module because scripts/build-route-cache.mjs is a top-level
 * program: nothing inside it is reachable from a test, and the one branch it
 * had — `if (res.status === 429)` — was the only refusal it could see. Run
 * for three virtual hours against an adsbdb answering 403 to everything, the
 * script sent 5 265 requests at a steady 0.5 req/s, cached nothing, and
 * printed exactly the 23 lines a healthy run prints.
 *
 * server/routeResolver.ts deliberately keeps its own, narrower policy: the
 * runtime pump asks once every 10 s and abandons a callsign after three
 * failures, so a 403 there cannot become a three-hour hammering loop.
 */
export type LookupVerdict = 'ok' | 'unknown' | 'blocked' | 'error';

/**
 * 360 s, not 300: the ban was still live at 300 s and only lifted after
 * 330 s of total silence. Requests sent during the penalty renew it.
 */
export const BLOCK_SILENCE_MS = 360_000;
/** Ceiling on the self-correcting spacing between lookups. */
export const MAX_DELAY_MS = 60_000;
/**
 * Refusals in a row before the run gives up. Five at the 360 s silence is
 * half an hour of asking a provider that has said no every time — long
 * enough to ride out an incident, short enough not to be a three-hour
 * hammering.
 */
export const MAX_CONSECUTIVE_REFUSALS = 5;

/**
 * 404 is a verdict about the callsign — private, business and military
 * flights — not a failure. 429, 403 and every 5xx are the shapes a block
 * arrives in, including a Cloudflare page in front of the API. Anything else
 * is an answer we cannot interpret: retried per callsign, and still counted
 * toward the abort, because a run that only ever gets 400s is not working.
 */
export function classifyLookupStatus(status: number): LookupVerdict {
  if (status === 404) return 'unknown';
  if (status === 429 || status === 403 || status >= 500) return 'blocked';
  if (status >= 200 && status < 300) return 'ok';
  return 'error';
}

/** Back off hard, then stop backing off: the silence is what does the work. */
export function nextDelayAfterBlock(delayMs: number, maxDelayMs: number = MAX_DELAY_MS): number {
  return Math.min(delayMs * 2, maxDelayMs);
}

/** Consecutive refusals, reset by the caller on the first usable answer. */
export function shouldAbortRun(
  consecutiveRefusals: number,
  max: number = MAX_CONSECUTIVE_REFUSALS
): boolean {
  return consecutiveRefusals >= max;
}
