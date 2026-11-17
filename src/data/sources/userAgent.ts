/**
 * Identifies Air View to the ADS-B aggregators that host us for free.
 *
 * History worth keeping, because it explains why this constant exists and
 * why it is not the whole story:
 *  - 2026-08: adsb.lol started answering 403 to Node's default
 *    "User-Agent: node". Measured then: UA 'node' -> 403, UA 'undici' -> 200.
 *    That outage froze production for 25 days.
 *  - 2026-11: that filter is gone (any UA, even none, returns 200), and a
 *    250 NM radius ceiling took its place. The 403 seen today means the
 *    radius, not the header.
 *
 * The header stays regardless: it is plain courtesy towards a free service,
 * and the policy has already changed twice.
 */
export const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
