// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  classifyLookupStatus,
  nextDelayAfterBlock,
  shouldAbortRun,
  BLOCK_SILENCE_MS,
  MAX_CONSECUTIVE_REFUSALS,
  MAX_DELAY_MS,
} from '../../../server/lookupPolicy';

/**
 * Only a literal 429 used to back the offline builder off. Everything else —
 * 403, 5xx, a Cloudflare block page — fell into the ordinary 2 s throttle
 * with no log line at all. Simulated over three virtual hours against an
 * adsbdb answering 403 to everything: 5 265 requests at a steady 0.5 req/s,
 * 0 callsigns cached, and an output of 23 lines indistinguishable from a
 * healthy run. A service that has already banned this machine will not
 * necessarily present the ban as a 429.
 */
describe('classifyLookupStatus', () => {
  it('calls a 429 a block', () => {
    expect(classifyLookupStatus(429)).toBe('blocked');
  });

  it('calls a 403 a block too — a ban need not arrive as a 429', () => {
    expect(classifyLookupStatus(403)).toBe('blocked');
  });

  it('calls every 5xx a block', () => {
    for (const s of [500, 502, 503, 504, 599]) expect(classifyLookupStatus(s)).toBe('blocked');
  });

  it('keeps 404 a verdict about the callsign, not a failure', () => {
    // Private, business and military flights. adsbdb genuinely has no route.
    expect(classifyLookupStatus(404)).toBe('unknown');
  });

  it('calls a 2xx an answer', () => {
    expect(classifyLookupStatus(200)).toBe('ok');
    expect(classifyLookupStatus(204)).toBe('ok');
  });

  it('calls any other status an error rather than guessing', () => {
    expect(classifyLookupStatus(400)).toBe('error');
    expect(classifyLookupStatus(418)).toBe('error');
    expect(classifyLookupStatus(301)).toBe('error');
  });
});

describe('nextDelayAfterBlock', () => {
  it('doubles the spacing, as the 429 branch always did', () => {
    expect(nextDelayAfterBlock(2_000)).toBe(4_000);
    expect(nextDelayAfterBlock(4_000)).toBe(8_000);
  });

  it('stops doubling at the ceiling', () => {
    expect(nextDelayAfterBlock(MAX_DELAY_MS)).toBe(MAX_DELAY_MS);
    expect(nextDelayAfterBlock(40_000)).toBe(MAX_DELAY_MS);
  });

  it('waits out the penalty in silence, longer than the advertised 300 s', () => {
    // The ban was still live at 300 s and only lifted after 330 s of total
    // silence; requests sent during it renew it.
    expect(BLOCK_SILENCE_MS).toBeGreaterThan(330_000);
  });
});

describe('shouldAbortRun', () => {
  it('lets a run continue through a handful of refusals', () => {
    expect(shouldAbortRun(0)).toBe(false);
    expect(shouldAbortRun(MAX_CONSECUTIVE_REFUSALS - 1)).toBe(false);
  });

  it('stops a run the provider keeps refusing', () => {
    // Otherwise it spends three hours hammering a service that is already
    // refusing it, while the terminal looks healthy.
    expect(shouldAbortRun(MAX_CONSECUTIVE_REFUSALS)).toBe(true);
    expect(shouldAbortRun(MAX_CONSECUTIVE_REFUSALS + 10)).toBe(true);
  });

  it('counts refusals in a row, not refusals in total', () => {
    // A single 503 in an otherwise healthy hour must not end the run: the
    // caller resets the count on the first answer that comes back.
    expect(shouldAbortRun(1)).toBe(false);
  });
});
