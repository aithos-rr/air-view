# Air View v2 — Piano 1: livello dati

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rimettere in produzione un feed vivo, con origini e destinazioni vere e con i guasti visibili entro minuti anziché mesi.

**Architecture:** Gli adattatori per fornitore normalizzano verso un tipo comune e un selettore con circuit breaker li mette in cascata. Il server impone un'età massima alla cache, espone lo stato del feed su `/health`, e arricchisce i callsign con rotte vere da adsbdb tramite una cache che si riempie progressivamente a rate limitato. Il client smette di cancellare la flotta quando il feed è fermo e lo dichiara.

**Tech Stack:** TypeScript strict, Fastify 5, Vitest, undici. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md`

## Global Constraints

- TypeScript `strict` con `noUncheckedIndexedAccess`: ogni accesso indicizzato va verificato o asserito con `!` solo dove l'invariante è ovvia.
- Alias import `@/` → `src/` (configurato in `tsconfig.json` e `vitest.config.ts`). Il codice sotto `server/` importa con percorsi relativi e suffisso `.js`, perché viene compilato da `tsconfig.server.json` per Node ESM.
- **Ogni richiesta HTTP uscente deve portare lo User-Agent del progetto.** Costante unica `USER_AGENT` in `src/data/sources/userAgent.ts`. Questa è la causa diretta del guasto di produzione: nessuna chiamata può ometterlo.
- Nessun dato inventato: un campo sconosciuto è `null`, mai un valore plausibile.
- Messaggi di commit in inglese, coerenti con la storia del repo.
- `npm test` deve passare al termine di ogni task.

---

### Task 1: User-Agent e adattatore adsb.lol

Rimette in vita la produzione. Da solo risolve il guasto: se dopo questo task si fa un deploy, il globo torna a popolarsi.

**Files:**
- Create: `src/data/sources/userAgent.ts`
- Create: `src/data/sources/types.ts`
- Create: `src/data/sources/adsbLol.ts`
- Modify: `src/types.ts` (estende `AircraftRaw`)
- Delete: `src/data/adsbSource.ts`
- Test: `tests/unit/data/sources/adsbLol.test.ts`
- Delete: `tests/unit/data/adsbSource.test.ts`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `USER_AGENT: string`; `GeoPoint { lat, lon }`; `SourceResult { aircraft: AircraftRaw[], fetchedAt: Date }`; `AircraftSource { id, label, fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl?: typeof fetch): Promise<SourceResult> }`; `adsbLolSource: AircraftSource`. `AircraftRaw` guadagna `registration: string | null`, `modelCode: string | null`, `modelDesc: string | null`.

- [ ] **Step 1: Estendere `AircraftRaw` in `src/types.ts`**

Sostituire il blocco `export interface AircraftRaw { ... }` con:

```ts
// Raw aircraft state from an ADS-B source, normalized across providers.
export interface AircraftRaw {
  icao24: string;
  callsign: string | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitudeFt: number | null;
  velocityKt: number | null;
  headingDeg: number | null;
  onGround: boolean;
  lastContact: number;                // unix seconds
  registration: string | null;        // tail number, e.g. "I-ABCD"
  modelCode: string | null;           // ICAO type code, e.g. "A320"
  modelDesc: string | null;           // long name, e.g. "AIRBUS A-320"; only adsb.fi ships it
}
```

- [ ] **Step 2: Scrivere il test che fallisce**

Creare `tests/unit/data/sources/adsbLol.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { adsbLolSource } from '@/data/sources/adsbLol';
import { USER_AGENT } from '@/data/sources/userAgent';

function mockOk(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

describe('adsbLolSource', () => {
  it('sends the project User-Agent — the v1 outage was a missing UA', async () => {
    const fetchImpl = mockOk({ now: 1_716_163_200_000, ac: [] });
    await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10_000, fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
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
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10_000, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.icao24).toBe('ad5174');
    expect(ac.callsign).toBe('BAW274');
    expect(ac.latitude).toBe(50);
    expect(ac.baroAltitudeFt).toBe(38000);
    expect(ac.velocityKt).toBe(472);
    expect(ac.registration).toBe('G-ZBKA');
    expect(ac.modelCode).toBe('B789');
    expect(ac.modelDesc).toBeNull(); // adsb.lol non espone desc
    expect(ac.lastContact).toBe(Math.floor((1_716_163_200_000 - 400) / 1000));
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

  it('returns an empty array when the payload has no aircraft key', async () => {
    const fetchImpl = mockOk({ now: 1, msg: 'No error' });
    const res = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft).toEqual([]);
  });
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/adsbLol.test.ts`
Expected: FAIL — `Failed to resolve import "@/data/sources/adsbLol"`

- [ ] **Step 4: Creare `src/data/sources/userAgent.ts`**

```ts
/**
 * Identifies Air View to the ADS-B aggregators that host us for free.
 *
 * This is not cosmetic. The v1 production outage (2026-08-20 → 2026-09-14)
 * was caused by its absence: Node/undici sends "User-Agent: node" by default,
 * and adsb.lol answers 403 to it. Every outbound request must carry this.
 */
export const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
```

- [ ] **Step 5: Creare `src/data/sources/types.ts`**

```ts
import type { AircraftRaw } from '@/types';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface SourceResult {
  aircraft: AircraftRaw[];
  fetchedAt: Date;
}

/**
 * One ADS-B provider. Providers speak centre+radius natively, which is why
 * this interface does too — v1's bbox shape did not match any of them.
 */
export interface AircraftSource {
  readonly id: string;
  readonly label: string;
  fetchRegion(
    centre: GeoPoint,
    radiusNm: number,
    fetchImpl?: typeof fetch
  ): Promise<SourceResult>;
}
```

- [ ] **Step 6: Creare `src/data/sources/adsbLol.ts`**

```ts
import type { AircraftRaw } from '@/types';
import type { AircraftSource, GeoPoint, SourceResult } from './types';
import { USER_AGENT } from './userAgent';

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  r?: string; // registration
  t?: string; // ICAO type code
}

interface AdsbLolResponse {
  ac?: AdsbLolAircraft[];
  now?: number; // ms since epoch
}

function normalise(ac: AdsbLolAircraft, nowMs: number): AircraftRaw {
  const onGround = ac.alt_baro === 'ground';
  const seenS = typeof ac.seen === 'number' ? ac.seen : 0;
  return {
    icao24: ac.hex!.toLowerCase(),
    callsign: ac.flight?.trim() || null,
    longitude: typeof ac.lon === 'number' ? ac.lon : null,
    latitude: typeof ac.lat === 'number' ? ac.lat : null,
    baroAltitudeFt: !onGround && typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null,
    velocityKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
    headingDeg: typeof ac.track === 'number' ? ac.track : null,
    onGround,
    lastContact: Math.floor((nowMs - seenS * 1000) / 1000),
    registration: ac.r?.trim() || null,
    modelCode: ac.t?.trim() || null,
    modelDesc: null, // adsb.lol does not ship a long model name
  };
}

export const adsbLolSource: AircraftSource = {
  id: 'adsb-lol',
  label: 'adsb.lol',

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://api.adsb.lol/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsb-lol: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbLolResponse;
    const nowMs = data.now ?? Date.now();
    const aircraft = (data.ac ?? [])
      .filter((ac): ac is AdsbLolAircraft & { hex: string } => typeof ac.hex === 'string' && ac.hex.length > 0)
      .map((ac) => normalise(ac, nowMs));
    return { aircraft, fetchedAt: new Date(nowMs) };
  },
};
```

- [ ] **Step 7: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/adsbLol.test.ts`
Expected: PASS, 8 test

- [ ] **Step 8: Sostituire il vecchio modulo nel server**

In `server/index.ts`, sostituire l'import
`import { fetchAdsbStates } from '../src/data/adsbSource.js';`
con
`import { adsbLolSource } from '../src/data/sources/adsbLol.js';`

e nel gestore `/api/states` sostituire
`const result = await fetchAdsbStates(bbox);`
con
`const result = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10_000);`

Il parametro `bbox` resta ignorato in questo task: il fetch camera-driven arriva nel Piano 2.

- [ ] **Step 9: Rimuovere il modulo obsoleto e il suo test**

```bash
git rm src/data/adsbSource.ts tests/unit/data/adsbSource.test.ts
```

- [ ] **Step 10: Verificare che tutto compili e passi**

Run: `npm run build && npm test -- --run`
Expected: build senza errori, tutti i test verdi

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "fix(data): send User-Agent to adsb.lol — restores the live feed

Node/undici defaults to 'User-Agent: node', which adsb.lol answers with
403. Production had been serving a frozen 2026-08-20 snapshot since.

Introduces the source adapter interface and moves adsb.lol behind it, so
a single provider's policy change can no longer take the site down.
Registration and model code are now carried through: both were already in
the feed and v1 discarded them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Adattatore adsb.fi

**Files:**
- Create: `src/data/sources/adsbFi.ts`
- Test: `tests/unit/data/sources/adsbFi.test.ts`

**Interfaces:**
- Consumes: `AircraftSource`, `GeoPoint`, `SourceResult` da Task 1; `USER_AGENT` da Task 1
- Produces: `adsbFiSource: AircraftSource`

adsb.fi differisce da adsb.lol in tre punti verificati: percorso URL diverso, chiave dell'array `aircraft` invece di `ac`, e campo `desc` con il nome esteso del modello. Per questo ha un adattatore proprio invece di un parametro.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/data/sources/adsbFi.test.ts`:

```ts
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

  it('uses the opendata.adsb.fi URL shape', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [] });
    await adsbFiSource.fetchRegion({ lat: 45.5, lon: 9.2 }, 250, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://opendata.adsb.fi/api/v2/lat/45.5/lon/9.2/dist/250');
  });

  it('reads the "aircraft" key, not "ac"', async () => {
    const fetchImpl = mockOk({ now: 1, aircraft: [{ hex: 'abc123' }], ac: [{ hex: 'wrong1' }] });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch);
    expect(res.aircraft.map((a) => a.icao24)).toEqual(['abc123']);
  });

  it('carries desc into modelDesc — adsb.fi is the only source that has it', async () => {
    const fetchImpl = mockOk({
      now: 1_716_163_200_000,
      aircraft: [{ hex: '0a0087', flight: 'DAH1004 ', lat: 45.78, lon: 4.54, alt_baro: 40000, gs: 428, track: 347.59, seen: 0, r: '7T-VJC', t: 'A332', desc: 'AIRBUS A-330-200' }],
    });
    const res = await adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 250, fetchImpl as unknown as typeof fetch);
    const ac = res.aircraft[0]!;
    expect(ac.modelCode).toBe('A332');
    expect(ac.modelDesc).toBe('AIRBUS A-330-200');
    expect(ac.registration).toBe('7T-VJC');
    expect(ac.callsign).toBe('DAH1004');
  });

  it('throws with its own source id on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      adsbFiSource.fetchRegion({ lat: 0, lon: 0 }, 10, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/adsb-fi.*500/);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/adsbFi.test.ts`
Expected: FAIL — import non risolto

- [ ] **Step 3: Creare `src/data/sources/adsbFi.ts`**

```ts
import type { AircraftRaw } from '@/types';
import type { AircraftSource, GeoPoint, SourceResult } from './types';
import { USER_AGENT } from './userAgent';

interface AdsbFiAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  r?: string;
  t?: string;
  desc?: string; // long model name — adsb.fi only
}

interface AdsbFiResponse {
  aircraft?: AdsbFiAircraft[];
  now?: number; // seconds since epoch, unlike adsb.lol
}

function normalise(ac: AdsbFiAircraft, nowMs: number): AircraftRaw {
  const onGround = ac.alt_baro === 'ground';
  const seenS = typeof ac.seen === 'number' ? ac.seen : 0;
  return {
    icao24: ac.hex!.toLowerCase(),
    callsign: ac.flight?.trim() || null,
    longitude: typeof ac.lon === 'number' ? ac.lon : null,
    latitude: typeof ac.lat === 'number' ? ac.lat : null,
    baroAltitudeFt: !onGround && typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : null,
    velocityKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
    headingDeg: typeof ac.track === 'number' ? ac.track : null,
    onGround,
    lastContact: Math.floor((nowMs - seenS * 1000) / 1000),
    registration: ac.r?.trim() || null,
    modelCode: ac.t?.trim() || null,
    modelDesc: ac.desc?.trim() || null,
  };
}

export const adsbFiSource: AircraftSource = {
  id: 'adsb-fi',
  label: 'adsb.fi',

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://opendata.adsb.fi/api/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsb-fi: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbFiResponse;
    // adsb.fi reports `now` in seconds; adsb.lol in milliseconds.
    const nowMs = typeof data.now === 'number' ? data.now * 1000 : Date.now();
    const aircraft = (data.aircraft ?? [])
      .filter((ac): ac is AdsbFiAircraft & { hex: string } => typeof ac.hex === 'string' && ac.hex.length > 0)
      .map((ac) => normalise(ac, nowMs));
    return { aircraft, fetchedAt: new Date(nowMs) };
  },
};
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/adsbFi.test.ts`
Expected: PASS, 5 test

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(data): add adsb.fi source adapter

Second provider, verified live: 646 aircraft within 250 NM of Milan.
Differs from adsb.lol in three ways that justify a separate adapter —
array key 'aircraft' instead of 'ac', epoch in seconds instead of
milliseconds, and a 'desc' field carrying the long model name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Selettore con circuit breaker

**Files:**
- Create: `src/data/sources/selector.ts`
- Test: `tests/unit/data/sources/selector.test.ts`

**Interfaces:**
- Consumes: `AircraftSource`, `GeoPoint`, `SourceResult` da Task 1
- Produces: `createSourceSelector(sources: AircraftSource[], opts?: SelectorOptions): SourceSelector`, dove `SourceSelector` ha `fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl?: typeof fetch): Promise<SelectorResult>` e `SelectorResult = SourceResult & { sourceId: string }`. `SelectorOptions = { breakerCooldownMs?: number; now?: () => number }`.

Il breaker esiste perché senza di esso, con la primaria in errore, ogni richiesta pagherebbe un timeout prima di scalare — trasformando un guasto in lentezza per tutti.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/data/sources/selector.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSourceSelector } from '@/data/sources/selector';
import type { AircraftSource, SourceResult } from '@/data/sources/types';

function fakeSource(id: string, impl: () => Promise<SourceResult>): AircraftSource {
  return { id, label: id, fetchRegion: vi.fn(impl) };
}

const emptyResult = (): SourceResult => ({ aircraft: [], fetchedAt: new Date(0) });

describe('createSourceSelector', () => {
  it('returns the primary result and tags it with the source id', async () => {
    const primary = fakeSource('a', async () => emptyResult());
    const selector = createSourceSelector([primary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('a');
  });

  it('falls through to the secondary when the primary throws', async () => {
    const primary = fakeSource('a', async () => { throw new Error('adsb-lol: HTTP 403'); });
    const secondary = fakeSource('b', async () => emptyResult());
    const selector = createSourceSelector([primary, secondary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('b');
  });

  it('does not retry a failed source while its breaker is open', async () => {
    const primary = fakeSource('a', async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], {
      breakerCooldownMs: 60_000,
      now: () => clock,
    });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);

    clock += 30_000; // still inside the cooldown
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1); // not retried
  });

  it('retries a failed source once the cooldown has elapsed', async () => {
    const primary = fakeSource('a', async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], {
      breakerCooldownMs: 60_000,
      now: () => clock,
    });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    clock += 61_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(2);
  });

  it('closes the breaker again after a success', async () => {
    let fail = true;
    const primary = fakeSource('a', async () => {
      if (fail) throw new Error('boom');
      return emptyResult();
    });
    const secondary = fakeSource('b', async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 10, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    fail = false;
    clock += 20;
    const ok = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(ok.sourceId).toBe('a');

    clock += 1;
    const again = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(again.sourceId).toBe('a'); // breaker reset, primary used immediately
  });

  it('throws an aggregated error when every source fails', async () => {
    const a = fakeSource('a', async () => { throw new Error('adsb-lol: HTTP 403'); });
    const b = fakeSource('b', async () => { throw new Error('adsb-fi: HTTP 500'); });
    const selector = createSourceSelector([a, b]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403.*500/s);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: FAIL — import non risolto

- [ ] **Step 3: Creare `src/data/sources/selector.ts`**

```ts
import type { AircraftSource, GeoPoint, SourceResult } from './types';

export interface SelectorOptions {
  /** How long a failed source is skipped before being retried. */
  breakerCooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type SelectorResult = SourceResult & { sourceId: string };

export interface SourceSelector {
  fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl?: typeof fetch): Promise<SelectorResult>;
}

const DEFAULT_COOLDOWN_MS = 120_000;

/**
 * Tries sources in order, skipping any whose breaker is open.
 *
 * Without the breaker, a provider that is down would cost every request a
 * timeout before falling through — turning an outage into sitewide latency.
 */
export function createSourceSelector(
  sources: AircraftSource[],
  opts: SelectorOptions = {}
): SourceSelector {
  const cooldownMs = opts.breakerCooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = opts.now ?? Date.now;
  const openUntil = new Map<string, number>();

  return {
    async fetchRegion(centre, radiusNm, fetchImpl) {
      const errors: string[] = [];
      const t = now();

      for (const source of sources) {
        const until = openUntil.get(source.id) ?? 0;
        if (until > t) continue; // breaker open — skip without paying a timeout

        try {
          const result = await source.fetchRegion(centre, radiusNm, fetchImpl);
          openUntil.delete(source.id); // success closes the breaker
          return { ...result, sourceId: source.id };
        } catch (e) {
          openUntil.set(source.id, now() + cooldownMs);
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      throw new Error(
        errors.length > 0
          ? `all ADS-B sources failed: ${errors.join(' | ')}`
          : 'all ADS-B sources are in cooldown'
      );
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: PASS, 6 test

- [ ] **Step 5: Collegare il selettore nel server**

In `server/index.ts`, sostituire l'import di `adsbLolSource` con:

```ts
import { adsbLolSource } from '../src/data/sources/adsbLol.js';
import { adsbFiSource } from '../src/data/sources/adsbFi.js';
import { createSourceSelector } from '../src/data/sources/selector.js';

const sources = createSourceSelector([adsbLolSource, adsbFiSource]);
```

e nel gestore `/api/states` sostituire la chiamata con:

```ts
const result = await sources.fetchRegion({ lat: 0, lon: 0 }, 10_000);
```

- [ ] **Step 6: Verificare build e suite completa**

Run: `npm run build && npm test -- --run`
Expected: build pulita, test verdi

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(data): source selector with circuit breaker

Falls through adsb.lol -> adsb.fi and remembers a failure for a cooldown
window instead of retrying on every request, so a provider outage costs
one timeout rather than one per request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Età massima della cache e `/health` diagnostico

Il cuore della cura: è la combinazione di cache senza scadenza e health check cieco ad aver reso invisibile il guasto per 25 giorni.

**Files:**
- Create: `server/feedState.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/server/feedState.test.ts`

**Interfaces:**
- Consumes: niente
- Produces: `createFeedState(opts?: { maxCacheAgeMs?: number; degradedAfterMs?: number; now?: () => number }): FeedState`, con `FeedState` che espone `put(key: string, body: string): void`, `get(key: string): string | null`, `recordFailure(message: string): void`, `health(): FeedHealth`. `FeedHealth = { status: 'ok' | 'degraded'; lastSuccessAt: string | null; feedAgeSeconds: number | null; lastError: string | null }`.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/server/feedState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFeedState } from '../../../server/feedState';

describe('createFeedState', () => {
  it('serves a cached body while it is fresh', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxCacheAgeMs: 90_000, now: () => clock });
    s.put('global', '{"a":1}');
    clock += 10_000;
    expect(s.get('global')).toBe('{"a":1}');
  });

  it('REFUSES to serve a body older than the max age — the v1 bug', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxCacheAgeMs: 90_000, now: () => clock });
    s.put('global', '{"a":1}');
    clock += 91_000;
    expect(s.get('global')).toBeNull();
  });

  it('keeps cache entries separate per key', () => {
    let clock = 0;
    const s = createFeedState({ maxCacheAgeMs: 90_000, now: () => clock });
    s.put('a', 'A');
    clock += 50_000;
    s.put('b', 'B');
    clock += 50_000; // a is 100s old, b is 50s old
    expect(s.get('a')).toBeNull();
    expect(s.get('b')).toBe('B');
  });

  it('reports ok while the last success is recent', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('global', '{}');
    clock += 60_000;
    const h = s.health();
    expect(h.status).toBe('ok');
    expect(h.feedAgeSeconds).toBe(60);
  });

  it('reports degraded once the last success is too old — Railway can see this', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('global', '{}');
    clock += 301_000;
    expect(s.health().status).toBe('degraded');
  });

  it('reports degraded when no fetch has ever succeeded', () => {
    const s = createFeedState({ now: () => 1_000_000 });
    const h = s.health();
    expect(h.status).toBe('degraded');
    expect(h.lastSuccessAt).toBeNull();
    expect(h.feedAgeSeconds).toBeNull();
  });

  it('surfaces the last upstream error without masking the age', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('global', '{}');
    clock += 10_000;
    s.recordFailure('all ADS-B sources failed: adsb-lol: HTTP 403');
    const h = s.health();
    expect(h.lastError).toMatch(/403/);
    expect(h.status).toBe('ok'); // still fresh: an error is not yet an outage
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 3: Creare `server/feedState.ts`**

```ts
export interface FeedHealth {
  status: 'ok' | 'degraded';
  lastSuccessAt: string | null;
  feedAgeSeconds: number | null;
  lastError: string | null;
}

export interface FeedState {
  put(key: string, body: string): void;
  get(key: string): string | null;
  recordFailure(message: string): void;
  health(): FeedHealth;
}

export interface FeedStateOptions {
  /** Beyond this age a cached body is no longer served at all. */
  maxCacheAgeMs?: number;
  /** Beyond this age since the last success, /health reports degraded. */
  degradedAfterMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_CACHE_AGE_MS = 90_000;
const DEFAULT_DEGRADED_AFTER_MS = 300_000;

/**
 * Cache and health state for the upstream feed.
 *
 * The v1 outage lasted 25 days because the cache had no maximum age and
 * /health answered 'ok' unconditionally: the server kept serving a frozen
 * 2026-08-20 snapshot and nothing ever reported it. Both guards live here,
 * in one place, so neither can be forgotten at a call site.
 */
export function createFeedState(opts: FeedStateOptions = {}): FeedState {
  const maxCacheAgeMs = opts.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
  const degradedAfterMs = opts.degradedAfterMs ?? DEFAULT_DEGRADED_AFTER_MS;
  const now = opts.now ?? Date.now;

  const entries = new Map<string, { body: string; storedAt: number }>();
  let lastSuccessAt: number | null = null;
  let lastError: string | null = null;

  return {
    put(key, body) {
      const t = now();
      entries.set(key, { body, storedAt: t });
      lastSuccessAt = t;
      lastError = null;
    },

    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.storedAt > maxCacheAgeMs) return null;
      return hit.body;
    },

    recordFailure(message) {
      lastError = message;
    },

    health() {
      const t = now();
      if (lastSuccessAt === null) {
        return { status: 'degraded', lastSuccessAt: null, feedAgeSeconds: null, lastError };
      }
      const ageMs = t - lastSuccessAt;
      return {
        status: ageMs > degradedAfterMs ? 'degraded' : 'ok',
        lastSuccessAt: new Date(lastSuccessAt).toISOString(),
        feedAgeSeconds: Math.floor(ageMs / 1000),
        lastError,
      };
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: PASS, 7 test

- [ ] **Step 5: Sostituire la cache artigianale in `server/index.ts`**

Rimuovere il blocco della cache in memoria (`const cache = new Map...`, `CACHE_TTL_MS`, `GLOBAL_KEY`, `bboxKey`) e sostituirlo con:

```ts
import { createFeedState } from './feedState.js';

const feed = createFeedState();

function cacheKey(b: BoundingBox | null): string {
  if (b === null) return 'global';
  return `${b.lamin}|${b.lomin}|${b.lamax}|${b.lomax}`;
}
```

Sostituire il gestore `/api/states` con:

```ts
app.get('/api/states', async (req, reply) => {
  const bbox = parseBbox(req.query as Record<string, string | undefined>);
  const key = cacheKey(bbox);

  const cached = feed.get(key);
  if (cached !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(cached);
  }

  try {
    const result = await sources.fetchRegion({ lat: 0, lon: 0 }, 10_000);
    const body = JSON.stringify({
      fetchedAt: result.fetchedAt.toISOString(),
      source: result.sourceId,
      bbox,
      aircraft: result.aircraft,
    });
    feed.put(key, body);
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .send(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    feed.recordFailure(msg);
    req.log.error({ err: msg, bbox }, 'every ADS-B source failed');
    // No stale fallback: serving an unbounded-age snapshot is what hid the
    // v1 outage for 25 days. Fail loudly instead.
    const health = feed.health();
    return reply.status(503).send({
      error: msg,
      feedAgeSeconds: health.feedAgeSeconds,
      lastSuccessAt: health.lastSuccessAt,
    });
  }
});
```

Sostituire il gestore `/health` con:

```ts
app.get('/health', async (_req, reply) => {
  const health = feed.health();
  return reply.status(health.status === 'ok' ? 200 : 503).send({
    status: health.status,
    uptime: process.uptime(),
    feedAgeSeconds: health.feedAgeSeconds,
    lastSuccessAt: health.lastSuccessAt,
    lastError: health.lastError,
  });
});
```

- [ ] **Step 6: Verificare build e suite completa**

Run: `npm run build:all && npm test -- --run`
Expected: build pulita, test verdi

- [ ] **Step 7: Verificare manualmente il server locale**

```bash
npm run server
```

In un altro terminale:

```bash
curl -s localhost:3000/health | head -c 300
curl -s localhost:3000/api/states | head -c 200
```

Expected: `/health` risponde `"status":"degraded"` prima del primo fetch riuscito e `"status":"ok"` dopo; `/api/states` restituisce aerei veri con `"source":"adsb-lol"`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(server): bound cache age and make /health diagnostic

The v1 outage stayed invisible for 25 days because the catch branch served
cached bodies of unbounded age while /health answered ok unconditionally.
Now a stale body is never served, a total upstream failure returns 503, and
/health reports feed age and flips to degraded so Railway sees it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Risoluzione rotte da adsbdb

**Files:**
- Create: `server/routeResolver.ts`
- Test: `tests/unit/server/routeResolver.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT` da Task 1 (importato con percorso relativo `../src/data/sources/userAgent.js`)
- Produces: `createRouteResolver(opts?: RouteResolverOptions): RouteResolver`. `RouteResolver` espone `get(callsign: string): FlightRoute | null` (sincrono, solo cache), `enqueue(callsigns: string[]): void`, `pump(fetchImpl?: typeof fetch): Promise<number>`, `stats(): { resolved: number; unknown: number; queued: number }`. `FlightRoute = { callsignIcao: string; callsignIata: string | null; airlineName: string | null; originIata: string | null; originName: string | null; destinationIata: string | null; destinationName: string | null }`.

Risolvere 10.000 callsign a ogni ciclo significherebbe 10.000 richieste ad adsbdb: insostenibile e scortese. Il resolver è quindi **asincrono rispetto alla risposta**: `get` risponde solo dalla cache, `enqueue` accoda i callsign sconosciuti e `pump` ne risolve un numero limitato per giro. I callsign si ripetono molto fra un ciclo e l'altro — gli aerei restano in volo per ore — quindi la cache converge in pochi minuti di esercizio.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/server/routeResolver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRouteResolver } from '../../../server/routeResolver';

function adsbdbOk(origin: string, dest: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      response: {
        flightroute: {
          callsign: 'BAW274',
          callsign_iata: 'BA274',
          airline: { name: 'British Airways' },
          origin: { iata_code: origin, name: `${origin} Airport` },
          destination: { iata_code: dest, name: `${dest} Airport` },
        },
      },
    }),
  };
}

const adsbdbUnknown = { ok: true, status: 200, json: async () => ({ response: 'unknown callsign' }) };

describe('createRouteResolver', () => {
  it('returns null before anything has been resolved', () => {
    const r = createRouteResolver();
    expect(r.get('BAW274')).toBeNull();
  });

  it('resolves a queued callsign and serves it from cache afterwards', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);

    const route = r.get('BAW274');
    expect(route?.originIata).toBe('LAS');
    expect(route?.destinationIata).toBe('LHR');
    expect(route?.airlineName).toBe('British Airways');
    expect(route?.callsignIata).toBe('BA274');
  });

  it('sends the project User-Agent to adsbdb', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/air-view/);
  });

  it('caps the number of lookups per pump', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('AAA', 'BBB'));
    const r = createRouteResolver({ maxPerPump: 2 });
    r.enqueue(['AAA111', 'BBB222', 'CCC333', 'DDD444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.stats().queued).toBe(2);
  });

  it('remembers unknown callsigns so they are never queried twice', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbUnknown);
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('NJE004M')).toBeNull();
    expect(r.stats().unknown).toBe(1);

    r.enqueue(['NJE004M']); // already known to be unknown
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue a callsign it already resolved', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    r.enqueue(['BAW274']);
    expect(r.stats().queued).toBe(0);
  });

  it('survives an adsbdb HTTP error without losing the queue', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await expect(r.pump(fetchImpl as unknown as typeof fetch)).resolves.toBe(0);
    expect(r.get('BAW274')).toBeNull();
    expect(r.stats().unknown).toBe(0); // an error is not a verdict
  });

  it('normalises the callsign to uppercase and trims it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue([' baw274 ']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.adsbdb.com/v0/callsign/BAW274');
    expect(r.get('baw274')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/routeResolver.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 3: Creare `server/routeResolver.ts`**

```ts
import { USER_AGENT } from '../src/data/sources/userAgent.js';

export interface FlightRoute {
  callsignIcao: string;
  callsignIata: string | null;
  airlineName: string | null;
  originIata: string | null;
  originName: string | null;
  destinationIata: string | null;
  destinationName: string | null;
}

export interface RouteResolverOptions {
  /** Maximum adsbdb lookups performed per pump() call. */
  maxPerPump?: number;
}

export interface RouteResolver {
  get(callsign: string): FlightRoute | null;
  enqueue(callsigns: string[]): void;
  pump(fetchImpl?: typeof fetch): Promise<number>;
  stats(): { resolved: number; unknown: number; queued: number };
}

interface AdsbdbAirport {
  iata_code?: string;
  name?: string;
}

interface AdsbdbResponse {
  response?:
    | string
    | {
        flightroute?: {
          callsign?: string;
          callsign_iata?: string;
          airline?: { name?: string };
          origin?: AdsbdbAirport;
          destination?: AdsbdbAirport;
        };
      };
}

const DEFAULT_MAX_PER_PUMP = 20;

/**
 * Resolves callsigns to real origin/destination pairs via adsbdb.
 *
 * Deliberately asynchronous with respect to the API response: resolving
 * 10 000 callsigns per cycle would mean 10 000 requests to a free service.
 * get() answers from cache only; unknown callsigns are queued and pumped a
 * few at a time. Callsigns repeat heavily between cycles — aircraft stay
 * airborne for hours — so the cache converges within minutes of uptime.
 *
 * Replaces v1's routeLookup, which ignored the flight number entirely and
 * returned the airline's alphabetically first route: every BA flight showed
 * Aalborg -> Aarhus.
 */
export function createRouteResolver(opts: RouteResolverOptions = {}): RouteResolver {
  const maxPerPump = opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP;

  const resolved = new Map<string, FlightRoute>();
  const unknown = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();

  function key(callsign: string): string {
    return callsign.trim().toUpperCase();
  }

  async function lookup(cs: string, fetchImpl: typeof fetch): Promise<boolean> {
    const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsbdb: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbdbResponse;

    const fr = typeof data.response === 'object' ? data.response?.flightroute : undefined;
    if (!fr) {
      unknown.add(cs); // a verdict, not an error: private and military callsigns
      return false;
    }

    resolved.set(cs, {
      callsignIcao: fr.callsign ?? cs,
      callsignIata: fr.callsign_iata ?? null,
      airlineName: fr.airline?.name ?? null,
      originIata: fr.origin?.iata_code ?? null,
      originName: fr.origin?.name ?? null,
      destinationIata: fr.destination?.iata_code ?? null,
      destinationName: fr.destination?.name ?? null,
    });
    return true;
  }

  return {
    get(callsign) {
      return resolved.get(key(callsign)) ?? null;
    },

    enqueue(callsigns) {
      for (const raw of callsigns) {
        const cs = key(raw);
        if (!cs) continue;
        if (resolved.has(cs) || unknown.has(cs) || queued.has(cs)) continue;
        queue.push(cs);
        queued.add(cs);
      }
    },

    async pump(fetchImpl: typeof fetch = fetch) {
      let count = 0;
      const batch = queue.splice(0, maxPerPump);
      for (const cs of batch) {
        queued.delete(cs);
        try {
          if (await lookup(cs, fetchImpl)) count += 1;
        } catch {
          // Transport failure is not a verdict on the callsign: drop it from
          // this batch and let a later cycle re-enqueue it.
        }
      }
      return count;
    },

    stats() {
      return { resolved: resolved.size, unknown: unknown.size, queued: queue.length };
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/routeResolver.test.ts`
Expected: PASS, 8 test

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): resolve real routes from adsbdb

v1's routeLookup ignored the flight number and returned the airline's
first route alphabetically: every BA flight claimed Aalborg -> Aarhus,
and 49% of aircraft showed a fabricated origin and destination.

The resolver answers from cache only and fills that cache a few lookups
at a time, so 10 000 aircraft never become 10 000 requests to a free
service. Measured coverage on live callsigns: 72%; the misses are private,
business and military flights, which the design leaves grey.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Arricchire `/api/states` con rotta e completezza

**Files:**
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Create: `src/data/completeness.ts`
- Test: `tests/unit/data/completeness.test.ts`

**Interfaces:**
- Consumes: `RouteResolver`, `FlightRoute` da Task 5; `AircraftRaw` da Task 1
- Produces: `isComplete(ac: AircraftRaw): boolean` in `src/data/completeness.ts`; `FlightRouteLite` in `src/types.ts` — la forma della rotta trasmessa al client. `AircraftRaw` guadagna in questo task il campo obbligatorio `route: FlightRouteLite | null`, quindi la firma non ha bisogno di un'intersezione.

- [ ] **Step 1: Aggiungere `FlightRouteLite` e il campo rotta in `src/types.ts`**

Aggiungere in fondo a `src/types.ts`:

```ts
/** Route as sent to the client — a subset of the server's FlightRoute. */
export interface FlightRouteLite {
  originIata: string;
  originName: string;
  destinationIata: string;
  destinationName: string;
  airlineName: string | null;
}
```

e aggiungere a `AircraftRaw` il campo:

```ts
  route: FlightRouteLite | null;      // null when adsbdb does not know this callsign
```

Nota: gli adattatori dei Task 1 e 2 non conoscono le rotte. Aggiungere `route: null` all'oggetto restituito da `normalise` in **entrambi** `src/data/sources/adsbLol.ts` e `src/data/sources/adsbFi.ts`. Il server lo popola dopo.

- [ ] **Step 2: Scrivere il test che fallisce**

Creare `tests/unit/data/completeness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isComplete } from '@/data/completeness';
import type { AircraftRaw } from '@/types';

function base(): AircraftRaw {
  return {
    icao24: 'ad5174',
    callsign: 'BAW274',
    longitude: -10,
    latitude: 50,
    baroAltitudeFt: 38000,
    velocityKt: 472,
    headingDeg: 261.3,
    onGround: false,
    lastContact: 1_716_163_200,
    registration: 'G-ZBKA',
    modelCode: 'B789',
    modelDesc: null,
    route: {
      originIata: 'LAS',
      originName: 'McCarran International Airport',
      destinationIata: 'LHR',
      destinationName: 'London Heathrow Airport',
      airlineName: 'British Airways',
    },
  };
}

describe('isComplete', () => {
  it('accepts an aircraft with a real route and every technical field', () => {
    expect(isComplete(base())).toBe(true);
  });

  it('rejects an aircraft without a route — this is the grey population', () => {
    expect(isComplete({ ...base(), route: null })).toBe(false);
  });

  it('rejects a missing callsign', () => {
    expect(isComplete({ ...base(), callsign: null })).toBe(false);
  });

  it('rejects a missing registration', () => {
    expect(isComplete({ ...base(), registration: null })).toBe(false);
  });

  it('rejects a missing model code', () => {
    expect(isComplete({ ...base(), modelCode: null })).toBe(false);
  });

  it('rejects a missing ground speed', () => {
    expect(isComplete({ ...base(), velocityKt: null })).toBe(false);
  });

  it('rejects a missing track', () => {
    expect(isComplete({ ...base(), headingDeg: null })).toBe(false);
  });

  it('rejects a missing position', () => {
    expect(isComplete({ ...base(), latitude: null })).toBe(false);
  });

  it('rejects a missing altitude while airborne', () => {
    expect(isComplete({ ...base(), baroAltitudeFt: null })).toBe(false);
  });

  it('accepts a null altitude when the aircraft is on the ground', () => {
    expect(isComplete({ ...base(), onGround: true, baroAltitudeFt: null })).toBe(true);
  });
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 4: Creare `src/data/completeness.ts`**

```ts
import type { AircraftRaw } from '@/types';

/**
 * An aircraft is "complete" when we can show its full card AND draw its
 * route. The colour predicts the interaction: only a complete aircraft can
 * put D and A on the globe, which is what makes the filter meaningful.
 *
 * Altitude is exempt on the ground, where a null baro altitude is correct
 * rather than missing.
 */
export function isComplete(ac: AircraftRaw): boolean {
  if (ac.route === null) return false;
  if (ac.callsign === null) return false;
  if (ac.latitude === null || ac.longitude === null) return false;
  if (ac.registration === null) return false;
  if (ac.modelCode === null) return false;
  if (ac.velocityKt === null) return false;
  if (ac.headingDeg === null) return false;
  if (!ac.onGround && ac.baroAltitudeFt === null) return false;
  return true;
}
```

- [ ] **Step 5: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: PASS, 10 test

- [ ] **Step 6: Collegare il resolver in `server/index.ts`**

Aggiungere agli import:

```ts
import { createRouteResolver } from './routeResolver.js';
import type { FlightRouteLite } from '../src/types.js';

const routes = createRouteResolver();
```

Nel gestore `/api/states`, dopo aver ottenuto `result` e prima di serializzare, arricchire e accodare:

```ts
    const callsigns: string[] = [];
    for (const ac of result.aircraft) {
      if (ac.callsign === null) continue;
      callsigns.push(ac.callsign);
      const r = routes.get(ac.callsign);
      if (r && r.originIata && r.originName && r.destinationIata && r.destinationName) {
        const lite: FlightRouteLite = {
          originIata: r.originIata,
          originName: r.originName,
          destinationIata: r.destinationIata,
          destinationName: r.destinationName,
          airlineName: r.airlineName,
        };
        ac.route = lite;
      }
    }
    routes.enqueue(callsigns);
    // Fire and forget: the queue drains across cycles, never blocking a response.
    void routes.pump();
```

- [ ] **Step 7: Esporre le statistiche del resolver su `/health`**

Nel gestore `/health`, aggiungere al corpo della risposta:

```ts
    routes: routes.stats(),
```

- [ ] **Step 8: Verificare build e suite completa**

Run: `npm run build:all && npm test -- --run`
Expected: build pulita, test verdi

- [ ] **Step 9: Verificare la convergenza della cache rotte in locale**

```bash
npm run server
```

In un altro terminale, chiamare `/api/states` alcune volte a distanza di qualche secondo, poi:

```bash
curl -s localhost:3000/health | python3 -m json.tool
```

Expected: `routes.resolved` cresce ad ogni ciclo; `routes.queued` sale al primo ciclo e poi scende. Verificare che almeno un aereo nella risposta abbia un campo `route` non nullo con origine e destinazione plausibili per il suo callsign.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(server): attach real routes and a completeness rule

/api/states now carries a route object populated from adsbdb, and
isComplete() defines the blue/grey split the v2 filter is built on:
a real origin and destination plus every technical field.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rimuovere il lookup rotte falso

Separato dal Task 6 perché un revisore potrebbe accettare le rotte vere e volere una discussione a parte sulla rimozione di 4,2 MB di dati statici.

**Files:**
- Delete: `src/data/routeLookup.ts`
- Delete: `tests/unit/data/lookups.test.ts` (la parte rotte; vedi step 2)
- Delete: `public/data/openflights-routes.json`
- Modify: `src/data/resolveFlight.ts`
- Modify: `tests/unit/data/resolveFlight.test.ts`
- Modify: `src/data/bootstrap.ts`
- Modify: `scripts/build-static-data.mjs`
- Modify: `src/types.ts` (rimuove `Route`)

**Interfaces:**
- Consumes: `FlightRouteLite` da Task 6
- Produces: `resolveFlight(ac: AircraftRaw): ResolvedFlight | null` — ora prende l'aereo, non il solo callsign, perché la rotta arriva dal server dentro l'aereo.

- [ ] **Step 1: Riscrivere `src/data/resolveFlight.ts`**

```ts
import type { AircraftRaw, ResolvedFlight } from '@/types';
import { parseCallsign } from './callsign';
import { lookupAirline } from './airlineLookup';
import { lookupAirport } from './airportLookup';

/**
 * Builds the display record for an aircraft.
 *
 * The route now arrives from the server (adsbdb, real). The airline name
 * still comes from the bundled OpenFlights airline table, which is a pure
 * code-to-name mapping and therefore trustworthy — unlike the old route
 * table, which was being queried in a way that fabricated origins.
 */
export function resolveFlight(ac: AircraftRaw): ResolvedFlight | null {
  const parsed = parseCallsign(ac.callsign);
  if (!parsed) return null;

  const airline = lookupAirline(parsed.airlineIcao);
  const airlineName = airline?.name ?? ac.route?.airlineName ?? null;
  if (airlineName === null) return null;

  return {
    airlineIcao: parsed.airlineIcao,
    airlineName,
    flightNumber: parsed.flightNumber,
    origin: ac.route ? lookupAirport(ac.route.originIata) : null,
    destination: ac.route ? lookupAirport(ac.route.destinationIata) : null,
  };
}
```

- [ ] **Step 2: Aggiornare `tests/unit/data/resolveFlight.test.ts`**

Sostituire l'intero file con:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFlight } from '@/data/resolveFlight';
import { initAirlines } from '@/data/airlineLookup';
import { initAirports } from '@/data/airportLookup';
import type { AircraftRaw } from '@/types';

beforeAll(() => {
  initAirlines([
    { icao: 'BAW', iata: 'BA', name: 'British Airways' },
    { icao: 'XYZ', iata: 'XY', name: 'Mystery Air' },
  ]);
  initAirports([
    { iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'GB', lat: 51.47, lon: -0.45, timezone: 'Europe/London' },
    { iata: 'JFK', icao: 'KJFK', name: 'JFK', city: 'New York', country: 'US', lat: 40.64, lon: -73.78, timezone: 'America/New_York' },
  ]);
});

function ac(overrides: Partial<AircraftRaw> = {}): AircraftRaw {
  return {
    icao24: 'ad5174',
    callsign: 'BAW274',
    longitude: -10,
    latitude: 50,
    baroAltitudeFt: 38000,
    velocityKt: 472,
    headingDeg: 261,
    onGround: false,
    lastContact: 1_716_163_200,
    registration: 'G-ZBKA',
    modelCode: 'B789',
    modelDesc: null,
    route: {
      originIata: 'LHR',
      originName: 'London Heathrow Airport',
      destinationIata: 'JFK',
      destinationName: 'John F Kennedy International Airport',
      airlineName: 'British Airways',
    },
    ...overrides,
  };
}

describe('resolveFlight', () => {
  it('resolves BAW274 to British Airways with the route the server supplied', () => {
    const r = resolveFlight(ac());
    expect(r?.airlineIcao).toBe('BAW');
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.flightNumber).toBe('274');
    expect(r?.origin?.iata).toBe('LHR');
    expect(r?.destination?.iata).toBe('JFK');
  });

  it('returns null origin and destination when the server knows no route', () => {
    const r = resolveFlight(ac({ route: null }));
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.origin).toBeNull();
    expect(r?.destination).toBeNull();
  });

  it('returns null for an unparseable callsign', () => {
    expect(resolveFlight(ac({ callsign: 'N12345' }))).toBeNull();
  });

  it('returns null for a null callsign', () => {
    expect(resolveFlight(ac({ callsign: null }))).toBeNull();
  });

  it('falls back to the route airline name when the ICAO code is unknown locally', () => {
    const r = resolveFlight(ac({ callsign: 'QQQ100' }));
    expect(r?.airlineName).toBe('British Airways'); // from route.airlineName
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/unit/data/resolveFlight.test.ts`
Expected: FAIL — `resolveFlight` ha ancora la vecchia firma

- [ ] **Step 4: Aggiornare `src/data/bootstrap.ts`**

Rimuovere l'import `import { loadRoutesFromBundle } from './routeLookup';` e rimuovere `loadRoutesFromBundle(),` dalla `Promise.allSettled`.

Nel callback `onBatch`, sostituire `const resolved = resolveFlight(r.callsign);` con `const resolved = resolveFlight(r);`.

- [ ] **Step 5: Rimuovere il modulo, i dati e il tipo obsoleti**

```bash
git rm src/data/routeLookup.ts public/data/openflights-routes.json
```

In `src/types.ts`, rimuovere l'intera `export interface Route { ... }`.

In `tests/unit/data/lookups.test.ts`, rimuovere l'import di `@/data/routeLookup` e ogni blocco `describe`/`it` che lo esercita, lasciando intatti i test di `airlineLookup` e `airportLookup`.

In `scripts/build-static-data.mjs`, rimuovere il blocco che genera `openflights-routes.json`. Individuarlo con:

```bash
grep -n "routes" scripts/build-static-data.mjs
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `npm test -- --run`
Expected: PASS su tutta la suite; nessun riferimento residuo a `routeLookup`

- [ ] **Step 7: Verificare che non restino riferimenti**

```bash
grep -rn "routeLookup\|openflights-routes\|initRoutes" src/ server/ tests/ scripts/ || echo "nessun riferimento residuo"
```

Expected: `nessun riferimento residuo`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(data): delete the fabricated route lookup

routeLookup returned list[0] for any flight number, so every BA flight
claimed Aalborg -> Aarhus and 49% of aircraft carried an invented origin
and destination. Real routes now arrive from the server, so the module,
its 4.2 MB static table, and the Route type all go.

resolveFlight now takes the aircraft rather than the bare callsign,
because the route travels with it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Il client smette di svuotare il globo

L'ultimo anello della catena che ha prodotto il globo vuoto.

**Files:**
- Modify: `src/state/aircraftStore.ts`
- Modify: `src/data/bootstrap.ts`
- Modify: `src/data/openSkyClient.ts` → rinominato `src/data/statesClient.ts`
- Test: `tests/unit/state/stores.test.ts` (estende)

**Interfaces:**
- Consumes: `AircraftRaw` da Task 1
- Produces: `useAircraftStore` guadagna `feedFetchedAt: number` (epoch ms del batch) e `feedAgeSeconds(): number`; `removeStale(batchFetchedAtUnix: number)` cambia semantica. `fetchStates` si sposta in `src/data/statesClient.ts` con la stessa firma.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `tests/unit/state/stores.test.ts`:

```ts
import { useAircraftStore } from '@/state/aircraftStore';
import type { AircraftRaw } from '@/types';

function raw(icao: string, lastContact: number): AircraftRaw {
  return {
    icao24: icao, callsign: 'TST1', longitude: 0, latitude: 0,
    baroAltitudeFt: 30000, velocityKt: 400, headingDeg: 90, onGround: false,
    lastContact, registration: 'X', modelCode: 'A320', modelDesc: null, route: null,
  };
}

describe('aircraftStore staleness', () => {
  it('keeps every aircraft of a batch even when the batch itself is old', () => {
    // The v1 bug: a frozen feed made now - lastContact enormous for ALL
    // aircraft, so removeStale deleted the entire fleet and the globe emptied.
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch([raw('a', batchAt), raw('b', batchAt - 10)], batchAt);
    store.removeStale(batchAt);
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('drops only aircraft stale relative to their own batch', () => {
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch([raw('fresh', batchAt), raw('old', batchAt - 600)], batchAt);
    store.removeStale(batchAt);
    const ids = [...useAircraftStore.getState().aircraft.keys()];
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('old');
  });

  it('reports the feed age from the batch timestamp', () => {
    const store = useAircraftStore.getState();
    const batchAt = Math.floor(Date.now() / 1000) - 45;
    store.updateBatch([raw('a', batchAt)], batchAt);
    expect(useAircraftStore.getState().feedAgeSeconds()).toBeGreaterThanOrEqual(45);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/state/stores.test.ts`
Expected: FAIL — `updateBatch` accetta un solo argomento e `feedAgeSeconds` non esiste

- [ ] **Step 3: Riscrivere `src/state/aircraftStore.ts`**

```ts
import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';

const TRAIL_MAX = 30;
/** An aircraft is dropped when it is this far behind its own batch. */
const STALE_SECONDS = 120;

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  /** Unix seconds of the batch currently held — NOT the local clock. */
  feedFetchedAt: number;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  updateBatch: (raws: AircraftRaw[], batchFetchedAtUnix: number) => void;
  removeStale: (batchFetchedAtUnix: number) => void;
  feedAgeSeconds: () => number;
}

export const useAircraftStore = create<AircraftState>((set, get) => ({
  aircraft: new Map(),
  feedFetchedAt: 0,
  fetchStatus: 'idle',

  setFetchStatus: (s) => set({ fetchStatus: s }),

  updateBatch: (raws, batchFetchedAtUnix) =>
    set((state) => {
      const next = new Map(state.aircraft);
      for (const r of raws) {
        const prev = next.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Only real received positions enter the trail — never computed ones.
        if (prev && prev.longitude !== null && prev.latitude !== null) {
          trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        next.set(r.icao24, { ...r, trail });
      }
      return { aircraft: next, feedFetchedAt: batchFetchedAtUnix };
    }),

  /**
   * Drops aircraft that are stale *relative to the batch that carried them*.
   *
   * v1 compared lastContact against the local clock, so a frozen feed made
   * every aircraft look infinitely stale and the whole fleet was deleted —
   * the final link in the chain that emptied the globe. A stopped feed is
   * not this function's problem: it is reported, not silently drained.
   */
  removeStale: (batchFetchedAtUnix) =>
    set((state) => {
      const next = new Map(state.aircraft);
      for (const [icao, ac] of next) {
        if (batchFetchedAtUnix - ac.lastContact > STALE_SECONDS) next.delete(icao);
      }
      return { aircraft: next };
    }),

  feedAgeSeconds: () => {
    const at = get().feedFetchedAt;
    if (at === 0) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000) - at);
  },
}));
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/state/stores.test.ts`
Expected: PASS

- [ ] **Step 5: Rinominare il client e propagare il timestamp del batch**

```bash
git mv src/data/openSkyClient.ts src/data/statesClient.ts
git mv tests/unit/data/openSkyClient.test.ts tests/unit/data/statesClient.test.ts
```

Il nome mentiva: il modulo parla con il nostro proxy, non con OpenSky. Aggiornare gli import in `tests/unit/data/statesClient.test.ts` e in `src/data/aircraftStream.ts` da `'./openSkyClient'` a `'./statesClient'`.

In `src/data/aircraftStream.ts`, cambiare la firma di `onBatch` per portare anche l'istante del batch:

```ts
  onBatch: (aircraft: AircraftRaw[], fetchedAt: Date) => void;
```

e nella funzione `tick`, sostituire `opts.onBatch(result.aircraft);` con `opts.onBatch(result.aircraft, result.fetchedAt);`.

- [ ] **Step 6: Aggiornare `src/data/bootstrap.ts`**

Sostituire il callback `onBatch` con:

```ts
    onBatch: (raws, fetchedAt) => {
      const batchUnix = Math.floor(fetchedAt.getTime() / 1000);
      const enriched: Aircraft[] = raws.map((r) => {
        const resolved = resolveFlight(r);
        const ac: Aircraft = { ...r, trail: [] };
        if (resolved) ac.resolved = resolved;
        return ac;
      });
      useAircraftStore.getState().updateBatch(enriched, batchUnix);
      useAircraftStore.getState().removeStale(batchUnix);
      useAircraftStore.getState().setFetchStatus('idle');
    },
```

- [ ] **Step 7: Verificare build e suite completa**

Run: `npm run build:all && npm test -- --run`
Expected: build pulita, tutti i test verdi

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(state): stop deleting the fleet when the feed stops

removeStale compared lastContact against the local clock, so a frozen
feed made every aircraft infinitely stale and the entire fleet was
dropped — the last link in the chain that emptied the globe. Staleness
is now measured against the batch that carried the aircraft.

Renames openSkyClient to statesClient: it talks to our own proxy, not
to OpenSky, and has since the adsb.lol switch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verifica end-to-end contro le API reali

Ultimo task: nessun mock. Serve a provare che la catena funzioni contro il mondo, non contro i nostri doppi di test.

**Files:**
- Create: `scripts/verify-feed.mjs`

**Interfaces:**
- Consumes: il server in esecuzione su `localhost:3000`
- Produces: uno script di verifica manuale riusabile

- [ ] **Step 1: Creare `scripts/verify-feed.mjs`**

```js
#!/usr/bin/env node
// Verifies the full data chain against the real upstream APIs.
// Usage: npm run server   (in another terminal)   then: node scripts/verify-feed.mjs

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`ok    ${msg}`);
}

const health = await (await fetch(`${BASE}/health`)).json();
console.log('health:', JSON.stringify(health));

const res = await fetch(`${BASE}/api/states`);
if (!res.ok) {
  fail(`/api/states returned HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const ac = data.aircraft ?? [];

pass(`source: ${data.source}`);
pass(`aircraft: ${ac.length}`);

if (ac.length < 1000) fail(`expected thousands of aircraft, got ${ac.length}`);

const ageS = (Date.now() - new Date(data.fetchedAt).getTime()) / 1000;
if (ageS > 120) fail(`fetchedAt is ${Math.round(ageS)}s old — the feed is not live`);
else pass(`feed age: ${Math.round(ageS)}s`);

const withReg = ac.filter((a) => a.registration).length;
const withModel = ac.filter((a) => a.modelCode).length;
pass(`registration: ${(100 * withReg / ac.length).toFixed(1)}%`);
pass(`model: ${(100 * withModel / ac.length).toFixed(1)}%`);
if (withReg / ac.length < 0.8) fail('registration coverage below 80% — adapter may be dropping it');

const withRoute = ac.filter((a) => a.route).length;
console.log(`route: ${withRoute} of ${ac.length} (grows as the resolver cache fills)`);

// The v1 bug, asserted directly: no BA flight may claim Aalborg -> Aarhus.
const fabricated = ac.filter(
  (a) => a.route && a.route.originIata === 'AAL' && a.route.destinationIata === 'AAR'
);
if (fabricated.length > 1) fail(`${fabricated.length} aircraft share AAL->AAR — the fabricated route is back`);
else pass('no fabricated AAL->AAR cluster');

console.log(process.exitCode ? '\nVERIFICATION FAILED' : '\nVERIFICATION PASSED');
```

- [ ] **Step 2: Aggiungere lo script a `package.json`**

Nel blocco `"scripts"`, aggiungere:

```json
    "verify:feed": "node scripts/verify-feed.mjs",
```

- [ ] **Step 3: Eseguire la verifica**

In un terminale:

```bash
npm run server
```

In un altro, attendere che il primo ciclo sia completato e poi:

```bash
npm run verify:feed
```

Expected: `VERIFICATION PASSED`, con migliaia di aerei, età del feed sotto i 120 s, copertura registrazione sopra l'80%, e nessun gruppo AAL→AAR. Il conteggio `route` cresce ripetendo la verifica dopo qualche minuto, man mano che la cache del resolver si riempie.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add end-to-end feed verification script

Checks the full chain against the real upstream APIs rather than test
doubles: live feed age, adapter field coverage, and an explicit assertion
that the fabricated AAL->AAR route cluster has not come back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy e verifica in produzione**

```bash
git checkout main && git merge v2-design && git push
```

Railway compila e ridistribuisce da solo. Dopo il deploy:

```bash
BASE_URL=https://air-view-production.up.railway.app npm run verify:feed
curl -s https://air-view-production.up.railway.app/health | python3 -m json.tool
```

Expected: `VERIFICATION PASSED` contro la produzione, `/health` con `"status": "ok"` e `feedAgeSeconds` sotto i 120.

---

## Cosa resta fuori da questo piano

- **Piano 2 — densità e movimento**: tile cache a 10°, doppia cadenza (sweep globale magro + celle in vista), dead reckoning con tetto temporale, raggio in pixel-schermo, ordine di disegno gerarchico.
- **Piano 3 — interazione e visivo**: pannello con conteggi e checkbox, focus con geodetica e marker D/A, ricerca per numero di volo, palette caldo/grigio/blu. Include anche la **superficie visibile** del presidio §3.4 punto 3: il Task 8 espone `feedAgeSeconds()` nello store ma nessun componente lo mostra ancora, perché la UI del pannello nasce lì. Fino ad allora il feed fermo è visibile su `/health` e nel 503 di `/api/states`, non nell'interfaccia.

Il Piano 1 lascia il sito funzionante e onesto: feed vivo, rotte vere, guasti visibili. I piani 2 e 3 lo rendono anche bello e leggibile.
