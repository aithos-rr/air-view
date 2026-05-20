import { describe, it, expect, vi } from 'vitest';
import { fetchAdsbStates } from '@/data/adsbSource';

describe('fetchAdsbStates', () => {
  it('normalises hex → icao24 (lowercase), trims callsign, maps alt/gs/track', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        now: 1716163200_000,
        ac: [
          {
            hex: 'AD5174',
            flight: 'BAW274  ',
            lat: 50.0,
            lon: -10.0,
            alt_baro: 38000,
            gs: 472.4,
            track: 261.3,
            seen: 0.4,
          },
        ],
      }),
    });
    const result = await fetchAdsbStates(null, mockFetch as unknown as typeof fetch);
    expect(result.aircraft).toHaveLength(1);
    const ac = result.aircraft[0]!;
    expect(ac.icao24).toBe('ad5174');
    expect(ac.callsign).toBe('BAW274');
    expect(ac.longitude).toBe(-10);
    expect(ac.latitude).toBe(50);
    expect(ac.baroAltitudeFt).toBe(38000);
    expect(ac.velocityKt).toBe(472); // rounded from 472.4
    expect(ac.headingDeg).toBe(261.3);
    expect(ac.onGround).toBe(false);
    expect(ac.lastContact).toBe(Math.floor((1716163200_000 - 400) / 1000));
  });

  it('treats alt_baro = "ground" as onGround true with null altitude', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        now: 1716163200_000,
        ac: [{ hex: 'abc123', flight: 'X', lat: 0, lon: 0, alt_baro: 'ground', gs: 0, track: 0, seen: 0 }],
      }),
    });
    const result = await fetchAdsbStates(null, mockFetch as unknown as typeof fetch);
    const ac = result.aircraft[0]!;
    expect(ac.onGround).toBe(true);
    expect(ac.baroAltitudeFt).toBeNull();
  });

  it('maps missing optional fields to null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        now: 1716163200_000,
        ac: [{ hex: 'abc123' }],
      }),
    });
    const result = await fetchAdsbStates(null, mockFetch as unknown as typeof fetch);
    const ac = result.aircraft[0]!;
    expect(ac.callsign).toBeNull();
    expect(ac.latitude).toBeNull();
    expect(ac.longitude).toBeNull();
    expect(ac.baroAltitudeFt).toBeNull();
    expect(ac.velocityKt).toBeNull();
    expect(ac.headingDeg).toBeNull();
    expect(ac.onGround).toBe(false);
  });

  it('skips entries without a hex', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        now: 1716163200_000,
        ac: [{ hex: 'a1' }, {}, { flight: 'NOHEX' }, { hex: 'b2' }],
      }),
    });
    const result = await fetchAdsbStates(null, mockFetch as unknown as typeof fetch);
    expect(result.aircraft).toHaveLength(2);
    expect(result.aircraft.map((a) => a.icao24)).toEqual(['a1', 'b2']);
  });

  it('throws on HTTP error from adsb.lol', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchAdsbStates(null, mockFetch as unknown as typeof fetch)).rejects.toThrow(/503/);
  });

  it('returns empty array when ac is missing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ now: 1, msg: 'No error' }),
    });
    const result = await fetchAdsbStates(null, mockFetch as unknown as typeof fetch);
    expect(result.aircraft).toEqual([]);
  });
});
