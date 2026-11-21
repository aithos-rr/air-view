import { lookupAirlineIcaosByIata } from './airlineLookup';

/** Three letters then a digit: the ICAO callsign the feed actually carries. */
const ICAO_FORM = /^[A-Z]{3}[0-9][A-Z0-9]*$/;
/** Two characters then digits: the IATA flight number on a boarding pass. */
const IATA_FORM = /^([A-Z0-9]{2})([0-9]{1,4})([A-Z]?)$/;

export function normalizeQuery(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The ICAO callsigns a typed query could mean, best first.
 *
 * adsbdb exposes both spellings and the user does not know which one they
 * need (spec §6.3), while the feed carries only the ICAO one. The two
 * readings never overlap: ICAO needs THREE letters followed by a digit, so
 * 'BAW274' has only that reading, and 'VY1234' has prefix 'VY1' which is
 * not three letters, so it has only the IATA one.
 *
 * A list, because 17 of the 834 IATA codes in the bundled table belong to
 * more than one airline (measured 2026-11-21). The feed decides which is
 * meant — the table cannot.
 */
export function expandQuery(input: string): string[] {
  const q = normalizeQuery(input);
  if (q.length < 3) return [];
  if (ICAO_FORM.test(q)) return [q];

  const m = q.match(IATA_FORM);
  if (!m) return [];
  const airline = m[1] ?? '';
  const digits = m[2] ?? '';
  const suffix = m[3] ?? '';

  // adsbdb spells it AA1006, never AA01006, but a user copying from a
  // boarding pass may keep the padding. Offer both, padded first because
  // that is what they typed.
  const stripped = digits.replace(/^0+/, '');
  const numbers = stripped !== '' && stripped !== digits ? [digits, stripped] : [digits];

  const out: string[] = [];
  for (const icao of lookupAirlineIcaosByIata(airline)) {
    for (const n of numbers) out.push(`${icao}${n}${suffix}`);
  }
  return out;
}
