import { describe, it, expect, vi } from 'vitest';
import { adsbLolSource } from '@/data/sources/adsbLol';
import { USER_AGENT } from '@/data/sources/userAgent';
import type { UpstreamHttpError } from '@/data/sources/httpError';

function mockOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

describe('adsbLolSource', () => {
  it('sends the project User-Agent — the v1 outage was a missing UA', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200_000, ac: [] });
    await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('declares the 250 NM ceiling adsb.lol actually enforces', () => {
    // Verified live 2026-11-16: dist=250 -> 200; dist=251 and above -> 403
    // with body "radius exceeds 250 NM". An earlier revision asserted
    // >= 10 000 here and went green on mocks while production returned 502.
    expect(adsbLolSource.maxRadiusNm).toBe(250);
  });

  it('builds a centre+radius URL from the requested region', async () => {
    const fetchImpl = mockOk({ now: 1, ac: [] });
    await adsbLolSource.fetchRegion({ lat: 45.5, lon: 9.2 }, 250, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.adsb.lol/v2/lat/45.5/lon/9.2/dist/250');
  });

  it('normalises hex, callsign, position, registration and model', async () => {
    const fetchImpl = mockOk({
      now: 1_716_163_200_000,
      ac: [{
        hex: 'AD5174', flight: 'BAW274  ', lat: 50, lon: -10,
        alt_baro: 38000, gs: 472.4, track: 261.3, seen: 0.4,
        r: 'G-ZBKA', t: 'B789',
      }],
    });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.icao24).toBe('ad5174');
    expect(ac.callsign).toBe('BAW274');
    expect(ac.latitude).toBe(50);
    expect(ac.baroAltitudeFt).toBe(38000);
    expect(ac.velocityKt).toBe(472);
    expect(ac.registration).toBe('G-ZBKA');
    expect(ac.modelCode).toBe('B789');
    expect(ac.modelDesc).toBeNull();
    expect(ac.route).toBeNull();
    expect(ac.lastContact).toBe(Math.floor((1_716_163_200_000 - 400) / 1000));
  });

  it('reads adsb.lol "now" as milliseconds', async () => {
    // Verified live: adsb.lol returns now=1789... (ms), adsb.fi returns now=1789389830.000 (s).
    // Getting this wrong shifts every timestamp by a factor of 1000.
    const fetchImpl = mockOk({ now: 1_716_163_200_000, ac: [{ hex: 'a1', seen: 0 }] });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.fetchedAt.getTime()).toBe(1_716_163_200_000);
  });

  it('treats alt_baro "ground" as onGround with null altitude', async () => {
    const fetchImpl = mockOk({ now: 1, ac: [{ hex: 'abc123', alt_baro: 'ground' }] });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft[0]!.onGround).toBe(true);
    expect(res.aircraft[0]!.baroAltitudeFt).toBeNull();
  });

  it('maps every missing optional field to null', async () => {
    const fetchImpl = mockOk({ now: 1, ac: [{ hex: 'abc123' }] });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.callsign).toBeNull();
    expect(ac.latitude).toBeNull();
    expect(ac.registration).toBeNull();
    expect(ac.modelCode).toBeNull();
    expect(ac.lastContact).toBeNull(); // no "seen" means unknown, not "now"
  });

  it('skips entries without a hex', async () => {
    const fetchImpl = mockOk({ now: 1, ac: [{ hex: 'a1' }, {}, { flight: 'NOHEX' }, { hex: 'b2' }] });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft.map((a) => a.icao24)).toEqual(['a1', 'b2']);
  });

  it('throws with status and source id on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/adsb-lol.*403/);
  });

  it('carries the reason adsb.lol puts in the BODY of a 403', async () => {
    // The status alone cannot tell a radius refusal from a blocked
    // User-Agent — and those are the two failures that took v1 down. The
    // reason is in the body, and it was being discarded.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => 'radius exceeds 250 NM',
    });
    await expect(
      adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow('adsb-lol: HTTP 403 ("radius exceeds 250 NM")');
  });

  it('carries Retry-After from a 429, which is how long to stay silent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => '',
      headers: new Headers({ 'Retry-After': '300' }),
    });
    // null if it resolves, which would fail both assertions below.
    const err = await adsbLolSource
      .fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch)
      .then(
        () => null,
        (e: unknown) => e as UpstreamHttpError
      );
    expect(err?.status).toBe(429);
    expect(err?.retryAfterSeconds).toBe(300);
  });

  it('survives an error response whose body cannot be read', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => { throw new Error('socket closed'); },
    });
    await expect(
      adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow('adsb-lol: HTTP 503');
  });

  it('returns an empty array when the payload has no aircraft key', async () => {
    const fetchImpl = mockOk({ now: 1, msg: 'No error' });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft).toEqual([]);
  });
});
