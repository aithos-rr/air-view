/**
 * Identifies Air View to the ADS-B aggregators that host us for free.
 *
 * This is not cosmetic. The v1 production outage (2026-08-20 -> 2026-09-14)
 * was caused by its absence: Node/undici sends "User-Agent: node" by default,
 * and adsb.lol answers 403 to it. Every outbound request must carry this.
 */
export const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
