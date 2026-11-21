import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStates } from '@/data/statesClient';

describe('fetchStates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses successful response into AircraftRaw[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          fetchedAt: '2026-05-20T00:00:00Z',
          aircraft: [
            {
              icao24: 'abc123',
              callsign: 'BAW274',
              longitude: -10,
              latitude: 50,
              baroAltitudeFt: 38000,
              velocityKt: 473,
              headingDeg: 265,
              onGround: false,
              lastContact: 1716163200,
            },
          ],
        }),
      })
    );
    const result = await fetchStates();
    expect(result.aircraft).toHaveLength(1);
    expect(result.aircraft[0]?.callsign).toBe('BAW274');
    expect(result.aircraft[0]?.baroAltitudeFt).toBe(38000);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502 })
    );
    await expect(fetchStates()).rejects.toThrow(/502/);
  });

  it('appends bbox as query params when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', aircraft: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchStates({ lamin: 35, lomin: -15, lamax: 72, lomax: 45 });
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/states?');
    expect(url).toContain('lamin=35');
    expect(url).toContain('lomin=-15');
    expect(url).toContain('lamax=72');
    expect(url).toContain('lomax=45');
  });

  it('serialises the view centre into the query string', async () => {
    // The other half of Step 9: the server's lat/lon/radius handler only
    // earns its keep if these three parameters actually leave the browser.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', aircraft: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchStates(null, undefined, { lat: 50, lon: 8, radiusNm: 1299 });
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('lat=50.000');
    expect(url).toContain('lon=8.000');
    // The radius is the zoom level; a constant here would send the server one
    // number for every camera distance, which is what Step 9 set out to fix.
    expect(url).toContain('radius=1299');
    // Swapped coordinates still produce a plausible-looking URL, and the
    // server would prioritise a cap off the coast of Somalia instead of
    // Frankfurt. Name the wrong pairing so the swap cannot pass.
    expect(url).not.toContain('lat=8.000');
    expect(url).not.toContain('lon=50.000');
  });

  it('omits the view parameters entirely when no centre is given', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', aircraft: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchStates();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/states');
  });

  it('reads the stale flag out of the body', async () => {
    // The server puts it in the body precisely because this function reads
    // only res.json(). If nobody reads it, that choice bought nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', stale: true, capped: false, aircraft: [] }),
      })
    );
    expect((await fetchStates()).stale).toBe(true);
  });

  it('treats a missing stale field as fresh, not as stale', async () => {
    // A server that predates the flag must not paint every batch as old.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', aircraft: [] }),
      })
    );
    expect((await fetchStates()).stale).toBe(false);
  });

  it('reads the truncation flag the server put in the body', async () => {
    // Same junction the stale flag was dropped at twice. The ends of a chain
    // can both be tested and still not be connected: only a test that starts
    // at the body and ends at the returned object proves the middle exists.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fetchedAt: '2026-01-01T00:00:00Z', capped: true, aircraft: [] }),
      })
    );
    expect((await fetchStates(null)).capped).toBe(true);
  });

  it('calls a world uncapped unless the server said otherwise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fetchedAt: '2026-01-01T00:00:00Z', aircraft: [] }),
      })
    );
    expect((await fetchStates(null)).capped).toBe(false);
  });
});
