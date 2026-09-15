# Air View v2 — Piano 1: livello dati

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rimettere in produzione un feed vivo, con origini e destinazioni vere, e rendere un guasto futuro **diagnosticabile in un colpo d'occhio** invece che invisibile per mesi.

Una precisazione che una revisione ha imposto: l'healthcheck di `railway.toml` è un cancello di *deploy*, non un monitor continuo. Nulla in questo piano interroga `/health` mentre il servizio gira, quindi il Piano 1 non promette un allarme automatico: elimina il fallimento silenzioso — niente più dati vecchi spacciati per freschi — e mette lo stato a disposizione di chiunque guardi. Un vero watcher (cron esterno o servizio Railway che interroga `/health` e avvisa sul 503) resta da aggiungere, e vale la pena farlo dopo il primo deploy riuscito.

**Architecture:** Gli adattatori per fornitore normalizzano verso un tipo comune e un selettore con circuit breaker li mette in cascata, saltando le sorgenti che non reggono il raggio richiesto. Il server si alimenta da solo con un poller di background invece di dipendere dalle richieste utente, impone un'età massima alla cache, e distingue "non ho ancora iniziato" da "ero vivo e sono morto". Le rotte vere vengono da adsbdb attraverso una cache costruita offline e caricata all'avvio, perché il servizio rate-limita duramente; a runtime il resolver assorbe solo i callsign nuovi, lentamente, e sospende tutto su 429. Il client smette di cancellare la flotta quando il feed è fermo.

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
  complete: boolean;                  // computed server-side by isComplete(); false from adapters
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
    complete: false,
    ...overrides,
  };
}
```

- [ ] **Step 3: Riparare TUTTI i literal `AircraftRaw`, non solo quelli nei test**

I nuovi campi obbligatori rompono ogni literal esistente. Cercare in `src/` **e** in `tests/`, non solo nei test:

```bash
grep -rn "icao24:" src/ tests/
```

Sono sei, non cinque: cinque nei test e **uno in `src/data/adsbSource.ts:75`**, il modulo che questo task sostituisce. Quest'ultimo non va riparato ma rimosso subito, prima di qualunque verifica — altrimenti `tsc --noEmit` fallisce per un file destinato a sparire:

```bash
git rm src/data/adsbSource.ts tests/unit/data/adsbSource.test.ts
```

In `server/index.ts`, sostituire contestualmente l'import
`import { fetchAdsbStates } from '../src/data/adsbSource.js';`
con
`import { adsbLolSource } from '../src/data/sources/adsbLol.js';`
e la chiamata
`const result = await fetchAdsbStates(bbox);`
con
`const result = await adsbLolSource.fetchRegion({ lat: 0, lon: 0 }, 10_000);`

(il modulo `adsbLol.ts` viene creato allo Step 9; fino ad allora `build:all` segnalerà l'import non risolto, il che è atteso e si risolve da sé).

In `tests/unit/state/stores.test.ts` e `tests/unit/data/aircraftStream.test.ts`, sostituire ogni literal `AircraftRaw` con una chiamata a `makeAircraftRaw({ ... })` passando solo i campi che quel test controlla davvero, e aggiungere in cima a **ciascuno dei due file**:

```ts
import { makeAircraftRaw } from '../../helpers/aircraft';
```

(adeguare la profondità del percorso relativo al file). Il Task 8 tornerà su `stores.test.ts` ma **non** ri-aggiungerà questo import: è già qui.

Verificare con:

```bash
npx tsc --noEmit
```

Expected: nessun errore `TS2739`. Se ne resta uno in `src/data/adsbSource.ts`, il `git rm` di questo step non è stato eseguito.

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
    complete: false, // computed server-side once the route is attached
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

- [ ] **Step 11: Verificare ENTRAMBI i programmi TypeScript**

Il vecchio modulo e la sua sostituzione nel server sono già stati gestiti allo Step 3. Il parametro `bbox` del gestore resta ignorato: il fetch camera-driven arriva nel Piano 2.

```bash
npm run build:all && npm test -- --run
```

Expected: `tsc --noEmit` pulito, `vite build` pulito, **`tsc -p tsconfig.server.json` pulito**, tutti i test verdi.

`npm run build:all` e non `npm run build`: il secondo non type-checka il server, e nella prima stesura di questo piano ha nascosto un errore di import fino a quattro task più avanti. Se `build:server` fallisce con `TS2307` (`Cannot find module '@/types'`) o `TS2835` (estensione mancante), l'errore è negli import dei nuovi moduli: rileggere le Global Constraints.

- [ ] **Step 12: Commit**

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
    complete: false,
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

  it('keeps reporting the real cause while the breaker is open', async () => {
    // On the tick after a failure the source is skipped by its own breaker.
    // Without carrying the reason forward the caller would be told
    // "all sources are in cooldown" instead of the actual 403.
    const a = fakeSource('a', 10_000, async () => { throw new Error('adsb-lol: HTTP 403'); });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
    clock += 1000; // breaker still open
    await expect(selector.fetchRegion({ lat: 0, lon: 0 }, 10)).rejects.toThrow(/403/);
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
  const lastError = new Map<string, string>();

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
        const until = openUntil.get(source.id) ?? 0;
        if (until > t) {
          // Carry the reason forward: otherwise, on the tick after a failure,
          // every source is skipped by its breaker, `errors` is empty, and the
          // caller is told "all sources are in cooldown" instead of the actual
          // upstream error — the one thing an operator needs to see.
          errors.push(`${source.id}: in cooldown after ${lastError.get(source.id) ?? 'unknown error'}`);
          continue;
        }

        try {
          const result = await source.fetchRegion(centre, radiusNm, fetchImpl);
          openUntil.delete(source.id); // success closes the breaker
          lastError.delete(source.id);
          return { ...result, sourceId: source.id };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          openUntil.set(source.id, now() + cooldownMs);
          lastError.set(source.id, msg);
          errors.push(msg);
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
- Produces: `createFeedState(opts?: FeedStateOptions): FeedState`. `FeedState` espone `put(key: string, body: string): void`, `get(key: string): { body: string; stale: boolean } | null`, `recordFailure(message: string): void`, `health(): FeedHealth`. `FeedHealth = { status: 'starting' | 'ok' | 'degraded'; lastSuccessAt: string | null; feedAgeSeconds: number | null; lastError: string | null }`. `FeedStateOptions = { maxFreshMs?: number; maxStaleMs?: number; degradedAfterMs?: number; startupGraceMs?: number; now?: () => number }`.

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

  it('stays starting during the grace window even after failures', () => {
    let clock = 1_000_000;
    const s = createFeedState({ startupGraceMs: 180_000, now: () => clock });
    s.recordFailure('adsb-lol: HTTP 403');
    clock += 60_000;
    expect(s.health().status).toBe('starting');
    expect(s.health().lastError).toMatch(/403/);
  });

  it('gives up on starting once the grace window expires — otherwise a boot-time outage hides forever', () => {
    // Without this, the exact 2026-08-20 scenario (adsb.lol 403 from the
    // first second) would leave /health answering 200 indefinitely: the
    // very blindness this plan exists to remove.
    let clock = 1_000_000;
    const s = createFeedState({ startupGraceMs: 180_000, now: () => clock });
    s.recordFailure('adsb-lol: HTTP 403');
    clock += 181_000;
    expect(s.health().status).toBe('degraded');
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
  /** How long 'starting' is tolerated before a feed that never came up is called degraded. */
  startupGraceMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_FRESH_MS = 90_000;
const DEFAULT_MAX_STALE_MS = 600_000;
const DEFAULT_DEGRADED_AFTER_MS = 300_000;
// Well beyond railway.toml's healthcheckTimeout of 100s, so the deploy has
// room to come up, but finite: a feed that never starts must not hide.
const DEFAULT_STARTUP_GRACE_MS = 180_000;

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
  const startupGraceMs = opts.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();

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
        // 'starting' is a grace period, not a permanent excuse: a feed that
        // never comes up must eventually report failure, or a boot-time
        // outage stays invisible exactly as it did for 25 days in v1.
        const status: FeedStatus = now() - startedAt > startupGraceMs ? 'degraded' : 'starting';
        return { status, lastSuccessAt: null, feedAgeSeconds: null, lastError };
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
```

**Non** derivare la chiave dal bbox. Il Piano 1 serve un solo sweep globale e l'unico scrittore della cache è il poller, che scrive sotto `GLOBAL_KEY`: una chiave di lettura derivata dal bbox mancherebbe sempre, scatenerebbe uno sweep da ~7 MB a ogni richiesta e risponderebbe comunque 503. `parseBbox` resta, ma solo per l'eco nel corpo della risposta. Il bbox diventa una chiave vera nel Piano 2, insieme alla cache a tile.

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

Tre dettagli non ovvi, tutti imposti da difetti trovati in revisione. La chiave è sempre `GLOBAL_KEY`. Il refresh sincrono è deduplicato da una promessa condivisa, altrimenti N richieste concorrenti su cache fredda diventano N sweep da 7 MB verso un fornitore gratuito — lo stesso tipo di traffico che ci è valso il 403. E il flag `stale` va **nel corpo**, non solo nell'header: `statesClient.ts` legge solo `res.json()` e un header non lo vedrebbe mai.

```ts
let inFlightRefresh: Promise<void> | null = null;

/** Collapses concurrent cold-cache requests into a single upstream sweep. */
function refreshOnce(): Promise<void> {
  if (inFlightRefresh === null) {
    inFlightRefresh = refreshGlobalFeed().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** Injects the freshness flag into an already-serialised payload. */
function withStaleFlag(body: string, stale: boolean): string {
  return `{"stale":${stale},${body.slice(1)}`;
}

app.get('/api/states', async (req, reply) => {
  // parseBbox is kept only to echo the request back. Plan 1 serves one
  // global sweep, so the cache key is constant; the bbox becomes a real
  // key in Plan 2, together with the tile cache.
  const bbox = parseBbox(req.query as Record<string, string | undefined>);
  void bbox;

  const cached = feed.get(GLOBAL_KEY);
  if (cached !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(cached.stale))
      .send(withStaleFlag(cached.body, cached.stale));
  }

  // Cache empty or past the stale ceiling: fetch synchronously this once.
  await refreshOnce();
  const afterFetch = feed.get(GLOBAL_KEY);
  if (afterFetch !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(afterFetch.stale))
      .send(withStaleFlag(afterFetch.body, afterFetch.stale));
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

Poi il ramo che una revisione ha trovato rotto — una richiesta con parametri bbox:

```bash
curl -s -o /dev/null -w "con bbox: HTTP %{http_code}\n" 'localhost:3000/api/states?lamin=35&lomin=-15&lamax=72&lomax=45'
curl -s localhost:3000/api/states | head -c 60
```

Expected: **HTTP 200**, non 503, e nessun `feed refreshed` aggiuntivo nei log per quella richiesta. Il corpo deve iniziare con `{"stale":false,` — il flag sta nel corpo e non solo nell'header, perché il client legge solo il JSON.

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

### Task 5: Resolver rotte con rate limit rispettato

**Files:**
- Create: `server/routeResolver.ts`
- Test: `tests/unit/server/routeResolver.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT` dal Task 1, importato come `'../src/data/sources/userAgent.js'`
- Produces: `createRouteResolver(opts?: RouteResolverOptions): RouteResolver`. `RouteResolver` espone `seed(records: SeedRecord[]): void`, `get(callsign: string): FlightRoute | null`, `enqueue(callsigns: string[]): void`, `pump(fetchImpl?: typeof fetch): Promise<number>`, `stats(): ResolverStats`. `FlightRoute = { callsignIcao: string; callsignIata: string | null; airlineName: string | null; originIata: string; originName: string; destinationIata: string; destinationName: string }`. `SeedRecord = { callsign: string; route: FlightRoute | null }` — `null` significa "già interrogato, sconosciuto". `ResolverStats = { resolved: number; unknown: number; queued: number; abandoned: number; suspendedUntil: string | null; consecutiveRateLimits: number; lastError: string | null }`. `RouteResolverOptions = { maxPerPump?: number; rateLimitCooldownMs?: number; maxAttempts?: number; minIntervalMs?: number; now?: () => number }`.

**Tre vincoli di realtà, tutti misurati dal vivo.**

Il primo: adsbdb risponde **404** per un callsign che non conosce, con corpo `{"response":"unknown callsign"}`. Un `if (!res.ok) throw` prima di leggere lo status renderebbe irraggiungibile il ramo "sconosciuto" e quei callsign — privati, business, militari — verrebbero ri-accodati per sempre.

Il secondo, scoperto eseguendo il server contro l'API reale: **adsbdb rate-limita duramente**. Circa 1.190 lookup a 4,8 richieste/s hanno prodotto `HTTP 429 {"response":"rate limited for 300 seconds"}`. Peggio: le richieste emesse *durante* la penalità la rinnovano. Un resolver che rimette in coda su ogni errore continuerebbe a sparare contro il muro e non guarirebbe mai da solo. Il 429 è quindi uno **stato di prima classe**: sospende il pump, con backoff esponenziale, e durante la sospensione non parte alcuna richiesta.

Il terzo: un singolo snapshot contiene fra **5.900 e 12.500 callsign distinti** a seconda dell'ora, e l'insieme cumulativo nell'arco di una giornata è molto maggiore. A una cadenza rispettosa il primo riempimento richiede **ore**, non minuti. Per questo la cache non si costruisce a runtime ma viene **pre-costruita offline** dal Task 6 e caricata con `seed()`; a runtime il pump serve solo per i callsign nuovi, molto lentamente.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/server/routeResolver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRouteResolver } from '../../../server/routeResolver';

const ROUTE = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

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

// Verified live: adsbdb answers 404 — NOT 200 — for an unknown callsign.
const adsbdbUnknown = { ok: false, status: 404, json: async () => ({ response: 'unknown callsign' }) };
// Verified live: ~1190 lookups at 4.8 req/s produced this.
const adsbdbRateLimited = {
  ok: false,
  status: 429,
  json: async () => ({ response: 'rate limited for 300 seconds' }),
};

/** Tests must not actually wait between lookups. */
const mk = (opts = {}) => createRouteResolver({ minIntervalMs: 0, ...opts });

describe('createRouteResolver — cache and lookups', () => {
  it('returns null before anything has been resolved', () => {
    expect(mk().get('BAW274')).toBeNull();
  });

  it('serves a seeded route without any network call', () => {
    const fetchImpl = vi.fn();
    const r = mk();
    r.seed([{ callsign: 'BAW274', route: ROUTE }]);
    expect(r.get('BAW274')?.originIata).toBe('LAS');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.stats().resolved).toBe(1);
  });

  it('does not re-enqueue a callsign the seed already judged unknown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.seed([{ callsign: 'NJE004M', route: null }]);
    r.enqueue(['NJE004M']);
    expect(r.stats().queued).toBe(0);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves a queued callsign and serves it from cache afterwards', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('BAW274')?.originIata).toBe('LAS');
    expect(r.get('BAW274')?.destinationIata).toBe('LHR');
    expect(r.get('BAW274')?.callsignIata).toBe('BA274');
  });

  it('sends the project User-Agent to adsbdb', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/air-view/);
  });

  it('treats HTTP 404 as a VERDICT, not a transport error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbUnknown);
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('NJE004M')).toBeNull();
    expect(r.stats().unknown).toBe(1);
    r.enqueue(['NJE004M']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps the number of lookups per pump', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('AAA', 'BBB'));
    const r = mk({ maxPerPump: 2 });
    r.enqueue(['AAA111', 'BBB222', 'CCC333', 'DDD444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.stats().queued).toBe(2);
  });

  it('ignores a resolved route missing an airport code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ response: { flightroute: { callsign: 'XXX1', origin: {}, destination: {} } } }),
    });
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['XXX1']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('XXX1')).toBeNull();
    expect(r.stats().unknown).toBe(1);
  });

  it('normalises the callsign to uppercase and trims it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = mk({ maxPerPump: 10 });
    r.enqueue([' baw274 ']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.adsbdb.com/v0/callsign/BAW274');
    expect(r.get('baw274')).not.toBeNull();
  });
});

describe('createRouteResolver — rate limiting', () => {
  it('SUSPENDS on 429 and stops the batch immediately', async () => {
    // Verified live: requests sent during the penalty renew it. A resolver
    // that keeps firing never recovers on its own.
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock });
    r.enqueue(['A111', 'B222', 'C333', 'D444']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // stopped at the first 429
    expect(r.stats().suspendedUntil).not.toBeNull();
    expect(r.stats().queued).toBe(4); // nothing lost
  });

  it('emits NO request at all while suspended', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock });
    r.enqueue(['A111']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    fetchImpl.mockClear();

    clock += 299_000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resumes once the cooldown has elapsed', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(adsbdbRateLimited).mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    clock += 301_000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.get('BAW274')).not.toBeNull();
    expect(r.stats().suspendedUntil).toBeNull();
  });

  it('backs off exponentially on repeated rate limits', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 300_000, now: () => clock });
    r.enqueue(['A111', 'B222']);

    await r.pump(fetchImpl as unknown as typeof fetch);
    const first = new Date(r.stats().suspendedUntil!).getTime() - clock;
    clock += first + 1;
    await r.pump(fetchImpl as unknown as typeof fetch);
    const second = new Date(r.stats().suspendedUntil!).getTime() - clock;

    expect(second).toBeGreaterThan(first);
    expect(r.stats().consecutiveRateLimits).toBe(2);
  });

  it('clears the backoff counter after a success', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(adsbdbRateLimited).mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    let clock = 1_000_000;
    const r = mk({ maxPerPump: 10, rateLimitCooldownMs: 1000, now: () => clock });
    r.enqueue(['BAW274']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    clock += 2000;
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.stats().consecutiveRateLimits).toBe(0);
  });

  it('exposes the rate limit in stats so /health can report it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbRateLimited);
    const r = mk({ maxPerPump: 10 });
    r.enqueue(['A111']);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(r.stats().lastError).toMatch(/429|rate/i);
  });

  it('gives up on a callsign after repeated transport failures', async () => {
    // Without a cap, a permanently failing callsign recirculates forever.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = mk({ maxPerPump: 1, maxAttempts: 3 });
    r.enqueue(['BAW274']);
    for (let i = 0; i < 4; i++) await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.stats().queued).toBe(0);
    expect(r.stats().abandoned).toBe(1);
  });

  it('REMEMBERS an abandoned callsign so the server cannot re-enqueue it', async () => {
    // The server calls enqueue() on every feed cycle. Without a permanent
    // record, a callsign given up on comes straight back and the attempt cap
    // achieves nothing.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = mk({ maxPerPump: 1, maxAttempts: 3 });
    r.enqueue(['BAW274']);
    for (let i = 0; i < 4; i++) await r.pump(fetchImpl as unknown as typeof fetch);

    r.enqueue(['BAW274']);
    expect(r.stats().queued).toBe(0);
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // no fourth attempt
  });

  it('waits minIntervalMs between lookups inside one pump', async () => {
    // pump() with maxPerPump > 1 used to fire the whole batch back-to-back,
    // which is how the project's 1-request-per-1.5s rule got broken from the
    // inside.
    const fetchImpl = vi.fn().mockResolvedValue(adsbdbOk('LAS', 'LHR'));
    const r = createRouteResolver({ maxPerPump: 3, minIntervalMs: 40 });
    r.enqueue(['A111', 'B222', 'C333']);
    const started = Date.now();
    await r.pump(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(80); // two gaps, not three
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

/** One entry of the pre-built cache. A null route means "asked, unknown". */
export interface SeedRecord {
  callsign: string;
  route: FlightRoute | null;
}

export interface ResolverStats {
  resolved: number;
  unknown: number;
  queued: number;
  /** Callsigns given up on after repeated transport failures. */
  abandoned: number;
  suspendedUntil: string | null;
  consecutiveRateLimits: number;
  lastError: string | null;
}

export interface RouteResolverOptions {
  maxPerPump?: number;
  /** Base cooldown after a 429, doubled on each consecutive one. */
  rateLimitCooldownMs?: number;
  /** Transport failures tolerated per callsign before giving up on it. */
  maxAttempts?: number;
  /**
   * Minimum gap between two lookups inside one pump. The project floor is one
   * request per 1.5 s; a batch fired back-to-back breaks it from the inside.
   * Tests pass 0.
   */
  minIntervalMs?: number;
  now?: () => number;
}

export interface RouteResolver {
  seed(records: SeedRecord[]): void;
  get(callsign: string): FlightRoute | null;
  enqueue(callsigns: string[]): void;
  pump(fetchImpl?: typeof fetch): Promise<number>;
  stats(): ResolverStats;
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

const DEFAULT_MAX_PER_PUMP = 1;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_INTERVAL_MS = 1500;
const MAX_COOLDOWN_MS = 3_600_000;

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/** Raised by lookup() on 429 so pump() can stop the whole batch. */
class RateLimited extends Error {}

/**
 * Resolves callsigns to real origin/destination pairs via adsbdb.
 *
 * The bulk of the cache is built offline (see scripts/build-route-cache.mjs)
 * and loaded with seed(): a snapshot holds 5 900-12 500 distinct callsigns
 * depending on the hour, and adsbdb cannot be asked that many times quickly.
 * At runtime the pump only picks up callsigns the seed does not cover, and
 * it does so slowly.
 *
 * Measured live: ~1 190 lookups at 4.8 req/s produced
 * HTTP 429 {"response":"rate limited for 300 seconds"}, and requests sent
 * during the penalty RENEW it — after 330 s of total silence the block was
 * gone, while polling every 20 s it never lifted. So 429 suspends the pump
 * entirely, with exponential backoff, and no request leaves while suspended.
 *
 * Replaces v1's routeLookup, which ignored the flight number and returned
 * the airline's alphabetically first route: every BA flight showed
 * Aalborg -> Aarhus.
 */
export function createRouteResolver(opts: RouteResolverOptions = {}): RouteResolver {
  const maxPerPump = opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP;
  const baseCooldownMs = opts.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;

  const resolved = new Map<string, FlightRoute>();
  const unknown = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const attempts = new Map<string, number>();
  /** Permanent record of callsigns we stopped trying, so enqueue() skips them. */
  const abandoned = new Set<string>();

  let suspendedUntil = 0;
  let consecutiveRateLimits = 0;
  let lastError: string | null = null;

  function key(callsign: string): string {
    return callsign.trim().toUpperCase();
  }

  async function lookup(cs: string, fetchImpl: typeof fetch): Promise<boolean> {
    const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });

    if (res.status === 429) throw new RateLimited('adsbdb: HTTP 429 rate limited');

    // 404 is a verdict about the callsign — private, business and military
    // flights — not a failure of the request.
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
      unknown.add(cs);
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
    seed(records) {
      for (const rec of records) {
        const cs = key(rec.callsign);
        if (!cs) continue;
        if (rec.route === null) unknown.add(cs);
        else resolved.set(cs, rec.route);
      }
    },

    get(callsign) {
      return resolved.get(key(callsign)) ?? null;
    },

    enqueue(callsigns) {
      for (const raw of callsigns) {
        const cs = key(raw);
        if (!cs) continue;
        if (resolved.has(cs) || unknown.has(cs) || queued.has(cs) || abandoned.has(cs)) continue;
        queue.push(cs);
        queued.add(cs);
      }
    },

    async pump(fetchImpl: typeof fetch = fetch) {
      if (now() < suspendedUntil) return 0; // not one request while suspended

      let count = 0;
      const batch = queue.splice(0, maxPerPump);

      for (let i = 0; i < batch.length; i++) {
        const cs = batch[i]!;
        queued.delete(cs);
        // Space out the batch. The server pumps one at a time, but a caller
        // asking for more must not turn a single pump into a burst.
        if (i > 0) await sleep(minIntervalMs);
        try {
          if (await lookup(cs, fetchImpl)) count += 1;
          consecutiveRateLimits = 0;
          attempts.delete(cs);
        } catch (e) {
          if (e instanceof RateLimited) {
            consecutiveRateLimits += 1;
            const cooldown = Math.min(baseCooldownMs * 2 ** (consecutiveRateLimits - 1), MAX_COOLDOWN_MS);
            suspendedUntil = now() + cooldown;
            lastError = `${e.message}; suspended for ${Math.round(cooldown / 1000)}s`;
            // Put back this callsign AND everything we had not reached, then
            // stop: further requests would renew the penalty.
            queue.unshift(cs, ...batch.slice(i + 1));
            queued.add(cs);
            for (const rest of batch.slice(i + 1)) queued.add(rest);
            return count;
          }
          lastError = e instanceof Error ? e.message : String(e);
          const tried = (attempts.get(cs) ?? 0) + 1;
          if (tried >= maxAttempts) {
            // Give up permanently. Merely dropping it from the queue is not
            // enough: the server calls enqueue() every feed cycle and the
            // callsign would come straight back, making the cap useless.
            attempts.delete(cs);
            abandoned.add(cs);
          } else {
            attempts.set(cs, tried);
            queue.push(cs);
            queued.add(cs);
          }
        }
      }
      return count;
    },

    stats() {
      return {
        resolved: resolved.size,
        unknown: unknown.size,
        queued: queue.length,
        abandoned: abandoned.size,
        suspendedUntil: now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
        consecutiveRateLimits,
        lastError,
      };
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/routeResolver.test.ts`
Expected: PASS, 18 test

- [ ] **Step 5: Verificare contro adsbdb reale, con parsimonia**

Lo script va **dentro il repo**: in ESM un import relativo si risolve rispetto al file che importa, quindi uno script in `/tmp` cercherebbe `/tmp/server/routeResolver.js` e fallirebbe prima di qualunque chiamata.

```bash
cat > check-routes.mts <<'EOF'
import { createRouteResolver } from './server/routeResolver.js';
const r = createRouteResolver({ maxPerPump: 5 });
r.enqueue(['BAW274', 'RYR1234', 'UAE2', 'NJE004M', 'MORPH16']);
await r.pump();
console.log('stats:', r.stats());
console.log('BAW274:', r.get('BAW274'));
console.log('NJE004M (atteso null, unknown):', r.get('NJE004M'));
EOF
npx tsx check-routes.mts && rm check-routes.mts
```

Expected: `resolved: 3, unknown: 2, queued: 0`, `suspendedUntil: null`; `BAW274` con origine e destinazione reali; `NJE004M` null e contato fra gli unknown. Se `unknown` è 0 e `queued` è 2, il ramo 404 non funziona. Se `suspendedUntil` non è null, siamo già sotto rate limit: **attendere almeno 6 minuti in totale silenzio** prima di riprovare — le richieste durante la penalità la rinnovano.

Cinque richieste soltanto: è l'unico passo che prova il ramo 404 contro l'API vera, e va eseguito, ma senza volume.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): route resolver with seeding and 429 backoff

v1's routeLookup ignored the flight number and returned the airline's
first route alphabetically: every BA flight claimed Aalborg -> Aarhus,
and 49% of aircraft showed a fabricated origin and destination.

Measured against the live API: ~1190 lookups at 4.8 req/s trigger
HTTP 429 'rate limited for 300 seconds', and requests sent during the
penalty renew it rather than waiting it out. So 429 is a first-class
state that suspends the pump with exponential backoff and emits nothing
while suspended, it is visible in stats() for /health, and a callsign
that keeps failing transport is dropped after three attempts instead of
recirculating forever.

The bulk of the cache is loaded via seed() from a file built offline;
the runtime pump only picks up callsigns the seed does not cover.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Cache rotte pre-costruita, collegamento al server e completezza

**Files:**
- Create: `scripts/build-route-cache.mjs`
- Create: `server/data/.gitkeep` (la cache vera viene generata ed è committata)
- Create: `src/data/completeness.ts`
- Modify: `server/index.ts`, `tsconfig.server.json`, `package.json`
- Test: `tests/unit/data/completeness.test.ts`

**Interfaces:**
- Consumes: `RouteResolver`, `SeedRecord`, `FlightRoute` dal Task 5; `FlightRouteLite` e `makeAircraftRaw` dal Task 1
- Produces: `isComplete(ac: AircraftRaw): boolean`; `npm run build:routes`; il file `server/data/route-cache.json` con forma `SeedRecord[]`

**Perché una cache pre-costruita e perché NON è un ritorno a `openflights-routes.json`.** Il file che il Task 7 elimina era sbagliato *per costruzione*: `list[0]` restituiva una rotta che non aveva alcun rapporto col volo richiesto. Questo file è verificato per costruzione: ogni voce è la risposta di adsbdb *per quello specifico callsign*. Al più invecchia — e i numeri di volo di linea sono stabili nel tempo, `BAW274` vola ogni giorno — mentre quello era falso il giorno stesso in cui è stato generato.

Lo script campiona il feed a intervalli nell'arco di ore, perché un singolo snapshot contiene fra 5.900 e 12.500 callsign a seconda dell'ora e l'insieme di una giornata è molto maggiore. È **ripartibile**: rilegge la cache esistente e riprende, così un'interruzione non butta via il lavoro fatto.

- [ ] **Step 1: Creare `scripts/build-route-cache.mjs`**

```js
#!/usr/bin/env node
// Builds server/data/route-cache.json by asking adsbdb about the callsigns
// seen in the live feed. Runs for hours on purpose: adsbdb rate-limits hard
// (~1190 lookups at 4.8 req/s earned a 300 s ban, and requests sent during
// the penalty renew it). Resumable: re-reading the existing cache and
// picking up where it stopped is the normal way to use it.
//
//   node scripts/build-route-cache.mjs            # default: 4 hours
//   node scripts/build-route-cache.mjs --hours 8

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
const OUT = 'server/data/route-cache.json';
const FEED = 'https://api.adsb.lol/v2/lat/0/lon/0/dist/10000';
const CALLSIGN_RX = /^[A-Z]{3}[A-Z0-9]+$/;

const hoursArg = process.argv.indexOf('--hours');
const RUN_HOURS = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 4;

// Conservative and self-correcting: start slow, back off hard on 429.
// MIN_DELAY_MS is the project floor of one request per 1.5 s. The loop below
// MUST await this between lookups: an earlier draft computed delayMs, logged
// it, and never slept on it — measured at 185 req/s against a stubbed fetch
// while its own log claimed 0.67 req/s.
let delayMs = 2000;
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 60_000;
const MAX_TRANSPORT_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cache = new Map();
if (existsSync(OUT)) {
  for (const rec of JSON.parse(readFileSync(OUT, 'utf8'))) cache.set(rec.callsign, rec.route);
  console.log(`resuming from ${cache.size} cached callsigns`);
}

function save() {
  mkdirSync(dirname(OUT), { recursive: true });
  const records = [...cache.entries()]
    .map(([callsign, route]) => ({ callsign, route }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
  writeFileSync(OUT, JSON.stringify(records, null, 0));
}

async function sampleFeed() {
  const res = await fetch(FEED, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`feed: HTTP ${res.status}`);
  const data = await res.json();
  const out = new Set();
  for (const ac of data.ac ?? []) {
    const cs = (ac.flight ?? '').trim().toUpperCase();
    if (CALLSIGN_RX.test(cs)) out.add(cs);
  }
  return out;
}

/** @returns 'ok' | 'unknown' | 'ratelimited' | 'error' */
async function lookup(cs) {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (res.status === 429) return 'ratelimited';
  if (res.status === 404) {
    cache.set(cs, null);
    return 'unknown';
  }
  if (!res.ok) return 'error';
  const data = await res.json();
  const fr = typeof data.response === 'object' ? data.response?.flightroute : undefined;
  const o = fr?.origin, d = fr?.destination;
  if (!fr || !o?.iata_code || !o?.name || !d?.iata_code || !d?.name) {
    cache.set(cs, null);
    return 'unknown';
  }
  cache.set(cs, {
    callsignIcao: fr.callsign ?? cs,
    callsignIata: fr.callsign_iata ?? null,
    airlineName: fr.airline?.name ?? null,
    originIata: o.iata_code,
    originName: o.name,
    destinationIata: d.iata_code,
    destinationName: d.name,
  });
  return 'ok';
}

const deadline = Date.now() + RUN_HOURS * 3600_000;
const pending = [];
const attempts = new Map();
let resolvedCount = 0, unknownCount = 0, abandonedCount = 0, lastSample = 0;

console.log(`building for ${RUN_HOURS}h, starting at ${(1000 / delayMs).toFixed(2)} req/s`);

while (Date.now() < deadline) {
  // Re-sample the feed every 20 minutes: traffic turns over through the day.
  if (Date.now() - lastSample > 20 * 60_000) {
    try {
      const seen = await sampleFeed();
      let added = 0;
      for (const cs of seen) {
        if (!cache.has(cs) && !pending.includes(cs)) { pending.push(cs); added++; }
      }
      lastSample = Date.now();
      console.log(`[sample] ${seen.size} callsigns in feed, ${added} new, ${pending.length} pending, ${cache.size} cached`);
    } catch (e) {
      console.warn(`[sample] failed: ${e.message}`);
    }
  }

  if (pending.length === 0) { await sleep(5000); continue; }

  const cs = pending.shift();
  let outcome;
  try {
    outcome = await lookup(cs);
  } catch (e) {
    console.warn(`[lookup] ${cs}: ${e.message}`);
    outcome = 'error';
  }

  if (outcome === 'ratelimited') {
    pending.unshift(cs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    save();
    console.warn(`[429] rate limited — sleeping 360s in total silence, new delay ${delayMs}ms`);
    await sleep(360_000); // longer than the advertised 300s: requests during it renew the ban
    continue;
  }

  if (outcome === 'ok') {
    resolvedCount++;
    attempts.delete(cs);
  } else if (outcome === 'unknown') {
    unknownCount++;
    attempts.delete(cs);
  } else {
    // Transport hiccup: retry a bounded number of times, then give up.
    // Without a cap a permanently failing callsign recirculates forever.
    const tried = (attempts.get(cs) ?? 0) + 1;
    if (tried >= MAX_TRANSPORT_ATTEMPTS) {
      attempts.delete(cs);
      abandonedCount++;
      console.warn(`[give up] ${cs} after ${tried} transport failures`);
    } else {
      attempts.set(cs, tried);
      pending.push(cs);
    }
  }

  // THE THROTTLE. Everything above is bookkeeping; this line is what keeps us
  // inside adsbdb's tolerance. Never remove it, never make it conditional.
  await sleep(delayMs);

  if ((resolvedCount + unknownCount) % 100 === 0) {
    save();
    const left = pending.length;
    const eta = (left * delayMs) / 3600_000;
    console.log(`resolved ${resolvedCount}, unknown ${unknownCount}, pending ${left}, eta ${eta.toFixed(1)}h`);
    // Creep back toward the floor after a clean run.
    if (delayMs > MIN_DELAY_MS) delayMs = Math.max(MIN_DELAY_MS, delayMs * 0.9);
  }
}

save();
console.log(`\ndone: ${cache.size} callsigns cached (${resolvedCount} resolved, ${unknownCount} unknown, ${abandonedCount} abandoned this run), ${pending.length} still pending`);
console.log(`written to ${OUT} — commit it`);
```

- [ ] **Step 2: Aggiungere lo script a `package.json`**

Nel blocco `"scripts"`:

```json
    "build:routes": "node scripts/build-route-cache.mjs",
```

- [ ] **Step 3: Lanciare una corsa breve per verificare che funzioni**

```bash
mkdir -p server/data
node scripts/build-route-cache.mjs --hours 0.05
```

**Prima di lanciarlo, verificare che il throttle esista davvero.** È il punto in cui una stesura precedente sparava a 185 req/s mentre il proprio log dichiarava 0,67:

```bash
grep -n "await sleep(delayMs)" scripts/build-route-cache.mjs
```

Se quella riga non compare nel ciclo principale, **non eseguire lo script**: manca il throttle e il risultato è un ban immediato.

Expected: circa tre minuti di esecuzione e `server/data/route-cache.json` scritto. Con `delayMs` iniziale di 2000 ms, tre minuti devono produrre **al massimo ~90 lookup**: un `[sample]` iniziale e nessuna o al più una riga di avanzamento, che compare ogni 100 esiti. Se ne vedi molte di più il throttle non funziona: interrompi con Ctrl-C e attendi sei minuti prima di qualunque altra chiamata ad adsbdb.

Se compare `[429]`, lo script deve **dormire 360 s in silenzio** e non emettere altre richieste: è il comportamento voluto.

Verificare la forma del file:

```bash
python3 -c "
import json
r=json.load(open('server/data/route-cache.json'))
print('voci:', len(r))
print('con rotta:', sum(1 for x in r if x['route']))
print('esempio:', next((x for x in r if x['route']), None))
"
```

La corsa lunga vera (`npm run build:routes -- --hours 8`) la lancia l'utente quando vuole, ed è ripartibile. Il piano non la richiede per proseguire: il server funziona anche con una cache parziale, semplicemente con meno aerei blu.

- [ ] **Step 4: Scrivere il test che fallisce per `isComplete`**

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

- [ ] **Step 5: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 6: Creare `src/data/completeness.ts`**

Import relativo con `.js`: questo modulo è compilato anche dal programma del server.

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

- [ ] **Step 7: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: PASS, 10 test

- [ ] **Step 8: Collegare resolver, seed e completezza in `server/index.ts`**

Agli import:

```ts
import { createRouteResolver } from './routeResolver.js';
import { isComplete } from '../src/data/completeness.js';
import type { FlightRouteLite } from '../src/types.js';

const routes = createRouteResolver();
// Deliberately slow: the bulk of the cache comes from the seed file, and
// adsbdb bans at a few requests per second. One lookup every 10 s is
// ~360/hour, enough to absorb newly appearing callsigns.
const ROUTE_PUMP_MS = 10_000;

let lastCompleteCount = 0;
let lastTotalCount = 0;
```

Caricare il seed all'avvio, prima di `app.listen`:

```ts
const seedPath = resolve(process.cwd(), 'server/data/route-cache.json');
if (existsSync(seedPath)) {
  try {
    routes.seed(JSON.parse(readFileSync(seedPath, 'utf8')));
    app.log.info({ callsigns: routes.stats().resolved + routes.stats().unknown }, 'route cache seeded');
  } catch (e) {
    app.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'route cache unreadable — starting cold');
  }
} else {
  app.log.warn('no route cache file — starting cold, most aircraft will be incomplete');
}
```

In `tsconfig.server.json`, aggiungere all'`include` il percorso `"src/data/completeness.ts"`: senza, il modulo non entra nel programma del server e `build:server` fallisce.

- [ ] **Step 9: Arricchire e marcare dentro `refreshGlobalFeed`**

Fra l'ottenimento di `result` e la scrittura in cache:

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

    for (const ac of result.aircraft) {
      ac.complete = isComplete(ac);
    }
    lastCompleteCount = result.aircraft.filter((ac) => ac.complete).length;
    lastTotalCount = result.aircraft.length;
```

Senza il secondo ciclo `isComplete` resterebbe codice morto: `noUnusedLocals` non segnala una funzione esportata mai importata, e nulla avviserebbe che metà del deliverable non è stata consegnata.

- [ ] **Step 10: Avviare il pump e pubblicare lo stato su `/health`**

Accanto al timer del feed, dopo `app.listen`:

```ts
  const routeTimer = setInterval(() => void routes.pump(), ROUTE_PUMP_MS);
  routeTimer.unref();
```

Nel corpo di `/health`:

```ts
    routes: routes.stats(),
    aircraft: { total: lastTotalCount, complete: lastCompleteCount },
```

`routes.stats()` include `suspendedUntil`, `consecutiveRateLimits` e `lastError`: senza questi campi un blocco di adsbdb resterebbe invisibile mentre `/health` continua a dire `ok`, che è la cecità che questo piano esiste per rimuovere.

- [ ] **Step 11: Verificare entrambi i programmi**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 12: Osservare il comportamento reale**

```bash
npm run server
```

Attendere un paio di minuti, poi:

```bash
curl -s localhost:3000/health | python3 -m json.tool
```

Expected: nei log di avvio compare `route cache seeded` con il numero di callsign del file. Il blocco `aircraft` mostra `complete` maggiore di zero — quanto, dipende da quanto è piena la cache: con la corsa breve dello Step 3 sarà una frazione piccola, ed è corretto così. `routes.suspendedUntil` deve essere `null`; se non lo è, la cadenza è ancora troppo alta.

Verificare anche il corpo:

```bash
curl -s localhost:3000/api/states | python3 -c "
import json,sys
d=json.load(sys.stdin); ac=d['aircraft']
comp=[a for a in ac if a.get('complete')]
print('stale flag nel corpo:', d.get('stale'))
print(f'complete: {len(comp)}/{len(ac)}')
print('esempio:', {k:comp[0][k] for k in ('callsign','registration','modelCode','route')} if comp else 'nessuno ancora')
"
```

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(server): pre-built route cache, wiring and completeness

/api/states now carries a real route and a 'complete' flag, and /health
reports the resolver state including any active rate-limit suspension.

The cache is built offline by scripts/build-route-cache.mjs rather than
at runtime: a snapshot holds 5900-12500 distinct callsigns depending on
the hour, and adsbdb bans at a few requests per second, so filling it
takes hours. The script samples the feed over time, backs off hard on
429, and is resumable. The runtime pump only absorbs callsigns the seed
does not cover, at one lookup every 10 s.

This static file is NOT a return to openflights-routes.json. That one was
wrong by construction — list[0] returned a route unrelated to the flight.
This one is verified by construction: every entry is adsbdb's answer for
that specific callsign. At worst it ages.

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
grep -rn "routeLookup\|openflights-routes\|initRoutes" src/ server/ tests/ scripts/ || echo "nessun riferimento residuo"
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

Sostituire l'intero blocco `describe('aircraftStore', ...)` esistente con il seguente, lasciando invariati gli altri `describe` del file **e tutti gli import già in cima**. In particolare `makeAircraftRaw` è già importato: l'ha aggiunto il Task 1 Step 3. **Non ri-aggiungerlo**, sarebbe un identificatore duplicato.

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

// The completeness flag must actually reach the payload: isComplete() being
// written and tested but never wired up is a defect a green suite cannot see.
if (!('stale' in data)) fail('payload has no "stale" field — the freshness flag is header-only, and the client reads only JSON');
else pass(`stale flag in body: ${data.stale}`);

const complete = ac.filter((a) => a.complete === true).length;
if (ac.some((a) => a.complete === undefined)) fail('payload has no "complete" field — isComplete() is not wired into the response');
else pass(`complete: ${complete} of ${ac.length} (${(100 * complete / ac.length).toFixed(1)}%)`);
if (withRoute > 0 && complete === 0) fail('routes are attached but no aircraft is marked complete — check isComplete()');

// The route subsystem dying silently is the failure mode this script exists
// to catch. A conditional check that only fires when routes already exist
// would print PASSED on a server whose resolver has been rate-limited into
// oblivion — which is exactly what happened during review.
if (health.routes?.suspendedUntil) fail(`resolver suspended until ${health.routes.suspendedUntil} — adsbdb rate limit hit`);
else pass('resolver not rate-limited');

const seeded = (health.routes?.resolved ?? 0) + (health.routes?.unknown ?? 0);
if (seeded === 0) fail('resolver knows no callsign at all — is server/data/route-cache.json present and readable?');
else pass(`resolver knows ${seeded} callsigns`);

if (health.routes?.lastError) console.log(`resolver lastError: ${health.routes.lastError}`);

// A request carrying bbox params must not 503 nor trigger its own upstream
// sweep: the writer and the reader of the cache must agree on the key.
const bboxRes = await fetch(`${BASE}/api/states?lamin=35&lomin=-15&lamax=72&lomax=45`);
if (bboxRes.status !== 200) fail(`/api/states with bbox returned HTTP ${bboxRes.status} — cache key mismatch between poller and handler`);
else pass('bbox request: HTTP 200');

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
| 6 | La cache rotte "converge in pochi minuti": falso di due ordini di grandezza | 8 466 callsign distinti per snapshot; pump legato al cache miss = 0,22 lookup/s = **10,7 ore** | Pump su timer proprio a 5 lookup/s — **correzione poi superata dal difetto #15**, che ha mostrato che 5 lookup/s fanno scattare il rate limit di adsbdb. Vedi la terza tornata |
| 7 | Il Task 8 rinominava `openSkyClient` aggiornando due file su tre, e cambiava la firma di `onBatch` senza adeguare l'asserzione del test esistente | `tests/unit/data/aircraftStream.test.ts:3` importa il modulo per lo `spyOn` | Tutti e tre i file elencati, più lo step che adegua `toHaveBeenCalledWith` al secondo argomento (Task 8) |
| 8 | Il Task 9 ordinava merge su `main` e `push`: un esecutore fedele avrebbe pubblicato in produzione senza autorizzazione, per giunta con un build che non compilava | Regola operativa del progetto; Task 9 Step 5 della prima stesura | Lo step di deploy è sostituito da una consegna esplicita all'utente (Task 9) |

### Seconda tornata di correzioni

La seconda stesura è stata a sua volta sottoposta al preflight: **1 finding critico, 10 major, 17 minori** — contro i 16 critici della prima. Due revisori hanno implementato l'intero piano in una sandbox ed eseguito il server risultante, il che ha prodotto evidenza sperimentale invece che congetture.

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 9 | **Critico.** Il poller scrive la cache sotto `GLOBAL_KEY`, il gestore la legge con una chiave derivata dal bbox: ogni richiesta con bbox mancava la cache, scatenava uno sweep da ~7 MB e rispondeva **503 comunque**. Regressione rispetto alla v1, che con bbox risponde 200 | Server del piano eseguito in sandbox: `/api/states` → 200; `/api/states?lamin=35&...` → 503 dopo 1752 ms e un `feed refreshed` da 12 665 aerei | Chiave unica `GLOBAL_KEY` in tutto il Piano 1; `parseBbox` resta solo per l'eco; più una promessa condivisa che fonde i refresh concorrenti in un solo sweep (Task 4) |
| 10 | Lo stato `starting` non scadeva mai: con adsb.lol in 403 dal primo secondo — cioè lo scenario esatto del guasto — `/health` avrebbe risposto 200 all'infinito, ricreando la cecità che il piano esiste per rimuovere | Lettura del codice: `health()` ritorna `starting` ogni volta che `lastSuccessAt === null` | Finestra di grazia di 180 s, oltre la quale `starting` diventa `degraded` (Task 4) |
| 11 | Il flag `stale` viveva solo nell'header, ma `statesClient.ts` legge unicamente `res.json()`: il client non l'avrebbe mai visto | Lettura di `src/data/statesClient.ts` | Il flag entra nel corpo della risposta, header incluso per i proxy (Task 4) |
| 12 | `isComplete()` veniva creato e testato ma **mai importato da nessuno**: codice morto che `noUnusedLocals` non segnala, mentre il titolo del task e il messaggio di commit dichiaravano il contrario | `grep isComplete` sull'intero piano: nessuna occorrenza fuori dal modulo e dal suo test | Il server marca ogni aereo con `complete`, `/health` espone `complete/total`, e lo script del Task 9 fallisce se il campo manca (Task 1, 6, 9) |
| 13 | Il Task 1 verificava `tsc --noEmit` mentre `src/data/adsbSource.ts:75` conteneva ancora un sesto literal `AircraftRaw`, rimosso solo nove step dopo: la verifica non poteva passare | Sandbox col solo Step 1 applicato: 6 errori `TS2739`, non i 5 dichiarati | La rimozione del modulo e la sostituzione dell'import nel server sono anticipate allo Step 3 (Task 1) |
| 14 | Il comando di verifica contro adsbdb reale non era eseguibile: `npx tsx -e` compila verso CJS, dove il top-level await non esiste | Natura di `tsx -e`; lo script del piano usa `await` a livello superiore | Script in un file `.mts`, che forza l'output ESM (Task 5) |

### Terza tornata di correzioni

Il terzo preflight ha prodotto **3 critici, 9 major, 16 minori**. Due revisori hanno eseguito il server contro le API reali, e nel farlo hanno scoperto — costandoci un ban temporaneo — un vincolo che nessuna lettura del codice avrebbe rivelato.

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 15 | **Critico.** La cadenza prescritta (5 lookup/s) supera il rate limit di adsbdb. Il resolver rimetteva in coda su ogni errore, quindi durante il ban continuava a sparare — e le richieste emesse durante la penalità **la rinnovano**: non sarebbe mai guarito da solo | Server eseguito dal vivo: `resolved` fermo a 690 con 13.472 in coda; probe diretta `HTTP 429 {"response":"rate limited for 300 seconds"}`. Dopo 330 s di silenzio totale il ban era sciolto; interrogando ogni 20 s non si scioglieva mai | 429 diventa uno stato di prima classe: sospende il pump con backoff esponenziale, nessuna richiesta parte durante la sospensione, ed è visibile in `stats()`. La cadenza scende a 1 lookup ogni 10 s (Task 5, 6) |
| 16 | **Critico.** Il grosso della cache non può essere costruito a runtime: 5.900-12.500 callsign distinti per snapshot, e molti di più nell'arco di una giornata. I "28 minuti" del piano erano una fantasia | Conteggi su snapshot reali a ore diverse: 5.898 e ~12.500 | Cache **pre-costruita offline** da uno script ripartibile che campiona il feed per ore e fa backoff sul 429; il server la carica con `seed()` (Task 6) |
| 17 | **Critico.** Lo script di verifica del Task 5 non era eseguibile: creato in `/tmp` ma con import relativo, che ESM risolve rispetto al file importante, non alla cwd | `npx tsx /tmp/check-routes.mts` → `ERR_MODULE_NOT_FOUND: /tmp/server/routeResolver.js` | Lo script si crea nella radice del repo e si rimuove dopo l'uso (Task 5) |
| 18 | `verify-feed.mjs` stampava **`VERIFICATION PASSED` con `route: 0.0%`**: l'unico controllo sulle rotte era condizionato a `withRoute > 0`, quindi non poteva fallire proprio nel caso che conta | Output reale sullo stesso server bloccato dal 429 | Controlli incondizionati su `suspendedUntil`, sul numero di callsign noti al resolver, e sul `lastError` (Task 9) |
| 19 | A tick alterni il selettore riportava "tutte le sorgenti in cooldown" invece della causa vera: col breaker aperto `errors` restava vuoto | Lettura del ramo `continue` senza `errors.push` | Il selettore ricorda la causa di ciascun breaker e la riporta anche quando salta la sorgente (Task 3) |
| 20 | Task 1 e Task 8 si contraddicevano sull'import di `makeAircraftRaw` in `stores.test.ts`: entrambi ordinavano di aggiungerlo | Confronto fra i due step | Il Task 8 dichiara esplicitamente che l'import c'è già e non va ri-aggiunto (Task 8) |

### Quarta tornata di correzioni

Il quarto preflight ha prodotto **3 critici** (lo stesso difetto trovato da tre lenti indipendenti), **5 major**, 24 minori.

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 21 | **Critico.** Lo script di pre-seed dichiarava una cadenza che non applicava: `delayMs` veniva calcolato, loggato, raddoppiato sul 429 — e mai atteso. Il ciclo sparava back-to-back. Lanciarlo sarebbe stato un ban immediato, e il log avrebbe stampato una conferma falsa mentre il ban maturava | Script estratto verbatim dal piano ed eseguito con `fetch` stubbato, senza alcuna richiesta reale: **3684 richieste in 19,8 s = 186 req/s**, mentre il log dichiarava `starting at 0.67 req/s` | `await sleep(delayMs)` nel ciclo, con un commento che ne vieta la rimozione; `MIN_DELAY_MS` portato a 1500 per rispettare il tetto di progetto; lo Step 3 ora fa verificare con un `grep` che il throttle esista prima di eseguire, e dichiara quanti lookup aspettarsi (Task 6) |
| 22 | `pump()` con `maxPerPump > 1` eseguiva l'intero batch back-to-back: lo Step 5 del Task 5 ne chiedeva 5, cioè cinque richieste in pochi millisecondi | Lettura del ciclo `for` senza pause | `minIntervalMs` (default 1500) atteso fra un lookup e il successivo, con test che lo verifica (Task 5) |
| 23 | Il tetto `maxAttempts` era inutile: un callsign abbandonato non veniva registrato da nessuna parte, e `enqueue()` del ciclo di feed successivo lo rimetteva in coda | Lettura di `enqueue()`, che controllava solo `resolved`/`unknown`/`queued` | Set `abandoned` permanente, controllato da `enqueue()` ed esposto in `stats()` (Task 5) |
| 24 | Anche lo script di pre-seed rimetteva in coda all'infinito sugli errori di trasporto | Ramo `else pending.push(cs)` senza tetto | Contatore di tentativi e abbandono dopo tre fallimenti, come nel resolver (Task 6) |
| 25 | Il blocco `Interfaces` del Task 4 ometteva `startupGraceMs`, che il test dello stesso task passa: il contratto non coincideva con il codice | Confronto fra il blocco Interfaces e lo Step 3 | Interfaccia allineata (Task 4) |

## Cosa resta fuori da questo piano

- **Piano 2 — densità e movimento**: tile cache a 10°, doppia cadenza (sweep globale magro + celle in vista), dead reckoning con tetto temporale, raggio in pixel-schermo, ordine di disegno gerarchico. È qui che adsb.fi entra davvero in servizio, perché i raggi camera-driven stanno sotto il suo tetto di 250 NM.
- **Un watcher per `/health`**: cron esterno o servizio Railway che interroghi l'endpoint e avvisi sul 503. Il Piano 1 rende il guasto diagnosticabile, non ancora notificato.
- **Corsa lunga di `build:routes`**: lo script è pronto e ripartibile, ma la costruzione completa della cache richiede ore e va lanciata quando conviene. Il server funziona anche con una cache parziale: semplicemente con meno aerei blu.
- **Piano 3 — interazione e visivo**: pannello con conteggi e checkbox, focus con geodetica e marker D/A, ricerca per numero di volo, palette caldo/grigio/blu. Include anche la **superficie visibile** del presidio §3.4 punto 3: il Task 8 espone `feedAgeSeconds()` nello store ma nessun componente lo mostra ancora, perché la UI del pannello nasce lì. Fino ad allora il feed fermo è visibile su `/health` e nel 503 di `/api/states`, non nell'interfaccia.

Il Piano 1 lascia il sito funzionante e onesto: feed vivo che si alimenta da solo, rotte vere, guasti visibili. I piani 2 e 3 lo rendono anche bello e leggibile.
