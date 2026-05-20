// OpenSky Network OAuth2 client_credentials flow.
// Replaces the deprecated basic-auth flow (deprecated mid-March 2025; new
// accounts cannot use basic auth at all).
//
// Two responsibilities:
//   1. getAccessToken(creds) — fetches + caches a Bearer token in-memory,
//      refreshing 60 s before expiry.
//   2. fetchStatesAuthenticated(creds) — calls /states/all with the token,
//      retries once on 401 after invalidating the cache.
//
// Both functions accept an injectable `fetchImpl` for unit testing.

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';

const REFRESH_SAFETY_SECONDS = 60; // refresh this many seconds before expiry

export interface TokenCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Geographic bounding box for OpenSky's geographic filter. All four values
 * are degrees. lamin/lamax are latitudes (-90..+90), lomin/lomax longitudes
 * (-180..+180). Passing a bbox reduces ~14k global aircraft to a few
 * thousand visible in the requested window.
 */
export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

interface TokenCache {
  token: string;
  expiresAt: number; // Date.now() ms timestamp
}

// Module-scoped state. Each edge runtime worker has its own copy; that's fine
// — at worst each worker fetches its own token, well within the OAuth quota.
let tokenCache: TokenCache | null = null;

export function clearTokenCache(): void {
  tokenCache = null;
}

export async function getAccessToken(
  creds: TokenCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  // Some Node fetch runtimes (notably under Railway's image) don't auto-set
  // Content-Length when the body is a URLSearchParams instance; serialize
  // explicitly so Content-Type + Content-Length are both unambiguous.
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OpenSky token endpoint: HTTP ${res.status}`);
  }
  const data = (await res.json()) as TokenResponse;
  const ttlMs = Math.max(0, data.expires_in - REFRESH_SAFETY_SECONDS) * 1000;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs,
  };
  return data.access_token;
}

function buildStatesUrl(bbox: BoundingBox | null): string {
  if (!bbox) return STATES_URL;
  const params = new URLSearchParams({
    lamin: String(bbox.lamin),
    lomin: String(bbox.lomin),
    lamax: String(bbox.lamax),
    lomax: String(bbox.lomax),
  });
  return `${STATES_URL}?${params.toString()}`;
}

export async function fetchStatesAuthenticated(
  creds: TokenCredentials,
  bbox: BoundingBox | null = null,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const url = buildStatesUrl(bbox);
  let token = await getAccessToken(creds, fetchImpl);
  let response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    // Token was rejected — likely revoked or expired earlier than expires_in.
    // Invalidate cache, mint a new one, retry exactly once.
    clearTokenCache();
    token = await getAccessToken(creds, fetchImpl);
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return response;
}
