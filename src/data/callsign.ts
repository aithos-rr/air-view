const CALLSIGN_REGEX = /^([A-Z]{3})([A-Z0-9]+)$/;

export interface ParsedCallsign {
  airlineIcao: string;
  flightNumber: string;
}

export function parseCallsign(callsign: string | null | undefined): ParsedCallsign | null {
  if (!callsign) return null;
  const cleaned = callsign.trim().toUpperCase();
  const m = cleaned.match(CALLSIGN_REGEX);
  if (!m) return null;
  return { airlineIcao: m[1]!, flightNumber: m[2]! };
}
