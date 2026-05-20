import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStates } from '@/data/openSkyClient';

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
});
