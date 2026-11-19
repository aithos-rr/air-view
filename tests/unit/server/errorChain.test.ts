import { describe, it, expect } from 'vitest';
import { rootCause, upstreamStatus } from '../../../server/errorChain';

describe('rootCause', () => {
  it('reads the code from the deepest link, not from the first', () => {
    // The shape the Railway egress failure actually had: the selector wraps
    // the adapter error, which wraps undici's, and only the innermost link
    // carries the code. Reading e.cause alone logged causeCode: null.
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND api.adsb.lol'), {
      code: 'ENOTFOUND',
    });
    const middle = new Error('adsb-lol: fetch failed', { cause: inner });
    const top = new Error('all usable ADS-B sources failed: adsb-lol: fetch failed', {
      cause: middle,
    });
    expect(rootCause(top)).toEqual({
      message: 'getaddrinfo ENOTFOUND api.adsb.lol',
      code: 'ENOTFOUND',
    });
  });

  it('falls back to the error itself when there is no cause', () => {
    expect(rootCause(new Error('all ADS-B sources are in cooldown'))).toEqual({
      message: 'all ADS-B sources are in cooldown',
      code: null,
    });
  });

  it('survives a non-Error throw', () => {
    expect(rootCause('boom')).toEqual({ message: 'boom', code: null });
  });

  it('stops on a cause chain that loops back on itself', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(rootCause(b).message).toBe('a');
  });
});

describe('upstreamStatus', () => {
  it('finds the adapter status and Retry-After under the selector wrapper', () => {
    const http = Object.assign(new Error('adsb-lol: HTTP 429 (retry after 90s)'), {
      status: 429,
      retryAfterSeconds: 90,
      body: null,
    });
    const top = new Error('all usable ADS-B sources failed: adsb-lol: HTTP 429', {
      cause: http,
    });
    expect(upstreamStatus(top)).toEqual({ status: 429, retryAfterSeconds: 90 });
  });

  it('reports null seconds when the server sent no Retry-After', () => {
    const http = Object.assign(new Error('adsb-lol: HTTP 429'), {
      status: 429,
      retryAfterSeconds: null,
      body: null,
    });
    expect(upstreamStatus(new Error('wrapped', { cause: http }))).toEqual({
      status: 429,
      retryAfterSeconds: null,
    });
  });

  it('returns null when nothing in the chain is an HTTP failure', () => {
    expect(upstreamStatus(new Error('no ADS-B source accepts a 10000 NM radius'))).toBeNull();
  });
});
