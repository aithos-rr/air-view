import type { AircraftRaw, ResolvedFlight } from '@/types';
import { parseCallsign } from './callsign';
import { lookupAirline } from './airlineLookup';
import { lookupAirport } from './airportLookup';

/**
 * Builds the display record for an aircraft.
 *
 * The route now arrives from the server (adsbdb, real). The airline name
 * still comes from the bundled OpenFlights airline table, which is a pure
 * code-to-name mapping and therefore trustworthy — unlike the old route
 * table, which was queried in a way that fabricated origins.
 */
export function resolveFlight(ac: AircraftRaw): ResolvedFlight | null {
  const parsed = parseCallsign(ac.callsign);
  if (!parsed) return null;

  const airline = lookupAirline(parsed.airlineIcao);
  const airlineName = airline?.name ?? ac.route?.airlineName ?? null;
  if (airlineName === null) return null;

  return {
    airlineIcao: parsed.airlineIcao,
    airlineName,
    flightNumber: parsed.flightNumber,
    origin: ac.route ? lookupAirport(ac.route.originIata) : null,
    destination: ac.route ? lookupAirport(ac.route.destinationIata) : null,
  };
}
