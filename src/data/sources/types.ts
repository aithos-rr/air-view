import type { AircraftRaw } from '../../types.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface SourceResult {
  aircraft: AircraftRaw[];
  fetchedAt: Date;
}

/**
 * One ADS-B provider. Providers speak centre+radius natively, which is why
 * this interface does too — v1's bbox shape matched none of them.
 */
export interface AircraftSource {
  readonly id: string;
  readonly label: string;
  /**
   * Largest radius this provider accepts, in nautical miles. Verified live:
   * adsb.lol serves 10 000 NM; adsb.fi rejects anything above 250 NM with
   * HTTP 400/429. The selector uses this to skip a source instead of firing
   * a request that is guaranteed to fail.
   */
  readonly maxRadiusNm: number;
  fetchRegion(
    centre: GeoPoint,
    radiusNm: number,
    fetchImpl?: typeof fetch
  ): Promise<SourceResult>;
}
