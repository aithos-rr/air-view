import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAccessToken,
  clearTokenCache,
  fetchStatesAuthenticated,
} from '@/data/openSkyAuth';

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';

describe('getAccessToken', () => {
  beforeEach(() => clearTokenCache());

  it('POSTs client_credentials form to the OpenSky token endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok123', expires_in: 1800, token_type: 'Bearer' }),
    });
    const token = await getAccessToken(
      { clientId: 'cid', clientSecret: 'csec' },
      mockFetch as unknown as typeof fetch
    );

    expect(token).toBe('tok123');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );

    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('csec');
  });

  it('caches the token within the TTL window (refresh 60s early)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-cached', expires_in: 1800, token_type: 'Bearer' }),
    });
    const t1 = await getAccessToken(
      { clientId: 'a', clientSecret: 'b' },
      mockFetch as unknown as typeof fetch
    );
    const t2 = await getAccessToken(
      { clientId: 'a', clientSecret: 'b' },
      mockFetch as unknown as typeof fetch
    );
    expect(t1).toBe('tok-cached');
    expect(t2).toBe('tok-cached');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on non-OK response from the token endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      getAccessToken(
        { clientId: 'a', clientSecret: 'b' },
        mockFetch as unknown as typeof fetch
      )
    ).rejects.toThrow(/401/);
  });
});

describe('fetchStatesAuthenticated', () => {
  beforeEach(() => clearTokenCache());

  it('sends Bearer header with the cached token', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-abc', expires_in: 1800, token_type: 'Bearer' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await fetchStatesAuthenticated(
      { clientId: 'a', clientSecret: 'b' },
      mockFetch as unknown as typeof fetch
    );

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(STATES_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-abc');
  });

  it('on 401 invalidates the cache, mints a fresh token, and retries once', async () => {
    const mockFetch = vi
      .fn()
      // 1. initial token mint
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-old', expires_in: 1800, token_type: 'Bearer' }),
      })
      // 2. first /states/all → 401
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // 3. token re-mint
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-new', expires_in: 1800, token_type: 'Bearer' }),
      })
      // 4. retry /states/all → 200
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await fetchStatesAuthenticated(
      { clientId: 'a', clientSecret: 'b' },
      mockFetch as unknown as typeof fetch
    );

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // The final call must use the NEW token, not the old one
    const [finalUrl, finalInit] = mockFetch.mock.calls[3] as [string, RequestInit];
    expect(finalUrl).toBe(STATES_URL);
    expect((finalInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-new');
  });

  it('does not retry beyond once on persistent 401', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-1', expires_in: 1800, token_type: 'Bearer' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-2', expires_in: 1800, token_type: 'Bearer' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });

    const response = await fetchStatesAuthenticated(
      { clientId: 'a', clientSecret: 'b' },
      mockFetch as unknown as typeof fetch
    );

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(4); // 2 tokens + 2 states (no third retry)
  });
});
