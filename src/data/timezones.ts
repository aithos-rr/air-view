/**
 * Formats a Date in a given IANA timezone as "HH:MM ZZZ" (e.g. "14:32 BST").
 * Returns "HH:MM UTC" if the timezone string is not recognised.
 *
 * Uses Intl.DateTimeFormat directly (not Luxon ZZZZ) because Luxon's
 * localized offset name depends on full-icu data which is not always
 * bundled with Node. Intl.DateTimeFormat with timeZoneName: 'short'
 * reliably returns "BST", "EDT", etc. across Node versions.
 */
export function formatLocalTime(date: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    const parts = fmt.formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
    // Intl returns "24" instead of "00" for midnight in some locales — normalize
    const normalisedHour = hour === '24' ? '00' : hour;
    return `${normalisedHour}:${minute} ${tz}`;
  } catch {
    const utcFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = utcFmt.formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const normalisedHour = hour === '24' ? '00' : hour;
    return `${normalisedHour}:${minute} UTC`;
  }
}
