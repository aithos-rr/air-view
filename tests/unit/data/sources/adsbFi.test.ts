import { describe, it, expect, vi } from 'vitest';
import { adsbFiSource } from '@/data/sources/adsbFi';
import { USER_AGENT } from '@/data/sources/userAgent';

function mockOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

describe('adsbFiSource', () => {
  it('sends the project User-Agent', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [] });
    await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('declares the 250 NM ceiling the provider actually enforces', () => {
    // Verified live: dist=250 -> 200, dist=1000 -> 400, dist=5000/10000 -> 429.
    expect(adsbFiSource.maxRadiusNm).toBe(250);
  });

  it('uses the opendata.adsb.fi URL shape', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [] });
    await adsbFiSource.fetchRegion({ lat: 45.5, lon: 9.2 }, 250, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://opendata.adsb.fi/api/v2/lat/45.5/lon/9.2/dist/250');
  });

  it('reads the "aircraft" key, not "ac"', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [{ hex: 'abc123' }], ac: [{ hex: 'wrong1' }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft.map((a) => a.icao24)).toEqual(['abc123']);
  });

  it('reads adsb.fi "now" as SECONDS, unlike adsb.lol', async () => {
    // Verified live: adsb.fi returns {"now": 1789389830.000} — seconds.
    // Treating it as milliseconds would date every fetch to 1970.
    const fetchImpl = mockOk({ now: 1_716_163_200, aircraft: [{ hex: 'a1', seen: 0 }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.fetchedAt.getTime()).toBe(1_716_163_200_000);
  });

  it('carries desc into modelDesc — adsb.fi is the only source that has it', async () => {
    const fetchImpl = mockOk({
      now: 1_716_163_200,
      aircraft: [{ hex: '0a0087', flight: 'DAH1004 ', lat: 45.78, lon: 4.54, alt_baro: 40000, gs: 428, track: 347.59, seen: 0, r: '7T-VJC', t: 'A332', desc: 'AIRBUS A-330-200' }],
    });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.modelCode).toBe('A332');
    expect(ac.modelDesc).toBe('AIRBUS A-330-200');
    expect(ac.registration).toBe('7T-VJC');
    expect(ac.callsign).toBe('DAH1004');
    expect(ac.route).toBeNull();
  });

  it('throws with its own source id on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(
      adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/adsb-fi.*429/);
  });
});
