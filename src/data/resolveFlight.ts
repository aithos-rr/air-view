import type { ResolvedFlight } from '@/types';
import { parseCallsign } from './callsign';
import { lookupAirline } from './airlineLookup';
import { lookupRoute } from './routeLookup';
import { lookupAirport } from './airportLookup';

/**
 * Parses a callsign and resolves it against the bundled static data.
 *
 * Returns null only if the callsign is unparseable or the airline is unknown.
 * If the airline is known but the route lookup fails, returns a partial
 * ResolvedFlight with null origin / destination — the UI must handle this.
 */
export function resolveFlight(callsign: string | null | undefined): ResolvedFlight | null {
  const parsed = parseCallsign(callsign);
  if (!parsed) return null;

  const airline = lookupAirline(parsed.airlineIcao);
  if (!airline) return null;

  const route = lookupRoute(airline.iata, parsed.flightNumber);
  if (!route) {
    return {
      airlineIcao: airline.icao,
      airlineName: airline.name,
      flightNumber: parsed.flightNumber,
      origin: null,
      destination: null,
    };
  }

  return {
    airlineIcao: airline.icao,
    airlineName: airline.name,
    flightNumber: parsed.flightNumber,
    origin: lookupAirport(route.originIata),
    destination: lookupAirport(route.destinationIata),
  };
}
