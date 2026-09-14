# Air View v2 — Piano 1: livello dati

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rimettere in produzione un feed vivo, con origini e destinazioni vere e con i guasti visibili entro minuti anziché mesi.

**Architecture:** Gli adattatori per fornitore normalizzano verso un tipo comune e un selettore con circuit breaker li mette in cascata, saltando le sorgenti che non reggono il raggio richiesto. Il server si alimenta da solo con un poller di background invece di dipendere dalle richieste utente, impone un'età massima alla cache, distingue "non ho ancora iniziato" da "ero vivo e sono morto", e arricchisce i callsign con rotte vere da adsbdb a rate costante. Il client smette di cancellare la flotta quando il feed è fermo.

**Tech Stack:** TypeScript strict, Fastify 5, Vitest, undici. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md`

**Revisione:** questa è la seconda stesura. La prima è stata respinta da un preflight a quattro lenti con 16 finding critici; le correzioni sono elencate in fondo, nella sezione "Difetti corretti rispetto alla prima stesura", con l'evidenza che li ha provati.

## Global Constraints

- **Regole di import — leggere prima di scrivere qualunque file.** Il repo ha due programmi TypeScript distinti:
  - `tsconfig.json` (`moduleResolution: Bundler`, include `src` e `tests`) compila il codice client. Qui l'alias `@/` funziona e le estensioni si omettono.
  - `tsconfig.server.json` (`moduleResolution: NodeNext`, include `server/**` più i file di `src/` che il server usa) compila il server. Qui **l'alias `@/` non risolve** e **ogni import relativo deve avere il suffisso `.js`**.
  - Un file di `src/` raggiungibile da `server/` viene compilato da **entrambi**, quindi deve rispettare le regole più severe: percorsi relativi con `.js`, mai `@/`. Precedente nel repo: `src/data/adsbSource.ts` importa `'../types.js'` esattamente per questo.
  - Tutti i moduli creati sotto `src/data/sources/` ricadono in questo caso.
- **`npm run build` non type-checka il server.** Solo `npm run build:all` lo fa. Ogni task che tocca file condivisi verifica con `npm run build:all`, mai con `npm run build` da solo.
- **Ogni richiesta HTTP uscente deve portare lo User-Agent del progetto.** Costante unica `USER_AGENT` in `src/data/sources/userAgent.ts`. È la causa diretta del guasto di produzione: nessuna chiamata può ometterlo.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy in produzione è una decisione dell'utente. Questo piano si ferma sul branch `v2-design`.
- TypeScript `strict` con `noUncheckedIndexedAccess`.
- Nessun dato inventato: un campo sconosciuto è `null`, mai un valore plausibile.
- Messaggi di commit in inglese, coerenti con la storia del repo.
- `npm test -- --run` e `npm run build:all` devono passare al termine di ogni task.

---

### Task 1: User-Agent, tipo esteso e adattatore adsb.lol

Rimette in vita la produzione. Estende `AircraftRaw` **una volta sola** con tutti i campi che i task successivi useranno, così i literal nei test si aggiornano in un punto solo invece che tre volte.

**Files:**
- Create: `src/data/sources/userAgent.ts`
- Create: `src/data/sources/types.ts`
- Create: `src/data/sources/adsbLol.ts`
- Create: `tests/helpers/aircraft.ts`
- Modify: `src/types.ts`
- Modify: `tsconfig.server.json`
- Modify: `tests/unit/state/stores.test.ts`
- Modify: `tests/unit/data/aircraftStream.test.ts`
- Modify: `server/index.ts`
- Delete: `src/data/adsbSource.ts`, `tests/unit/data/adsbSource.test.ts`
- Test: `tests/unit/data/sources/adsbLol.test.ts`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `USER_AGENT: string`; `GeoPoint { lat, lon }`; `SourceResult { aircraft: AircraftRaw[], fetchedAt: Date }`; `AircraftSource { id, label, maxRadiusNm, fetchRegion(centre, radiusNm, fetchImpl?) }`; `adsbLolSource: AircraftSource`; `makeAircraftRaw(overrides?)` in `tests/helpers/aircraft.ts`. `AircraftRaw` guadagna `registration`, `modelCode`, `modelDesc`, `route` — tutti obbligatori nel tipo, `route` popolato solo dal Task 6.

- [ ] **Step 1: Estendere `src/types.ts`**

Sostituire il blocco `export interface AircraftRaw { ... }` con:

```ts
/** Route as sent to the client. Populated server-side from adsbdb. */
export interface FlightRouteLite {
  originIata: string;
  originName: string;
  destinationIata: string;
  destinationName: string;
  airlineName: string | null;
}

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
  modelDesc: string | null;           // long name; only adsb.fi ships it
  route: FlightRouteLite | null;      // filled by the server; null until Task 6
}
```

Tutti i campi nuovi entrano qui, in questo task. Il Task 6 popolerà `route` ma non toccherà più il tipo: è la lezione della prima stesura, che aggiungeva campi obbligatori in due momenti diversi e rompeva il typecheck entrambe le volte.

- [ ] **Step 2: Creare l'helper di test condiviso `tests/helpers/aircraft.ts`**

```ts
import type { AircraftRaw } from '@/types';

/**
 * Builds a valid AircraftRaw for tests. Every field has a sane default so a
 * new required field only has to be added here, not in every test literal.
 */
export function makeAircraftRaw(overrides: Partial<AircraftRaw> = {}): AircraftRaw {
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
    route: null,
    ...overrides,
  };
}
```

- [ ] **Step 3: Riparare i test esistenti che costruiscono `AircraftRaw`**

I nuovi campi obbligatori rompono i literal già presenti. Trovarli:

```bash
grep -rn "icao24:" tests/
```

In `tests/unit/state/stores.test.ts` e `tests/unit/data/aircraftStream.test.ts`, sostituire ogni literal `AircraftRaw` con una chiamata a `makeAircraftRaw({ ... })` passando solo i campi che quel test controlla davvero, e aggiungere in cima:

```ts
import { makeAircraftRaw } from '../../helpers/aircraft';
```

(adeguare la profondità del percorso relativo al file). Verificare con:

```bash
npx tsc --noEmit
```

Expected: nessun errore `TS2739`.

- [ ] **Step 4: Dichiarare i nuovi moduli al programma del server**

In `tsconfig.server.json`, sostituire la riga `include` con:

```json
  "include": ["server/**/*.ts", "src/data/sources/**/*.ts", "src/types.ts"],
```

`src/data/openSkyAuth.ts` esce dall'elenco: quel file non esiste più nel repo, l'include puntava a un fantasma.

- [ ] **Step 5: Scrivere il test che fallisce**

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

  it('declares a radius ceiling large enough for the global sweep', () => {
    expect(adsbLolSource.maxRadiusNm).toBeGreaterThanOrEqual(10_000);
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

- [ ] **Step 6: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/adsbLol.test.ts`
Expected: FAIL — `Failed to resolve import "@/data/sources/adsbLol"`

- [ ] **Step 7: Creare `src/data/sources/userAgent.ts`**

```ts
/**
 * Identifies Air View to the ADS-B aggregators that host us for free.
 *
 * This is not cosmetic. The v1 production outage (2026-08-20 -> 2026-09-14)
 * was caused by its absence: Node/undici sends "User-Agent: node" by default,
 * and adsb.lol answers 403 to it. Every outbound request must carry this.
 */
export const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
```

- [ ] **Step 8: Creare `src/data/sources/types.ts`**

Nota gli import: percorso relativo con `.js`, mai `@/`. Questo file è compilato anche da `tsconfig.server.json` sotto NodeNext.

```ts
import type { AircraftRaw } from '../../types.js';

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
 * this interface does too — v1's bbox shape matched none of them.
 */
export interface AircraftSource {
  readonly id: string;
  readonly label: string;
  /**
   * Largest radius this provider accepts, in nautical miles. Verified live:
   * adsb.lol serves 10 000 NM; adsb.fi rejects anything above 250 NM with
   * HTTP 400/429. The selector uses this to skip a source instead of firing
   * a request that is guaranteed to fail.
   */
  readonly maxRadiusNm: number;
  fetchRegion(
    centre: GeoPoint,
    radiusNm: number,
    fetchImpl?: typeof fetch
  ): Promise<SourceResult>;
}
```

- [ ] **Step 9: Creare `src/data/sources/adsbLol.ts`**

```ts
import type { AircraftRaw } from '../../types.js';
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';
import { USER_AGENT } from './userAgent.js';

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
  now?: number; // milliseconds since epoch
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
    route: null, // filled server-side from adsbdb
  };
}

export const adsbLolSource: AircraftSource = {
  id: 'adsb-lol',
  label: 'adsb.lol',
  maxRadiusNm: 10_000,

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

- [ ] **Step 10: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/adsbLol.test.ts`
Expected: PASS, 10 test

- [ ] **Step 11: Sostituire il vecchio modulo nel server**

In `server/index.ts`, sostituire l'import
`import { fetchAdsbStates } from '../src/data/adsbSource.js';`
con
`import { adsbLolSource } from '../src/data/sources/adsbLol.js';`

e nel gestore `/api/states` sostituire
`const result = await fetchAdsbStates(bbox);`
con
`const result = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10_000);`

Il parametro `bbox` resta ignorato: il fetch camera-driven arriva nel Piano 2.

- [ ] **Step 12: Rimuovere il modulo obsoleto e il suo test**

```bash
git rm src/data/adsbSource.ts tests/unit/data/adsbSource.test.ts
```

- [ ] **Step 13: Verificare ENTRAMBI i programmi TypeScript**

```bash
npm run build:all && npm test -- --run
```

Expected: `tsc --noEmit` pulito, `vite build` pulito, **`tsc -p tsconfig.server.json` pulito**, tutti i test verdi.

`npm run build:all` e non `npm run build`: il secondo non type-checka il server, e nella prima stesura di questo piano ha nascosto un errore di import fino a quattro task più avanti. Se `build:server` fallisce con `TS2307` (`Cannot find module '@/types'`) o `TS2835` (estensione mancante), l'errore è negli import dei nuovi moduli: rileggere le Global Constraints.

- [ ] **Step 14: Commit**

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
- Consumes: `AircraftSource`, `GeoPoint`, `SourceResult`, `USER_AGENT` dal Task 1
- Produces: `adsbFiSource: AircraftSource` con `maxRadiusNm: 250`

adsb.fi differisce da adsb.lol in quattro punti verificati dal vivo: percorso URL, chiave dell'array (`aircraft` invece di `ac`), unità di `now` (secondi invece di millisecondi), e campo `desc` con il nome esteso del modello. Ha inoltre un tetto di raggio molto più basso.

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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/adsbFi.test.ts`
Expected: FAIL — import non risolto

- [ ] **Step 3: Creare `src/data/sources/adsbFi.ts`**

```ts
import type { AircraftRaw } from '../../types.js';
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';
import { USER_AGENT } from './userAgent.js';

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
  now?: number; // SECONDS since epoch, unlike adsb.lol's milliseconds
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
    route: null,
  };
}

export const adsbFiSource: AircraftSource = {
  id: 'adsb-fi',
  label: 'adsb.fi',
  // Verified live: 250 NM -> 200; 1000 NM -> 400; 5000 and 10 000 NM -> 429.
  // This provider is usable by the Plan 2 camera-driven fetch, not by the
  // Plan 1 global sweep. The selector skips it rather than failing.
  maxRadiusNm: 250,

  async fetchRegion(centre: GeoPoint, radiusNm: number, fetchImpl: typeof fetch = fetch): Promise<SourceResult> {
    const url = `https://opendata.adsb.fi/api/v2/lat/${centre.lat}/lon/${centre.lon}/dist/${radiusNm}`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`adsb-fi: HTTP ${res.status}`);
    const data = (await res.json()) as AdsbFiResponse;
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
Expected: PASS, 7 test

- [ ] **Step 5: Verificare entrambi i programmi e committare**

```bash
npm run build:all && npm test -- --run
git add -A
git commit -m "feat(data): add adsb.fi source adapter

Second provider, verified live: 676 aircraft within 250 NM of Milan.
Differs from adsb.lol in four ways that justify a separate adapter —
array key 'aircraft' instead of 'ac', epoch in seconds instead of
milliseconds, a 'desc' field with the long model name, and a hard 250 NM
radius ceiling (1000 NM returns 400, larger returns 429).

That ceiling means adsb.fi cannot serve the Plan 1 global sweep. It is
declared through maxRadiusNm so the selector skips it knowingly, and it
enters service with the Plan 2 camera-driven fetch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Selettore con circuit breaker e tetto di raggio

**Files:**
- Create: `src/data/sources/selector.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/data/sources/selector.test.ts`

**Interfaces:**
- Consumes: `AircraftSource`, `GeoPoint`, `SourceResult` dal Task 1
- Produces: `createSourceSelector(sources: AircraftSource[], opts?: SelectorOptions): SourceSelector`. `SourceSelector.fetchRegion(centre, radiusNm, fetchImpl?): Promise<SelectorResult>`, `SelectorResult = SourceResult & { sourceId: string }`, `SelectorOptions = { breakerCooldownMs?: number; now?: () => number }`.

Due ragioni per il selettore, non una. Il breaker evita che un fornitore in avaria costi un timeout a **ogni** richiesta. Il tetto di raggio evita di chiamare un fornitore che rifiuterà comunque: adsb.fi restituisce 400 sopra i 250 NM, e senza questo controllo il fallback sarebbe codice morto che apre il proprio breaker al primo tentativo.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/data/sources/selector.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSourceSelector } from '@/data/sources/selector';
import type { AircraftSource, SourceResult } from '@/data/sources/types';

const emptyResult = (): SourceResult => ({ aircraft: [], fetchedAt: new Date(0) });

function fakeSource(id: string, maxRadiusNm: number, impl: () => Promise<SourceResult>): AircraftSource {
  return { id, label: id, maxRadiusNm, fetchRegion: vi.fn(impl) };
}

describe('createSourceSelector', () => {
  it('returns the primary result and tags it with the source id', async () => {
    const primary = fakeSource('a', 10_000, async () => emptyResult());
    const selector = createSourceSelector([primary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('a');
  });

  it('falls through to the secondary when the primary throws', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    const selector = createSourceSelector([primary, secondary]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(res.sourceId).toBe('b');
  });

  it('SKIPS a source whose radius ceiling is below the request', async () => {
    // adsb.fi caps at 250 NM. Calling it with the 10 000 NM global sweep
    // would return HTTP 400 and open its breaker for nothing.
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const big = fakeSource('adsb-lol', 10_000, async () => emptyResult());
    const selector = createSourceSelector([small, big]);
    const res = await selector.fetchRegion({ lat: 0, lon: 0 }, 10_000);
    expect(small.fetchRegion).not.toHaveBeenCalled();
    expect(res.sourceId).toBe('adsb-lol');
  });

  it('uses a small-radius source when the request fits it', async () => {
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([small]);
    const res = await selector.fetchRegion({ lat: 45, lon: 9 }, 250);
    expect(res.sourceId).toBe('adsb-fi');
  });

  it('does not retry a failed source while its breaker is open', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
    clock += 30_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(1);
  });

  it('retries a failed source once the cooldown has elapsed', async () => {
    const primary = fakeSource('a', 10_000, async () => { throw new Error('boom'); });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 60_000, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    clock += 61_000;
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    expect(primary.fetchRegion).toHaveBeenCalledTimes(2);
  });

  it('closes the breaker again after a success', async () => {
    let fail = true;
    const primary = fakeSource('a', 10_000, async () => {
      if (fail) throw new Error('boom');
      return emptyResult();
    });
    const secondary = fakeSource('b', 10_000, async () => emptyResult());
    let clock = 1000;
    const selector = createSourceSelector([primary, secondary], { breakerCooldownMs: 10, now: () => clock });

    await selector.fetchRegion({ lat: 0, lon: 0 }, 10);
    fail = false;
    clock += 20;
    expect((await selector.fetchRegion({ lat: 0, lon: 0 }, 10)).sourceId).toBe('a');
    clock += 1;
    expect((await selector.fetchRegion({ lat: 0, lon: 0 }, 10)).sourceId).toBe('a');
  });

  it('throws an aggregated error when every source fails', async () => {
    const a = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    const b = fakeSource('b', 10_000, async () => { throw new Error('adsb-fi: HTTP 500'); });
    const selector = createSourceSelector([a, b]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403.*500/s);
  });

  it('reports clearly when every source was skipped for radius', async () => {
    const small = fakeSource('adsb-fi', 250, async () => emptyResult());
    const selector = createSourceSelector([small]);
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10_000)).rejects.toThrow(/radius/i);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: FAIL — import non risolto

- [ ] **Step 3: Creare `src/data/sources/selector.ts`**

```ts
import type { AircraftSource, GeoPoint, SourceResult } from './types.js';

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
 * Tries sources in order, skipping any that cannot serve the requested
 * radius and any whose breaker is open.
 *
 * The radius check is not an optimisation: adsb.fi rejects anything above
 * 250 NM, so without it the global sweep would call a provider guaranteed
 * to fail, open its breaker, and leave us with no fallback at all.
 *
 * The breaker exists because otherwise a provider that is down would cost
 * every request a timeout before falling through — turning an outage into
 * sitewide latency.
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
      const skippedForRadius: string[] = [];
      const t = now();

      for (const source of sources) {
        if (radiusNm > source.maxRadiusNm) {
          skippedForRadius.push(`${source.id} (max ${source.maxRadiusNm} NM)`);
          continue;
        }
        if ((openUntil.get(source.id) ?? 0) > t) continue; // breaker open

        try {
          const result = await source.fetchRegion(centre, radiusNm, fetchImpl);
          openUntil.delete(source.id); // success closes the breaker
          return { ...result, sourceId: source.id };
        } catch (e) {
          openUntil.set(source.id, now() + cooldownMs);
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      if (errors.length > 0) {
        throw new Error(`all usable ADS-B sources failed: ${errors.join(' | ')}`);
      }
      if (skippedForRadius.length > 0) {
        throw new Error(
          `no ADS-B source accepts a ${radiusNm} NM radius: ${skippedForRadius.join(', ')}`
        );
      }
      throw new Error('all ADS-B sources are in cooldown');
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: PASS, 9 test

- [ ] **Step 5: Collegare il selettore nel server**

In `server/index.ts`, sostituire l'import di `adsbLolSource` con:

```ts
import { adsbLolSource } from '../src/data/sources/adsbLol.js';
import { adsbFiSource } from '../src/data/sources/adsbFi.js';
import { createSourceSelector } from '../src/data/sources/selector.js';

// Plan 1 uses a single global sweep, which only adsb.lol can serve.
// adsb.fi is registered now and starts being used by the Plan 2
// camera-driven fetch, whose radii fit under its 250 NM ceiling.
const sources = createSourceSelector([adsbLolSource, adsbFiSource]);
const GLOBAL_SWEEP = { centre: { lat: 0, lon: 0 }, radiusNm: 10_000 };
```

e nel gestore `/api/states` sostituire la chiamata con:

```ts
const result = await sources.fetchRegion(GLOBAL_SWEEP.centre, GLOBAL_SWEEP.radiusNm);
```

- [ ] **Step 6: Verificare entrambi i programmi e committare**

```bash
npm run build:all && npm test -- --run
git add -A
git commit -m "feat(data): source selector with breaker and radius ceiling

Falls through adsb.lol -> adsb.fi, remembering a failure for a cooldown
window instead of retrying on every request.

Also skips any source whose maxRadiusNm is below the request. Without it
the 10 000 NM global sweep would call adsb.fi, get HTTP 400, and open the
breaker on the very provider meant to be the fallback.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Stato del feed, poller di background e `/health` che non blocca il deploy

Il cuore della cura. Tre difetti della v1 si incontrano qui, e a essi si aggiunge un difetto strutturale che la v1 aveva e che nessuno aveva notato: **il server non si alimenta da solo**. Il fetch avviene solo dentro il gestore di `/api/states`, quindi senza traffico il feed non esiste.

**Files:**
- Create: `server/feedState.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/server/feedState.test.ts`

**Interfaces:**
- Consumes: `SourceSelector` dal Task 3
- Produces: `createFeedState(opts?: FeedStateOptions): FeedState`. `FeedState` espone `put(key: string, body: string): void`, `get(key: string): { body: string; stale: boolean } | null`, `recordFailure(message: string): void`, `health(): FeedHealth`. `FeedHealth = { status: 'starting' | 'ok' | 'degraded'; lastSuccessAt: string | null; feedAgeSeconds: number | null; lastError: string | null }`. `FeedStateOptions = { maxFreshMs?: number; maxStaleMs?: number; degradedAfterMs?: number; now?: () => number }`.

**Perché tre stati e non due.** `railway.toml` usa `/health` come healthcheck del deploy, con `restartPolicyType = ON_FAILURE` e 10 tentativi. Se `/health` rispondesse 503 quando nessun fetch è ancora riuscito, si creerebbe uno stallo: Railway non instrada traffico finché il check non passa, e senza traffico nessun fetch parte. Il deploy che deve riparare il guasto non entrerebbe mai in servizio. Lo stato `starting` distingue "non ho ancora iniziato" (200, legittimo al boot) da `degraded`, cioè "ero vivo e ora sono fermo" (503, il segnale che alla v1 è mancato per 25 giorni).

**Perché la cache stantia torna, ma con un limite.** Il difetto della v1 non era servire dati vecchi: era servirli **senza limite di età e senza dirlo**. Qui una risposta oltre i 90 s è ancora servibile fino a 10 minuti, ma marcata `stale: true` nel corpo e in un header, così il client sa. Oltre i 10 minuti non si serve più nulla. Questa è la vera resilienza del Piano 1, dato che adsb.fi non può coprire il raggio globale.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/server/feedState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFeedState } from '../../../server/feedState';

describe('createFeedState — cache', () => {
  it('serves a fresh body unmarked', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('global', '{"a":1}');
    clock += 10_000;
    expect(s.get('global')).toEqual({ body: '{"a":1}', stale: false });
  });

  it('serves a body past freshness but marks it stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('global', '{"a":1}');
    clock += 120_000;
    expect(s.get('global')).toEqual({ body: '{"a":1}', stale: true });
  });

  it('REFUSES a body past the stale ceiling — the v1 bug was no ceiling at all', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('global', '{"a":1}');
    clock += 601_000;
    expect(s.get('global')).toBeNull();
  });

  it('keeps cache entries separate per key', () => {
    let clock = 0;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('a', 'A');
    clock += 400_000;
    s.put('b', 'B');
    clock += 300_000; // a is 700s old, b is 300s old
    expect(s.get('a')).toBeNull();
    expect(s.get('b')).toEqual({ body: 'B', stale: true });
  });
});

describe('createFeedState — health', () => {
  it('reports starting before any fetch has succeeded — NOT degraded', () => {
    // Railway healthchecks /health at boot. Answering 503 here would stall
    // the deploy: no traffic is routed until the check passes, and nothing
    // warms the feed without traffic.
    const s = createFeedState({ now: () => 1_000_000 });
    const h = s.health();
    expect(h.status).toBe('starting');
    expect(h.lastSuccessAt).toBeNull();
    expect(h.feedAgeSeconds).toBeNull();
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

  it('reports degraded once a previously live feed has gone stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('global', '{}');
    clock += 301_000;
    expect(s.health().status).toBe('degraded');
  });

  it('stays starting even after failures, if nothing ever succeeded', () => {
    const s = createFeedState({ now: () => 1_000_000 });
    s.recordFailure('adsb-lol: HTTP 403');
    expect(s.health().status).toBe('starting');
    expect(s.health().lastError).toMatch(/403/);
  });

  it('surfaces the last error without prematurely declaring degraded', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('global', '{}');
    clock += 10_000;
    s.recordFailure('all usable ADS-B sources failed: adsb-lol: HTTP 403');
    const h = s.health();
    expect(h.lastError).toMatch(/403/);
    expect(h.status).toBe('ok'); // one failed cycle is not yet an outage
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 3: Creare `server/feedState.ts`**

```ts
export type FeedStatus = 'starting' | 'ok' | 'degraded';

export interface FeedHealth {
  status: FeedStatus;
  lastSuccessAt: string | null;
  feedAgeSeconds: number | null;
  lastError: string | null;
}

export interface FeedState {
  put(key: string, body: string): void;
  get(key: string): { body: string; stale: boolean } | null;
  recordFailure(message: string): void;
  health(): FeedHealth;
}

export interface FeedStateOptions {
  /** Up to this age a cached body is served unmarked. */
  maxFreshMs?: number;
  /** Past freshness and up to this age it is served marked stale. Beyond, never. */
  maxStaleMs?: number;
  /** Age since the last success beyond which health reports degraded. */
  degradedAfterMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_FRESH_MS = 90_000;
const DEFAULT_MAX_STALE_MS = 600_000;
const DEFAULT_DEGRADED_AFTER_MS = 300_000;

/**
 * Cache and health state for the upstream feed.
 *
 * The v1 outage lasted 25 days because the cache had no maximum age and
 * /health answered 'ok' unconditionally: the server served a frozen
 * 2026-08-20 snapshot and nothing ever reported it.
 *
 * Two corrections, both here so neither can be forgotten at a call site:
 *  - a cached body has a hard ceiling, and between freshness and that
 *    ceiling it is served MARKED stale rather than passed off as current;
 *  - health distinguishes 'starting' (no fetch yet — legitimate at boot,
 *    and answered 200 so the Railway healthcheck does not deadlock the
 *    deploy) from 'degraded' (was live, now stopped — answered 503).
 */
export function createFeedState(opts: FeedStateOptions = {}): FeedState {
  const maxFreshMs = opts.maxFreshMs ?? DEFAULT_MAX_FRESH_MS;
  const maxStaleMs = opts.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
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
      const age = now() - hit.storedAt;
      if (age > maxStaleMs) return null;
      return { body: hit.body, stale: age > maxFreshMs };
    },

    recordFailure(message) {
      lastError = message;
    },

    health() {
      if (lastSuccessAt === null) {
        return { status: 'starting', lastSuccessAt: null, feedAgeSeconds: null, lastError };
      }
      const ageMs = now() - lastSuccessAt;
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
Expected: PASS, 9 test

- [ ] **Step 5: Sostituire la cache artigianale in `server/index.ts`**

Rimuovere il blocco della cache in memoria (`const cache = new Map...`, `CACHE_TTL_MS`, `GLOBAL_KEY`, `bboxKey`) e sostituirlo con:

```ts
import { createFeedState } from './feedState.js';

const feed = createFeedState();
const GLOBAL_KEY = 'global';

function cacheKey(b: BoundingBox | null): string {
  if (b === null) return GLOBAL_KEY;
  return `${b.lamin}|${b.lomin}|${b.lamax}|${b.lomax}`;
}
```

- [ ] **Step 6: Estrarre il ciclo di aggiornamento e farlo girare da solo**

Aggiungere in `server/index.ts`, prima dei gestori:

```ts
/**
 * Fetches one global sweep and stores it.
 *
 * v1 only ever fetched inside the /api/states handler, so with no traffic
 * there was no feed at all — and with a Railway healthcheck gating traffic,
 * that would have been a deadlock. The server now feeds itself.
 */
async function refreshGlobalFeed(): Promise<void> {
  try {
    const result = await sources.fetchRegion(GLOBAL_SWEEP.centre, GLOBAL_SWEEP.radiusNm);
    feed.put(
      GLOBAL_KEY,
      JSON.stringify({
        fetchedAt: result.fetchedAt.toISOString(),
        source: result.sourceId,
        bbox: null,
        aircraft: result.aircraft,
      })
    );
    app.log.info({ source: result.sourceId, count: result.aircraft.length }, 'feed refreshed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    feed.recordFailure(msg);
    app.log.error({ err: msg }, 'every usable ADS-B source failed');
  }
}

const FEED_REFRESH_MS = 60_000;
```

- [ ] **Step 7: Sostituire il gestore `/api/states`**

```ts
app.get('/api/states', async (req, reply) => {
  const bbox = parseBbox(req.query as Record<string, string | undefined>);
  const key = cacheKey(bbox);

  const cached = feed.get(key);
  if (cached !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(cached.stale))
      .send(cached.body);
  }

  // Cache empty or past the stale ceiling: fetch synchronously this once.
  await refreshGlobalFeed();
  const afterFetch = feed.get(key);
  if (afterFetch !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('x-feed-stale', String(afterFetch.stale))
      .send(afterFetch.body);
  }

  // No stale fallback of unbounded age: that is what hid the v1 outage for
  // 25 days. Fail loudly instead.
  const health = feed.health();
  return reply.status(503).send({
    error: health.lastError ?? 'feed unavailable',
    status: health.status,
    feedAgeSeconds: health.feedAgeSeconds,
    lastSuccessAt: health.lastSuccessAt,
  });
});
```

- [ ] **Step 8: Sostituire il gestore `/health`**

```ts
app.get('/health', async (_req, reply) => {
  const health = feed.health();
  // 'starting' answers 200 on purpose: railway.toml gates the deploy on this
  // endpoint, and a 503 at boot would stall it forever. Only 'degraded' —
  // a feed that WAS live and has stopped — reports failure.
  const httpStatus = health.status === 'degraded' ? 503 : 200;
  return reply.status(httpStatus).send({
    status: health.status,
    uptime: process.uptime(),
    feedAgeSeconds: health.feedAgeSeconds,
    lastSuccessAt: health.lastSuccessAt,
    lastError: health.lastError,
  });
});
```

- [ ] **Step 9: Avviare il poller dopo il listen**

Nel blocco finale `try { await app.listen(...) }`, subito dopo la riga di log di avvio, aggiungere:

```ts
  // Warm the feed immediately, then keep it warm regardless of traffic.
  void refreshGlobalFeed();
  const feedTimer = setInterval(() => void refreshGlobalFeed(), FEED_REFRESH_MS);
  feedTimer.unref();
```

- [ ] **Step 10: Verificare entrambi i programmi**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 11: Verificare il comportamento reale del server**

```bash
npm run server
```

Subito, in un altro terminale (prima che il primo fetch sia completato):

```bash
curl -s -o /dev/null -w "health al boot: HTTP %{http_code}\n" localhost:3000/health
```

Expected: **HTTP 200** con `"status":"starting"`. Se qui vedi 503, il deploy su Railway fallirebbe: rileggi lo Step 8.

Dopo una decina di secondi:

```bash
curl -s localhost:3000/health | python3 -m json.tool
curl -s -D- -o /dev/null localhost:3000/api/states | grep -i "x-feed-stale\|HTTP"
```

Expected: `"status":"ok"` con `feedAgeSeconds` basso; `/api/states` risponde 200 con `x-feed-stale: false`. Nei log del server deve comparire `feed refreshed` **senza che nessuno abbia chiamato `/api/states`**: è la prova che il server si alimenta da solo.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "fix(server): self-feeding poller, bounded cache, non-blocking health

Three v1 defects meet here. The cache had no maximum age, so a frozen
snapshot was served for 25 days. /health answered ok unconditionally, so
Railway never noticed. And the server only ever fetched inside the
/api/states handler, so it had no feed of its own at all.

Now a background poller keeps the feed warm regardless of traffic; a
cached body is served marked stale past 90s and refused past 10 minutes;
and health distinguishes 'starting' (200 — a boot with no fetch yet, which
must not stall the Railway healthcheck) from 'degraded' (503 — a feed that
was live and has stopped).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Risoluzione rotte da adsbdb

**Files:**
- Create: `server/routeResolver.ts`
- Test: `tests/unit/server/routeResolver.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT` dal Task 1, importato come `'../src/data/sources/userAgent.js'`
- Produces: `createRouteResolver(opts?: RouteResolverOptions): RouteResolver`. `RouteResolver` espone `get(callsign: string): FlightRoute | null` (sincrono, solo cache), `enqueue(callsigns: string[]): void`, `pump(fetchImpl?: typeof fetch): Promise<number>`, `stats(): { resolved: number; unknown: number; queued: number }`. `FlightRoute = { callsignIcao, callsignIata, airlineName, originIata, originName, destinationIata, destinationName }`, tutti `string` tranne i nullable dichiarati nel codice. `RouteResolverOptions = { maxPerPump?: number }`.

**Due vincoli di realtà, entrambi verificati dal vivo.**

Il primo: adsbdb risponde **HTTP 404** per un callsign che non conosce, con corpo `{"response":"unknown callsign"}`. Un `if (!res.ok) throw` prima di leggere il corpo renderebbe irraggiungibile il ramo "sconosciuto": ogni callsign privato o militare — il 27% del feed — verrebbe trattato come errore di trasporto e ri-accodato per sempre.

Il secondo: uno snapshot globale contiene **8 466 callsign distinti parsabili**. Con `pump()` legato al ciclo di richiesta (20 lookup ogni 90 s = 0,22/s) il primo riempimento richiederebbe **10,7 ore**. Il pump gira quindi su un timer proprio, a cadenza costante. A 5 lookup/s il primo riempimento richiede circa **28 minuti**, e da lì in poi è incrementale: solo i callsign nuovi entrano in coda.

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

// Verified live: api.adsbdb.com answers 404 — NOT 200 — for an unknown
// callsign. The first draft of this plan mocked {ok:true,status:200} and
// would have gone green while production did the opposite.
const adsbdbUnknown = {
  ok: false,
  status: 404,
  json: async () => ({ response: 'unknown callsign' }),
};

describe('createRouteResolver', () => {
  it('returns null before anything has been resolved', () => {
    expect(createRouteResolver().get('BAW274')).toBeNull();
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

  it('treats HTTP 404 as a VERDICT, not a transport error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbUnknown);
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('NJE004M')).toBeNull();
    expect(r.stats().unknown).toBe(1);

    r.enqueue(['NJE004M']); // already judged unknown
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never asked twice
  });

  it('caps the number of lookups per pump', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('AAA', 'BBB'));
    const r = createRouteResolver({ maxPerPump: 2 });
    r.enqueue(['AAA111', 'BBB222', 'CCC333', 'DDD444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.stats().queued).toBe(2);
  });

  it('does not enqueue a callsign it already resolved', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    r.enqueue(['BAW274']);
    expect(r.stats().queued).toBe(0);
  });

  it('re-queues after a real transport error — 500 is not a verdict', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await expect(r.pump(fetchImpl as unknown as typeof fetch)).resolves.toBe(0);
    expect(r.get('BAW274')).toBeNull();
    expect(r.stats().unknown).toBe(0);
    expect(r.stats().queued).toBe(1); // back in line, will be retried
  });

  it('normalises the callsign to uppercase and trims it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue([' baw274 ']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.adsbdb.com/v0/callsign/BAW274');
    expect(r.get('baw274')).not.toBeNull();
  });

  it('ignores a resolved route missing an airport code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: { flightroute: { callsign: 'XXX1', origin: {}, destination: {} } } }),
    });
    const r = createRouteResolver({ maxPerPump: 10 });
    r.enqueue(['XXX1']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('XXX1')).toBeNull();
    expect(r.stats().unknown).toBe(1);
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
  originIata: string;
  originName: string;
  destinationIata: string;
  destinationName: string;
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

const DEFAULT_MAX_PER_PUMP = 10;

/**
 * Resolves callsigns to real origin/destination pairs via adsbdb.
 *
 * Deliberately asynchronous with respect to the API response: a global
 * snapshot holds ~8 500 distinct parseable callsigns, and resolving them
 * inside a request would mean thousands of calls to a free service. get()
 * answers from cache only; unknown callsigns are queued and pumped at a
 * steady rate by a timer the server owns. Callsigns repeat heavily between
 * cycles — aircraft stay airborne for hours — so after the first fill only
 * new ones enter the queue.
 *
 * Replaces v1's routeLookup, which ignored the flight number and returned
 * the airline's alphabetically first route: every BA flight showed
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

  /** @returns true if a route was stored. Throws only on transport failure. */
  async function lookup(cs: string, fetchImpl: typeof fetch): Promise<boolean> {
    const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });

    // Verified live: adsbdb answers 404 with {"response":"unknown callsign"}
    // for private, business and military callsigns — roughly 27% of the feed.
    // That is a verdict about the callsign, not a failure of the request.
    if (res.status === 404) {
      unknown.add(cs);
      return false;
    }
    if (!res.ok) throw new Error(`adsbdb: HTTP ${res.status}`);

    const data = (await res.json()) as AdsbdbResponse;
    const fr = typeof data.response === 'object' ? data.response?.flightroute : undefined;
    const originIata = fr?.origin?.iata_code;
    const originName = fr?.origin?.name;
    const destinationIata = fr?.destination?.iata_code;
    const destinationName = fr?.destination?.name;

    if (!fr || !originIata || !originName || !destinationIata || !destinationName) {
      unknown.add(cs); // answered, but not with a usable route
      return false;
    }

    resolved.set(cs, {
      callsignIcao: fr.callsign ?? cs,
      callsignIata: fr.callsign_iata ?? null,
      airlineName: fr.airline?.name ?? null,
      originIata,
      originName,
      destinationIata,
      destinationName,
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
          // Transport failure is not a verdict on the callsign: put it back
          // so a later cycle retries it.
          queue.push(cs);
          queued.add(cs);
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
Expected: PASS, 9 test

- [ ] **Step 5: Verificare contro adsbdb reale, senza mock**

```bash
npx tsx -e "
import { createRouteResolver } from './server/routeResolver.ts';
const r = createRouteResolver({ maxPerPump: 5 });
r.enqueue(['BAW274', 'RYR1234', 'UAE2', 'NJE004M', 'MORPH16']);
await r.pump();
console.log('stats:', r.stats());
console.log('BAW274:', r.get('BAW274'));
console.log('NJE004M (atteso null, unknown):', r.get('NJE004M'));
"
```

Expected: `resolved: 3, unknown: 2, queued: 0`; `BAW274` con origine e destinazione reali; `NJE004M` null e contato fra gli unknown — non ri-accodato. Se `unknown` è 0 e `queued` è 2, il ramo 404 non funziona: rileggi lo Step 3.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): resolve real routes from adsbdb

v1's routeLookup ignored the flight number and returned the airline's
first route alphabetically: every BA flight claimed Aalborg -> Aarhus,
and 49% of aircraft showed a fabricated origin and destination.

Answers from cache only and fills that cache at a steady rate, so ~8 500
distinct callsigns never become thousands of in-request calls to a free
service. HTTP 404 is treated as a verdict ('unknown callsign', ~27% of
the feed: private, business and military) rather than a transport error,
so those are recorded once instead of being retried forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Arricchire `/api/states` con rotta e completezza

**Files:**
- Create: `src/data/completeness.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/data/completeness.test.ts`

**Interfaces:**
- Consumes: `RouteResolver` dal Task 5, `FlightRouteLite` e `makeAircraftRaw` dal Task 1
- Produces: `isComplete(ac: AircraftRaw): boolean`

`AircraftRaw` non cambia in questo task: `route` esiste già dal Task 1. Qui viene soltanto popolato.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/data/completeness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isComplete } from '@/data/completeness';
import { makeAircraftRaw } from '../../helpers/aircraft';

const ROUTE = {
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

const complete = (over = {}) => makeAircraftRaw({ route: ROUTE, ...over });

describe('isComplete', () => {
  it('accepts an aircraft with a real route and every technical field', () => {
    expect(isComplete(complete())).toBe(true);
  });

  it('rejects an aircraft without a route — this is the grey population', () => {
    expect(isComplete(complete({ route: null }))).toBe(false);
  });

  it('rejects a missing callsign', () => {
    expect(isComplete(complete({ callsign: null }))).toBe(false);
  });

  it('rejects a missing registration', () => {
    expect(isComplete(complete({ registration: null }))).toBe(false);
  });

  it('rejects a missing model code', () => {
    expect(isComplete(complete({ modelCode: null }))).toBe(false);
  });

  it('rejects a missing ground speed', () => {
    expect(isComplete(complete({ velocityKt: null }))).toBe(false);
  });

  it('rejects a missing track', () => {
    expect(isComplete(complete({ headingDeg: null }))).toBe(false);
  });

  it('rejects a missing position', () => {
    expect(isComplete(complete({ latitude: null }))).toBe(false);
  });

  it('rejects a missing altitude while airborne', () => {
    expect(isComplete(complete({ baroAltitudeFt: null }))).toBe(false);
  });

  it('accepts a null altitude when the aircraft is on the ground', () => {
    expect(isComplete(complete({ onGround: true, baroAltitudeFt: null }))).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 3: Creare `src/data/completeness.ts`**

Import relativo con `.js`: questo modulo verrà usato anche dal server.

```ts
import type { AircraftRaw } from '../types.js';

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

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: PASS, 10 test

- [ ] **Step 5: Collegare il resolver nel ciclo di aggiornamento**

In `server/index.ts` aggiungere agli import:

```ts
import { createRouteResolver } from './routeResolver.js';
import type { FlightRouteLite } from '../src/types.js';

const routes = createRouteResolver();
const ROUTE_PUMP_MS = 2_000; // 5 lookups/s with the default maxPerPump of 10
```

In `refreshGlobalFeed`, fra l'ottenimento di `result` e la scrittura in cache, arricchire e accodare:

```ts
    const callsigns: string[] = [];
    for (const ac of result.aircraft) {
      if (ac.callsign === null) continue;
      callsigns.push(ac.callsign);
      const r = routes.get(ac.callsign);
      if (r) {
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
```

- [ ] **Step 6: Avviare il pump su un timer proprio**

Accanto al timer del feed, dopo `app.listen`:

```ts
  const routeTimer = setInterval(() => void routes.pump(), ROUTE_PUMP_MS);
  routeTimer.unref();
```

Il pump **non** va agganciato al ciclo di richiesta: legato al cache miss darebbe 0,22 lookup/s e 10,7 ore di primo riempimento. Su timer proprio dà 5/s e circa 28 minuti, poi solo incrementi.

- [ ] **Step 7: Esporre le statistiche del resolver su `/health`**

Nel corpo della risposta di `/health` aggiungere:

```ts
    routes: routes.stats(),
```

- [ ] **Step 8: Verificare entrambi i programmi**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 9: Osservare la convergenza reale**

```bash
npm run server
```

Attendere qualche minuto senza chiamare nulla, poi:

```bash
curl -s localhost:3000/health | python3 -m json.tool
```

Expected: `routes.resolved` cresce di circa 300 al minuto senza alcun traffico; `routes.unknown` cresce anch'esso (i callsign privati e militari); `routes.queued` sale al primo ciclo di feed e poi scende. Verificare che almeno un aereo della risposta abbia `route` non nullo, con origine e destinazione plausibili per il suo callsign.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(server): attach real routes and a completeness rule

/api/states now carries a route object populated from adsbdb, and
isComplete() defines the blue/grey split the v2 filter is built on:
a real origin and destination plus every technical field.

The route pump runs on its own timer rather than on cache misses. Tied to
the request cycle it would have managed 0.22 lookups/s — 10.7 hours to
fill a cache of ~8 500 distinct callsigns. On its own timer it does 5/s.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rimuovere il lookup rotte falso

Separato dal Task 6 perché un revisore potrebbe accettare le rotte vere e volere una discussione a parte sulla rimozione di 4,2 MB di dati statici.

**Files:**
- Delete: `src/data/routeLookup.ts`, `public/data/openflights-routes.json`
- Modify: `src/data/resolveFlight.ts`, `tests/unit/data/resolveFlight.test.ts`
- Modify: `tests/unit/data/lookups.test.ts`, `src/data/bootstrap.ts`, `scripts/build-static-data.mjs`
- Modify: `src/types.ts` (rimuove `Route`)

**Interfaces:**
- Consumes: `FlightRouteLite` dal Task 1, `makeAircraftRaw` dal Task 1
- Produces: `resolveFlight(ac: AircraftRaw): ResolvedFlight | null` — prende l'aereo, non il solo callsign, perché la rotta arriva dal server dentro l'aereo.

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
 * table, which was queried in a way that fabricated origins.
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

- [ ] **Step 2: Sostituire integralmente `tests/unit/data/resolveFlight.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFlight } from '@/data/resolveFlight';
import { initAirlines } from '@/data/airlineLookup';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../../helpers/aircraft';

const ROUTE = {
  originIata: 'LHR',
  originName: 'London Heathrow Airport',
  destinationIata: 'JFK',
  destinationName: 'John F Kennedy International Airport',
  airlineName: 'British Airways',
};

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

describe('resolveFlight', () => {
  it('resolves BAW274 to British Airways with the route the server supplied', () => {
    const r = resolveFlight(makeAircraftRaw({ route: ROUTE }));
    expect(r?.airlineIcao).toBe('BAW');
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.flightNumber).toBe('274');
    expect(r?.origin?.iata).toBe('LHR');
    expect(r?.destination?.iata).toBe('JFK');
  });

  it('returns null origin and destination when the server knows no route', () => {
    const r = resolveFlight(makeAircraftRaw({ route: null }));
    expect(r?.airlineName).toBe('British Airways');
    expect(r?.origin).toBeNull();
    expect(r?.destination).toBeNull();
  });

  it('returns null for an unparseable callsign', () => {
    expect(resolveFlight(makeAircraftRaw({ callsign: 'N12345' }))).toBeNull();
  });

  it('returns null for a null callsign', () => {
    expect(resolveFlight(makeAircraftRaw({ callsign: null }))).toBeNull();
  });

  it('falls back to the route airline name when the ICAO code is unknown locally', () => {
    const r = resolveFlight(makeAircraftRaw({ callsign: 'QQQ100', route: ROUTE }));
    expect(r?.airlineName).toBe('British Airways');
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/unit/data/resolveFlight.test.ts`
Expected: FAIL — `resolveFlight` ha ancora la vecchia firma

- [ ] **Step 4: Aggiornare `src/data/bootstrap.ts`**

Rimuovere `import { loadRoutesFromBundle } from './routeLookup';` e togliere `loadRoutesFromBundle(),` dalla `Promise.allSettled`. Nel callback `onBatch`, sostituire `const resolved = resolveFlight(r.callsign);` con `const resolved = resolveFlight(r);`.

- [ ] **Step 5: Rimuovere modulo, dati e tipo obsoleti**

```bash
git rm src/data/routeLookup.ts public/data/openflights-routes.json
```

In `src/types.ts`, rimuovere `export interface Route { ... }`.

In `tests/unit/data/lookups.test.ts`, rimuovere l'import di `@/data/routeLookup` e ogni blocco che lo esercita, lasciando intatti i test di `airlineLookup` e `airportLookup`.

In `scripts/build-static-data.mjs`, rimuovere il blocco che genera `openflights-routes.json`. Individuarlo con `grep -n "routes" scripts/build-static-data.mjs`.

- [ ] **Step 6: Verificare che non restino riferimenti**

```bash
grep -rn "routeLookup\|openflights-routes\|initRoutes\|Route\b" src/ server/ tests/ scripts/ | grep -v "FlightRoute\|flightroute" || echo "nessun riferimento residuo"
npm run build:all && npm test -- --run
```

Expected: nessun riferimento residuo, build pulita, test verdi

- [ ] **Step 7: Commit**

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
- Modify: `src/state/aircraftStore.ts`, `src/data/bootstrap.ts`, `src/data/aircraftStream.ts`
- Rename: `src/data/openSkyClient.ts` → `src/data/statesClient.ts` (e il suo test)
- Modify: `tests/unit/state/stores.test.ts`, `tests/unit/data/aircraftStream.test.ts`

**Interfaces:**
- Consumes: `makeAircraftRaw` dal Task 1
- Produces: `useAircraftStore` guadagna `feedFetchedAt: number` (sostituisce `fetchedAt`) e `feedAgeSeconds(): number`; `updateBatch(raws, batchFetchedAtUnix)` prende due argomenti; `removeStale(batchFetchedAtUnix)` cambia semantica; `StreamOptions.onBatch(aircraft, fetchedAt)` prende due argomenti; `fetchStates` si sposta in `src/data/statesClient.ts` con la stessa firma.

**Tre file importano ciò che questo task rinomina.** Il `git mv` rompe `src/data/aircraftStream.ts`, `tests/unit/data/statesClient.test.ts` **e** `tests/unit/data/aircraftStream.test.ts`, che fa `spyOn` sul modulo. Dimenticare il terzo impedisce alla suite di caricarsi.

- [ ] **Step 1: Sostituire il blocco `describe('aircraftStore')` in `tests/unit/state/stores.test.ts`**

Sostituire l'intero blocco `describe('aircraftStore', ...)` esistente con il seguente, lasciando invariati gli altri `describe` del file e gli import già presenti in cima, ai quali va aggiunto soltanto:

```ts
import { makeAircraftRaw } from '../../helpers/aircraft';
```

```ts
describe('aircraftStore', () => {
  beforeEach(() =>
    useAircraftStore.setState({ aircraft: new Map(), feedFetchedAt: 0, fetchStatus: 'idle' })
  );

  it('updateBatch replaces aircraft by icao24', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274', lastContact: 1 })], 1);
    expect(useAircraftStore.getState().aircraft.size).toBe(1);
    expect(useAircraftStore.getState().aircraft.get('a1')?.callsign).toBe('BAW274');
  });

  it('updateBatch preserves trail history when updating existing aircraft', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 0, latitude: 0, lastContact: 1 })], 1);
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 1, latitude: 1, lastContact: 2 })], 2);
    expect(useAircraftStore.getState().aircraft.get('a1')?.trail.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps every aircraft of a batch even when the batch itself is old', () => {
    // The v1 bug: a frozen feed made now - lastContact enormous for ALL
    // aircraft, so removeStale deleted the entire fleet and the globe emptied.
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'b', lastContact: batchAt - 10 })],
      batchAt
    );
    store.removeStale(batchAt);
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('drops only aircraft stale relative to their own batch', () => {
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'fresh', lastContact: batchAt }), makeAircraftRaw({ icao24: 'old', lastContact: batchAt - 600 })],
      batchAt
    );
    store.removeStale(batchAt);
    const ids = [...useAircraftStore.getState().aircraft.keys()];
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('old');
  });

  it('reports the feed age from the batch timestamp', () => {
    const store = useAircraftStore.getState();
    const batchAt = Math.floor(Date.now() / 1000) - 45;
    store.updateBatch([makeAircraftRaw({ icao24: 'a', lastContact: batchAt })], batchAt);
    expect(useAircraftStore.getState().feedAgeSeconds()).toBeGreaterThanOrEqual(45);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/state/stores.test.ts`
Expected: FAIL — `updateBatch` accetta un solo argomento, `feedFetchedAt` e `feedAgeSeconds` non esistono

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

- [ ] **Step 5: Rinominare il client — TRE file da aggiornare**

```bash
git mv src/data/openSkyClient.ts src/data/statesClient.ts
git mv tests/unit/data/openSkyClient.test.ts tests/unit/data/statesClient.test.ts
```

Il nome mentiva: il modulo parla con il nostro proxy, non con OpenSky. Aggiornare l'import in tutti e tre i file che lo referenziano:

- `src/data/aircraftStream.ts`: `'./openSkyClient'` → `'./statesClient'`
- `tests/unit/data/statesClient.test.ts`: `'@/data/openSkyClient'` → `'@/data/statesClient'`
- `tests/unit/data/aircraftStream.test.ts`: `'@/data/openSkyClient'` → `'@/data/statesClient'`

Verificare che non ne restino:

```bash
grep -rn "openSkyClient" src/ tests/ || echo "nessun riferimento residuo"
```

- [ ] **Step 6: Portare il timestamp del batch attraverso lo stream**

In `src/data/aircraftStream.ts`, cambiare la firma in `StreamOptions`:

```ts
  onBatch: (aircraft: AircraftRaw[], fetchedAt: Date) => void;
```

e in `tick`, sostituire `opts.onBatch(result.aircraft);` con `opts.onBatch(result.aircraft, result.fetchedAt);`.

- [ ] **Step 7: Adeguare l'asserzione di `aircraftStream.test.ts` al secondo argomento**

Nel test `calls fetchStates immediately on start`, `toHaveBeenCalledWith` verifica la lista **completa** degli argomenti e fallirebbe ora che sono due. Sostituire quell'asserzione con:

```ts
    expect(onBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ icao24: 'a1' })]),
      expect.any(Date)
    );
```

- [ ] **Step 8: Aggiornare `src/data/bootstrap.ts`**

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

- [ ] **Step 9: Verificare entrambi i programmi e l'intera suite**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, tutti i test verdi. Se la suite non si carica affatto, un import di `openSkyClient` è sopravvissuto: rileggi lo Step 5.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "fix(state): stop deleting the fleet when the feed stops

removeStale compared lastContact against the local clock, so a frozen
feed made every aircraft infinitely stale and the entire fleet was
dropped — the last link in the chain that emptied the globe. Staleness
is now measured against the batch that carried the aircraft.

Renames openSkyClient to statesClient: it talks to our own proxy, not to
OpenSky, and has since the adsb.lol switch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verifica end-to-end contro le API reali

Nessun mock. Prova che la catena funzioni contro il mondo, non contro i nostri doppi di test.

**Files:**
- Create: `scripts/verify-feed.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: il server in esecuzione
- Produces: `npm run verify:feed`, riusabile in locale e contro la produzione

- [ ] **Step 1: Creare `scripts/verify-feed.mjs`**

```js
#!/usr/bin/env node
// Verifies the full data chain against the real upstream APIs.
// Usage: npm run server   (in another terminal)   then: npm run verify:feed
// Against production: BASE_URL=https://... npm run verify:feed

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`ok    ${msg}`);
}

const healthRes = await fetch(`${BASE}/health`);
const health = await healthRes.json();
console.log('health:', JSON.stringify(health));
if (healthRes.status !== 200) fail(`/health returned HTTP ${healthRes.status} (status: ${health.status})`);
else pass(`/health 200, status ${health.status}`);

const res = await fetch(`${BASE}/api/states`);
if (!res.ok) {
  fail(`/api/states returned HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const ac = data.aircraft ?? [];

pass(`source: ${data.source}`);
pass(`aircraft: ${ac.length}`);
console.log(`x-feed-stale: ${res.headers.get('x-feed-stale')}`);

if (ac.length < 1000) fail(`expected thousands of aircraft, got ${ac.length}`);

const ageS = (Date.now() - new Date(data.fetchedAt).getTime()) / 1000;
if (ageS > 300) fail(`fetchedAt is ${Math.round(ageS)}s old — the feed is not live`);
else pass(`feed age: ${Math.round(ageS)}s`);

// A timestamp far in the past or future means a seconds/milliseconds mixup
// in an adapter — the kind of bug unit tests with hand-made mocks miss.
if (ageS < -60 || ageS > 86_400) fail(`fetchedAt is implausible (${Math.round(ageS)}s) — check the epoch units in the source adapter`);

const withReg = ac.filter((a) => a.registration).length;
const withModel = ac.filter((a) => a.modelCode).length;
pass(`registration: ${(100 * withReg / ac.length).toFixed(1)}%`);
pass(`model: ${(100 * withModel / ac.length).toFixed(1)}%`);
if (withReg / ac.length < 0.8) fail('registration coverage below 80% — the adapter may be dropping it');

const withRoute = ac.filter((a) => a.route).length;
console.log(`route: ${withRoute} of ${ac.length} (${(100 * withRoute / ac.length).toFixed(1)}%) — grows as the resolver cache fills`);
if (health.routes) console.log(`resolver: ${JSON.stringify(health.routes)}`);

// The v1 bug, asserted directly: no cluster of flights may share one route.
const counts = new Map();
for (const a of ac) {
  if (!a.route) continue;
  const k = `${a.route.originIata}->${a.route.destinationIata}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
const worst = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
if (worst && worst[1] > 30) fail(`${worst[1]} aircraft share the route ${worst[0]} — a fabricated route may be back`);
else if (worst) pass(`most common route ${worst[0]} appears ${worst[1]}x — no fabricated cluster`);

console.log(process.exitCode ? '\nVERIFICATION FAILED' : '\nVERIFICATION PASSED');
```

- [ ] **Step 2: Aggiungere lo script a `package.json`**

Nel blocco `"scripts"`, aggiungere:

```json
    "verify:feed": "node scripts/verify-feed.mjs",
```

- [ ] **Step 3: Eseguire la verifica in locale**

```bash
npm run server
```

In un altro terminale, attendere che il poller abbia completato almeno un ciclo, poi:

```bash
npm run verify:feed
```

Expected: `VERIFICATION PASSED`, migliaia di aerei, età del feed plausibile, copertura registrazione sopra l'80%, nessun gruppo di rotte sospetto. Ripetendo dopo qualche minuto, la percentuale `route` deve essere cresciuta.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add end-to-end feed verification script

Checks the full chain against the real upstream APIs rather than test
doubles: health status code, live feed age, epoch-unit plausibility,
adapter field coverage, and an explicit assertion that no cluster of
flights shares one route — the shape of the v1 fabrication.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Consegna — NON eseguire il deploy**

Il branch `v2-design` è pronto. **Fermarsi qui.** Il merge su `main` e il push sono una decisione dell'utente, non dell'esecutore del piano: `main` è collegato all'auto-deploy di Railway e pubblicare è un'azione verso l'esterno.

Riferire all'utente: quali task sono stati completati, l'esito di `npm run verify:feed` in locale, e che il deploy attende la sua parola. Quando deciderà di procedere, il comando di verifica post-deploy è:

```bash
BASE_URL=https://air-view-production.up.railway.app npm run verify:feed
```

---

## Difetti corretti rispetto alla prima stesura

La prima stesura di questo piano è stata respinta da un preflight a quattro lenti indipendenti: 16 finding critici, 17 major, 9 minori. Le correzioni, con l'evidenza che le ha imposte:

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 1 | `/health` rispondeva 503 al boot, ma `railway.toml` usa `/health` come healthcheck e nulla scaldava il feed senza traffico: **stallo di deploy**, il piano avrebbe impedito la riparazione che si proponeva di fare | `railway.toml` con `healthcheckPath=/health`, `ON_FAILURE`, 10 retry; nessun fetch schedulato in `server/index.ts` | Tre stati (`starting`/`ok`/`degraded`), 200 tranne `degraded`; più un poller che alimenta il server da solo (Task 4) |
| 2 | I moduli in `src/data/sources/` usavano `@/` e import senza `.js`, ma vengono compilati da `tsconfig.server.json` sotto NodeNext: `build:server` fallisce e il JS emesso non si risolve a runtime | `npx tsc -p tsconfig.server.json` → `TS2307` e `TS2835`; baseline del repo pulita | Import relativi con `.js` ovunque; regola chiarita nelle Global Constraints; `build:all` già dal Task 1 (Task 1) |
| 3 | adsb.fi veniva chiamato a 10 000 NM, che rifiuta: il fallback era **codice morto** e l'intera tesi di resilienza non esisteva | `dist=250` → 200; `dist=1000` → 400; `dist=5000/10000` → 429 | `maxRadiusNm` nell'interfaccia e selettore che salta la sorgente; la resilienza del Piano 1 viene dalla cache stantia **limitata e dichiarata** (Task 2, 3, 4) |
| 4 | Campi obbligatori aggiunti a `AircraftRaw` in due task diversi senza aggiornare i literal nei test: `tsc --noEmit` falliva subito, e lo step dichiarava "build senza errori" | `npx tsc --noEmit` → 5 × `TS2739` | Tutti i campi nuovi introdotti **una volta sola** nel Task 1, più l'helper condiviso `tests/helpers/aircraft.ts` |
| 5 | adsbdb risponde **404** per callsign sconosciuto, non 200: il ramo `unknown` era irraggiungibile e il mock del test asseriva una risposta che l'API non produce — la suite sarebbe passata verde mentre la produzione faceva l'opposto | `NJE004M` → HTTP 404 `{"response":"unknown callsign"}`; `BAW274` → 200 | 404 trattato come verdetto; mock corretto a `{ok:false,status:404}`; test aggiuntivo che distingue 404 da 500 (Task 5) |
| 6 | La cache rotte "converge in pochi minuti": falso di due ordini di grandezza | 8 466 callsign distinti per snapshot; pump legato al cache miss = 0,22 lookup/s = **10,7 ore** | Pump su timer proprio a 5 lookup/s ≈ 28 minuti, poi incrementale; numeri dichiarati nel piano (Task 5, 6) |
| 7 | Il Task 8 rinominava `openSkyClient` aggiornando due file su tre, e cambiava la firma di `onBatch` senza adeguare l'asserzione del test esistente | `tests/unit/data/aircraftStream.test.ts:3` importa il modulo per lo `spyOn` | Tutti e tre i file elencati, più lo step che adegua `toHaveBeenCalledWith` al secondo argomento (Task 8) |
| 8 | Il Task 9 ordinava merge su `main` e `push`: un esecutore fedele avrebbe pubblicato in produzione senza autorizzazione, per giunta con un build che non compilava | Regola operativa del progetto; Task 9 Step 5 della prima stesura | Lo step di deploy è sostituito da una consegna esplicita all'utente (Task 9) |

## Cosa resta fuori da questo piano

- **Piano 2 — densità e movimento**: tile cache a 10°, doppia cadenza (sweep globale magro + celle in vista), dead reckoning con tetto temporale, raggio in pixel-schermo, ordine di disegno gerarchico. È qui che adsb.fi entra davvero in servizio, perché i raggi camera-driven stanno sotto il suo tetto di 250 NM.
- **Piano 3 — interazione e visivo**: pannello con conteggi e checkbox, focus con geodetica e marker D/A, ricerca per numero di volo, palette caldo/grigio/blu. Include anche la **superficie visibile** del presidio §3.4 punto 3: il Task 8 espone `feedAgeSeconds()` nello store ma nessun componente lo mostra ancora, perché la UI del pannello nasce lì. Fino ad allora il feed fermo è visibile su `/health` e nel 503 di `/api/states`, non nell'interfaccia.

Il Piano 1 lascia il sito funzionante e onesto: feed vivo che si alimenta da solo, rotte vere, guasti visibili. I piani 2 e 3 lo rendono anche bello e leggibile.
