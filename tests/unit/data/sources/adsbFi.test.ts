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
    expect(ac.latitude).toBe(45.78);
    expect(ac.longitude).toBe(4.54);
  });

  it('throws with its own source id on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(
      adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/adsb-fi.*429/);
  });

  // --- Full normalisation coverage -------------------------------------
  // The tests above only pin the four ways adsb.fi differs from adsb.lol.
  // Mutation testing showed the other normalised fields had no protection at
  // all: lat/lon could be swapped, onGround forced false, lastContact zeroed,
  // velocityKt nulled and complete forced true with the suite still green.
  // A plan whose purpose is to make a future outage diagnosable cannot leave
  // the position mapping untested — it is the one error a user sees directly.

  it('maps lon to longitude and lat to latitude, never the other way round', async () => {
    // Deliberately asymmetric and opposite-signed: swapping the two fails loudly.
    const fetchImpl = mockOk({
      now: 1_716_163_200,
      aircraft: [{ hex: 'a1', lat: 12.5, lon: -71.25 }],
    });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.latitude).toBe(12.5);
    expect(ac.longitude).toBe(-71.25);
  });

  it('normalises airborne kinematics: altitude, ground speed, track, onGround', async () => {
    const fetchImpl = mockOk({
      now: 1_716_163_200,
      aircraft: [{ hex: 'AD5174', alt_baro: 37975, gs: 472.4, track: 261.3, seen: 0 }],
    });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.icao24).toBe('ad5174'); // hex is lowercased
    expect(ac.baroAltitudeFt).toBe(37975);
    expect(ac.velocityKt).toBe(472); // gs is rounded to whole knots
    expect(ac.headingDeg).toBe(261.3); // track keeps its precision
    expect(ac.onGround).toBe(false);
  });

  it('treats alt_baro "ground" as onGround with a null altitude', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200, aircraft: [{ hex: 'a1', alt_baro: 'ground', gs: 12 }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.onGround).toBe(true);
    expect(ac.baroAltitudeFt).toBeNull(); // 'ground' is not an altitude
  });

  it('derives lastContact in unix SECONDS by subtracting "seen" from "now"', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200, aircraft: [{ hex: 'a1', seen: 12.4 }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft[0]!.lastContact).toBe(Math.floor((1_716_163_200_000 - 12_400) / 1000));
  });

  it('treats a missing "seen" as zero staleness rather than guessing', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200, aircraft: [{ hex: 'a1' }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft[0]!.lastContact).toBe(1_716_163_200);
  });

  it('leaves complete false — the server computes it once the route is attached', async () => {
    const fetchImpl = mockOk({
      now: 1_716_163_200,
      aircraft: [{ hex: 'a1', flight: 'DAH1004 ', lat: 45.78, lon: 4.54, alt_baro: 40000, gs: 428, track: 347.59, r: '7T-VJC', t: 'A332', desc: 'AIRBUS A-330-200' }],
    });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    // Even a fully populated record stays incomplete: no adapter may claim it.
    expect(res.aircraft[0]!.complete).toBe(false);
  });

  it('maps every missing optional field to null instead of a plausible value', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200, aircraft: [{ hex: 'abc123' }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.callsign).toBeNull();
    expect(ac.latitude).toBeNull();
    expect(ac.longitude).toBeNull();
    expect(ac.baroAltitudeFt).toBeNull();
    expect(ac.velocityKt).toBeNull();
    expect(ac.headingDeg).toBeNull();
    expect(ac.registration).toBeNull();
    expect(ac.modelCode).toBeNull();
    expect(ac.modelDesc).toBeNull();
    expect(ac.onGround).toBe(false);
  });

  it('skips entries without a hex', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [{ hex: 'a1' }, {}, { flight: 'NOHEX' }, { hex: 'b2' }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft.map((a) => a.icao24)).toEqual(['a1', 'b2']);
  });

  it('returns an empty array when the payload carries no aircraft key', async () => {
    const fetchImpl = mockOk({ now: 1, msg: 'No error' });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft).toEqual([]);
  });
});
