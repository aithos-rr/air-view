import type { FlightRouteLite } from '@/types';
import { lookupAirport } from './airportLookup';

export type RouteEnd = 'origin' | 'destination';

export interface AirportInfo {
  /** 'origin' draws D, 'destination' draws A. */
  end: RouteEnd;
  iata: string;
  /** adsbdb's name for this flight's airport; the table's only as a fallback. */
  name: string | null;
  icao: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  /**
   * Modelled, never populated.
   *
   * No free source exposes terminals (spec §2, non-goals). The card renders
   * this row only when it is non-null, so in production it never renders —
   * which is the right outcome. Writing "Terminal —" would suggest a
   * terminal we do not have, and writing a number would be Aalborg->Aarhus
   * wearing a different hat.
   */
  terminal: string | null;
}

/**
 * One end of a route, resolved as far as our data honestly goes.
 *
 * The name comes from the route record because adsbdb answered about THIS
 * callsign; the bundled OpenFlights table is generic and only supplies what
 * the provider does not send. Measured 2026-11-21: 13 IATA codes present in
 * the route cache are absent from that table, touching 17 of 4 243 routes.
 * For those every table-sourced field stays null and nothing is guessed.
 */
export function airportInfoFor(end: RouteEnd, route: FlightRouteLite): AirportInfo {
  const iata = end === 'origin' ? route.originIata : route.destinationIata;
  const sent = (end === 'origin' ? route.originName : route.destinationName).trim();
  const table = lookupAirport(iata);
  return {
    end,
    iata,
    name: sent !== '' ? sent : table?.name ?? null,
    icao: table?.icao ?? null,
    city: table?.city ?? null,
    lat: table?.lat ?? null,
    lon: table?.lon ?? null,
    terminal: null,
  };
}

export function routeEnds(route: FlightRouteLite): {
  origin: AirportInfo;
  destination: AirportInfo;
} {
  return {
    origin: airportInfoFor('origin', route),
    destination: airportInfoFor('destination', route),
  };
}

/** Can this end be put on the globe at all? No coordinates, no marker, no arc. */
export function isPlaceable(a: AirportInfo): boolean {
  return a.lat !== null && a.lon !== null;
}
