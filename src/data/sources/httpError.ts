/**
 * An upstream HTTP failure that keeps what the response actually said.
 *
 * Throwing the status alone discards the two things that matter in practice:
 * adsb.lol puts its reason in the BODY ("radius exceeds 250 NM" on a 403),
 * and a 429 puts the wait in the Retry-After HEADER. Both were being thrown
 * away, so an operator reading the logs saw "adsb-lol: HTTP 403" and had no
 * way to tell a radius refusal from a blocked User-Agent — which is exactly
 * the pair of causes that took v1 down.
 */
export interface UpstreamHttpError extends Error {
  status: number;
  /** Seconds to wait, from Retry-After; null when the server did not say. */
  retryAfterSeconds: number | null;
  /** First 200 characters of the error body, or null when there was none. */
  body: string | null;
}

/** Seconds, or an HTTP-date. Anything else is unknown, so null — not a guess. */
function parseRetryAfter(raw: string | null, nowMs: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.round((when - nowMs) / 1000));
}

async function readBodySnippet(res: Response): Promise<string | null> {
  if (typeof res.text !== 'function') return null; // hand-built test doubles
  try {
    const text = (await res.text()).trim();
    return text === '' ? null : text.slice(0, 200);
  } catch {
    return null; // a body we cannot read must not mask the status
  }
}

export async function upstreamHttpError(
  sourceId: string,
  res: Response,
  nowMs: number = Date.now()
): Promise<UpstreamHttpError> {
  const body = await readBodySnippet(res);
  const retryAfterSeconds = parseRetryAfter(res.headers?.get('Retry-After') ?? null, nowMs);
  const detail = [
    body === null ? null : `"${body}"`,
    retryAfterSeconds === null ? null : `retry after ${retryAfterSeconds}s`,
  ].filter((p): p is string => p !== null);
  const message = `${sourceId}: HTTP ${res.status}${detail.length > 0 ? ` (${detail.join(', ')})` : ''}`;
  const err = new Error(message) as UpstreamHttpError;
  err.status = res.status;
  err.retryAfterSeconds = retryAfterSeconds;
  err.body = body;
  return err;
}
