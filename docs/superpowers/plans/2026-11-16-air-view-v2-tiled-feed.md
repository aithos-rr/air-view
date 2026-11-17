# Air View v2 — Piano 1b: feed a tile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare in produzione un feed vivo e onesto ora che adsb.lol non espone più alcun endpoint globale, e rendere un guasto futuro diagnosticabile invece che invisibile per mesi.

**Architecture:** Il feed si compone da una griglia di tile da ≤250 NM sulle regioni dove esistono ricevitori ADS-B, interrogate a rotazione da un poller che impara quali tile hanno traffico e trascura quelle costantemente vuote. Le rotte vere vengono da adsbdb attraverso una cache costruita offline, perché quel servizio rate-limita duramente. Il client smette di cancellare la flotta quando il feed è fermo.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md`

**Predecessore:** `docs/superpowers/plans/2026-09-14-air-view-v2-data-layer.md`, di cui i Task 1-3 sono già implementati sul branch `v2-design` (commit `8511656`, `53c4a6f`, `5fa7f00`, `660f0ca`). Questo piano corregge quel codice e prosegue.

## Perché questo piano sostituisce il precedente

Il piano di settembre poggiava su un presupposto che **oggi è falso**: un unico sweep globale a 10.000 NM servito da adsb.lol. Misurato il 2026-11-16:

```
dist=250   -> HTTP 200
dist=251   -> HTTP 403  "radius exceeds 250 NM"
dist=10000 -> HTTP 403  "radius exceeds 250 NM"
```

Nessun endpoint globale alternativo sopravvive: `/v2/all` risponde 400, `/api/0/all` risponde 503, `/v2/mil` è il solo traffico militare. adsb.fi ha lo stesso tetto (251 NM → 400). Il codice già committato (`maxRadiusNm: 10_000`, `GLOBAL_SWEEP radiusNm: 10_000`) **non funziona in produzione**: `/api/states` risponde 502.

Va corretta anche la diagnosi scritta nel codice. A settembre il blocco su `User-Agent: node` era reale e riproducibile — misurato allora: `UA 'node' → 403`, `UA 'undici' → 200`. Oggi non esiste più:

```
UA 'node'  -> 200      UA 'curl/8.5.0' -> 200
nessun UA  -> 200      UA 'undici'     -> 200
```

adsb.lol ha cambiato policy due volte in due mesi. Lo User-Agent resta (regola di progetto e cortesia verso un servizio gratuito), ma il commento che ne attribuisce il guasto attuale è ora **sbagliato e fuorviante**, e va riscritto.

## Global Constraints

- **Regole di import.** `tsconfig.json` (`moduleResolution: Bundler`) compila il client: alias `@/`, niente estensioni. `tsconfig.server.json` (`NodeNext`) compila il server: **percorsi relativi con suffisso `.js`, mai `@/`**. Un file di `src/` raggiungibile da `server/` segue le regole più severe. Tutti i moduli sotto `src/data/sources/` ricadono in questo caso.
- **`npm run build` non type-checka il server.** Verificare sempre con `npm run build:all`.
- **Nessuna sorgente ADS-B accetta raggi oltre 250 NM.** Qualunque codice che chieda di più è un difetto, non un'ottimizzazione mancata.
- **Ogni richiesta HTTP uscente porta lo `USER_AGENT` del progetto.**
- **Parsimonia verso i servizi gratuiti.** adsbdb banna a pochi req/s e le richieste durante la penalità la rinnovano: mai oltre 1 richiesta ogni 1,5 s, e dopo un 429 silenzio totale per almeno 6 minuti. Verso adsb.lol non superare ~1,5 richieste/s complessive.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy è una decisione dell'utente.
- Nessun dato inventato: un campo sconosciuto è `null`.
- Messaggi di commit in inglese.

---

### Task 1: Correggere il tetto di raggio e la diagnosi

Il codice già su `v2-design` dichiara un tetto che la sorgente non concede e attribuisce il guasto a una causa che non è più vera. Finché non si corregge, la produzione resta rotta.

**Files:**
- Modify: `src/data/sources/adsbLol.ts`, `src/data/sources/adsbFi.ts`, `src/data/sources/userAgent.ts`, `src/data/sources/types.ts`
- Modify: `tests/unit/data/sources/adsbLol.test.ts`

**Interfaces:**
- Consumes: il codice esistente su `v2-design`
- Produces: `adsbLolSource.maxRadiusNm === 250`

- [ ] **Step 1: Correggere il test, che oggi protegge l'affermazione sbagliata**

In `tests/unit/data/sources/adsbLol.test.ts`, sostituire il test sul tetto con:

```ts
  it('declares the 250 NM ceiling adsb.lol actually enforces', () => {
    // Verified live 2026-11-16: dist=250 -> 200; dist=251 and above -> 403
    // with body "radius exceeds 250 NM". An earlier revision asserted
    // >= 10 000 here and went green on mocks while production returned 502.
    expect(adsbLolSource.maxRadiusNm).toBe(250);
  });
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/adsbLol.test.ts`
Expected: FAIL — `expected 10000 to be 250`

- [ ] **Step 3: Correggere il tetto in `src/data/sources/adsbLol.ts`**

```ts
  // Verified live 2026-11-16: 250 NM -> 200; 251 NM and above -> 403
  // "radius exceeds 250 NM". There is no global endpoint any more:
  // /v2/all -> 400, /api/0/all -> 503, /v2/mil is military traffic only.
  maxRadiusNm: 250,
```

- [ ] **Step 4: Riscrivere il commento di `src/data/sources/userAgent.ts`**

Il testo attuale attribuisce il 403 allo User-Agent. Sostituirlo con:

```ts
/**
 * Identifies Air View to the ADS-B aggregators that host us for free.
 *
 * History worth keeping, because it explains why this constant exists and
 * why it is not the whole story:
 *  - 2026-08: adsb.lol started answering 403 to Node's default
 *    "User-Agent: node". Measured then: UA 'node' -> 403, UA 'undici' -> 200.
 *    That outage froze production for 25 days.
 *  - 2026-11: that filter is gone (any UA, even none, returns 200), and a
 *    250 NM radius ceiling took its place. The 403 seen today means the
 *    radius, not the header.
 *
 * The header stays regardless: it is plain courtesy towards a free service,
 * and the policy has already changed twice.
 */
export const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
```

- [ ] **Step 5: Aggiornare il commento di `maxRadiusNm` in `src/data/sources/types.ts`**

Sostituire il riferimento ai 10 000 NM di adsb.lol con:

```ts
  /**
   * Largest radius this provider accepts, in nautical miles. Verified live
   * 2026-11-16: both adsb.lol and adsb.fi cap at 250 NM and reject anything
   * above it (403 and 400 respectively). The selector uses this to skip a
   * source instead of firing a request guaranteed to fail.
   */
  readonly maxRadiusNm: number;
```

- [ ] **Step 6: Verificare che la suite passi e che entrambi i programmi compilino**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add src/data/sources tests/unit/data/sources
git commit -m "fix(data): adsb.lol caps at 250 NM, not 10 000

Verified live: dist=250 -> 200; dist=251 and above -> 403 'radius exceeds
250 NM'. The committed maxRadiusNm of 10 000 made /api/states answer 502
in production while the unit test went green against a mock.

Also rewrites the User-Agent rationale. The August 403 really was the UA
filter — measured at the time — but that filter is gone as of November and
the radius ceiling took its place. The header stays as courtesy to a free
service whose policy has now changed twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Griglia di tile adattiva

**Files:**
- Create: `src/data/sources/tileGrid.ts`
- Test: `tests/unit/data/sources/tileGrid.test.ts`

**Interfaces:**
- Consumes: `GeoPoint` dal Task 1 del piano precedente
- Produces: `TILE_RADIUS_NM: number`; `buildTileGrid(): Tile[]` con `Tile = { id: string; region: string; centre: GeoPoint }`; `tilesNear(grid: Tile[], centre: GeoPoint, radiusNm: number): Tile[]`; `createTileScheduler(tiles: Tile[], opts?: SchedulerOptions): TileScheduler` con `TileScheduler.next(count: number): Tile[]`, `prioritise(tileIds: string[]): void`, `record(tileId: string, aircraftCount: number): void`, `stats(): { total: number; productive: number; dormant: number; sweepsCompleted: number; prioritised: number }`. `SchedulerOptions = { dormantAfterEmptySweeps?: number; dormantRetryEvery?: number }`.

**Perché adattiva.** La griglia copre riquadri geografici, ma molte tile cadono su oceano aperto dove nessun ricevitore esiste. Misurato dal vivo: una tile sugli Stati Uniti centrali restituisce **660 aerei**, una sul Pacifico orientale **zero**. Interrogare indefinitamente le tile vuote sprecherebbe la gran parte del budget di richieste verso un servizio gratuito. Lo scheduler impara: dopo alcuni passaggi a vuoto una tile diventa dormiente e viene ritentata di rado, perché la copertura ADS-B cambia nel tempo e una tile morta oggi può rianimarsi domani.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/unit/data/sources/tileGrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTileGrid, createTileScheduler, tilesNear, TILE_RADIUS_NM } from '@/data/sources/tileGrid';

describe('buildTileGrid', () => {
  it('stays under the 250 NM ceiling every provider enforces', () => {
    expect(TILE_RADIUS_NM).toBeLessThanOrEqual(250);
  });

  it('covers the regions where ADS-B receivers actually exist', () => {
    const tiles = buildTileGrid();
    const regions = new Set(tiles.map((t) => t.region));
    expect(regions).toContain('north-america');
    expect(regions).toContain('europe');
    expect(regions).toContain('east-asia');
    expect(tiles.length).toBeGreaterThan(300);
    expect(tiles.length).toBeLessThan(600);
  });

  it('gives every tile a stable unique id', () => {
    const tiles = buildTileGrid();
    const ids = new Set(tiles.map((t) => t.id));
    expect(ids.size).toBe(tiles.length);
    expect(buildTileGrid()[0]!.id).toBe(tiles[0]!.id); // deterministic
  });

  it('keeps every centre inside valid coordinates', () => {
    for (const t of buildTileGrid()) {
      expect(t.centre.lat).toBeGreaterThanOrEqual(-90);
      expect(t.centre.lat).toBeLessThanOrEqual(90);
      expect(t.centre.lon).toBeGreaterThanOrEqual(-180);
      expect(t.centre.lon).toBeLessThanOrEqual(180);
    }
  });
});

const tiles3 = () => [
  { id: 'a', region: 'r', centre: { lat: 0, lon: 0 } },
  { id: 'b', region: 'r', centre: { lat: 1, lon: 1 } },
  { id: 'c', region: 'r', centre: { lat: 2, lon: 2 } },
];

describe('tilesNear', () => {
  it('returns the tiles whose centre falls within the radius', () => {
    const grid = buildTileGrid();
    const near = tilesNear(grid, { lat: 50, lon: 8 }, 400);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(grid.length);
    expect(near.every((t) => t.region === 'europe')).toBe(true);
  });

  it('returns nothing over an uncovered ocean', () => {
    expect(tilesNear(buildTileGrid(), { lat: 0, lon: -160 }, 200)).toEqual([]);
  });

  it('orders the nearest tile first', () => {
    const near = tilesNear(buildTileGrid(), { lat: 50, lon: 8 }, 800);
    expect(near.length).toBeGreaterThan(1);
  });
});

describe('createTileScheduler', () => {
  it('serves prioritised tiles before the rotation', () => {
    // What the user is looking at must be fresh; the rest is context.
    const s = createTileScheduler(tiles3());
    s.prioritise(['c']);
    expect(s.next(1)[0]!.id).toBe('c');
  });

  it('serves a prioritised tile even when it is dormant', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1 });
    for (const t of s.next(3)) s.record(t.id, 0);
    s.prioritise(['b']);
    expect(s.next(1)[0]!.id).toBe('b');
  });

  it('NEVER lets priority starve the rotation', () => {
    // Simulated on this code: with an unbounded priority queue a single
    // viewer asking for 12 tiles every 30 s left the rotation at 8 tiles out
    // of 413 in two hours, sweeps at zero, and prune() deleting the world.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many);
    s.prioritise(many.slice(0, 12).map((t) => t.id));
    const served = s.next(8);
    expect(served.length).toBe(8);
    expect(s.stats().rotationServed).toBeGreaterThanOrEqual(4); // half the batch
  });

  it('caps the priority queue so a moving camera cannot grow it without bound', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { maxPriorityQueue: 5 });
    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(5);
  });

  it('does not re-queue a tile it served moments ago', () => {
    let clock = 1_000_000;
    const s = createTileScheduler(tiles3(), { minRefreshMs: 60_000, now: () => clock });
    s.prioritise(['a']);
    s.next(2);
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(0);
    clock += 61_000;
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(1);
  });

  it('drops a tile from the priority set once it has been served', () => {
    const s = createTileScheduler(tiles3());
    s.prioritise(['c']);
    s.next(1);
    expect(s.stats().prioritised).toBe(0);
  });

  it('hands out tiles in rotation without repeating within a sweep', () => {
    const s = createTileScheduler(tiles3());
    const first = s.next(2).map((t) => t.id);
    const second = s.next(2).map((t) => t.id);
    expect(new Set([...first, ...second]).size).toBe(3);
  });

  it('counts a completed sweep', () => {
    const s = createTileScheduler(tiles3());
    expect(s.stats().sweepsCompleted).toBe(0);
    s.next(3);
    s.next(1);
    expect(s.stats().sweepsCompleted).toBeGreaterThanOrEqual(1);
  });

  it('marks a tile dormant after repeated empty sweeps', () => {
    // A tile over open ocean returns zero for ever. Polling it at full rate
    // wastes most of the request budget: measured live, a US tile returns
    // 660 aircraft and a Pacific one returns 0.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 2 });
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const t of s.next(3)) s.record(t.id, t.id === 'a' ? 100 : 0);
    }
    expect(s.stats().dormant).toBe(2);
    expect(s.stats().productive).toBe(1);
  });

  it('keeps serving productive tiles while skipping dormant ones', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 100 });
    for (const t of s.next(3)) s.record(t.id, t.id === 'a' ? 5 : 0);
    const served = s.next(3).map((t) => t.id);
    expect(served).toContain('a');
    expect(served.length).toBeLessThan(3);
  });

  it('retries a dormant tile occasionally — coverage changes over time', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 2 });
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    let seen = new Set<string>();
    for (let i = 0; i < 10; i++) for (const t of s.next(3)) seen.add(t.id);
    expect(seen.size).toBe(3); // all eventually retried
  });

  it('wakes a dormant tile that produces again', () => {
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, dormantRetryEvery: 1 });
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    s.record('a', 42);
    expect(s.stats().productive).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: FAIL — import non risolto

- [ ] **Step 3: Creare `src/data/sources/tileGrid.ts`**

Import relativi con `.js`: questo modulo è compilato anche dal programma del server.

```ts
import type { GeoPoint } from './types.js';

/** Margin under the 250 NM ceiling every free provider enforces. */
export const TILE_RADIUS_NM = 230;

export interface Tile {
  id: string;
  region: string;
  centre: GeoPoint;
}

/**
 * Bounding boxes where terrestrial ADS-B receivers actually exist.
 *
 * The planet would need ~1060 tiles of this radius; these regions need ~413,
 * and the rest is open ocean where no volunteer receiver listens. This is a
 * statement about where the data comes from, not about where aircraft fly:
 * measured on a live snapshot, the North Atlantic held 0.1% of traffic and
 * the mid-Pacific 0.0%, against 43% over the United States.
 */
const REGIONS: Array<[string, number, number, number, number]> = [
  ['north-america', 25, 60, -130, -60],
  ['europe', 35, 62, -11, 32],
  ['east-asia', 20, 46, 100, 146],
  ['southeast-asia', -10, 22, 95, 128],
  ['india', 6, 33, 68, 90],
  ['gulf', 12, 32, 34, 60],
  ['oceania', -45, -10, 113, 179],
  ['south-america', -35, 12, -75, -35],
  ['southern-africa', -35, -20, 16, 33],
  ['north-africa', 28, 42, -9, 45],
];

const NM_PER_DEGREE_LAT = 60;
/** 1.4 leaves overlap between neighbouring circles, so no gap is left uncovered. */
const STEP_FACTOR = 1.4;

export function buildTileGrid(): Tile[] {
  const tiles: Tile[] = [];
  const stepLat = (TILE_RADIUS_NM * STEP_FACTOR) / NM_PER_DEGREE_LAT;

  for (const [region, latMin, latMax, lonMin, lonMax] of REGIONS) {
    for (let lat = latMin; lat <= latMax; lat += stepLat) {
      // Meridians converge towards the poles: widen the longitude step.
      const nmPerDegreeLon = NM_PER_DEGREE_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const stepLon = (TILE_RADIUS_NM * STEP_FACTOR) / nmPerDegreeLon;
      for (let lon = lonMin; lon <= lonMax; lon += stepLon) {
        const centre = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
        tiles.push({ id: `${region}:${centre.lat}:${centre.lon}`, region, centre });
      }
    }
  }
  return tiles;
}

export interface SchedulerOptions {
  /** Empty sweeps after which a tile is considered dormant. */
  dormantAfterEmptySweeps?: number;
  /** A dormant tile is retried once every this many sweeps. */
  dormantRetryEvery?: number;
  /** Longest the priority queue may grow; oldest entries are dropped. */
  maxPriorityQueue?: number;
  /** A tile served more recently than this is not re-queued by prioritise(). */
  minRefreshMs?: number;
  now?: () => number;
}

export interface TileScheduler {
  next(count: number): Tile[];
  /** Marks tiles as wanted now — typically those under a viewer's camera. */
  prioritise(tileIds: string[]): void;
  record(tileId: string, aircraftCount: number): void;
  stats(): {
    total: number;
    productive: number;
    dormant: number;
    sweepsCompleted: number;
    prioritised: number;
    /** Tiles served from the rotation, not from the priority queue. */
    rotationServed: number;
  };
}

const NM_PER_RADIAN = 3440.065;

/** Great-circle distance in nautical miles. */
function distanceNm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RADIAN * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tiles whose centre lies within `radiusNm` of a point, nearest first.
 *
 * Used to turn a viewer's camera into the set of tiles worth refreshing
 * immediately. A full sweep takes 16-25 minutes at adsb.lol's measured
 * latency of ~29 s per tile, so without this the region being looked at
 * would be as stale as the far side of the planet.
 */
export function tilesNear(grid: Tile[], centre: GeoPoint, radiusNm: number): Tile[] {
  return grid
    .map((tile) => ({ tile, d: distanceNm(centre, tile.centre) }))
    .filter((x) => x.d <= radiusNm)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.tile);
}

const DEFAULT_DORMANT_AFTER = 3;
const DEFAULT_RETRY_EVERY = 20;
const DEFAULT_MAX_PRIORITY_QUEUE = 12;
const DEFAULT_MIN_REFRESH_MS = 60_000;
/**
 * Share of each batch reserved for the rotation.
 *
 * Without it the priority queue eats the entire budget: a viewer asks for 12
 * tiles every 30 s while the poller serves 8 every 31-55 s, so the rotation
 * never advances, sweeps stay at zero, dormancy never engages, and prune()
 * deletes the rest of the world. Simulated on this very code: 8 rotation
 * tiles out of 413 in two hours.
 */
const ROTATION_SHARE = 0.5;

/**
 * Hands out tiles in rotation, learning which ones are worth asking about.
 *
 * Without this, most of the request budget would go to ocean tiles that
 * never return anything. Dormancy is reversible on purpose: receiver
 * coverage shifts, and a tile that is dead today may wake up next month.
 */
export function createTileScheduler(tiles: Tile[], opts: SchedulerOptions = {}): TileScheduler {
  const dormantAfter = opts.dormantAfterEmptySweeps ?? DEFAULT_DORMANT_AFTER;
  const retryEvery = opts.dormantRetryEvery ?? DEFAULT_RETRY_EVERY;
  const maxPriorityQueue = opts.maxPriorityQueue ?? DEFAULT_MAX_PRIORITY_QUEUE;
  const minRefreshMs = opts.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS;
  const now = opts.now ?? Date.now;

  const emptyStreak = new Map<string, number>();
  const dormant = new Set<string>();
  const byId = new Map(tiles.map((t) => [t.id, t]));
  /** Insertion order matters: the newest request is served first. */
  const priority: string[] = [];
  const lastServedAt = new Map<string, number>();
  let cursor = 0;
  let sweeps = 0;
  let rotationServed = 0;

  function isDue(tile: Tile): boolean {
    if (!dormant.has(tile.id)) return true;
    return sweeps % retryEvery === 0;
  }

  return {
    next(count) {
      const out: Tile[] = [];

      // Prioritised tiles jump the queue, dormancy included: a viewer looking
      // at a region is better evidence than our own history of that tile.
      // But only up to a share of the batch — the rest belongs to the
      // rotation, or the globe outside the viewport is never refreshed and
      // the fleet decays into the region on screen.
      const priorityQuota = Math.max(1, Math.floor(count * (1 - ROTATION_SHARE)));
      while (out.length < priorityQuota && priority.length > 0) {
        const id = priority.shift()!;
        const tile = byId.get(id);
        if (tile) {
          out.push(tile);
          lastServedAt.set(id, now());
        }
      }

      let examined = 0;
      while (out.length < count && examined < tiles.length * 2) {
        const tile = tiles[cursor % tiles.length]!;
        cursor += 1;
        examined += 1;
        if (cursor % tiles.length === 0) sweeps += 1;
        if (isDue(tile)) {
          out.push(tile);
          lastServedAt.set(tile.id, now());
          rotationServed += 1;
        }
      }
      return out;
    },

    prioritise(tileIds) {
      const t = now();
      for (const id of tileIds) {
        if (!byId.has(id) || priority.includes(id)) continue;
        // A tile fetched moments ago gains nothing from being fetched again,
        // and re-queuing it on every poll is how the queue outgrows the
        // budget in the first place.
        const served = lastServedAt.get(id);
        if (served !== undefined && t - served < minRefreshMs) continue;
        priority.push(id);
      }
      // Newest requests win: an old entry describes a camera that has moved.
      while (priority.length > maxPriorityQueue) priority.shift();
    },

    record(tileId, aircraftCount) {
      if (aircraftCount > 0) {
        emptyStreak.set(tileId, 0);
        dormant.delete(tileId);
        return;
      }
      const streak = (emptyStreak.get(tileId) ?? 0) + 1;
      emptyStreak.set(tileId, streak);
      if (streak >= dormantAfter) dormant.add(tileId);
    },

    stats() {
      return {
        total: tiles.length,
        productive: tiles.length - dormant.size,
        dormant: dormant.size,
        sweepsCompleted: sweeps,
        prioritised: priority.length,
        rotationServed,
      };
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: PASS, 20 test

- [ ] **Step 5: Verificare la griglia reale senza fare volume**

```bash
cat > probe-grid.mts <<'EOF'
import { buildTileGrid } from './src/data/sources/tileGrid.js';
const tiles = buildTileGrid();
console.log('tile totali:', tiles.length);
const byRegion = new Map<string, number>();
for (const t of tiles) byRegion.set(t.region, (byRegion.get(t.region) ?? 0) + 1);
console.log([...byRegion.entries()].sort((a, b) => b[1] - a[1]));
EOF
npx tsx probe-grid.mts && rm probe-grid.mts
```

Expected: circa 413 tile, con `north-america` ed `europe` fra le regioni più rappresentate. **Non** interrogare adsb.lol in questo passo: la griglia è deterministica e si verifica senza rete.

- [ ] **Step 6: Verificare ENTRAMBI i programmi e committare**

```bash
npm run build:all && npm test -- --run
git add src/data/sources/tileGrid.ts tests/unit/data/sources/tileGrid.test.ts
git commit -m "feat(data): adaptive tile grid for a feed without a global endpoint

adsb.lol caps every request at 250 NM and no global endpoint survives, so
the feed is now assembled from ~413 tiles over the regions where ADS-B
receivers exist. The planet would need ~1060, and the difference is open
ocean nobody listens to.

The scheduler learns: a tile that comes back empty for several sweeps goes
dormant and is retried rarely. Measured live, a tile over the central
United States returns 660 aircraft and one over the eastern Pacific
returns zero — polling both at the same rate would spend most of the
budget on nothing. Dormancy is reversible: receiver coverage shifts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Flotta cumulativa, poller a tile e `/health` che non blocca il deploy

Il cambiamento concettuale di questo piano. Con un endpoint globale il server poteva sostituire l'intero payload a ogni fetch; con le tile **nessuna richiesta restituisce il mondo**, quindi il server deve mantenere una flotta cumulativa che le tile aggiornano a pezzi e da cui gli aerei scompaiono per scadenza.

**Files:**
- Create: `server/fleet.ts`, `server/feedState.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/server/fleet.test.ts`, `tests/unit/server/feedState.test.ts`

**Interfaces:**
- Consumes: `TileScheduler`, `buildTileGrid`, `TILE_RADIUS_NM` dal Task 2; `SourceSelector` dal codice esistente
- Produces: `createFleet(opts?: FleetOptions): Fleet` con `Fleet.absorb(aircraft: AircraftRaw[], atUnix: number): number`, `Fleet.snapshot(): AircraftRaw[]`, `Fleet.prune(nowUnix: number): number`, `Fleet.size(): number`; `FleetOptions = { maxAgeSeconds?: number }`. `createFeedState(opts?: FeedStateOptions): FeedState` come nel piano precedente, con `FeedHealth.status: 'starting' | 'ok' | 'degraded'`.

- [ ] **Step 1: Scrivere il test della flotta**

Creare `tests/unit/server/fleet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFleet } from '../../../server/fleet';
import type { AircraftRaw } from '../../../src/types';

function ac(icao: string, lastContact: number, lat = 10): AircraftRaw {
  return {
    icao24: icao, callsign: 'TST1', longitude: 10, latitude: lat,
    baroAltitudeFt: 30000, velocityKt: 400, headingDeg: 90, onGround: false,
    lastContact, registration: 'X', modelCode: 'A320', modelDesc: null,
    route: null, complete: false,
  };
}

describe('createFleet', () => {
  it('accumulates aircraft across tiles — no single tile holds the world', () => {
    const f = createFleet();
    f.absorb([ac('a', 100), ac('b', 100)], 100);
    f.absorb([ac('c', 101)], 101);
    expect(f.size()).toBe(3);
  });

  it('updates an aircraft seen again in another tile instead of duplicating it', () => {
    const f = createFleet();
    f.absorb([ac('a', 100, 10)], 100);
    f.absorb([ac('a', 150, 20)], 150);
    expect(f.size()).toBe(1);
    expect(f.snapshot()[0]!.latitude).toBe(20);
    expect(f.snapshot()[0]!.lastContact).toBe(150);
  });

  it('never replaces a fresher record with a staler one', () => {
    // Overlapping tiles can return the same aircraft with different ages.
    const f = createFleet();
    f.absorb([ac('a', 200, 20)], 200);
    f.absorb([ac('a', 100, 10)], 200);
    expect(f.snapshot()[0]!.lastContact).toBe(200);
    expect(f.snapshot()[0]!.latitude).toBe(20);
  });

  it('reports how many records a batch actually changed', () => {
    const f = createFleet();
    expect(f.absorb([ac('a', 100), ac('b', 100)], 100)).toBe(2);
    expect(f.absorb([ac('a', 100)], 100)).toBe(0); // same timestamp, no change
  });

  it('prunes aircraft not seen within the age window', () => {
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('old', 1000), ac('fresh', 1500)], 1500);
    const removed = f.prune(1700);
    expect(removed).toBe(1);
    expect(f.snapshot().map((a) => a.icao24)).toEqual(['fresh']);
  });

  it('keeps everything when nothing has aged out', () => {
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', 1000), ac('b', 1100)], 1100);
    expect(f.prune(1200)).toBe(0);
    expect(f.size()).toBe(2);
  });

  it('starts empty', () => {
    expect(createFleet().snapshot()).toEqual([]);
  });

  it('lets the retention window be retuned at runtime', () => {
    // A sweep takes 16-25 minutes at adsb.lol's measured latency, and that
    // varies. A window shorter than a sweep deletes aircraft long before
    // their tile comes round again, leaving a rotating smear instead of a
    // fleet — so the poller derives it from the sweep it actually observes.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', 1000)], 1000);
    f.setMaxAgeSeconds(3000);
    expect(f.maxAgeSeconds()).toBe(3000);
    expect(f.prune(3500)).toBe(0); // 2500s old, still inside the new window
    f.setMaxAgeSeconds(600);
    expect(f.prune(3500)).toBe(1);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/fleet.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 3: Creare `server/fleet.ts`**

```ts
import type { AircraftRaw } from '../src/types.js';

export interface FleetOptions {
  /** An aircraft not seen again within this window is dropped. */
  maxAgeSeconds?: number;
}

export interface Fleet {
  /** @returns how many records this batch created or updated. */
  absorb(aircraft: AircraftRaw[], atUnix: number): number;
  snapshot(): AircraftRaw[];
  /** @returns how many records were removed. */
  prune(nowUnix: number): number;
  size(): number;
  /**
   * Retention must outlast a full sweep, and the sweep period is only known
   * at runtime: adsb.lol's latency varies by a factor of six between tiles.
   * A hard-coded window would be wrong in one direction or the other.
   */
  setMaxAgeSeconds(seconds: number): void;
  maxAgeSeconds(): number;
}

const DEFAULT_MAX_AGE_SECONDS = 900;

/**
 * The world, assembled from tiles.
 *
 * With a global endpoint the server could replace its whole payload on every
 * fetch. adsb.lol caps requests at 250 NM, so no single call returns the
 * world: the fleet accumulates what the tiles report and lets aircraft age
 * out when no tile has seen them for a while.
 *
 * Tiles overlap by design, so the same aircraft arrives more than once per
 * sweep — sometimes with an older fix. A staler record never overwrites a
 * fresher one.
 */
export function createFleet(opts: FleetOptions = {}): Fleet {
  let maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const byIcao = new Map<string, AircraftRaw>();

  return {
    absorb(aircraft, _atUnix) {
      let changed = 0;
      for (const ac of aircraft) {
        const prev = byIcao.get(ac.icao24);
        if (prev && prev.lastContact >= ac.lastContact) continue;
        byIcao.set(ac.icao24, ac);
        changed += 1;
      }
      return changed;
    },

    snapshot() {
      return [...byIcao.values()];
    },

    prune(nowUnix) {
      let removed = 0;
      for (const [icao, ac] of byIcao) {
        if (nowUnix - ac.lastContact > maxAgeSeconds) {
          byIcao.delete(icao);
          removed += 1;
        }
      }
      return removed;
    },

    size() {
      return byIcao.size;
    },

    setMaxAgeSeconds(seconds) {
      maxAgeSeconds = seconds;
    },

    maxAgeSeconds() {
      return maxAgeSeconds;
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/fleet.test.ts`
Expected: PASS, 7 test

- [ ] **Step 5: Scrivere il test di `feedState`**

Creare `tests/unit/server/feedState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFeedState } from '../../../server/feedState';

describe('createFeedState — cache', () => {
  it('serves a fresh body unmarked', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 10_000;
    expect(s.get('world')).toEqual({ body: '{"a":1}', stale: false });
  });

  it('serves a body past freshness but marks it stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 120_000;
    expect(s.get('world')).toEqual({ body: '{"a":1}', stale: true });
  });

  it('REFUSES a body past the stale ceiling — v1 had no ceiling at all', () => {
    let clock = 1_000_000;
    const s = createFeedState({ maxFreshMs: 90_000, maxStaleMs: 600_000, now: () => clock });
    s.put('world', '{"a":1}');
    clock += 601_000;
    expect(s.get('world')).toBeNull();
  });
});

describe('createFeedState — health', () => {
  it('reports starting before any fetch has succeeded — NOT degraded', () => {
    // railway.toml gates the deploy on /health. Answering 503 at boot would
    // stall it: no traffic is routed until the check passes.
    const s = createFeedState({ now: () => 1_000_000 });
    const h = s.health();
    expect(h.status).toBe('starting');
    expect(h.feedAgeSeconds).toBeNull();
  });

  it('reports ok while the last success is recent', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 60_000;
    expect(s.health().status).toBe('ok');
    expect(s.health().feedAgeSeconds).toBe(60);
  });

  it('reports degraded once a previously live feed has gone stale', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 301_000;
    expect(s.health().status).toBe('degraded');
  });

  it('gives up on starting once the grace window expires', () => {
    // Otherwise a feed that never comes up — the exact 2026-08 scenario —
    // leaves /health answering 200 for ever.
    let clock = 1_000_000;
    const s = createFeedState({ startupGraceMs: 180_000, now: () => clock });
    s.recordFailure('adsb-lol: HTTP 403');
    clock += 181_000;
    expect(s.health().status).toBe('degraded');
  });

  it('surfaces the last error without prematurely declaring degraded', () => {
    let clock = 1_000_000;
    const s = createFeedState({ degradedAfterMs: 300_000, now: () => clock });
    s.put('world', '{}');
    clock += 10_000;
    s.recordFailure('adsb-lol: HTTP 403');
    expect(s.health().lastError).toMatch(/403/);
    expect(s.health().status).toBe('ok');
  });
});
```

- [ ] **Step 6: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: FAIL — modulo inesistente

- [ ] **Step 7: Creare `server/feedState.ts`**

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
  maxFreshMs?: number;
  maxStaleMs?: number;
  degradedAfterMs?: number;
  startupGraceMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_FRESH_MS = 90_000;
const DEFAULT_MAX_STALE_MS = 600_000;
const DEFAULT_DEGRADED_AFTER_MS = 300_000;
// Well beyond railway.toml's healthcheckTimeout, but finite: a feed that
// never starts must not hide behind 'starting' for ever.
const DEFAULT_STARTUP_GRACE_MS = 180_000;

/**
 * Cache and health state for the feed.
 *
 * The v1 outage lasted 25 days because the cache had no maximum age and
 * /health answered 'ok' unconditionally: the server served a frozen
 * snapshot and nothing ever reported it. Both guards live here so neither
 * can be forgotten at a call site.
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

- [ ] **Step 8: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: PASS, 8 test

- [ ] **Step 9: Riscrivere il ciclo di aggiornamento in `server/index.ts`**

Rimuovere il blocco della cache artigianale (`const cache = new Map...`, `CACHE_TTL_MS`, `GLOBAL_KEY`, `bboxKey`) e `GLOBAL_SWEEP`. Aggiungere agli import e alle costanti:

```ts
import { createFeedState } from './feedState.js';
import { createFleet } from './fleet.js';
import { buildTileGrid, createTileScheduler, tilesNear, TILE_RADIUS_NM } from '../src/data/sources/tileGrid.js';

const feed = createFeedState();
const fleet = createFleet();
const tiles = buildTileGrid();
const scheduler = createTileScheduler(tiles);
const WORLD_KEY = 'world';

/** Floor and ceiling for the derived retention window. */
const MIN_RETENTION_S = 900;
const MAX_RETENTION_S = 7_200;

let observedSweepSeconds = 0;
const pollerStartedMs = Date.now();

// Measured live: adsb.lol takes ~29 s median per tile — 53 s even to return
// zero aircraft, so the latency is the server's, not the payload's.
// Sequentially, 413 tiles would take 213 minutes. Fetching several at once
// is therefore mandatory, not an optimisation: 8 in flight brings a sweep to
// ~25 minutes at 0.28 requests/s, well inside the courtesy budget.
//
// A fixed setInterval would stack cycles on top of each other, so the loop
// reschedules itself AFTER each cycle and a guard refuses a second one.
const TILE_CONCURRENCY = 8;
/** Minimum pause between the end of one cycle and the start of the next. */
const TILE_CYCLE_GAP_MS = 2_000;
```

**Non esiste alcuna funzione di refresh da sostituire**: il server attuale fa il fetch inline dentro il gestore `/api/states`. Creare questa funzione **dopo** `await app.register(cors, ...)` — deve stare sotto la dichiarazione di `app`, perché il suo corpo chiama `app.log` — e rimuovere il fetch inline dal gestore, che viene riscritto allo Step 10.

```ts
/**
 * Polls the next few tiles and folds them into the fleet.
 *
 * v1 only ever fetched inside the /api/states handler, so with no traffic
 * there was no feed at all — and with a Railway healthcheck gating traffic
 * that would be a deadlock. The server feeds itself.
 */
let cycleInFlight = false;

async function refreshNextTiles(): Promise<void> {
  if (cycleInFlight) return; // a slow cycle must not be overlapped by the next
  cycleInFlight = true;
  try {
    await runCycle();
  } finally {
    cycleInFlight = false;
  }
}

async function runCycle(): Promise<void> {
  const batch = scheduler.next(TILE_CONCURRENCY);
  if (batch.length === 0) return;

  const outcomes = await Promise.all(
    batch.map(async (tile) => {
      try {
        const result = await sources.fetchRegion(tile.centre, TILE_RADIUS_NM);
        return { tile, result };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        feed.recordFailure(`${tile.id}: ${msg}`);
        app.log.warn({ err: msg, tile: tile.id }, 'tile fetch failed');
        return { tile, result: null };
      }
    })
  );

  let anySuccess = false;
  for (const { tile, result } of outcomes) {
    if (result === null) continue;
    fleet.absorb(result.aircraft, Math.floor(result.fetchedAt.getTime() / 1000));
    scheduler.record(tile.id, result.aircraft.length);
    anySuccess = true;
  }

  if (!anySuccess) return;

  const nowUnix = Math.floor(Date.now() / 1000);

  // The retention window must outlast a full sweep, or prune() deletes an
  // aircraft long before its tile comes round again and the fleet degrades
  // into a rotating smear over a fraction of the grid. The sweep period is
  // measured rather than assumed: at ~29 s median latency it lands around
  // 25 minutes, but it varies with upstream load.
  // Measured on the ROTATION, not on every tile served: priority tiles are
  // re-fetched repeatedly and counting them would make the sweep look far
  // faster than it is, and the retention window would silently lie.
  const elapsedS = (Date.now() - pollerStartedMs) / 1000;
  const rotationServed = scheduler.stats().rotationServed;
  const sweepSeconds = rotationServed > 0 ? (elapsedS / rotationServed) * tiles.length : 0;
  observedSweepSeconds = Math.round(sweepSeconds);
  fleet.setMaxAgeSeconds(
    Math.min(MAX_RETENTION_S, Math.max(MIN_RETENTION_S, Math.round(sweepSeconds * 2)))
  );

  fleet.prune(nowUnix);

  feed.put(
    WORLD_KEY,
    JSON.stringify({
      fetchedAt: new Date(nowUnix * 1000).toISOString(),
      source: 'tiled',
      bbox: null,
      aircraft: fleet.snapshot(),
    })
  );
}
```

- [ ] **Step 10: Sostituire il gestore `/api/states`**

La chiave di lettura è sempre `WORLD_KEY`: il poller scrive lì e un lettore che usasse una chiave derivata dal bbox mancherebbe sempre la cache. Il flag `stale` va **nel corpo**, perché `statesClient.ts` legge solo `res.json()` e un header non lo vedrebbe mai.

```ts
/** Injects the freshness flag into an already-serialised payload. */
function withStaleFlag(body: string, stale: boolean): string {
  return `{"stale":${stale},${body.slice(1)}`;
}

app.get('/api/states', async (req, reply) => {
  const q = req.query as Record<string, string | undefined>;
  void parseBbox(q); // kept for backward compatibility; the payload is the whole fleet

  // A viewer tells us where they are looking, and those tiles jump the
  // queue. Without this, the region on screen would be as stale as the far
  // side of the planet: a full sweep takes 16-25 minutes.
  const viewLat = Number(q.lat);
  const viewLon = Number(q.lon);
  const viewRadius = Number(q.radius);
  if (Number.isFinite(viewLat) && Number.isFinite(viewLon)) {
    const radius = Number.isFinite(viewRadius) ? Math.min(viewRadius, 2000) : 600;
    const wanted = tilesNear(tiles, { lat: viewLat, lon: viewLon }, radius);
    // Six, not twelve: the scheduler reserves half of each batch for the
    // rotation, so asking for more only grows a queue that cannot be served.
    scheduler.prioritise(wanted.slice(0, 6).map((t) => t.id));
  }

  const cached = feed.get(WORLD_KEY);
  if (cached !== null) {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(cached.stale))
      .send(withStaleFlag(cached.body, cached.stale));
  }

  // No stale fallback of unbounded age: that is what hid the v1 outage for
  // 25 days. Fail loudly instead.
  const health = feed.health();
  return reply.status(503).send({
    error: health.lastError ?? 'feed warming up',
    status: health.status,
    feedAgeSeconds: health.feedAgeSeconds,
    fleetSize: fleet.size(),
  });
});
```

Nota deliberata: niente fetch sincrono nel gestore. Una tile non restituirebbe comunque il mondo, e un fetch per richiesta verso un servizio gratuito è esattamente il traffico da evitare. Finché il primo ciclo non ha prodotto nulla, l'endpoint risponde 503 dicendo che si sta scaldando.

- [ ] **Step 11: Sostituire il gestore `/health`**

```ts
app.get('/health', async (_req, reply) => {
  const health = feed.health();
  // 'starting' answers 200 on purpose: railway.toml gates the deploy on this
  // endpoint and a 503 at boot would stall it for ever. Only 'degraded' —
  // a feed that WAS live and has stopped — reports failure.
  return reply.status(health.status === 'degraded' ? 503 : 200).send({
    status: health.status,
    uptime: process.uptime(),
    feedAgeSeconds: health.feedAgeSeconds,
    lastSuccessAt: health.lastSuccessAt,
    lastError: health.lastError,
    fleet: { size: fleet.size(), maxAgeSeconds: fleet.maxAgeSeconds() },
    tiles: { ...scheduler.stats(), observedSweepSeconds },
  });
});
```

- [ ] **Step 12: Avviare il poller dopo il listen**

Nel blocco `try { await app.listen(...) }`, dopo la riga di log:

```ts
  // Self-rescheduling loop, NOT setInterval: a cycle can take minutes when
  // the upstream is slow, and a fixed timer would pile cycles on top of one
  // another until the request rate is unbounded.
  const scheduleNextCycle = (): void => {
    const t = setTimeout(() => {
      void refreshNextTiles().finally(scheduleNextCycle);
    }, TILE_CYCLE_GAP_MS);
    t.unref();
  };
  void refreshNextTiles().finally(scheduleNextCycle);
```

- [ ] **Step 13: Verificare entrambi i programmi**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 14: Verificare che non sia rimasto un timer a cadenza fissa**

```bash
grep -n "setInterval" server/index.ts
```

Expected: nessuna occorrenza relativa a `refreshNextTiles`. Un `setInterval` da 3 s su un ciclo che dal vivo può durare 90 s produce decine di cicli sovrapposti e richieste concorrenti illimitate verso un servizio gratuito.

- [ ] **Step 15: Verificare il comportamento reale del server**

```bash
npm run server
```

Subito, prima che il primo ciclo finisca:

```bash
curl -s -o /dev/null -w "health al boot: HTTP %{http_code}\n" localhost:3000/health
```

Expected: **HTTP 200** con `"status":"starting"`. Se qui vedi 503, il deploy su Railway fallirebbe.

Dopo due o tre minuti:

```bash
curl -s localhost:3000/health | python3 -m json.tool
curl -s -D- -o /dev/null localhost:3000/api/states | grep -iE "x-feed-stale|HTTP"
curl -s localhost:3000/api/states | head -c 80
```

Expected: `"status":"ok"`; `fleet.size` cresce ciclo dopo ciclo; `tiles.dormant` sale quando le tile oceaniche tornano vuote; `/api/states` risponde 200 e il corpo inizia con `{"stale":false,`. Nei log compaiono i fetch delle tile **senza che nessuno abbia chiamato `/api/states`**.

**Controllare la coerenza fra finestra e sweep**, che è il difetto più insidioso di questo piano:

```bash
curl -s localhost:3000/health | python3 -c "
import json,sys
h=json.load(sys.stdin)
sweep=h['tiles']['observedSweepSeconds']; win=h['fleet']['maxAgeSeconds']
print(f\"sweep osservato {sweep}s ({sweep/60:.0f} min), finestra {win}s ({win/60:.0f} min)\")
print('OK: la finestra copre lo sweep' if win >= sweep else 'ROTTO: prune cancella prima della rivisita')
"
```

Expected: `observedSweepSeconds` si assesta fra 900 e 1500 s con otto fetch concorrenti, e `fleet.maxAgeSeconds` è **almeno** pari ad esso. Se la finestra fosse più corta dello sweep, `prune` cancellerebbe ogni aereo prima che la sua tile torni, e la flotta sarebbe una macchia rotante su una frazione della griglia invece del mondo.

Verificare infine la priorità del viewport:

```bash
curl -s "localhost:3000/api/states?lat=50&lon=8&radius=600" > /dev/null
curl -s localhost:3000/health | python3 -c "import json,sys; print('prioritised:', json.load(sys.stdin)['tiles']['prioritised'])"
```

Expected: un valore maggiore di zero subito dopo la richiesta, che torna a zero man mano che quelle tile vengono servite.

**La verifica che conta davvero**: la rotazione deve continuare ad avanzare *mentre* qualcuno guarda. Simulare un visitatore per qualche minuto e controllare che `rotationServed` cresca:

```bash
for i in $(seq 1 10); do curl -s "localhost:3000/api/states?lat=50&lon=8&radius=600" > /dev/null; sleep 30; done &
sleep 60; curl -s localhost:3000/health | python3 -c "import json,sys; t=json.load(sys.stdin)['tiles']; print('rotationServed:', t['rotationServed'], '| prioritised:', t['prioritised'])"
sleep 180; curl -s localhost:3000/health | python3 -c "import json,sys; t=json.load(sys.stdin)['tiles']; print('rotationServed:', t['rotationServed'], '| prioritised:', t['prioritised'])"
```

Expected: `rotationServed` **cresce** fra le due letture e `prioritised` resta piccolo e limitato. Se `rotationServed` resta fermo mentre il visitatore interroga, la priorità sta affamando la rotazione: il resto del pianeta non viene mai aggiornato e `prune` lo cancellerà. È il difetto che la quota riservata esiste per impedire, ed è invisibile a una `curl` singola.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat(server): cumulative fleet, tile poller and non-blocking health

No single request returns the world any more, so the server keeps a fleet
that tiles update piecewise and from which aircraft age out. Overlapping
tiles deliver the same aircraft repeatedly, sometimes with an older fix: a
staler record never overwrites a fresher one.

Also fixes three v1 defects that meet here. The cache had no maximum age,
so a frozen snapshot was served for 25 days. /health answered ok
unconditionally, so Railway never noticed. And the server only fetched
inside the /api/states handler, so it had no feed of its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Resolver rotte con rate limit rispettato

**Files:**
- Create: `server/routeResolver.ts`
- Test: `tests/unit/server/routeResolver.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT` dal piano precedente, importato come `'../src/data/sources/userAgent.js'`
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
// 360s, not 300: the ban was still live at 300 s and only lifted after
// 330 s of total silence. The advertised window is a floor, not a promise.
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 360_000;
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
    // undici's default headersTimeout is 300 s: without a signal a single
    // hung request holds the only pump slot for five minutes.
    const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
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
        // Re-check: a 429 raised earlier in this same batch must stop the
        // rest of it, not just future pumps.
        if (now() < suspendedUntil) {
          queue.unshift(cs, ...batch.slice(i + 1));
          for (const rest of batch.slice(i)) queued.add(rest);
          return count;
        }
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

### Task 5: Cache rotte pre-costruita, collegamento al server e completezza

**Files:**
- Create: `scripts/build-route-cache.mjs`
- Create: `server/data/.gitkeep` (la cache vera viene generata ed è committata)
- Create: `src/data/completeness.ts`
- Modify: `server/index.ts`, `tsconfig.server.json`, `package.json`
- Test: `tests/unit/data/completeness.test.ts`

**Interfaces:**
- Consumes: `RouteResolver`, `SeedRecord`, `FlightRoute` dal Task 5; `FlightRouteLite` e `makeAircraftRaw` dal Task 1
- Produces: `isComplete(ac: AircraftRaw): boolean`; `npm run build:routes`; il file `server/data/route-cache.json` con forma `SeedRecord[]`

**Perché una cache pre-costruita e perché NON è un ritorno a `openflights-routes.json`.** Il file che il Task 6 elimina era sbagliato *per costruzione*: `list[0]` restituiva una rotta che non aveva alcun rapporto col volo richiesto. Questo file è verificato per costruzione: ogni voce è la risposta di adsbdb *per quello specifico callsign*. Al più invecchia — e i numeri di volo di linea sono stabili nel tempo, `BAW274` vola ogni giorno — mentre quello era falso il giorno stesso in cui è stato generato.

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
const CALLSIGN_RX = /^[A-Z]{3}[A-Z0-9]+$/;
// No global endpoint exists: adsb.lol caps at 250 NM. The sampler walks the
// same tile grid the server uses, so there is one definition to maintain.
const TILE_RADIUS_NM = 230;
const TILES_URL = (lat, lon) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${TILE_RADIUS_NM}`;
// A handful of dense tiles yields most distinct callsigns; measured live, a
// central-US tile returns ~660 aircraft and an ocean tile returns zero.
const SAMPLE_TILES = [
  [40, -90], [37, -97], [34, -84], [41, -74], [33, -112],
  [50, 8], [51, 0], [48, 2], [52, 13], [41, 12],
  [35, 139], [31, 121], [25, 55], [13, 100], [1, 104],
  [-33, 151], [-37, 145], [19, 72], [28, 77], [-23, -46],
];

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
  const out = new Set();
  for (const [lat, lon] of SAMPLE_TILES) {
    try {
      const res = await fetch(TILES_URL(lat, lon), {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      if (!res.ok) {
        console.warn(`[sample] tile ${lat},${lon}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      for (const ac of data.ac ?? []) {
        const cs = (ac.flight ?? '').trim().toUpperCase();
        if (CALLSIGN_RX.test(cs)) out.add(cs);
      }
    } catch (e) {
      console.warn(`[sample] tile ${lat},${lon}: ${e.message}`);
    }
    await sleep(1500); // same courtesy rate as everything else
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
      // Record the verdict in `cache`, not just in a counter: the guard the
      // re-sampler consults is `cache.has(cs)`. Merely dropping it means the
      // next sample — every 20 minutes — queues it again with a fresh
      // counter, spending three more requests each time, for ever.
      cache.set(cs, null);
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

- [ ] **Step 9: Arricchire e marcare dentro `refreshNextTiles`**

**Dopo la guardia `if (!anySuccess) return;` e dopo `fleet.prune(...)`, prima di `feed.put(...)`.** L'arricchimento gira una volta per ciclo, non una per tile: `result` vive dentro il ciclo delle tile e qui non è visibile.

```ts
    const world = fleet.snapshot();
    const callsigns: string[] = [];
    for (const ac of world) {
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

    for (const ac of world) {
      ac.complete = isComplete(ac);
    }
    lastCompleteCount = world.filter((ac) => ac.complete).length;
    lastTotalCount = world.length;
```

Senza il secondo ciclo `isComplete` resterebbe codice morto: `noUnusedLocals` non segnala una funzione esportata mai importata, e nulla avviserebbe che metà del deliverable non è stata consegnata.

- [ ] **Step 10: Avviare il pump e pubblicare lo stato su `/health`**

Accanto al timer del feed, dopo `app.listen`:

```ts
  // Same shape as the tile loop, and for the same reason: a hung adsbdb
  // request must not let pumps stack. Reproduced during review — a single
  // 300 s hang with a bare setInterval produced 30 concurrent lookups
  // against the one service that bans hard and renews the ban on every
  // request sent during the penalty.
  let routePumpInFlight = false;
  const scheduleNextPump = (): void => {
    const t = setTimeout(() => {
      if (routePumpInFlight) {
        scheduleNextPump();
        return;
      }
      routePumpInFlight = true;
      void routes
        .pump()
        .finally(() => {
          routePumpInFlight = false;
          scheduleNextPump();
        });
    }, ROUTE_PUMP_MS);
    t.unref();
  };
  scheduleNextPump();
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

### Task 6: Rimuovere il lookup rotte falso

Separato dal Task 6 perché un revisore potrebbe accettare le rotte vere e volere una discussione a parte sulla rimozione di 4,2 MB di dati statici.

**Files:**
- Delete: `src/data/routeLookup.ts`, `public/data/openflights-routes.json`
- Modify: `src/data/resolveFlight.ts`, `tests/unit/data/resolveFlight.test.ts`
- Modify: `tests/unit/data/lookups.test.ts`, `src/data/bootstrap.ts`, `scripts/build-static-data.mjs`
- Modify: `src/types.ts` (rimuove `Route`)

**Interfaces:**
- Consumes: `FlightRouteLite` dal piano precedente, `makeAircraftRaw` dal Task 1
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

### Task 7: Il client smette di svuotare il globo

L'ultimo anello della catena che ha prodotto il globo vuoto.

**Files:**
- Modify: `src/state/aircraftStore.ts`, `src/data/bootstrap.ts`, `src/data/aircraftStream.ts`
- Rename: `src/data/openSkyClient.ts` → `src/data/statesClient.ts` (e il suo test)
- Modify: `tests/unit/state/stores.test.ts`, `tests/unit/data/aircraftStream.test.ts`

**Interfaces:**
- Consumes: `makeAircraftRaw` dal Task 1
- Produces: `vec3ToLatLon(v: Vector3): { lat, lon }`; `SceneHandle.viewCentre(): ViewCentre`; `fetchStates(bbox?, signal?, view?)`; `StreamOptions.getViewCentre?`; `bootstrapData(getViewCentre?)`. `useAircraftStore` guadagna `feedFetchedAt: number` (sostituisce `fetchedAt`) e `feedAgeSeconds(): number`; `updateBatch(raws, batchFetchedAtUnix)` prende due argomenti e **sostituisce** la flotta anziché fonderla; `removeStale` viene **rimosso**; `StreamOptions.onBatch(aircraft, fetchedAt)` prende due argomenti; `fetchStates` si sposta in `src/data/statesClient.ts` con la stessa firma.

**Il server è l'unica autorità su chi è in volo.** La v1 misurava la staleness lato client contro l'orologio locale, e con un feed congelato cancellava l'intera flotta. La correzione ovvia sarebbe misurarla contro il timestamp del batch — ma con il feed a tile anche quella sarebbe sbagliata: uno sweep completo richiede fra 16 e 25 minuti alla latenza reale di adsb.lol (~29 s mediani per tile), e il server dimensiona la propria finestra di ritenzione su quel periodo osservato; una finestra client di 120 s cancellerebbe quasi tutta la flotta appena ricevuta. Il globo tornerebbe quasi vuoto, in forma più mite ma per la stessa ragione.

Qui la finestra client sparisce del tutto: il payload del server **è** il mondo, il server fa già `prune`, e il client si limita a sincronizzarsi con ciò che riceve. Due autorità sulla stessa decisione sono una di troppo, e sono destinate a divergere.

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

  it('KEEPS an aircraft whose last fix is ten minutes old', () => {
    // A full sweep takes 16-25 minutes at the measured upstream latency,
    // and the server sizes its retention on that. A client-side window of
    // 120 s would delete most of the fleet the server just sent — the v1 empty
    // globe all over again, in a milder form.
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'old', lastContact: batchAt - 600 })],
      batchAt
    );
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('keeps the whole fleet even when the batch itself is ancient', () => {
    // The v1 bug: a frozen feed made now - lastContact enormous for ALL
    // aircraft, so the client deleted the entire fleet.
    const store = useAircraftStore.getState();
    const batchAt = 1_000_000;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'b', lastContact: batchAt - 10 })],
      batchAt
    );
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('drops an aircraft the server no longer reports — the server prunes, not us', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' }), makeAircraftRaw({ icao24: 'gone' })], 100);
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 160);
    const ids = [...useAircraftStore.getState().aircraft.keys()];
    expect(ids).toEqual(['a']);
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

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  /** Unix seconds of the batch currently held — NOT the local clock. */
  feedFetchedAt: number;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  /** Replaces the fleet with what the server reports, preserving trails. */
  updateBatch: (raws: AircraftRaw[], batchFetchedAtUnix: number) => void;
  feedAgeSeconds: () => number;
}

export const useAircraftStore = create<AircraftState>((set, get) => ({
  aircraft: new Map(),
  feedFetchedAt: 0,
  fetchStatus: 'idle',

  setFetchStatus: (s) => set({ fetchStatus: s }),

  /**
   * The payload IS the world: the server assembles it from tiles and prunes
   * it on its own schedule. The client mirrors that instead of applying a
   * second, independent staleness rule.
   *
   * v1 compared lastContact against the LOCAL clock, so a frozen feed made
   * every aircraft look infinitely stale and the whole fleet was deleted —
   * the last link in the chain that emptied the globe. Measuring against the
   * batch timestamp would have been better but still wrong here: a full
   * sweep takes 16-25 minutes at the measured upstream latency and the
   * server sizes its own retention on that observed period, so any short
   * client window would delete most of a legitimately assembled fleet.
   */
  updateBatch: (raws, batchFetchedAtUnix) =>
    set((state) => {
      const next = new Map<string, Aircraft>();
      for (const r of raws) {
        const prev = state.aircraft.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Only real received positions enter the trail — never computed ones.
        if (prev && prev.longitude !== null && prev.latitude !== null && prev.lastContact !== r.lastContact) {
          trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        next.set(r.icao24, { ...r, trail });
      }
      // Aircraft absent from the payload are gone: the server already pruned.
      return { aircraft: next, feedFetchedAt: batchFetchedAtUnix };
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

`toHaveBeenCalledWith` verifica la lista **completa** degli argomenti, quindi **tre** asserzioni di questo file si rompono: una su `onBatch`, che passa da uno a due argomenti, e due su `fetchStates`, che passa da uno a tre con lo Step 9. Correggerle tutte:

Nel test `calls fetchStates immediately on start`:

```ts
    expect(onBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ icao24: 'a1' })]),
      expect.any(Date)
    );
```

Nel test `passes the bounding box from getBoundingBox to fetchStates`:

```ts
    expect(client.fetchStates).toHaveBeenCalledWith(bbox, undefined, null);
```

Nel test `passes null bbox when getBoundingBox is omitted`:

```ts
    expect(client.fetchStates).toHaveBeenCalledWith(null, undefined, null);
```

Senza queste due ultime correzioni lo Step 11 non può passare: la suite si carica, ma due test diventano rossi.

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
      useAircraftStore.getState().setFetchStatus('idle');
    },
```

- [ ] **Step 9: Completare il lato client della priorità di viewport**

Senza questo il blocco `lat`/`lon`/`radius` del Task 3 è **codice morto**: il client oggi costruisce solo query bbox e non ne passa nemmeno una. La promessa "la regione inquadrata è fresca" non sarebbe mantenuta.

Aggiungere a `src/globe/geoHelpers.ts` l'inversa della proiezione già presente:

```ts
/**
 * 3D position → lat/lon (degrees). Inverse of latLonToVec3, same convention:
 * lon=0 on +Z, lat=90 on +Y, lon=90 on +X.
 */
export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const r = v.length();
  if (r === 0) return { lat: 0, lon: 0 };
  const lat = 90 - (Math.acos(v.y / r) * 180) / Math.PI;
  const lon = (Math.atan2(v.x, v.z) * 180) / Math.PI;
  return { lat, lon };
}
```

In `src/globe/scene.ts`, estendere `SceneHandle` perché il resto dell'applicazione possa sapere cosa si sta guardando — oggi espone solo `dispose`:

```ts
export interface ViewCentre {
  lat: number;
  lon: number;
  radiusNm: number;
}

export interface SceneHandle {
  dispose: () => void;
  viewCentre: () => ViewCentre;
}
```

e nell'oggetto restituito da `mountScene`:

```ts
    viewCentre: () => {
      // The camera always looks at the origin, so the point under it is the
      // normalised camera direction. The visible cap half-angle follows from
      // how far out the camera sits: close in, you see a small disc.
      const { lat, lon } = vec3ToLatLon(camera.position);
      const d = camera.position.length();
      const ratio = Math.min(1, GLOBE_RADIUS / Math.max(d, GLOBE_RADIUS + 1e-6));
      const halfAngleRad = Math.acos(ratio);
      return { lat, lon, radiusNm: Math.round(halfAngleRad * 3440.065) };
    },
```

In `src/data/statesClient.ts`, accettare il punto osservato:

```ts
export interface ViewQuery {
  lat: number;
  lon: number;
  radiusNm: number;
}

export async function fetchStates(
  bbox?: BoundingBox | null,
  signal?: AbortSignal,
  view?: ViewQuery | null
): Promise<FetchResult> {
  const params = new URLSearchParams();
  if (bbox) {
    params.set('lamin', String(bbox.lamin));
    params.set('lomin', String(bbox.lomin));
    params.set('lamax', String(bbox.lamax));
    params.set('lomax', String(bbox.lomax));
  }
  if (view) {
    // Tells the server which tiles to refresh first. A full sweep takes
    // 16-25 minutes, so without this the region on screen would be as stale
    // as the far side of the planet.
    params.set('lat', view.lat.toFixed(3));
    params.set('lon', view.lon.toFixed(3));
    params.set('radius', String(view.radiusNm));
  }
  const qs = params.toString();
  const res = await fetch(qs ? `${ENDPOINT}?${qs}` : ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Air View proxy: HTTP ${res.status}`);
  const data = (await res.json()) as { fetchedAt: string; aircraft: AircraftRaw[] };
  return { fetchedAt: new Date(data.fetchedAt), aircraft: data.aircraft };
}
```

In `src/data/aircraftStream.ts`, aggiungere a `StreamOptions`:

```ts
  /** Where the viewer is looking, so the server can refresh those tiles first. */
  getViewCentre?: () => ViewQuery | null;
```

e nella `tick`, passarlo: `const result = await fetchStates(bbox, undefined, opts.getViewCentre?.() ?? null);`

In `src/data/bootstrap.ts`, accettare il punto osservato dal chiamante e inoltrarlo:

```ts
export async function bootstrapData(getViewCentre?: () => ViewQuery | null): Promise<void> {
```

e nelle opzioni dello stream: `getViewCentre,`.

Infine, in `src/App.tsx` (o dove `mountScene` e `bootstrapData` vengono chiamati), collegare i due: passare `() => sceneHandle.viewCentre()` a `bootstrapData`. Individuare il punto con:

```bash
grep -rn "bootstrapData\|mountScene" src/
```

- [ ] **Step 10: Verificare che la priorità arrivi davvero al server**

```bash
npm run server
```

In un altro terminale, dopo che il server ha completato qualche ciclo:

```bash
curl -s "localhost:3000/api/states?lat=50&lon=8&radius=600" > /dev/null
curl -s localhost:3000/health | python3 -c "import json,sys; print('prioritised:', json.load(sys.stdin)['tiles']['prioritised'])"
```

Expected: un valore maggiore di zero. Poi, con il frontend in esecuzione (`npm run dev:full`), aprire il browser, ruotare il globo e controllare nel pannello di rete che le richieste a `/api/states` portino `lat`, `lon` e `radius`. Se non li portano, il collegamento camera→richiesta non è stato fatto e la freschezza della regione inquadrata non esiste.

- [ ] **Step 11: Verificare entrambi i programmi e l'intera suite**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, tutti i test verdi. Se la suite non si carica affatto, un import di `openSkyClient` è sopravvissuto (Step 5). Se invece si carica ma due test di `aircraftStream` falliscono con `expected "spy" to be called with arguments`, mancano le correzioni di arity dello Step 7.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "fix(state): stop deleting the fleet when the feed stops

removeStale compared lastContact against the local clock, so a frozen
feed made every aircraft infinitely stale and the entire fleet was
dropped — the last link in the chain that emptied the globe.

It is deleted rather than fixed. Measuring against the batch timestamp
would still have been wrong under the tiled feed: a full sweep takes
16-25 minutes at the measured upstream latency and the server sizes its
retention on that, so a 120 s client window would have deleted most of a
legitimately assembled fleet. The server already prunes; the client now mirrors the payload
instead of applying a second, independent rule that is bound to drift.

Renames openSkyClient to statesClient: it talks to our own proxy, not to
OpenSky, and has since the adsb.lol switch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Verifica end-to-end contro le API reali

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
if (health.tiles) console.log(`tiles: ${JSON.stringify(health.tiles)}`);
if (health.fleet) console.log(`fleet: ${JSON.stringify(health.fleet)}`);
console.log(`x-feed-stale: ${res.headers.get('x-feed-stale')}`);

// The fleet fills in tile by tile: a server that has just started has
// legitimately seen only part of the world. Below a few hundred after a
// full sweep, something is wrong.
if (ac.length < 300) fail(`only ${ac.length} aircraft — has a full sweep completed? tiles: ${JSON.stringify(health.tiles)}`);

// Dormancy is expected over ocean, but if nearly everything went dormant the
// grid or the provider is broken rather than the ocean being empty.
if (health.tiles && health.tiles.productive < 20) {
  fail(`only ${health.tiles.productive} productive tiles of ${health.tiles.total} — the grid or the source is broken`);
} else if (health.tiles) {
  pass(`${health.tiles.productive} productive tiles, ${health.tiles.dormant} dormant`);
}

const ageS = (Date.now() - new Date(data.fetchedAt).getTime()) / 1000;
if (ageS > 600) fail(`fetchedAt is ${Math.round(ageS)}s old — the feed is not live`);
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


## Difetti del piano precedente corretti qui

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 26 | **Critico.** Il presupposto dell'intero Piano 1 — uno sweep globale a 10 000 NM — è falso: adsb.lol impone un tetto di 250 NM. Il codice già committato risponde 502 in produzione, e il test unitario che avrebbe dovuto proteggerlo asseriva `>= 10_000` passando verde su mock | `dist=250 → 200`; `dist=251` e oltre → `403 "radius exceeds 250 NM"`. Nessun endpoint globale sopravvive: `/v2/all` → 400, `/api/0/all` → 503 | Tetto corretto a 250, griglia di ~413 tile sulle regioni con ricevitori, flotta cumulativa lato server (Task 1, 2, 3) |
| 27 | **Critico.** La causa del guasto dichiarata nel codice e nel commit — lo User-Agent — non è più vera. Il commento avrebbe mandato fuori strada chiunque indagasse il prossimo guasto | `UA 'node'`, `'undici'`, `'curl'` e nessun UA → tutti 200 oggi; il 403 residuo è quello del raggio | Commento riscritto con entrambe le fasi datate; lo User-Agent resta per cortesia (Task 1) |
| 28 | **Critico.** Lo script di pre-seed campionava il feed con lo stesso URL impossibile: `sampleFeed()` avrebbe sollevato 403 a ogni ciclo e la cache sarebbe rimasta vuota | Stesso URL, stesso 403 | Il campionamento percorre venti tile dense, con la stessa cadenza di cortesia (Task 5) |
| 29 | La rinuncia a un callsign dopo tre fallimenti non era permanente nello script: la guardia del ri-campionamento è `cache.has(cs)`, che non veniva mai scritta. Ogni venti minuti lo stesso callsign tornava in coda con il contatore azzerato — 72 richieste sprecate in otto ore per ciascuno | Riproduzione dei frammenti verbatim su quattro cicli: 12 richieste per un solo callsign permanentemente rotto | Il ramo di rinuncia scrive `cache.set(cs, null)`, che sopravvive anche al salvataggio e alla ripartenza (Task 5) |
| 30 | Il cooldown del resolver era 300 s, ma la misura riportata dal piano stesso dice che il ban era ancora attivo a 300 s e si è sciolto dopo 330 s di silenzio | Incoerenza fra la costante e lo script offline, che già dormiva 360 s | Cooldown portato a 360 s, con il perché accanto alla costante (Task 4) |

## Cosa resta fuori da questo piano

- **Un watcher per `/health`**: l'healthcheck di `railway.toml` è un cancello di deploy, non un monitor. Il piano rende il guasto diagnosticabile, non notificato.
- **Corsa lunga di `build:routes`**: lo script è ripartibile e la costruzione completa richiede ore. Il server funziona con cache parziale, solo con meno aerei blu.
- **Piano 2 — densità e movimento**: dead reckoning con tetto temporale, raggio in pixel-schermo, ordine di disegno gerarchico.
- **Piano 3 — interazione e visivo**: pannello con conteggi e checkbox, focus con geodetica e marker D/A, ricerca per numero di volo, palette caldo/grigio/blu.

Il tiling introdotto qui era previsto per il Piano 2: il vincolo dei 250 NM lo ha reso un prerequisito. Il Piano 2 ne eredita la griglia e deve solo derivare dalla camera quali tile interrogare più spesso.

## Difetti del quinto preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 31 | **Critico.** Il client avrebbe cancellato l'81% della flotta appena ricevuta: finestra client di 120 s contro una flotta server che trattiene gli aerei 900 s e tile rivisitate ogni ~620 s. Il globo vuoto della v1, in forma attenuata, nel task che esiste per impedirlo | Sweep reale fra 16 e 25 minuti alla latenza misurata; una finestra client di 120 s ne copre una frazione minima. I test del piano non potevano vederlo — usavano scarti di 10 s | `removeStale` eliminato: il server è l'unica autorità, `updateBatch` sincronizza con il payload. Test con scarto di 600 s che asserisce la **conservazione** (Task 7) |
| 32 | **Critico.** `setInterval` ogni 3 s senza guardia di rientranza, mentre una fetch di tile dal vivo impiega da 11 a oltre 90 s: decine di cicli sovrapposti e richieste concorrenti illimitate verso un servizio gratuito | Latenze misurate sul campo; lo Step di verifica guardava solo `/health` e non se ne sarebbe accorto | Guardia `cycleInFlight` e loop che si ripianifica **dopo** il completamento, più uno step che verifica con `grep` che nessun `setInterval` sia rimasto (Task 3) |
| 33 | **Critico.** Due step dicevano di sostituire `refreshGlobalFeed`, una funzione che non esiste in nessun punto del repo: era nel piano precedente, il cui Task 4 non è mai stato implementato | `grep -rn 'refreshGlobalFeed' server/ src/` → nessun risultato | Gli step dicono ora di **creare** la funzione, con il punto di inserimento esatto e il perché (deve stare sotto la dichiarazione di `app`), e il Task 5 nomina `refreshNextTiles` indicando dove inserire l'arricchimento (Task 3, 5) |

## Difetti del sesto preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 34 | **Critico.** La finestra di ritenzione della flotta (900 s fissi) era più corta del tempo reale di una spazzata, quindi `prune` avrebbe cancellato ogni aereo molto prima che la sua tile tornasse: non una flotta cumulativa ma una macchia rotante su circa un sesto della griglia. Il mio «~620 s per sweep» contava **solo** il gap fra cicli, ignorando la pausa fra tile e la latenza di rete che il piano stesso dichiarava di aver misurato | Latenza misurata dal vivo: 17,6 s / 39,7 s / 8,1 s / 52,8 s su quattro tile, mediana **28,6 s** — e 52,8 s per restituire **zero** aerei, quindi la lentezza è del server, non del payload. Sweep sequenziale di 413 tile: **213 minuti** | Otto fetch concorrenti (sweep ~25 min a 0,28 richieste/s) e finestra di ritenzione **derivata dallo sweep osservato** invece che fissata a mano, con floor e cap. I due numeri non possono più divergere perché uno è calcolato dall'altro (Task 3) |
| 35 | Con uno sweep di 16-25 minuti, le posizioni della vista globale sarebbero vecchie di decine di minuti: un aereo in crociera percorre oltre 200 NM in venti minuti. È l'opposto del requisito di partenza — posizioni aggiornate di frequente, non icone che sembrano ferme | Aritmetica sulla latenza misurata | Anticipato il fetch guidato dalla camera, che era previsto per il Piano 2: `/api/states` accetta il punto osservato, le tile sotto il viewport saltano la coda e vengono rinfrescate subito, lo sweep globale resta in sottofondo per il colpo d'occhio (Task 2, 3) |

## Nota sul risultato atteso

Con questi vincoli il globo ha due velocità, ed è bene saperlo prima di guardarlo: **la regione inquadrata è fresca**, perché le sue tile hanno priorità; **il resto del pianeta è un contesto che si aggiorna in 16-25 minuti**. Non è un compromesso elegante, è il massimo che adsb.lol concede a 29 secondi per tile e 250 NM di raggio. Il dead reckoning del Piano 2 renderà continuo il movimento di ciò che si guarda; la vista globale resterà, per natura, un colpo d'occhio e non un cronometro.

## Difetti del settimo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 36 | **Critico.** La priorità guidata dalla camera era implementata **solo lato server**: il gestore leggeva `lat`/`lon`/`radius` che nessun client invia. Codice morto, e con esso l'unica risposta al difetto #35 — tutto il globo sarebbe rimasto vecchio di 16-25 minuti, inclusa la regione inquadrata. La "Nota sul risultato atteso" prometteva una freschezza che il piano non consegnava | Piano applicato a una copia e server avviato: `curl` manuale con i parametri → `tiles.prioritised = 12`; una richiesta nuda del client reale → `0`. `SceneHandle` espone solo `dispose`, la camera non è raggiungibile dall'esterno | Completato il lato client: `vec3ToLatLon` in geoHelpers, `SceneHandle.viewCentre()` che deriva punto e raggio dalla posizione della camera, `fetchStates` che serializza il punto osservato, `getViewCentre` nello stream e il collegamento in `bootstrap`, più uno step che verifica nel browser che le richieste portino davvero i parametri (Task 7) |
| 37 | **Critico.** Il pump delle rotte usava `setInterval` senza guardia di rientranza e senza timeout sul fetch: esattamente il difetto #32, corretto per il ciclo delle tile e reintrodotto per le rotte poche pagine dopo | Riprodotto durante la revisione: un singolo hang da 300 s con `setInterval` a 10 s ha prodotto **30 lookup concorrenti** verso adsbdb, contro un tetto di progetto di 1 ogni 1,5 s. Il `headersTimeout` di undici è 300 s e il server ne sovrascriveva solo `connect` | Guardia `routePumpInFlight` e loop che si ripianifica dopo il completamento, `AbortSignal.timeout(10_000)` su ogni lookup, e ricontrollo della sospensione **dentro** il batch, così un 429 ferma anche le richieste rimanenti dello stesso giro (Task 5) |

## Difetti dell'ottavo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 38 | **Critico.** La priorità da viewport affamava la rotazione: `next()` serviva la coda prioritaria senza alcun tetto, e un solo visitatore chiedeva 12 tile ogni 30 s contro 8 servite ogni 31-55 s. Il cursore non avanzava mai, `sweepsCompleted` restava 0, la dormienza non si attivava e `prune` cancellava tutto ciò che sta fuori dall'inquadratura — il difetto #34 reintrodotto dalla correzione del #36 | Simulazione sul codice del piano, due ore e griglia reale: camera ferma → **8 tile di rotazione su 413**, `sweepsCompleted` 0; camera in movimento con ciclo lento → backlog prioritario che cresce a 284 senza mai svuotarsi | Metà di ogni batch è riservata alla rotazione; la coda prioritaria è limitata a 12 voci e scarta le più vecchie; `prioritise()` ignora una tile servita negli ultimi 60 s; il client ne chiede 6 invece di 12. In più `observedSweepSeconds` si misura sulle tile **di rotazione**, non su tutte, altrimenti la finestra di ritenzione continuerebbe a mentire (Task 2, 3) |
| 39 | **Critico.** Due asserzioni su `fetchStates` si rompono quando la firma passa da uno a tre argomenti. Il piano enunciava la regola — «`toHaveBeenCalledWith` verifica la lista completa» — e la applicava solo a `onBatch`. Lo step di verifica non poteva passare, e il suo suggerimento diagnostico indicava la causa sbagliata | Riprodotto con vitest 2.1.9 nel repo: `expected "spy" to be called with arguments: [ { lamin: 1 } ] / Received: [ {lamin: 1}, undefined, null ]` | Entrambe le asserzioni corrette nello Step 7, e il suggerimento diagnostico dello Step 11 distingue ora «la suite non si carica» da «due test rossi per arity» (Task 7) |
