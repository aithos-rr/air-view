/**
 * Readers for the error chain the poller actually receives.
 *
 * The selector throws an aggregate Error carrying the original failure as
 * `cause`, and that failure is itself a wrapper: undici hangs the code an
 * operator greps for — UND_ERR_CONNECT_TIMEOUT, ENOTFOUND — on
 * `e.cause.cause`. The handler that read one level logged causeCode: null
 * throughout the Railway egress outage, the one failure it existed for.
 */

export interface RootCause {
  message: string;
  /** undici's error code, when any link in the chain carried one. */
  code: string | null;
}

/** Walks `.cause` to the deepest link, keeping the last message and code seen. */
export function rootCause(e: unknown): RootCause {
  let message = e instanceof Error ? e.message : String(e);
  let code: string | null = null;
  let current: unknown = e;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current); // a chain that loops back must not hang the logger
    const link = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof link.message === 'string' && link.message !== '') message = link.message;
    if (typeof link.code === 'string' && link.code !== '') code = link.code;
    current = link.cause ?? null;
  }
  return { message, code };
}

export interface UpstreamStatus {
  status: number;
  /** Seconds the server asked us to wait, or null when it did not say. */
  retryAfterSeconds: number | null;
}

/**
 * Finds the `UpstreamHttpError` the adapters throw, wherever the selector
 * buried it. Without it the poller is left matching /\b429\b/ against a
 * message, next to a `status` and a `Retry-After` the adapter already
 * parsed and typed.
 */
export function upstreamStatus(e: unknown): UpstreamStatus | null {
  let current: unknown = e;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const link = current as { status?: unknown; retryAfterSeconds?: unknown; cause?: unknown };
    if (typeof link.status === 'number') {
      return {
        status: link.status,
        retryAfterSeconds:
          typeof link.retryAfterSeconds === 'number' ? link.retryAfterSeconds : null,
      };
    }
    current = link.cause ?? null;
  }
  return null;
}
