import { describe, it, expect } from 'vitest';
import { formatLocalTime } from '@/data/timezones';

describe('formatLocalTime', () => {
  // Note: ICU/CLDR ships proper short timezone abbreviations only for North
  // American zones (EDT/PDT/CDT…). For the rest of the world it returns
  // "GMT+N" generic offsets. We accept what Intl gives us — the goal is
  // accurate local time + zone marker, not insisting on "BST" vs "GMT+1".
  it('formats UTC midnight 2026-05-20 to Europe/London with +1 offset', () => {
    const out = formatLocalTime(new Date('2026-05-20T00:00:00Z'), 'Europe/London');
    expect(out).toBe('01:00 GMT+1');
  });
  it('formats UTC noon to America/New_York as "08:00 EDT"', () => {
    const out = formatLocalTime(new Date('2026-05-20T12:00:00Z'), 'America/New_York');
    expect(out).toBe('08:00 EDT');
  });
  it('falls back to UTC for invalid timezone', () => {
    const out = formatLocalTime(new Date('2026-05-20T12:00:00Z'), 'Not/A/Zone');
    expect(out).toBe('12:00 UTC');
  });
});
