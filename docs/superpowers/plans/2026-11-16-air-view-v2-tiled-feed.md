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
- **Parsimonia verso i servizi gratuiti.** adsbdb banna a pochi req/s e le richieste durante la penalità la rinnovano: mai oltre 1 richiesta ogni 1,5 s, e dopo un 429 silenzio totale per almeno 6 minuti. Verso adsb.lol: una richiesta alla volta, spaziata di almeno 1,5 s. Misurato dal vivo: raffiche di 8 richieste simultanee, pur restando a 1,07 req/s di media, hanno prodotto HTTP 429 dopo 26 fetch e ucciso il feed. Non è la media che conta, è il pattern.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy è una decisione dell'utente.
- **Mai `git add -A` né `git add .`.** Questo working tree ha quattro percorsi non tracciati e non ignorati — `.claude/` (1,5 MB di skill locali: in `.gitignore` c'è solo `.claude/settings.local.json`), `.agents/` (536 KB), `mockups/` (40 KB) e `skills-lock.json`, 106 file in tutto — che finirebbero in un commit del branch di prodotto mescolati alle modifiche del task. Ogni commit elenca i file del proprio task uno per uno, come fa il Task 2 Step 6.
- Nessun dato inventato: un campo sconosciuto è `null`.
- Messaggi di commit in inglese.

---

### Task 1: GIÀ COMPLETATO — solo verifica

Questo task è **già implementato e committato** sul branch `v2-design` dai commit `ccaf7bb`, `441af23`, `657b820` e `89ae03d`. Il tetto di raggio è a 250 NM in entrambi gli adattatori, i commenti sulla diagnosi sono allineati alla realtà misurata, e il test asserisce `toBe(250)`.

**Non rieseguire gli step originali**: chiederebbero di sostituire testo già sostituito, e il gate TDD non potrebbe mai vedere il rosso che si aspetta. Un esecutore fedele si bloccherebbe, o romperebbe il codice apposta per renderlo rosso.

- [x] **Step 1: Verificare lo stato e passare oltre**

```bash
grep -n "maxRadiusNm: " src/data/sources/adsbLol.ts src/data/sources/adsbFi.ts
npm run build:all && npm test -- --run
```

Expected: entrambi gli adattatori dichiarano `maxRadiusNm: 250`, build pulita su entrambi i programmi, suite verde. Nessun commit da fare: procedere al Task 2.

---

### Task 2: GIÀ COMPLETATO — NON RIESEGUIRE: griglia di tile adattiva

Questo task è **già implementato e committato** sul branch `v2-design` dai commit `ad2743d`, `430039d`, `69c9302`, `641c9d0` e `8ae051c`. I blocchi di codice e di test qui sotto sono una **fotografia del codice committato** — risincronizzati verbatim il 2026-11-19 con `src/data/sources/tileGrid.ts` e `tests/unit/data/sources/tileGrid.test.ts` — non istruzioni da applicare. **Unica eccezione, dichiarata qui per non doverla indovinare:** il commento di `tilesNear` riprodotto sotto è già nella forma che il Task 3 Step 11b installa. Il file committato dice ancora «~10 minutes at adsb.lol's measured latency of ~29 s per tile», e quella latenza è stata smentita dalla rimisurazione del difetto #41 (0,47 s mediani); il Task 3 riscrive quel commento e mette `src/data/sources/tileGrid.ts` nella propria riga `git add`. **Seconda eccezione, dalla stessa data:** il Task 3 (Step 8e-8h) aggiunge `recordFailure` allo scheduler, perche' `record()` e' raggiunto solo sul ramo di successo del poller e una tile che fallisce sempre non diventerebbe mai dormiente. Da quel momento il file vero ha un metodo in piu' di questa fotografia, e il suo test quattro casi in piu'; tutto il resto resta identico.

**Non rieseguire gli step originali**: lo Step 1 chiederebbe di creare un file che esiste già, lo Step 2 si aspetta un rosso che non può più esserci, e riscrivere lo Step 3 sopra il file vero reintrodurrebbe difetti già chiusi. Per verificare lo stato basta `npm run build:all && npm test -- --run`.

**Files:**
- Create: `src/data/sources/tileGrid.ts`
- Test: `tests/unit/data/sources/tileGrid.test.ts`

**Interfaces:**
- Consumes: `GeoPoint` dal Task 1 del piano precedente
- Produces: `TILE_RADIUS_NM: number`; `buildTileGrid(): Tile[]` con `Tile = { id: string; region: string; centre: GeoPoint }`; `tilesNear(grid: Tile[], centre: GeoPoint, radiusNm: number): Tile[]`; `createTileScheduler(tiles: Tile[], opts?: SchedulerOptions): TileScheduler` con `TileScheduler.next(count: number): Tile[]`, `prioritise(tileIds: string[]): void`, `record(tileId: string, aircraftCount: number): void`, `recordFailure(tileId: string): void` (aggiunto dal Task 3 Step 8g: senza di esso la dormienza impara solo dal vuoto e mai dal fallimento, e una tile che non risponde mai consuma uno slot da 1,5 s a ogni spazzata per sempre), `stats(): { total: number; productive: number; dormant: number; sweepsCompleted: number; prioritised: number; rotationServed: number }`. `SchedulerOptions = { dormantAfterEmptySweeps?: number; dormantRetryEvery?: number; maxPriorityQueue?: number; minRefreshMs?: number; now?: () => number }`. `rotationServed` conta le sole tile servite dalla rotazione, non quelle prioritarie: il Task 3 Step 9 ci deriva la finestra di ritenzione e lo Step 14 ci misura il rate, e contare anche le tile del viewport — rifetchate di continuo — farebbe sembrare la spazzata molto più veloce di com'è.

**Perché adattiva.** La griglia copre riquadri geografici, ma molte tile cadono su oceano aperto dove nessun ricevitore esiste. Misurato dal vivo: una tile sugli Stati Uniti centrali restituisce **660 aerei**, una sul Pacifico orientale **zero**. Interrogare indefinitamente le tile vuote sprecherebbe la gran parte del budget di richieste verso un servizio gratuito. Lo scheduler impara: dopo alcuni passaggi a vuoto una tile diventa dormiente e viene ritentata di rado, perché la copertura ADS-B cambia nel tempo e una tile morta oggi può rianimarsi domani.

- [x] **Step 1: Scrivere il test che fallisce**

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

  it('covers EVERY point of every declared box, edges included', () => {
    // The whole purpose of the grid. An earlier revision incremented by the
    // raw step and stopped at the last centre still inside the edge, which
    // left 276 of 12 883 sampled points — 2.1% of the declared area — beyond
    // 230 NM from any centre, with holes up to 387 NM.
    //
    // Sampled at half a degree (~30 NM), finer than any hole the lattice can
    // produce: the margin is 230 - 216 = 14 NM. Distance is to the nearest
    // centre of the WHOLE grid, which is how coverage works — the poller
    // fetches every tile, so a tile covers a point whatever box it came from.
    const boxes: Array<[number, number, number, number]> = [
      [25, 60, -130, -60], // north-america
      [35, 62, -11, 32], // europe
      [20, 46, 100, 146], // east-asia
      [-10, 22, 95, 128], // southeast-asia
      [6, 33, 68, 90], // india
      [12, 32, 34, 60], // gulf
      [-45, -10, 113, 179], // oceania
      [-35, 12, -75, -35], // south-america
      [-35, -20, 16, 33], // southern-africa
      [28, 42, -9, 45], // north-africa
    ];
    const grid = buildTileGrid();
    let sampled = 0;
    let uncovered = 0;
    let worst = 0;
    for (const [latMin, latMax, lonMin, lonMax] of boxes) {
      for (let lat = latMin; lat <= latMax + 1e-9; lat += 0.5) {
        for (let lon = lonMin; lon <= lonMax + 1e-9; lon += 0.5) {
          sampled++;
          let nearest = Infinity;
          for (const t of grid) {
            const d = haversineNm({ lat, lon }, t.centre);
            if (d < nearest) nearest = d;
          }
          if (nearest > TILE_RADIUS_NM) uncovered++;
          if (nearest > worst) worst = nearest;
        }
      }
    }
    expect(sampled).toBe(50112);
    expect(uncovered).toBe(0);
    // 216.25 NM of 230: ~14 NM of margin, so the spacing has nothing to give.
    // Raising STEP_FACTOR to 1.6 pushes this past the radius and fails here.
    expect(worst).toBeLessThan(TILE_RADIUS_NM);
    expect(worst).toBeCloseTo(216.25, 1);
  });

  it('builds 546 tiles — the figure every rate and retention budget is derived from', () => {
    // A sweep is 546 sequential fetches spaced >= 1.5 s, so this number sets
    // the floor on how stale the far side of the world may be. It is quoted
    // in the plan; if it moves, those figures have to move with it.
    const grid = buildTileGrid();
    expect(grid.length).toBe(546);
    expect(new Set(grid.map((t) => t.id)).size).toBe(546);
  });

  it('covers the four places that used to fall outside every tile', () => {
    // Three cities in the old edge strip, plus the Bay of Bengal point that
    // sat in the staircase between two rows of the india box: enclosed
    // between centres on both axes and still 308 NM from the nearest one.
    const grid = buildTileGrid();
    const nearest = (p: { lat: number; lon: number }): number =>
      Math.min(...grid.map((t) => haversineNm(p, t.centre)));
    expect(nearest({ lat: -25.92, lon: 32.573 })).toBeLessThan(TILE_RADIUS_NM); // Maputo
    expect(nearest({ lat: 45.623, lon: 126.25 })).toBeLessThan(TILE_RADIUS_NM); // Harbin
    expect(nearest({ lat: 46.161, lon: -60.048 })).toBeLessThan(TILE_RADIUS_NM); // Cape Breton
    expect(nearest({ lat: 19, lon: 89.75 })).toBeLessThan(TILE_RADIUS_NM); // Bay of Bengal
  });
});

const tiles3 = () => [
  { id: 'a', region: 'r', centre: { lat: 0, lon: 0 } },
  { id: 'b', region: 'r', centre: { lat: 1, lon: 1 } },
  { id: 'c', region: 'r', centre: { lat: 2, lon: 2 } },
];

/**
 * Great-circle distance, written out independently of the source so the
 * ordering assertions cannot be satisfied by a shared bug.
 */
function haversineNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

describe('tilesNear', () => {
  it('returns the tiles whose centre falls within the radius', () => {
    const grid = buildTileGrid();
    const radiusNm = 400;
    const camera = { lat: 50, lon: 8 };
    const near = tilesNear(grid, camera, radiusNm);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(grid.length);
    expect(near.every((t) => t.region === 'europe')).toBe(true);

    // The radius is the whole point of the function: the provider refuses
    // anything beyond 250 NM, so a tile returned from outside the asked-for
    // radius is a request that comes back empty or rejected. Both halves are
    // asserted against the test's own haversine — nothing inside may be
    // missing, nothing outside may be present.
    const returned = new Set(near.map((t) => t.id));
    for (const t of grid) {
      const inside = haversineNm(camera, t.centre) <= radiusNm;
      expect(returned.has(t.id)).toBe(inside);
    }
  });

  it('cuts the radius at the right distance in real nautical miles', () => {
    // Ordering is scale-free: a distance function off by a constant factor
    // sorts identically and would pass every other test here. The cut does
    // not. One degree of latitude is 60 NM by definition, so these two tiles
    // sit at 228 NM and 240 NM from the camera: with a 230 NM radius the
    // first is in and the second is out, and no rescaling of the source's
    // distance can satisfy both. Load-bearing because 250 NM is the
    // provider's hard ceiling — a 13% underestimate would ask for tiles
    // 264 NM away and get nothing back.
    const camera = { lat: 0, lon: 0 };
    const grid = [
      { id: 'in', region: 'r', centre: { lat: 3.8, lon: 0 } }, // 228 NM
      { id: 'out', region: 'r', centre: { lat: 4.0, lon: 0 } }, // 240 NM
    ];
    expect(haversineNm(camera, grid[0]!.centre)).toBeCloseTo(228, 0);
    expect(haversineNm(camera, grid[1]!.centre)).toBeCloseTo(240, 0);

    expect(tilesNear(grid, camera, TILE_RADIUS_NM).map((t) => t.id)).toEqual(['in']);
  });

  it('returns nothing over an uncovered ocean', () => {
    expect(tilesNear(buildTileGrid(), { lat: 0, lon: -160 }, 200)).toEqual([]);
  });

  it('orders the nearest tile first', () => {
    // Load-bearing, not cosmetic: the server prioritises only the first six
    // tiles of this list. If the order reversed, it would refresh the
    // farthest tiles inside the radius and leave the region under the camera
    // as stale as the far side of the planet — the exact failure this
    // mechanism exists to prevent.
    const camera = { lat: 50, lon: 8 };
    const grid = buildTileGrid();
    const near = tilesNear(grid, camera, 800);
    expect(near.length).toBeGreaterThan(1);

    const distances = near.map((t) => haversineNm(camera, t.centre));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
    // The head of the list is the nearest tile of the whole grid, not merely
    // the nearest of some arbitrary subset that happened to come out first.
    const nearestOfGrid = Math.min(...grid.map((t) => haversineNm(camera, t.centre)));
    expect(distances[0]!).toBeCloseTo(nearestOfGrid, 6);
  });

  it('puts the six tiles the server prioritises nearest the camera', () => {
    // Task 3 calls prioritise(tilesNear(...).slice(0, 6)): those six must be
    // the six nearest, or the priority queue refreshes the wrong region.
    const camera = { lat: 50, lon: 8 };
    const grid = buildTileGrid();
    const near = tilesNear(grid, camera, 600);
    expect(near.length).toBeGreaterThan(6);

    const allSorted = grid
      .map((t) => haversineNm(camera, t.centre))
      .sort((a, b) => a - b)
      .slice(0, 6);
    const head = near.slice(0, 6).map((t) => haversineNm(camera, t.centre));
    expect(head).toEqual(allSorted);
    // And they are genuinely close by, not a spread across the radius.
    expect(head[5]!).toBeLessThan(500);
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
    // Dormancy is overridden by a viewer's request: someone looking at a
    // region is better evidence than our own history of that tile.
    // minRefreshMs is set to 0 to isolate that rule from the freshness one,
    // which is exercised by its own test below — and which wins: a tile
    // fetched seconds ago is not re-queued even for a viewer.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 1, minRefreshMs: 0 });
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

  it('gives the rotation its share even when the batch is ONE tile', () => {
    // A batch of one is the natural shape under a limit of one request every
    // 1.5 s, and a share cannot be split inside it: floor(1 * 0.5) is 0, and
    // the old max(1, ...) floor handed every single-tile batch to the
    // viewport for ever. The share is spread across batches instead.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { minRefreshMs: 0 });
    s.prioritise(many.slice(0, 12).map((t) => t.id));
    for (let poll = 0; poll < 12; poll++) s.next(1);
    expect(s.stats().rotationServed).toBe(6); // half of twelve single-tile polls
  });

  it('never returns the same tile twice in one batch', () => {
    // The caller fetches every entry, so a duplicate is a duplicate request
    // against a provider that answers 429 to bursts.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    s.prioritise(['a']);
    const batch = s.next(3);
    expect(new Set(batch.map((t) => t.id)).size).toBe(batch.length);
  });

  it('does not repeat tiles when the rotation laps inside one batch', () => {
    // The real case: fewer due tiles than the batch size. The cursor wraps
    // and would hand out the same tiles again — six fetches for three tiles.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    const batch = s.next(8); // more than the three tiles available
    expect(new Set(batch.map((t) => t.id)).size).toBe(batch.length);
    expect(batch.length).toBeLessThanOrEqual(3);
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

  it('serves the NEWEST camera request first', () => {
    // An older entry describes a camera that has already moved on. Serving it
    // first refreshes where the viewer WAS before where they are now — the
    // exact delay viewport priority exists to remove. The queue therefore
    // grows at the back and is served from the back.
    const s = createTileScheduler(tiles3());
    s.prioritise(['a']);
    s.prioritise(['c']);
    // Batches of two: one tile of each goes to the viewport, so two batches
    // drain the queue and the ORDER is what is under test here.
    expect(s.next(2)[0]!.id).toBe('c');
    expect(s.next(2)[0]!.id).toBe('a');
  });

  it('drops the OLDEST entry when a moving camera overflows the queue', () => {
    // The cap and the service order must agree: the newest request is both
    // the first served and the last discarded. Asserting only the queue
    // LENGTH leaves which end is dropped free to invert.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    const s = createTileScheduler(many, { maxPriorityQueue: 3 });
    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(3);
    expect([s.next(2)[0]!.id, s.next(2)[0]!.id, s.next(2)[0]!.id]).toEqual(['t5', 't4', 't3']);
  });

  it('stamps a tile served by the ROTATION, not just one served by priority', () => {
    // Both paths spend the same budget against a provider that answers 429 to
    // bursts. Without the stamp on the rotation path, the next camera update
    // re-queues a tile fetched a second ago — a duplicate HTTP request.
    let clock = 1_000_000;
    const s = createTileScheduler(tiles3(), { minRefreshMs: 60_000, now: () => clock });
    const served = s.next(3).map((t) => t.id);
    expect(s.stats().rotationServed).toBe(3);
    clock += 1_000;
    s.prioritise(served);
    expect(s.stats().prioritised).toBe(0);
    clock += 60_000;
    s.prioritise(served);
    expect(s.stats().prioritised).toBe(3);
  });

  it('ignores a tile already waiting in the queue', () => {
    // Two camera updates overlapping the same tile must not put it in one
    // batch twice. The sibling test above cannot see this: its setup queues
    // 'a' once, so the duplicate never has a chance to form.
    const s = createTileScheduler(tiles3(), { minRefreshMs: 0 });
    s.prioritise(['a']);
    s.prioritise(['a']);
    expect(s.stats().prioritised).toBe(1);
    expect(s.next(4).filter((t) => t.id === 'a').length).toBe(1);
  });

  it('runs on the queue cap and freshness window production actually gets', () => {
    // Task 3 builds the scheduler with no options, so the defaults ARE the
    // production values — and these two are the literal fix for the
    // starvation defect (unbounded queue, re-queued on every poll). Every
    // other scheduler test passes its options explicitly, which leaves the
    // defaults free to be reverted with the suite still green.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, region: 'r', centre: { lat: i, lon: 0 },
    }));
    let clock = 1_000_000;
    const s = createTileScheduler(many, { now: () => clock });

    s.prioritise(many.map((t) => t.id));
    expect(s.stats().prioritised).toBe(12); // maxPriorityQueue

    const served = s.next(2)[0]!.id;
    expect(served).toBe('t39');
    s.prioritise([served]);
    expect(s.stats().prioritised).toBe(11); // 60 s freshness: not re-queued
    clock += 60_001;
    s.prioritise([served]);
    expect(s.stats().prioritised).toBe(12);
  });

  it('goes dormant on the THIRD empty sweep by default, not the second', () => {
    const s = createTileScheduler(tiles3());
    for (let i = 0; i < 2; i++) for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(0);
    for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
  });

  it('retries a dormant tile on every twentieth sweep by default', () => {
    const s = createTileScheduler(tiles3());
    for (let i = 0; i < 3; i++) for (const t of s.next(3)) s.record(t.id, 0);
    expect(s.stats().dormant).toBe(3);
    const resumedAtSweep: number[] = [];
    for (let poll = 0; poll < 30; poll++) {
      const got = s.next(3);
      if (got.length > 0) resumedAtSweep.push(s.stats().sweepsCompleted);
      for (const t of got) s.record(t.id, 0);
    }
    expect(resumedAtSweep).toEqual([20, 40, 60]);
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

- [x] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: FAIL — import non risolto

- [x] **Step 3: Creare `src/data/sources/tileGrid.ts`**

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
 * The planet would need ~1400 tiles of this radius; these regions need 546,
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
/**
 * 1.4 leaves overlap between neighbouring circles: the far corner of a cell
 * sits at sqrt(2) * 0.7 * 230 = 227.7 NM from the nearest centre, inside the
 * 230 NM radius. There is ~2 NM of margin, so this is not a figure to round
 * off — raising it to 1.6 opens holes the tests below catch.
 */
const STEP_FACTOR = 1.4;

/**
 * Centres on a lattice that INCLUDES both edges of every box.
 *
 * The step is a ceiling, not an increment: each box is divided into the
 * fewest whole steps that stay under it, so a row always ends exactly on
 * lonMax and a column exactly on latMax. An earlier revision incremented by
 * the raw step and stopped at the last centre still <= the edge, which left
 * two kinds of hole:
 *
 *  - a strip along the far edge of every box, up to a full step wide. Maputo,
 *    Harbin and Cape Breton all sat inside a declared box and outside every
 *    tile.
 *  - a staircase between rows. The longitude step depends on latitude, so
 *    adjacent rows ran out at different longitudes: (19 N, 89.75 E) in the
 *    Bay of Bengal, enclosed between centres on both axes, was 308 NM from
 *    the nearest centre of the whole grid.
 *
 * Both are gone: sampled at 0.1 degrees, all 1 224 760 points of the ten
 * boxes lie within 230 NM of a centre, the worst at 218.0 NM. The price is
 * 546 tiles instead of 413 (+32%); the extra ones are mostly edge strips over
 * water, which the scheduler marks dormant after three empty sweeps.
 */
export function buildTileGrid(): Tile[] {
  const tiles: Tile[] = [];
  const maxStepLat = (TILE_RADIUS_NM * STEP_FACTOR) / NM_PER_DEGREE_LAT;

  for (const [region, latMin, latMax, lonMin, lonMax] of REGIONS) {
    const rows = Math.max(1, Math.ceil((latMax - latMin) / maxStepLat));
    const stepLat = (latMax - latMin) / rows;

    for (let i = 0; i <= rows; i++) {
      const lat = latMin + i * stepLat;
      // Meridians converge towards the poles: widen the longitude step.
      const nmPerDegreeLon = NM_PER_DEGREE_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const maxStepLon = (TILE_RADIUS_NM * STEP_FACTOR) / nmPerDegreeLon;
      const cols = Math.max(1, Math.ceil((lonMax - lonMin) / maxStepLon));
      const stepLon = (lonMax - lonMin) / cols;

      for (let j = 0; j <= cols; j++) {
        const centre = {
          lat: Math.round(lat * 1000) / 1000,
          lon: Math.round((lonMin + j * stepLon) * 1000) / 1000,
        };
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
 * immediately. A full sweep is 546 tiles fetched one at a time, at most one
 * every 1.5 s: 820-1000 s, i.e. 14-17 minutes. The ~10 minutes this comment
 * used to claim read the pace off a 29 s median latency measured during
 * congestion; the pace comes from the floor, and 546 x 1.5 s = 819 s is a
 * floor no latency can beat. Without this the region being looked at would
 * be as stale as the far side of the planet.
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
 * tiles out of 413 in two hours — the grid had 413 tiles then, 546 now.
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
  /**
   * Camera requests, oldest at the front. next() takes from the BACK and the
   * cap drops from the front, so the newest request is both served first and
   * the last to be discarded: an old entry describes a camera that has moved.
   */
  const priority: string[] = [];
  const lastServedAt = new Map<string, number>();
  let cursor = 0;
  let sweeps = 0;
  let rotationServed = 0;
  /**
   * The rotation's share cannot be split inside a batch of ONE — and a batch
   * of one is the natural shape under a limit of one request every 1.5 s.
   * `Math.floor(1 * 0.5)` is 0, and the `max(1, ...)` floor then handed the
   * whole batch to the viewport for ever: rotationServed stayed at zero, the
   * exact starvation ROTATION_SHARE exists to prevent. So the share is spread
   * ACROSS batches instead — it accrues here and is spent a whole tile at a
   * time, which makes a one-tile poller alternate.
   */
  let priorityCredit = 0;

  function isDue(tile: Tile): boolean {
    if (!dormant.has(tile.id)) return true;
    return sweeps % retryEvery === 0;
  }

  return {
    next(count) {
      const out: Tile[] = [];

      // Prioritised tiles jump the queue, dormancy included: a viewer looking
      // at a region is better evidence than our own history of that tile.
      // Freshness is the one thing priority does NOT override — prioritise()
      // refuses a tile fetched within minRefreshMs, because re-queuing it on
      // every poll is how the queue outgrows the budget.
      // But only up to a share of the batch — the rest belongs to the
      // rotation, or the globe outside the viewport is never refreshed and
      // the fleet decays into the region on screen.
      // Credit accrues only when there is something to spend it on, or an
      // idle queue would bank enough to swallow a later batch whole.
      if (priority.length > 0) priorityCredit += count * (1 - ROTATION_SHARE);
      const priorityQuota = Math.min(count, Math.max(0, Math.ceil(priorityCredit)));
      while (out.length < priorityQuota && priority.length > 0) {
        const id = priority.pop()!;
        const tile = byId.get(id);
        if (tile) {
          out.push(tile);
          lastServedAt.set(id, now());
        }
      }

      priorityCredit -= out.length; // only what the queue actually spent

      // A tile already taken from the priority queue must not be handed out
      // again by the rotation in the same batch: the caller fetches each
      // entry, so a duplicate is a duplicate HTTP request.
      const alreadyOut = new Set(out.map((t) => t.id));

      let examined = 0;
      while (out.length < count && examined < tiles.length * 2) {
        const tile = tiles[cursor % tiles.length]!;
        cursor += 1;
        examined += 1;
        if (cursor % tiles.length === 0) sweeps += 1;
        if (alreadyOut.has(tile.id)) continue;
        if (isDue(tile)) {
          out.push(tile);
          alreadyOut.add(tile.id); // without this the cursor laps and repeats
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

- [x] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: PASS, 34 test

- [x] **Step 5: Verificare la griglia reale senza fare volume**

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

Expected: **esattamente 546 tile**, con questa distribuzione (la funzione è deterministica, quindi il confronto è esatto):

```
oceania 98 | north-america 87 | south-america 87 | southeast-asia 54 | east-asia 51
europe 47 | north-africa 39 | india 37 | gulf 30 | southern-africa 16
```

Le regioni più numerose sono quelle con le bounding box più larghe, non quelle con più traffico: `europe` è sesta con 47 tile ed è corretto così. **Non** interrogare adsb.lol in questo passo: la griglia si verifica senza rete.

> **Questione chiusa il 2026-11-19 — la griglia copre ora l'intera area dichiarata.** La revisione precedente incrementava per step grezzo e si fermava all'ultimo centro ancora dentro il bordo, il che lasciava due famiglie di buco. (1) Una striscia lungo il bordo di ogni box, larga fino a uno step intero: 276 punti su 12883 campionati a 1 grado — il 2,1% dell'area dichiarata — oltre 230 NM da qualunque centro, con buchi fino a 387 NM; e non era solo oceano, perché Maputo (279 NM), Harbin (270 NM) e Cape Breton (316 NM) stavano dentro una bbox e fuori da ogni tile. (2) Una scalinata fra righe: lo step in longitudine dipende dalla latitudine, quindi righe contigue finivano a longitudini diverse, e (19 N, 89,75 E) nel Golfo del Bengala — racchiuso fra centri su **entrambi** gli assi, cioè nell'«interno» che il commento dichiarava coperto con 2 NM di margine — distava **308 NM** dal centro più vicino dell'intera griglia.
>
> La correzione tratta lo step come un **tetto, non un incremento**: ogni box è diviso nel minor numero di passi interi che restano sotto quel tetto, quindi una riga finisce esattamente su `lonMax` e una colonna esattamente su `latMax`. Misurato sul codice vero, campionando a 0,1 grado: **1 224 760 punti su 1 224 760 entro 230 NM**, il peggiore a 218,0 NM. Maputo passa da 279 a 59,9 NM, Cape Breton da 316 a 69,7 NM, Harbin da 270 a 137,9 NM, il Golfo del Bengala da 308 a 33,2 NM. Il prezzo è **546 tile invece di 413 (+32%)**, e le aggiunte sono in gran parte strisce di bordo sull'acqua, che lo scheduler marca dormienti dopo tre spazzate vuote. Tutte le cifre derivate da 413 — durata dello sweep, finestra di ritenzione, `MIN_RETENTION_S` — sono state aggiornate in questo piano. La copertura è asserita a 0,5 gradi (50 112 punti, zero scoperti) da `tests/unit/data/sources/tileGrid.test.ts`, e `STEP_FACTOR = 1.6` la fa fallire.

- [x] **Step 6: Verificare ENTRAMBI i programmi e committare**

```bash
npm run build:all && npm test -- --run
git add src/data/sources/tileGrid.ts tests/unit/data/sources/tileGrid.test.ts
git commit -m "feat(data): adaptive tile grid for a feed without a global endpoint

adsb.lol caps every request at 250 NM and no global endpoint survives, so
the feed is now assembled from 546 tiles over the regions where ADS-B
receivers exist. The planet would need ~1400, and the difference is open
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
- Create: `server/fleet.ts`, `server/feedState.ts`, `server/errorChain.ts`
- Modify: `server/index.ts`, `src/data/sources/selector.ts`, `src/data/sources/adsbFi.ts`, `src/data/sources/tileGrid.ts` — `adsbFi.ts` solo per il commento che lo Step 11b rende falso; `tileGrid.ts` (già committato dal Task 2) per lo stesso motivo **e** perché lo Step 8g gli aggiunge `recordFailure`
- Test: `tests/unit/server/fleet.test.ts`, `tests/unit/server/feedState.test.ts`, `tests/unit/server/errorChain.test.ts`, `tests/unit/data/sources/tileGrid.test.ts` (esteso dallo Step 8e); lo Step 11b aggiorna anche un commento di `tests/unit/data/sources/selector.test.ts`

**Interfaces:**
- Consumes: `TileScheduler`, `buildTileGrid`, `TILE_RADIUS_NM` dal Task 2; `SourceSelector` e `UpstreamHttpError` (`status`, `retryAfterSeconds`) dal Task 1
- Produces: `createFleet(opts?: FleetOptions): Fleet` con `Fleet.absorb(aircraft: AircraftRaw[], atUnix: number): number`, `Fleet.snapshot(maxRecords?: number): AircraftRaw[]`, `Fleet.prune(nowUnix: number): number`, `Fleet.size(): number`, `Fleet.setMaxAgeSeconds(seconds: number): void`, `Fleet.maxAgeSeconds(): number`; `FleetOptions = { maxAgeSeconds?: number }`. `createFeedState(opts?: FeedStateOptions): FeedState` come nel piano precedente, con `FeedHealth.status: 'starting' | 'ok' | 'degraded'`. Su moduli già committati questo task produce inoltre: `TileScheduler.recordFailure(tileId: string): void` (Step 8g) e `SourcesFailedError extends Error` con `attempted: boolean` (Step 8k), che dice se su quella chiamata una richiesta è davvero partita o se il messaggio è solo il ricordo di un errore precedente.

**Semantica di `lastContact` dentro la flotta.** Dal commit 8ae051c `AircraftRaw.lastContact` è `number | null`, e `null` significa «​il provider non ha detto quanto è vecchio questo fix», non «​è fresco». Il Task 7 e il Task 8 poggiano su questa semantica, perciò è dichiarata qui e non solo nel codice.

- **La flotta invecchia su `absorbedAt`, non su `lastContact`.** Ogni record è tenuto insieme all'istante `atUnix` in cui lo abbiamo assorbito, e `prune(nowUnix)` confronta quello. Due ragioni. La finestra di ritenzione misura la cadenza della *nostra* spazzata — quanto passa prima che una tile torni — che è una proprietà del poller e non dell'orologio del provider. E con `lastContact` nullable l'unico modo type-safe di scrivere il vecchio confronto, cioè saltare ciò che non si può confrontare, renderebbe immortale un aereo di staleness ignota. **In concreto: `absorb` riceve `Math.floor(Date.now() / 1000)`, mai `result.fetchedAt`.** `fetchedAt` non è l'istante del nostro fetch: entrambi gli adattatori lo derivano dal campo `now` della risposta upstream (`src/data/sources/adsbLol.ts`, `src/data/sources/adsbFi.ts`), mentre `prune(nowUnix)` gira su `Date.now()`. Passarlo ad `absorb` metterebbe a confronto due orologi diversi a ogni ciclo, e la deriva di quello del provider allungherebbe o accorcerebbe in silenzio la finestra di ritenzione. Ne segue che l'appartenenza alla flotta non dipende da timestamp altrui, coerentemente con il principio che il Task 7 enuncia: «il server è l'unica autorità su chi è in volo».
- **In `absorb` vince il record in arrivo ogni volta che le due età non sono confrontabili.** Se entrambi i `lastContact` sono non-null vince il più recente, com'era già. Se uno dei due è `null` le età non sono ordinabili, e vince il record in arrivo perché è l'informazione fetchata più di recente che abbiamo. Attenzione: `prev.lastContact !== r.lastContact` **non** restringe il null, perché sono entrambi nullable — il confronto va scritto con due controlli espliciti.

- [x] **Step 1: Scrivere il test della flotta**

Creare `tests/unit/server/fleet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFleet } from '../../../server/fleet';
import type { AircraftRaw } from '../../../src/types';

function ac(icao: string, lastContact: number | null, lat = 10): AircraftRaw {
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

  it('prunes aircraft no tile has reported within the age window', () => {
    // Ageing is on the moment WE absorbed a record, so two aircraft taken
    // in by the same batch always age together: 'old' has to arrive in an
    // earlier sweep or this asserts nothing.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('old', 1000)], 1000);
    f.absorb([ac('fresh', 1500)], 1500);
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

  it('absorbs a record whose staleness the provider never stated', () => {
    // null is "the provider did not say how old this fix is", not "fresh":
    // an aircraft we cannot date is still an aircraft a tile reported.
    const f = createFleet();
    f.absorb([ac('a', null)], 100);
    expect(f.snapshot().map((x) => x.icao24)).toEqual(['a']);
    expect(f.snapshot()[0]!.lastContact).toBeNull();
  });

  it('prunes an undatable record too — it is not immortal', () => {
    // Ageing on lastContact would have to skip what it cannot compare, and
    // a record of unknown staleness would then never leave the fleet.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', null)], 1000);
    expect(f.prune(1500)).toBe(0);
    expect(f.prune(1700)).toBe(1);
    expect(f.size()).toBe(0);
  });

  it('lets the incoming record win whenever the two ages are not comparable', () => {
    // Either side unknown means no ordering exists, so the tie goes to the
    // batch we fetched last rather than to whatever is already in the map.
    const f = createFleet();
    f.absorb([ac('a', null, 10)], 100);
    expect(f.absorb([ac('a', 150, 20)], 150)).toBe(1);
    expect(f.snapshot()[0]!.lastContact).toBe(150);
    expect(f.snapshot()[0]!.latitude).toBe(20);

    f.absorb([ac('b', 150, 10)], 150);
    expect(f.absorb([ac('b', null, 30)], 200)).toBe(1);
    expect(f.snapshot().find((x) => x.icao24 === 'b')!.latitude).toBe(30);
  });

  it('ages on OUR clock, whatever clock the provider stamped the batch with', () => {
    // SourceResult.fetchedAt is NOT the instant of our fetch: both adapters
    // derive it from the upstream `now` field, so it is the provider's
    // clock, while prune() is called with ours. Ageing on it let the
    // provider's drift stretch or shrink the retention window in silence.
    // Nothing the provider says about time may move what prune() does: the
    // only clock that counts is the atUnix the poller passes in.
    const behind = createFleet({ maxAgeSeconds: 600 });
    const ahead = createFleet({ maxAgeSeconds: 600 });
    // Same aircraft, same local instant of absorption; only the ages the
    // provider claims differ — an hour behind, an hour ahead, unstated.
    behind.absorb([ac('a', 1000 - 3600), ac('b', null)], 1000);
    ahead.absorb([ac('a', 1000 + 3600), ac('b', null)], 1000);
    expect(behind.prune(1500)).toBe(0);
    expect(ahead.prune(1500)).toBe(0);
    expect(behind.prune(1601)).toBe(2);
    expect(ahead.prune(1601)).toBe(2);
    expect(behind.size()).toBe(0);
    expect(ahead.size()).toBe(0);
  });

  it('starts empty', () => {
    expect(createFleet().snapshot()).toEqual([]);
  });

  it('lets the retention window be retuned at runtime', () => {
    // A sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling of
    // one tile every 1.5 s, and that varies. A window shorter than a sweep
    // deletes aircraft long before their tile comes round again, leaving a
    // rotating smear instead of a fleet — so the poller derives it from the
    // sweep it actually observes.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', 1000)], 1000);
    f.setMaxAgeSeconds(3000);
    expect(f.maxAgeSeconds()).toBe(3000);
    expect(f.prune(3500)).toBe(0); // 2500s old, still inside the new window
    f.setMaxAgeSeconds(600);
    expect(f.prune(3500)).toBe(1);
  });

  it('caps the snapshot, keeping what we absorbed last', () => {
    // /api/states serves the WHOLE fleet on every request, so the payload is
    // as big as the retention window makes it. Dropping the oldest sightings
    // first drops exactly what prune() would take next.
    const f = createFleet();
    f.absorb([ac('old1', 100), ac('old2', 100)], 100);
    f.absorb([ac('new1', 200), ac('new2', 200)], 200);
    expect(
      f
        .snapshot(2)
        .map((a) => a.icao24)
        .sort()
    ).toEqual(['new1', 'new2']);
  });

  it('returns the whole fleet when it is under the cap', () => {
    const f = createFleet();
    f.absorb([ac('a', 100), ac('b', 100)], 100);
    expect(f.snapshot(50)).toHaveLength(2);
    expect(f.snapshot()).toHaveLength(2);
  });
});
```

- [x] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/fleet.test.ts`
Expected: FAIL — modulo inesistente

- [x] **Step 3: Creare `server/fleet.ts`**

```ts
import type { AircraftRaw } from '../src/types.js';

export interface FleetOptions {
  /** An aircraft no tile has reported again within this window is dropped. */
  maxAgeSeconds?: number;
}

export interface Fleet {
  /**
   * @param atUnix when WE fetched this batch. It is stored next to each
   *   record and is the clock prune() ages on, so fleet membership never
   *   depends on the provider's own timestamps.
   * @returns how many records this batch created or updated.
   */
  absorb(aircraft: AircraftRaw[], atUnix: number): number;
  /**
   * Every record, or — with maxRecords — the most recently absorbed ones.
   *
   * The cap exists because /api/states serves the whole fleet on every
   * request: the payload grows with the retention window, and in the
   * slow-upstream regime that window stretches to two hours. Dropping the
   * oldest sightings first drops what prune() would remove next anyway.
   */
  snapshot(maxRecords?: number): AircraftRaw[];
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
 * fresher one; when either side's age is unknown, the record we just
 * fetched wins.
 */
export function createFleet(opts: FleetOptions = {}): Fleet {
  let maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  // Each record is kept with the moment WE absorbed it. The provider does
  // not supply that, and it is what the retention window is measured on.
  const byIcao = new Map<string, { record: AircraftRaw; absorbedAt: number }>();

  return {
    absorb(aircraft, atUnix) {
      let changed = 0;
      for (const ac of aircraft) {
        const prev = byIcao.get(ac.icao24);
        // Since 8ae051c lastContact is `number | null`, where null means
        // "the provider did not say how stale this fix is" — not "fresh".
        // Two known ages can be ordered and the older one is dropped; as
        // soon as one side is unknown they cannot be, and the tie goes to
        // the batch we just fetched, the later information we hold. Both
        // null checks are needed: a `!==` between two nullable fields does
        // not narrow either of them.
        const prevIsNewer =
          prev !== undefined &&
          prev.record.lastContact !== null &&
          ac.lastContact !== null &&
          prev.record.lastContact >= ac.lastContact;
        if (prevIsNewer) continue;
        byIcao.set(ac.icao24, { record: ac, absorbedAt: atUnix });
        changed += 1;
      }
      return changed;
    },

    snapshot(maxRecords) {
      const entries = [...byIcao.values()];
      if (maxRecords === undefined || entries.length <= maxRecords) {
        return entries.map((e) => e.record);
      }
      // Freshest first, so what falls off the end is what prune() would take
      // next. The sort only runs when the cap actually bites.
      return entries
        .sort((a, b) => b.absorbedAt - a.absorbedAt)
        .slice(0, maxRecords)
        .map((e) => e.record);
    },

    prune(nowUnix) {
      let removed = 0;
      for (const [icao, entry] of byIcao) {
        // Ageing is on absorbedAt, not on lastContact. The window measures
        // the cadence of OUR sweep — how long before a tile comes round
        // again — which is a property of the poller, not of the provider's
        // clock. And an aircraft whose staleness the provider never stated
        // would otherwise never age out at all.
        if (nowUnix - entry.absorbedAt > maxAgeSeconds) {
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

- [x] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/fleet.test.ts`
Expected: PASS, 14 test

- [x] **Step 5: Scrivere il test di `feedState`**

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

- [x] **Step 6: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: FAIL — modulo inesistente

- [x] **Step 7: Creare `server/feedState.ts`**

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

- [x] **Step 8: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/feedState.test.ts`
Expected: PASS, 8 test

- [x] **Step 8a: Scrivere il test della catena d'errore**

Il difetto #51 lascia un'istruzione esplicita per questo task: il logging deve percorrere la catena `cause` fino alla radice, perche' il `code` di undici sta su `e.cause.cause`. Il Task 1 ha conservato `cause` sull'errore aggregato del selector proprio perche' qui lo si potesse leggere, e il Task 1 ha anche tipizzato `status` e `retryAfterSeconds` su `UpstreamHttpError`: il poller li legge invece di indovinarli da una regex sul messaggio.

Creare `tests/unit/server/errorChain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rootCause, upstreamStatus } from '../../../server/errorChain';

describe('rootCause', () => {
  it('reads the code from the deepest link, not from the first', () => {
    // The shape the Railway egress failure actually had: the selector wraps
    // the adapter error, which wraps undici's, and only the innermost link
    // carries the code. Reading e.cause alone logged causeCode: null.
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND api.adsb.lol'), {
      code: 'ENOTFOUND',
    });
    const middle = new Error('adsb-lol: fetch failed', { cause: inner });
    const top = new Error('all usable ADS-B sources failed: adsb-lol: fetch failed', {
      cause: middle,
    });
    expect(rootCause(top)).toEqual({
      message: 'getaddrinfo ENOTFOUND api.adsb.lol',
      code: 'ENOTFOUND',
    });
  });

  it('falls back to the error itself when there is no cause', () => {
    expect(rootCause(new Error('all ADS-B sources are in cooldown'))).toEqual({
      message: 'all ADS-B sources are in cooldown',
      code: null,
    });
  });

  it('survives a non-Error throw', () => {
    expect(rootCause('boom')).toEqual({ message: 'boom', code: null });
  });

  it('stops on a cause chain that loops back on itself', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(rootCause(b).message).toBe('a');
  });
});

describe('upstreamStatus', () => {
  it('finds the adapter status and Retry-After under the selector wrapper', () => {
    const http = Object.assign(new Error('adsb-lol: HTTP 429 (retry after 90s)'), {
      status: 429,
      retryAfterSeconds: 90,
      body: null,
    });
    const top = new Error('all usable ADS-B sources failed: adsb-lol: HTTP 429', {
      cause: http,
    });
    expect(upstreamStatus(top)).toEqual({ status: 429, retryAfterSeconds: 90 });
  });

  it('reports null seconds when the server sent no Retry-After', () => {
    const http = Object.assign(new Error('adsb-lol: HTTP 429'), {
      status: 429,
      retryAfterSeconds: null,
      body: null,
    });
    expect(upstreamStatus(new Error('wrapped', { cause: http }))).toEqual({
      status: 429,
      retryAfterSeconds: null,
    });
  });

  it('returns null when nothing in the chain is an HTTP failure', () => {
    expect(upstreamStatus(new Error('no ADS-B source accepts a 10000 NM radius'))).toBeNull();
  });
});
```

- [x] **Step 8b: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/errorChain.test.ts`
Expected: FAIL — modulo inesistente

- [x] **Step 8c: Creare `server/errorChain.ts`**

```ts
/**
 * Readers for the error chain the poller actually receives.
 *
 * The selector throws an aggregate Error carrying the original failure as
 * `cause`, and that failure is itself a wrapper: undici hangs the code an
 * operator greps for — UND_ERR_CONNECT_TIMEOUT, ENOTFOUND — on
 * `e.cause.cause`. The handler that read one level logged causeCode: null
 * throughout the Railway egress outage, the one failure it existed for.
 */

export interface RootCause {
  message: string;
  /** undici's error code, when any link in the chain carried one. */
  code: string | null;
}

/** Walks `.cause` to the deepest link, keeping the last message and code seen. */
export function rootCause(e: unknown): RootCause {
  let message = e instanceof Error ? e.message : String(e);
  let code: string | null = null;
  let current: unknown = e;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current); // a chain that loops back must not hang the logger
    const link = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof link.message === 'string' && link.message !== '') message = link.message;
    if (typeof link.code === 'string' && link.code !== '') code = link.code;
    current = link.cause ?? null;
  }
  return { message, code };
}

export interface UpstreamStatus {
  status: number;
  /** Seconds the server asked us to wait, or null when it did not say. */
  retryAfterSeconds: number | null;
}

/**
 * Finds the `UpstreamHttpError` the adapters throw, wherever the selector
 * buried it. Without it the poller is left matching /\b429\b/ against a
 * message, next to a `status` and a `Retry-After` the adapter already
 * parsed and typed.
 */
export function upstreamStatus(e: unknown): UpstreamStatus | null {
  let current: unknown = e;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const link = current as { status?: unknown; retryAfterSeconds?: unknown; cause?: unknown };
    if (typeof link.status === 'number') {
      return {
        status: link.status,
        retryAfterSeconds:
          typeof link.retryAfterSeconds === 'number' ? link.retryAfterSeconds : null,
      };
    }
    current = link.cause ?? null;
  }
  return null;
}
```

- [x] **Step 8d: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/errorChain.test.ts`
Expected: PASS, 7 test

- [x] **Step 8e: Scrivere il test della dormienza che impara dal fallimento**

`src/data/sources/tileGrid.ts` è già committato dal Task 2, ma il contratto dello scheduler cambia qui, e va cambiato prima dello Step 9 che lo usa. Motivo: `scheduler.record()` è raggiunto **solo sul ramo di successo**, quindi una tile la cui fetch fallisce sempre non diventa mai dormiente, resta nella rotazione per sempre e consuma uno slot da 1,5 s a ogni spazzata. La dormienza — la ragione per cui lo scheduler esiste — imparerebbe solo dal vuoto, mai dal fallimento.

Il vincolo opposto conta quanto questo: **un 429 è globale**, colpisce ogni tile, e non deve addormentare il mondo intero. La distinzione sta nel chiamante, non qui: lo Step 9 decide quali fallimenti sono attribuibili alla singola tile, lo scheduler riceve un metodo separato e non sa nulla di HTTP.

Aggiungere in coda al blocco `describe('createTileScheduler', ...)` di `tests/unit/data/sources/tileGrid.test.ts`, **prima** della parentesi che lo chiude:

```ts
  it('marks a tile dormant when its fetch keeps FAILING, not only when it is empty', () => {
    // record() is reached only on the poller's success branch, so before
    // recordFailure() a tile that always failed stayed in the rotation for
    // ever: one 1.5 s slot per sweep, every sweep, for a tile that never
    // answers. Dormancy learned from emptiness and never from failure.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 3 });
    for (let i = 0; i < 3; i++) s.recordFailure('b');
    expect(s.stats().dormant).toBe(1);
    expect(s.stats().productive).toBe(2);
  });

  it('counts a failure and an empty answer on the SAME streak', () => {
    // Both mean the tile yielded no aircraft this time round and both cost
    // the same slot. Two separate counters would let a tile alternate
    // between failing and answering empty and never reach either threshold.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 3 });
    s.record('a', 0);
    s.recordFailure('a');
    expect(s.stats().dormant).toBe(0);
    s.record('a', 0);
    expect(s.stats().dormant).toBe(1);
  });

  it('wakes a tile that answers again after failing', () => {
    // Dormancy stays reversible whatever put the tile to sleep: an outage
    // on one region is not evidence about the next month.
    const s = createTileScheduler(tiles3(), { dormantAfterEmptySweeps: 2 });
    s.recordFailure('c');
    s.recordFailure('c');
    expect(s.stats().dormant).toBe(1);
    s.record('c', 7);
    expect(s.stats().dormant).toBe(0);
    expect(s.stats().productive).toBe(3);
  });

  it('drops a failing tile out of the rotation, which is the point of all this', () => {
    // The slot is the scarce resource: one request every 1.5 s. A tile that
    // cannot be fetched has to stop spending one on every sweep.
    const s = createTileScheduler(tiles3(), {
      dormantAfterEmptySweeps: 1, dormantRetryEvery: 100, minRefreshMs: 0,
    });
    // One full sweep first: isDue() lets a dormant tile through on every
    // retryEvery-th sweep, and sweep ZERO is one of those — without this the
    // test would pass for the wrong reason, or fail for one.
    for (const t of s.next(3)) s.record(t.id, 5);
    s.recordFailure('b');
    const served = s.next(3).map((t) => t.id);
    expect(served).not.toContain('b');
    expect(served.length).toBe(2);
  });
```

- [x] **Step 8f: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: FAIL — `s.recordFailure is not a function` nei quattro test nuovi, i 34 preesistenti verdi.

- [x] **Step 8g: Aggiungere `recordFailure` a `src/data/sources/tileGrid.ts`**

File già committato: tre modifiche puntuali, non una riscrittura.

Nell'interfaccia `TileScheduler`, subito dopo `record(tileId: string, aircraftCount: number): void;`:

```ts
  /**
   * A fetch that failed for a reason attributable to THIS tile.
   *
   * Separate from record() because only the caller can tell a tile's own
   * failure from the whole feed's: a 429 is the provider's global rate
   * limit and would otherwise put all 546 tiles to sleep at once.
   */
  recordFailure(tileId: string): void;
```

Dentro `createTileScheduler`, accanto a `isDue`, dichiarare l'helper che le due strade condividono:

```ts
  /**
   * One more sweep in which this tile yielded nothing.
   *
   * Shared by record(count === 0) and recordFailure() on purpose: an empty
   * answer and a failed fetch cost the same 1.5 s slot and carry the same
   * meaning for the rotation. Keeping two streaks would let a tile alternate
   * between the two and never reach either threshold.
   */
  function countBarrenSweep(tileId: string): void {
    const streak = (emptyStreak.get(tileId) ?? 0) + 1;
    emptyStreak.set(tileId, streak);
    if (streak >= dormantAfter) dormant.add(tileId);
  }
```

e sostituire il metodo `record` con questa coppia:

```ts
    record(tileId, aircraftCount) {
      if (aircraftCount > 0) {
        emptyStreak.set(tileId, 0);
        dormant.delete(tileId);
        return;
      }
      countBarrenSweep(tileId);
    },

    recordFailure(tileId) {
      countBarrenSweep(tileId);
    },
```

- [x] **Step 8h: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/tileGrid.test.ts`
Expected: PASS, 38 test (34 del Task 2 più i 4 nuovi).

- [x] **Step 8i: Scrivere il test del 429 citato a memoria**

Durante il cooldown del breaker **nessuna sorgente viene interrogata**, eppure l'errore aggregato di `selector.ts` interpola `lastError`, che per un 429 contiene ancora `HTTP 429`, e lancia con `cause: causes[0]` dove `causes` è vuoto. Lo Step 9 ne ricava `upstreamStatus(e) === null` e poi `/\b429\b/.test(msg) === true`: un messaggio **stale** riarma la sospensione da rate limit con il cooldown di ripiego di 5 minuti, su un tick in cui non è partita una sola richiesta, e il ciclo successivo può rifarlo. Il poller deve poter distinguere «429 appena ricevuto» da «429 ricordato».

Aggiungere a `tests/unit/data/sources/selector.test.ts`, dentro `describe('createSourceSelector', ...)`:

```ts
  it('marks an error raised while every source was in cooldown as NOT attempted', async () => {
    // Nothing left the process on that call, so the 429 quoted in the
    // message is a replay of one from minutes ago. server/index.ts reads
    // `attempted` before letting message text re-arm the rate-limit
    // suspension: without it a stale "HTTP 429" froze the feed for five
    // more minutes on every cycle, without a single request being made.
    const a = fakeSource('a', 250, async () => {
      throw new Error('adsb-lol: HTTP 429 (retry after 90s)');
    });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });

    const live = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect((live as { attempted?: boolean }).attempted).toBe(true);

    clock += 1000; // breaker still open: the source is not asked at all
    const replayed = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect((replayed as Error).message).toMatch(/in cooldown after/);
    expect((replayed as Error).message).toMatch(/429/); // still readable by an operator
    expect((replayed as { attempted?: boolean }).attempted).toBe(false);
    expect(a.fetchRegion).toHaveBeenCalledTimes(1);
  });

  it('does not pretend to carry a cause when nothing was asked', async () => {
    // `cause: causes[0]` with an empty `causes` CREATES the property with
    // value undefined, so a reader cannot tell "no diagnosis exists" from
    // "the diagnosis was lost" — and every cooldown error looked like the
    // second. rootCause() then reports the aggregate's own message as the
    // root, which is the one message that explains nothing.
    const a = fakeSource('a', 250, async () => { throw new Error('adsb-lol: HTTP 500'); });
    let clock = 1000;
    const selector = createSourceSelector([a], { breakerCooldownMs: 60_000, now: () => clock });
    await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch(() => undefined);
    clock += 1000;
    const replayed = await selector.fetchRegion({ lat: 0, lon: 0 }, 10).catch((e: unknown) => e);
    expect('cause' in (replayed as Error)).toBe(false);
  });

  it('still carries the original cause when a source WAS asked', async () => {
    // The guard above must not cost the diagnostic the cause exists for.
    const original = Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' });
    const a = fakeSource('a', 250, async () => { throw original; });
    const thrown = await createSourceSelector([a])
      .fetchRegion({ lat: 0, lon: 0 }, 10)
      .catch((e: unknown) => e);
    expect((thrown as Error).cause).toBe(original);
    expect((thrown as { attempted?: boolean }).attempted).toBe(true);
  });
```

- [x] **Step 8j: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: FAIL — `attempted` è `undefined` e `'cause' in err` è `true`; i 12 test preesistenti restano verdi.

- [x] **Step 8k: Marcare l'errore aggregato in `src/data/sources/selector.ts`**

File già committato. Esportare il tipo sopra `createSourceSelector`:

```ts
/**
 * The aggregate thrown when no source could serve the request.
 *
 * `attempted` says whether a request actually left the process on THIS
 * call. It is false when every source was skipped by its own breaker: the
 * message then quotes the error that opened the breaker minutes ago, and a
 * reader that re-parses it — server/index.ts matching /\b429\b/ — would
 * re-arm a five-minute rate-limit suspension on a tick that asked nothing.
 */
export interface SourcesFailedError extends Error {
  attempted: boolean;
}
```

e sostituire il solo blocco del `throw` aggregato:

```ts
      if (errors.length > 0) {
        // A source skipped for radius is still part of the picture: without
        // this, a mixed roster reports only "adsb-fi: HTTP 500" and the
        // operator never learns the primary was never asked at all.
        const alsoSkipped =
          skippedForRadius.length > 0
            ? ` | skipped for radius: ${skippedForRadius.join(', ')}`
            : '';
        const err = new Error(
          `all usable ADS-B sources failed: ${errors.join(' | ')}${alsoSkipped}`
        ) as SourcesFailedError;
        // causes is non-empty exactly when a source was really tried, which
        // is also what makes the message describe THIS call rather than an
        // earlier one. `new Error(m, { cause: undefined })` would still
        // create the property, so it is assigned only when there is one.
        if (causes.length > 0) (err as Error & { cause?: unknown }).cause = causes[0];
        err.attempted = causes.length > 0;
        throw err;
      }
```

- [x] **Step 8l: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/sources/selector.test.ts`
Expected: PASS, 15 test (12 preesistenti più i 3 nuovi).

- [x] **Step 9: Riscrivere il ciclo di aggiornamento in `server/index.ts`**

Rimuovere il blocco della cache artigianale (`const cache = new Map...`, `CACHE_TTL_MS`, `GLOBAL_KEY`, `bboxKey`) e `GLOBAL_SWEEP`. Aggiungere agli import e alle costanti:

```ts
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createFeedState } from './feedState.js';
import { createFleet } from './fleet.js';
import { rootCause, upstreamStatus } from './errorChain.js';
import { buildTileGrid, createTileScheduler, tilesNear, TILE_RADIUS_NM } from '../src/data/sources/tileGrid.js';

const feed = createFeedState();
const fleet = createFleet();
const tiles = buildTileGrid();
const scheduler = createTileScheduler(tiles);
const WORLD_KEY = 'world';

/**
 * Hard ceiling on the records in one payload.
 *
 * /api/states serves the whole accumulated fleet on every request — the bbox
 * is ignored on purpose — so the body is as big as the retention window
 * makes it, not as big as what the viewer is looking at.
 *
 * Measured on 20 000 records of the fourteen fields in src/types.ts, with
 * realistic variation: 280 B each with no route attached, 414 B with one,
 * about 340 B at a plausible route coverage — against about 143 B in v1,
 * which carried neither registration nor model nor route nor the
 * completeness flag. At the retention FLOOR of 1 200 s the fleet holds
 * twenty minutes of sightings, more aircraft than any snapshot, so the body
 * lands between 5,6 and 8,3 MB. Step 15a measures the real figure rather
 * than trusting this one.
 *
 * 24 000 is that 10 MB expressed in records: 24 000 x 414 B is 9,9 MB, the
 * worst case with a route on every aircraft. It therefore does not bind in
 * the normal regime — it is the backstop for the slow-upstream one, where
 * the window stretches to MAX_RETENTION_S = 7 200 s and the fleet becomes
 * two hours of sightings. When it binds, the payload is the most recently
 * absorbed records and `capped: true` says so in the body and on /health;
 * the fix is the one Step 15 already names, shrink the grid or accept a
 * partial feed.
 */
const MAX_PAYLOAD_AIRCRAFT = 24_000;

const gzipAsync = promisify(gzip);

/**
 * The current cycle's payload, compressed once instead of once per request.
 *
 * Measured at 6,1x with no routes attached and 7,8x with a route on every
 * record: twenty thousand objects with the same fourteen keys is close to
 * the best case for a dictionary coder, so ~7 MB leaves as ~1 MB.
 * Compressing in the handler would redo that work for every client on a body
 * that changes once a cycle, and gzipSync would block the same event loop
 * that paces the tile fetches.
 *
 * Two variants, because withStaleFlag() writes the freshness INTO the body
 * and a compressed body cannot be patched afterwards. (That function is
 * declared in Step 10 below; a function declaration is hoisted, and this
 * code runs only after listen().) Null until the cycle's compression
 * resolves, and the handler serves the raw string until then.
 */
let encodedWorld: { fresh: Buffer; stale: Buffer } | null = null;
let lastPayloadAircraft = 0;
let lastPayloadBytes = 0;
let lastPayloadGzipBytes = 0;
let lastPayloadCapped = false;

/**
 * Ceiling on the radius a viewer may ask us to refresh first.
 *
 * Not a round number any more. The orbit controls in src/globe/scene.ts hold
 * the camera between 3,0 and 10,0 globe radii, and at the far limit the cap
 * it can actually see is 4 886 NM (visibleCapRadiusNm in geoHelpers.ts). The
 * old ceiling of 2 000 NM sat BELOW the smallest value the client could
 * produce, so every request arrived clamped to exactly 2 000 and the zoom
 * level never reached the server at all. This one bounds a malformed client
 * without ever truncating an honest one.
 */
const MAX_VIEW_RADIUS_NM = 5_000;
/** No lat/lon in the query: refresh a region the size of a zoomed-in view. */
const DEFAULT_VIEW_RADIUS_NM = 600;

/**
 * Floor and ceiling for the derived retention window.
 *
 * A nominal sweep is 546 tiles x 1.5 s = 819 s, so this 1200 s floor is
 * about one and a half of them: a tile always comes round again well before
 * the window expires. 546 is the worst case and also the boot case, when
 * nothing is dormant yet; the derived figure below is measured over the DUE
 * tiles, so once the ocean and edge tiles fall asleep the sweep shortens and
 * this floor legitimately wins. That is the floor doing its job, not the
 * derivation going inert — the derivation still binds in the regime it was
 * written for, an upstream slower than the 1.5 s slot, where a sweep runs
 * into hours and only MAX_RETENTION_S holds it back.
 */
const MIN_RETENTION_S = 1_200;
const MAX_RETENTION_S = 7_200;

let observedSweepSeconds = 0;
const pollerStartedMs = Date.now();

// Two lessons, both learned the hard way, both encoded here.
//
// One: the rate is NOT derived from the measured latency. adsb.lol answered
// in 0.47 s median one day and 28.6 s the next; an earlier revision sized
// its pace on the slow reading and ended up emitting 3.2 req/s while
// believing it was doing 0.28.
//
// Two: a rate ceiling on the AVERAGE is not enough. A revision that fired 8
// tiles at once every 8 s averaged 1.07 req/s and was still cut off:
// measured on the real server, 26 fetches succeeded and then adsb.lol
// answered 429 — and so did adsb.fi, because the selector retried the burst
// against it. The feed was dead from second 24.
//
// So tiles are fetched STRICTLY ONE AT A TIME, spaced by a fixed interval
// measured from the previous fetch — across cycle boundaries included.
// 546 tiles at one every 1.5 s is a sweep of about 13.7 minutes.
const TILE_INTERVAL_MS = 1_500;
/** Tiles taken from the scheduler per cycle; they are fetched sequentially. */
const TILES_PER_CYCLE = 8;
/**
 * Idle delay before the next cycle starts. It no longer paces requests —
 * waitForTileSlot() does, counting from the last fetch of the PREVIOUS
 * cycle — so this can only push requests further apart, never closer. It
 * stays because a cycle that fetches nothing (suspended after a 429, or an
 * empty batch) returns at once, and the loop would otherwise spin.
 */
const TILE_CYCLE_GAP_MS = 1_000;
/**
 * Suspension after a 429 that carried NO Retry-After. When the header is
 * there it wins: httpError.ts has already parsed it into
 * `retryAfterSeconds`, in seconds or as an HTTP-date, and a guess that
 * undershoots a number the server stated is how the penalty gets renewed
 * instead of served.
 */
const TILE_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 300_000;
/**
 * Bounds on a Retry-After we did not write: 0 would make the suspension a
 * no-op and the next cycle would renew the ban, while an HTTP-date far
 * ahead would freeze the feed for hours.
 */
const MIN_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 3_600_000;
/**
 * Deadline for one tile fetch. undici's headersTimeout is 300 s and the
 * dispatcher above overrides only `connect`, so a single hung tile holds
 * `cycleInFlight` — and with it the whole feed — for five minutes. 60 s
 * rather than the 10 s used for the adsbdb lookups (defect #37): adsb.lol
 * answered in 0.47 s median when last measured but took 52.8 s for one tile
 * during the congested run, and aborting slow-but-healthy tiles would
 * starve the fleet instead of protecting it.
 */
const TILE_FETCH_TIMEOUT_MS = 60_000;
/** The adapters already take a `fetchImpl`, so the deadline is injected
 *  here and no signature changes. */
const fetchWithTileTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) });
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

let tilesSuspendedUntil = 0;
/** When the last tile fetch was issued. Kept BETWEEN cycles on purpose. */
let lastTileFetchAtMs = 0;
/** The last tile failure as thrown: /health reads its chain, not a string. */
let lastTileFailure: unknown = null;

/**
 * Waits until TILE_INTERVAL_MS has passed since the last fetch was issued.
 *
 * Spacing the tiles only inside a cycle left the boundary between two cycles
 * TILE_CYCLE_GAP_MS apart — 1 s, under the declared floor of one request
 * every 1.5 s. Same family as the burst that earned the 429: what gets
 * punished is the instantaneous pattern, not the average.
 */
async function waitForTileSlot(): Promise<void> {
  const waitMs = lastTileFetchAtMs + TILE_INTERVAL_MS - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

async function runCycle(): Promise<void> {
  if (Date.now() < tilesSuspendedUntil) return; // rate-limited: ask nothing

  const batch = scheduler.next(TILES_PER_CYCLE);
  if (batch.length === 0) return;

  // OUR clock, stamped once per cycle and handed to every absorb() below.
  // `result.fetchedAt` is NOT the instant of our fetch: both adapters derive
  // it from the upstream `now` field (adsbLol.ts, adsbFi.ts), so it is the
  // provider's clock — while prune() runs on Date.now(). Comparing the two
  // every cycle let the provider's drift stretch or shrink the retention
  // window in silence, and broke the invariant this task declares: fleet
  // membership depends on no one else's clock. Stamped once rather than per
  // tile so every record of a cycle ages together; a cycle lasts seconds
  // against a window of at least 1200 s, and the error is in the safe
  // direction — a record is never stamped later than it actually arrived.
  const cycleAtUnix = Math.floor(Date.now() / 1000);

  let anySuccess = false;
  // Tiles whose failure may be theirs or may be the whole feed's — a
  // timeout, a transport error, a 5xx. They are charged to the tile only if
  // another tile succeeds in this same cycle; see the catch below.
  const ambiguousFailures: string[] = [];

  // Sequential, spaced. NOT Promise.all: a burst of eight is what earned the
  // 429 that killed the feed in testing, even while the average was inside
  // the ceiling.
  for (const tile of batch) {
    await waitForTileSlot();
    if (Date.now() < tilesSuspendedUntil) break;

    // Stamped before the fetch, not after: the floor is on the interval
    // between requests leaving this process, and a tile slower than the
    // floor already spaces itself.
    lastTileFetchAtMs = Date.now();
    try {
      const result = await sources.fetchRegion(tile.centre, TILE_RADIUS_NM, fetchWithTileTimeout);
      fleet.absorb(result.aircraft, cycleAtUnix);
      scheduler.record(tile.id, result.aircraft.length);
      anySuccess = true;
      // One line per successful tile: without it the request rate cannot be
      // observed from outside, and the point of the ceiling is that it must
      // be verifiable rather than believed.
      app.log.info({ tile: tile.id, aircraft: result.aircraft.length }, 'tile fetched');
    } catch (e) {
      // `msg` is the aggregate, which names every source tried; `root` is the
      // bottom of the cause chain, where undici puts the code (defect #51).
      const msg = e instanceof Error ? e.message : String(e);
      const root = rootCause(e);
      lastTileFailure = e;
      feed.recordFailure(`${tile.id}: ${msg}`);

      const http = upstreamStatus(e);
      // 429 is a first-class state here too, exactly as it is for adsbdb:
      // keep asking during the penalty and it is renewed rather than served.
      // The selector carries only the FIRST source's error as `cause`, so a
      // 429 raised by the second one survives in the message alone — hence
      // the text fallback. But that text has to describe a FRESH 429: while
      // a breaker is open the selector replays the message that opened it
      // without asking anything upstream, and re-arming a five-minute
      // suspension on a quote would freeze the feed cycle after cycle.
      // Step 8k marks exactly that error `attempted: false`.
      const attempted = (e as { attempted?: unknown }).attempted;
      if (http?.status === 429 || (attempted !== false && /\b429\b/.test(msg))) {
        const retryAfterSeconds = http?.status === 429 ? http.retryAfterSeconds : null;
        const waitMs =
          retryAfterSeconds === null
            ? TILE_RATE_LIMIT_FALLBACK_COOLDOWN_MS
            : Math.min(
                MAX_RATE_LIMIT_COOLDOWN_MS,
                Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, retryAfterSeconds * 1000)
              );
        tilesSuspendedUntil = Date.now() + waitMs;
        app.log.error(
          { err: msg, code: root.code, tile: tile.id, waitSeconds: Math.round(waitMs / 1000) },
          'tile fetch rate-limited — suspending'
        );
        break;
      }
      // Dormancy has to learn from failure too: record() above is reached
      // only on the success branch, so a tile that can never be fetched kept
      // its 1.5 s slot on every sweep for ever. Only the provider answering
      // ABOUT THIS REGION is evidence about the tile, and a 4xx other than
      // 429 is exactly that, so it counts at once. A timeout, a transport
      // error or a 5xx may just as easily be the whole feed failing: those
      // are held back and charged only if another tile succeeds in this
      // cycle. Without the split, one DNS outage would send all 546 tiles
      // dormant in three sweeps and the feed would crawl back over hours.
      if (http !== null && http.status >= 400 && http.status < 500) {
        scheduler.recordFailure(tile.id);
      } else {
        ambiguousFailures.push(tile.id);
      }
      app.log.warn(
        { err: msg, code: root.code, cause: root.message, tile: tile.id },
        'tile fetch failed'
      );
    }
  }

  // A failure that might have been the feed's is charged to the tile only
  // here, with the evidence that the feed was alive: another tile answered
  // in this same cycle.
  if (anySuccess) {
    for (const id of ambiguousFailures) scheduler.recordFailure(id);
  }

  if (!anySuccess) return;

  const nowUnix = Math.floor(Date.now() / 1000);

  // The retention window must outlast a full sweep, or prune() deletes an
  // aircraft long before its tile comes round again and the fleet degrades
  // into a rotating smear over a fraction of the grid. The sweep period is
  // measured rather than assumed: 546 tiles at the 1.5 s floor is 819 s and
  // the slots actually observed put it at 820-1000 s (14-17 minutes), but it
  // moves with upstream load, which is why it is derived and not a constant.
  // Measured on the ROTATION, not on every tile served: priority tiles are
  // re-fetched repeatedly and counting them would make the sweep look far
  // faster than it is, and the retention window would silently lie.
  // And over the tiles the rotation actually VISITS. Multiplying by
  // tiles.length counted the dormant ones as well, which the rotation skips
  // at zero cost — and dormant ocean and edge tiles are the steady state
  // Task 2 exists to reach, so the figure this plan calls the revisit period
  // was not one, and the window derived from it was inflated. `productive`
  // is total minus dormant; a dormant tile is still retried once every
  // DEFAULT_RETRY_EVERY sweeps, which adds at most ~5% to the true period
  // and is swallowed by the factor of two below.
  const elapsedS = (Date.now() - pollerStartedMs) / 1000;
  const stats = scheduler.stats();
  const dueTiles = Math.max(1, stats.productive);
  const sweepSeconds =
    stats.rotationServed > 0 ? (elapsedS / stats.rotationServed) * dueTiles : 0;
  observedSweepSeconds = Math.round(sweepSeconds);
  fleet.setMaxAgeSeconds(
    Math.min(MAX_RETENTION_S, Math.max(MIN_RETENTION_S, Math.round(sweepSeconds * 2)))
  );

  fleet.prune(nowUnix);

  const payloadAircraft = fleet.snapshot(MAX_PAYLOAD_AIRCRAFT);
  lastPayloadAircraft = payloadAircraft.length;
  lastPayloadCapped = fleet.size() > payloadAircraft.length;
  const body = JSON.stringify({
    fetchedAt: new Date(nowUnix * 1000).toISOString(),
    source: 'tiled',
    bbox: null,
    // Declared, not silent. A truncated world served as the whole world is
    // the same class of failure as a frozen feed served as a live one, and
    // this project has already paid for that one.
    capped: lastPayloadCapped,
    fleetSize: fleet.size(),
    aircraft: payloadAircraft,
  });
  lastPayloadBytes = Buffer.byteLength(body);
  feed.put(WORLD_KEY, body);

  if (lastPayloadCapped) {
    app.log.warn(
      { fleet: fleet.size(), served: payloadAircraft.length, retentionS: fleet.maxAgeSeconds() },
      'payload capped — the fleet outgrew MAX_PAYLOAD_AIRCRAFT'
    );
  }

  // Compressed AFTER the cache is filled, never before: a request landing
  // mid-compression gets the raw body rather than waiting on it.
  encodedWorld = null;
  try {
    const [fresh, stale] = await Promise.all([
      gzipAsync(withStaleFlag(body, false)),
      gzipAsync(withStaleFlag(body, true)),
    ]);
    encodedWorld = { fresh, stale };
    lastPayloadGzipBytes = fresh.length;
    app.log.info(
      { aircraft: payloadAircraft.length, bytes: lastPayloadBytes, gzipBytes: fresh.length },
      'payload encoded'
    );
  } catch (e) {
    // Not fatal: without the buffers the handler falls back to the raw body.
    lastPayloadGzipBytes = 0;
    app.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'payload compression failed');
  }
}
```

- [x] **Step 10: Sostituire il gestore `/api/states`**

La chiave di lettura è sempre `WORLD_KEY`: il poller scrive lì e un lettore che usasse una chiave derivata dal bbox mancherebbe sempre la cache. Il flag `stale` va **nel corpo**, perché `statesClient.ts` legge solo `res.json()` e un header non lo vedrebbe mai — e il Task 7 lo porta fino allo schermo, altrimenti questo spostamento non compra niente. L'header `x-feed-stale` resta per chi guarda con `curl`, non per il browser.

Il corpo esce **già compresso** quando il client dichiara di accettare gzip. È l'unica risposta seria al fatto che questo endpoint serve l'intera flotta accumulata a ogni richiesta, bbox ignorato di proposito: lo Step 15a misura quanto pesa e il tetto `MAX_PAYLOAD_AIRCRAFT` dice cosa succede quando cresce.

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
  // side of the planet: a full sweep takes 820-1000 s, 14-17 minutes.
  const viewLat = Number(q.lat);
  const viewLon = Number(q.lon);
  const viewRadius = Number(q.radius);
  if (Number.isFinite(viewLat) && Number.isFinite(viewLon)) {
    // Clamped, not trusted — but the ceiling is now above what the camera
    // can produce (see MAX_VIEW_RADIUS_NM), so an honest client is never
    // truncated and the zoom level survives the trip. A negative radius is
    // floored at 0, where tilesNear simply returns nothing.
    const radius = Number.isFinite(viewRadius)
      ? Math.min(Math.max(viewRadius, 0), MAX_VIEW_RADIUS_NM)
      : DEFAULT_VIEW_RADIUS_NM;
    const wanted = tilesNear(tiles, { lat: viewLat, lon: viewLon }, radius);
    // Six, not twelve: the scheduler reserves half of each batch for the
    // rotation, so asking for more only grows a queue that cannot be served.
    scheduler.prioritise(wanted.slice(0, 6).map((t) => t.id));
  }

  const cached = feed.get(WORLD_KEY);
  if (cached !== null) {
    reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, s-maxage=10, stale-while-revalidate=20')
      .header('x-feed-stale', String(cached.stale));

    // Load-bearing next to a public cache-control: without accept-encoding
    // in Vary a shared cache may hand the gzip body to a client that never
    // asked for one. APPENDED, never replaced: @fastify/cors has already
    // set `vary: Origin` — CORS_ORIGINS is a list with regexes — and
    // dropping that would let the same cache serve one origin's
    // Access-Control-Allow-Origin to another.
    const vary = reply.getHeader('vary');
    const varied = vary === undefined ? [] : Array.isArray(vary) ? vary.map(String) : [String(vary)];
    reply.header('vary', [...varied, 'accept-encoding'].join(', '));

    const acceptsGzip = String(req.headers['accept-encoding'] ?? '').includes('gzip');
    const encoded = encodedWorld;
    if (acceptsGzip && encoded !== null) {
      // Compressed once per cycle by refreshNextTiles(), not once per
      // client: the body changes once a cycle and every client gets the
      // same bytes.
      return reply
        .header('content-encoding', 'gzip')
        .send(cached.stale ? encoded.stale : encoded.fresh);
    }
    // No gzip accepted, or the cycle's compression has not resolved yet.
    return reply.send(withStaleFlag(cached.body, cached.stale));
  }

  // No stale fallback of unbounded age: that is what hid the v1 outage for
  // 25 days. Fail loudly instead.
  const health = feed.health();
  return reply.status(503).send({
    error: health.lastError ?? 'feed warming up',
    // Same chain as /health: a blank globe is reported here first, and
    // "fetch failed" with no ENOTFOUND under it carries no diagnosis.
    code: health.lastError === null ? null : rootCause(lastTileFailure).code,
    status: health.status,
    feedAgeSeconds: health.feedAgeSeconds,
    fleetSize: fleet.size(),
  });
});
```

Nota deliberata: niente fetch sincrono nel gestore. Una tile non restituirebbe comunque il mondo, e un fetch per richiesta verso un servizio gratuito è esattamente il traffico da evitare. Finché il primo ciclo non ha prodotto nulla, l'endpoint risponde 503 dicendo che si sta scaldando.

- [x] **Step 11: Sostituire il gestore `/health`**

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
    // The code an operator greps for — UND_ERR_CONNECT_TIMEOUT, ENOTFOUND —
    // sits at the bottom of the cause chain, not on the aggregate error the
    // selector throws. Tied to lastError's lifecycle, so a cleared failure
    // cannot leave a stale code behind.
    lastErrorCode: health.lastError === null ? null : rootCause(lastTileFailure).code,
    fleet: { size: fleet.size(), maxAgeSeconds: fleet.maxAgeSeconds() },
    // Measured, not assumed. This endpoint serves the whole fleet on every
    // request and the body grows with the retention window, so without these
    // numbers the payload can only be guessed at from outside — and a guess
    // is what this plan is replacing everywhere else.
    payload: {
      aircraft: lastPayloadAircraft,
      bytes: lastPayloadBytes,
      gzipBytes: lastPayloadGzipBytes,
      capped: lastPayloadCapped,
      maxAircraft: MAX_PAYLOAD_AIRCRAFT,
    },
    tiles: {
      ...scheduler.stats(),
      observedSweepSeconds,
      suspendedUntil: Date.now() < tilesSuspendedUntil ? new Date(tilesSuspendedUntil).toISOString() : null,
    },
  });
});
```

- [x] **Step 11b: Riscrivere i commenti che il Task 3 rende falsi**

Il difetto #27 e' esattamente questa classe: un commento che dichiara una causa di guasto non piu' vera manda fuori strada chi indaghera' il guasto successivo. Quattro blocchi di codice e un commento di test lo diventano nell'istante in cui lo Step 9 atterra, e vanno riscritti tutti qui: il gate in fondo allo step non puo' passare finche' ne sopravvive uno.

In `server/index.ts`, il blocco sopra `const sources = createSourceSelector(...)` (oggi righe 34-41, quello che inizia con «Plan 1's single global sweep.» e finisce con «until then this endpoint is known broken.») descrive uno sweep globale che non esiste piu'. Sostituirlo per intero:

```ts
// The feed is assembled from tiles, not from one global sweep: adsb.lol and
// adsb.fi both cap at 250 NM (verified live 2026-11-16) and no global
// endpoint survives (/v2/all -> 400, /api/0/all -> 503). Plan 1's single
// 10 000 NM request is what answered 502 in production without a single
// upstream request ever leaving the process — the selector skipped every
// source on radius. The poller below asks for one TILE_RADIUS_NM tile at a
// time instead.
const sources = createSourceSelector([adsbLolSource, adsbFiSource]);
```

In `src/data/sources/selector.ts`, il commento di `createSourceSelector` sostiene che l'unico chiamante chiede ancora uno sweep da 10 000 NM e che «until then this endpoint is known broken». Sostituire il paragrafo che va da «The radius check is not an optimisation.» a «until then this endpoint is known broken.» con:

```ts
 * The radius check is not an optimisation. Verified live 2026-11-17: BOTH
 * providers cap at 250 NM — adsb.lol answers 403 "radius exceeds 250 NM"
 * above it, adsb.fi answers 400. Asking either for more is a guaranteed
 * failure that would open its breaker for nothing, and there is no third
 * source to fall through to. The only caller now stays under that ceiling:
 * server/index.ts polls one 230 NM tile at a time. The check is what caught
 * the single 10 000 NM request Plan 1 issued — every source skipped on
 * radius, 502 to the client, not one upstream request — so it stays as the
 * refusal that happens here rather than at the provider.
```

Il testo nuovo racconta la stessa storia **senza** ripetere la stringa che il gate qui sotto cerca. La revisione precedente di questo step scriveva «10 000 NM sweep» dentro il commento e due righe piu' giu' pretendeva zero occorrenze di «10 000 NM sweep»: il grep avrebbe trovato la propria esca, e lo step non sarebbe mai potuto diventare verde.

In `src/data/sources/adsbFi.ts` il commento sopra `maxRadiusNm: 250` (oggi righe 54-60) dichiara che l'unico chiamante chiede ancora uno sweep da 10 000 NM, che entrambe le sorgenti sono scartate per raggio, che `/api/states` risponde 502 e che adsb.fi «is therefore a fallback for nothing today». Dopo lo Step 9 nessuna delle quattro e' vera, e la terza e' la diagnosi sbagliata che chi indaghera' il prossimo 502 leggera' per prima. Sostituire le sette righe da «// Verified live:» a «// request under 250 NM — not before.» con:

```ts
  // Verified live: 250 NM -> 200; 1000 NM -> 400; 5000 and 10 000 NM -> 429.
  // Same ceiling as adsb.lol since 2026-11, so the gap that once separated
  // the two providers is gone. The tiled poller now issues every request
  // under this ceiling, so adsb.fi is a real fallback again: when adsb.lol
  // opens its breaker the same tile is served from here, instead of both
  // sources being skipped on radius and /api/states answering 502.
```

`src/data/sources/adsbLol.ts` e' stato controllato nello stesso giro e **non** va toccato: il suo commento riporta solo misure (250 NM -> 200, 251 NM -> 403, `/v2/all` -> 400, `/api/0/all` -> 503) e non afferma nulla sul chiamante ne' sullo stato di `/api/states`.

In `src/data/sources/tileGrid.ts` il commento di `tilesNear` deriva la durata dello sweep da «~29 s per tile», la latenza misurata in un momento di congestione e poi smentita dal difetto #41 (rimisurata: 0,47 s mediani). La cadenza non viene piu' dalla latenza ma dal pavimento di 1,5 s per tile, quindi la cifra va rifatta. Sostituire il blocco di commento sopra `export function tilesNear` con:

```ts
/**
 * Tiles whose centre lies within `radiusNm` of a point, nearest first.
 *
 * Used to turn a viewer's camera into the set of tiles worth refreshing
 * immediately. A full sweep is 546 tiles fetched one at a time, at most one
 * every 1.5 s: 820-1000 s, i.e. 14-17 minutes. The ~10 minutes this comment
 * used to claim read the pace off a 29 s median latency measured during
 * congestion; the pace comes from the floor, and 546 x 1.5 s = 819 s is a
 * floor no latency can beat. Without this the region being looked at would
 * be as stale as the far side of the planet.
 */
```

`src/data/sources/tileGrid.ts` e' gia' committato dal Task 2: questa e' una modifica a un file tracciato, e deve comparire nella riga `git add` dello Step 16 come tutte le altre. Il blocco riprodotto nel Task 2 mostra gia' questa versione del commento, con la nota che lo dichiara.

Infine, in `tests/unit/data/sources/selector.test.ts` il test «reports clearly when every source was skipped for radius» si apre con «The real roster at the 10 000 NM sweep the caller still asks for» e con «This is the state Task 3 has to end, not a passing feature». Dopo questo task nessun chiamante chiede quel raggio e quello stato e' finito; il test resta valido, perche' asserisce la regola del selector e non il comportamento del poller. Sostituire le tre righe di commento con:

```ts
    // The real roster against a radius no caller asks for any more: both
    // providers declare 250 NM, so neither is called. This is where Plan 1's
    // 502 came from, kept as a regression test now that the poller stays
    // under the ceiling.
```

Poi verificare che nessuna delle affermazioni smentite sia sopravvissuta altrove:

```bash
grep -rn "known broken\|10 000 NM sweep\|GLOBAL_SWEEP" server/ src/ tests/
```

Expected: nessuna occorrenza. Il `tests/` nel comando non e' decorativo: «the caller still asks for» viveva proprio li', fuori dal raggio della versione precedente di questo gate, che guardava solo `server/` e `src/`. Un commento che descrive un guasto ormai risolto costa piu' di nessun commento: e' il difetto #27, che questo piano ha gia' pagato una volta.

- [x] **Step 12: Avviare il poller dopo il listen**

Nel blocco `try { await app.listen(...) }`, dopo la riga di log:

```ts
  // Self-rescheduling loop, NOT setInterval: a cycle can take minutes when
  // the upstream is slow, and a fixed timer would pile cycles on top of one
  // another until the request rate is unbounded.
  // waitForTileSlot() sets the rate, and it counts from the last fetch of
  // the previous cycle, so this delay can only push requests further apart.
  // It stays because a suspended or empty cycle returns at once and the
  // loop would otherwise spin.
  const scheduleNextCycle = (): void => {
    const t = setTimeout(() => {
      void refreshNextTiles().finally(scheduleNextCycle);
    }, TILE_CYCLE_GAP_MS);
    t.unref();
  };
  void refreshNextTiles().finally(scheduleNextCycle);
```

- [x] **Step 13: Verificare entrambi i programmi**

```bash
npm run build:all && npm test -- --run
```

- [ ] **Step 14: Guardie statiche, avvio del server e rate reale**

Prima i `grep`, che non richiedono un server acceso:

```bash
grep -n "setInterval" server/index.ts
grep -n "fetchedAt.getTime\|fleet.absorb" server/index.ts
grep -n "sweepSeconds =" server/index.ts
```

Expected, nell'ordine:

- nessuna occorrenza di `setInterval` relativa a `refreshNextTiles`. Un timer a cadenza fissa su un ciclo che può durare minuti produce cicli sovrapposti e richieste concorrenti illimitate verso un servizio gratuito;
- `fleet.absorb(result.aircraft, cycleAtUnix)` e **nessuna** occorrenza di `fetchedAt.getTime`. `result.fetchedAt` viene dal campo `now` del provider, non dal nostro fetch, e confrontarlo con il `Date.now()` di `prune` fa variare la finestra di ritenzione con la deriva di un orologio che non è il nostro;
- la derivazione moltiplica per `dueTiles`, non per `tiles.length`: la rotazione salta le tile dormienti a costo zero, quindi il totale non è il periodo di rivisita.

**Poi misurare il rate reale**, che è la cosa che conta e che un `grep` non può vedere. La misura si prende da `/health`, confrontando due letture a distanza nota — non cercando stringhe nei log, perché una stringa che il codice non emette darebbe zero sia con il limitatore funzionante sia con il limitatore rotto.

Avviare qui il server, in background e con i log su file: nessuno step lo rediriggeva, e il controllo di `tile fetched` più sotto cercava in un file che non esisteva. È lo stesso processo che servirà allo Step 15, quindi **il controllo al boot si fa adesso**, subito dopo l'avvio e prima che il primo ciclo finisca:

```bash
npm run server > /tmp/airview.log 2>&1 &
SERVER_PID=$!
sleep 3
curl -s -o /dev/null -w "health al boot: HTTP %{http_code}\n" localhost:3000/health
curl -s localhost:3000/health | python3 -c "import json,sys; print('status al boot:', json.load(sys.stdin)['status'])"
```

Expected: **HTTP 200** con `"status":"starting"`. Se qui vedi 503 il deploy su Railway fallirebbe: `railway.toml` vincola il deploy a questo endpoint e nessun traffico viene instradato finché non passa.

Dopo tre o quattro minuti di rotazione:

```bash
A=$(curl -s localhost:3000/health | python3 -c "import json,sys; print(json.load(sys.stdin)['tiles']['rotationServed'])")
sleep 120
B=$(curl -s localhost:3000/health | python3 -c "import json,sys; print(json.load(sys.stdin)['tiles']['rotationServed'])")
python3 -c "print(f'tile/s osservate: {($B - $A)/120:.2f}  (atteso: ~0.6)')"
```

Expected: **circa 0,6 tile al secondo** (una ogni 1,5 s), o meno se l'upstream è lento. Un valore sensibilmente superiore significa che il limitatore non funziona: una revisione precedente di questo piano emetteva 3,2 req/s credendo di emetterne 0,28, perché il ritmo era dedotto da una latenza misurata in un momento sfortunato invece che imposto.

Il conteggio da log è la controprova, ora che il file esiste davvero e che ogni tile riuscita emette una riga:

```bash
grep -c "tile fetched" /tmp/airview.log
```

Expected: un numero **maggiore o uguale a `rotationServed`** (ogni tile riuscita emette una riga, venga dalla rotazione o dalla priorità) e che cresce fra due letture. Zero con il server acceso da minuti significa che la riga di log non viene emessa, non che le tile non vengono fetchate: in quel caso controllare lo Step 9 prima di concludere alcunché sul rate.

**Non spegnere il server**: lo Step 15 interroga questo stesso processo. Alla fine dello Step 15, `kill $SERVER_PID` (e, se il figlio di `tsx watch` sopravvive, `pkill -f "server/index.ts"`).

- [ ] **Step 15: Verificare il comportamento reale del server**

Il server è quello avviato in background allo Step 14: **non riavviarlo**. Il controllo al boot — HTTP 200 con `"status":"starting"`, senza il quale il deploy su Railway si bloccherebbe — si può fare una volta sola ed è già stato fatto lì; qui serve invece un processo acceso da qualche minuto. I log sono in `/tmp/airview.log`.

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

Expected: **nei primi tre quarti d'ora** `observedSweepSeconds` si assesta fra **820 e 1 000 s** (14-17 minuti). In quella finestra nessuna tile è ancora dormiente — servono tre spazzate vuote, cioè oltre 40 minuti — quindi le tile dovute sono tutte e 546 e il calcolo, dalle costanti che risultano dopo la spaziatura fra cicli:

- il pavimento e' una tile ogni 1,5 s misurata da `waitForTileSlot`, quindi 546 x 1,5 s = **819 s**. Alla latenza mediana di 0,47 s rimisurata nel difetto #41 ogni fetch entra dentro il proprio slot, quindi e' il pavimento a vincolare;
- una tile piu' lenta del pavimento si paga per intero, perche' lo slot vale `max(1,5 s, latenza)`. Sulle sei latenze davvero misurate (0,28 / 0,40 / 0,55 / 2,35 / 0,24 / 1,97 s) lo slot medio e' 1,72 s, cioe' **~940 s**;
- `TILE_CYCLE_GAP_MS` aggiunge al piu' 1 s per ciclo, e solo quando l'ultima tile del ciclo e' stata piu' lenta di 1,5 s: 546/8 ≈ 69 cicli, quindi **≤ 70 s**.

La cifra di 820-900 s che questo piano dichiarava prima era irraggiungibile: con la spaziatura applicata solo `if (i > 0)` un ciclo costava 7 x 1,5 s + 8 x latenza + 1 s, cioe' **785 s a latenza zero** e ~1 040 s alla mediana misurata — un intervallo che l'arrivo in fondo non poteva centrare.

`fleet.maxAgeSeconds` deve essere **almeno** pari allo sweep osservato: a 940 s la finestra derivata vale 1 880 s e lo copre. Se la finestra fosse piu' corta dello sweep, `prune` cancellerebbe ogni aereo prima che la sua tile torni, e la flotta sarebbe una macchia rotante su una frazione della griglia invece del mondo.

**Più avanti la cifra scende, ed è corretto così.** Il numero è il periodo di rivisita delle tile **dovute**, non di tutte: la rotazione salta le dormienti a costo zero, quindi moltiplicare per 546 sovrastimava la rivisita e gonfiava la finestra derivata. Quando le tile oceaniche e di bordo si addormentano, `observedSweepSeconds` cala in proporzione a `tiles.productive / 546` — con il 40% dormiente sono ~490 s — e la finestra derivata finisce sotto `MIN_RETENTION_S`, che la tiene a 1 200 s. Il controllo che conta resta `win >= sweep`, non la cifra assoluta. Guardare anche il denominatore:

```bash
curl -s localhost:3000/health | python3 -c "
import json,sys
t=json.load(sys.stdin)['tiles']
print(f\"dovute {t['productive']} di {t['total']}, dormienti {t['dormant']}, sweep {t['observedSweepSeconds']}s\")
"
```

Expected: `dormienti` a zero nella prima mezz'ora e in crescita dopo; `dovute + dormienti == 546` sempre. Se `dormienti` cresce fino a sfiorare il totale mentre `fleet.size` crolla, non è la dormienza che funziona: è lo Step 9 che sta attribuendo alle tile un guasto globale, e va guardato il log per `tile fetch failed`.

Se adsb.lol tornasse alle latenze di decine di secondi osservate in passato lo sweep le seguirebbe (a 28,6 s mediani sono ~4,3 ore) e lo script stamperebbe `ROTTO`, perche' la finestra sbatte contro `MAX_RETENTION_S` = 7 200 s. In quel regime non e' un difetto dello script: e' il tetto che fa il suo mestiere — trattenere aerei per quattro ore e' memoria, non una flotta — ed e' il segnale che la griglia va ridotta o il feed accettato come parziale.

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

- [x] **Step 15a: Misurare il payload invece di supporlo** — ESEGUITO il 2026-11-20

> **Misura reale, e chiude la questione del payload magro della spec §3.3.** Server avviato contro adsb.lol, 159 tile, flotta a 6 254 aerei con finestra derivata a 1 604 s:
>
> | | |
> |---|---|
> | corpo grezzo | **1,79 MB** |
> | corpo gzip | **253 KB** (rapporto 6,9x) |
> | cap da 24 000 aerei | non raggiunto |
> | sweep osservato | 802 s |
>
> La spec §3.3 chiede «poche centinaia di KB contro i 5,8 MB della v1», e propone array posizionali per ottenerle. **La compressione le dà già**: 253 KB stanno dentro l'obiettivo dichiarato, e il rapporto 6,9x è quello che ci si aspetta da JSON ripetitivo. Riscrivere il formato sul filo in array posizionali risparmierebbe byte che il gzip sta già togliendo, al prezzo di un codificatore e un decodificatore da tenere allineati a mano — la classe di difetto che questo progetto ha già pagato due volte.
>
> **Decisione: il payload magro §3.3 non si fa.** La spec resta soddisfatta nel suo obiettivo misurabile. Quello che va tenuto d'occhio è la crescita: la flotta cresce finché la finestra di ritenzione non si stabilizza, quindi il corpo crescerà ancora. Il cap a 24 000 aerei corrisponde a ~6,9 MB grezzi, cioè **~1 MB gzip**: ancora accettabile, e `capped: true` resta un FAIL in `verify-feed` perché raggiungerlo significa che la finestra è troppo lunga, non che il cap è troppo basso.

`/api/states` serve l'intera flotta accumulata a ogni richiesta e il bbox è ignorato di proposito: il peso del corpo non dipende da quanto guardi, dipende da quanto trattieni. Con il pavimento di ritenzione a 1 200 s il corpo contiene **almeno venti minuti di avvistamenti** — più aerei di qualunque istantanea — e ogni record porta ora registrazione, modello, rotta e flag di completezza, cioè più del doppio dei byte della v1. Misurato su 20 000 record con variazione realistica: **280 B senza rotta, 414 B con rotta**, contro i ~143 B della v1 — fra 5,6 e 8,3 MB di corpo per una flotta da ventimila aerei.

Con il server avviato da qualche ciclo:

```bash
curl -s localhost:3000/health | python3 -c "
import json,sys
p = json.load(sys.stdin)['payload']
ratio = p['bytes'] / p['gzipBytes'] if p['gzipBytes'] else 0
print(f\"aerei {p['aircraft']}  raw {p['bytes']/1e6:.2f} MB  gzip {p['gzipBytes']/1e6:.2f} MB\")
print(f\"{p['bytes']/max(p['aircraft'],1):.0f} B/aereo, compressione {ratio:.1f}x, capped={p['capped']} su {p['maxAircraft']}\")
"
curl -s -H 'accept-encoding: gzip' -D- -o /tmp/states.gz localhost:3000/api/states | grep -iE "content-encoding|content-length|vary"
ls -l /tmp/states.gz
```

Expected: `content-encoding: gzip`, un `vary` che **contiene** `accept-encoding` (accanto a `Origin`, che ci mette `@fastify/cors`) e un file su disco grande quanto `gzipBytes`. La compressione deve valere **almeno 5x** — misurata fra 6,1x e 7,8x sugli stessi 20 000 record: ventimila oggetti con le stesse quattordici chiavi sono quasi il caso migliore per un codificatore a dizionario, e ~7 MB escono come ~1 MB. Un rapporto vicino a 1 significa che si sta servendo il corpo grezzo e che l'header mente.

**Il numero da annotare è `bytes`.** Sopra i **10 MB** — cioè sopra il tetto che `MAX_PAYLOAD_AIRCRAFT` traduce in record — la flotta è cresciuta oltre quanto questo piano ha previsto, e le leve sono due, in quest'ordine: abbassare `MAX_RETENTION_S`, che è la causa — meno minuti trattenuti, meno aerei — oppure abbassare `MAX_PAYLOAD_AIRCRAFT`, che è il sintomo: il corpo viene troncato e `capped` lo dichiara. La terza leva, togliere campi dal record, è stata valutata e scartata: i campi nulli di un record tipico valgono ~40 B su ~340, il 12%, contro il ~90% che prende la compressione, e renderebbero opzionale metà di `AircraftRaw` su tutto il client.

Verificare infine che un client senza gzip non resti a bocca asciutta:

```bash
curl -s -H 'accept-encoding: identity' localhost:3000/api/states | head -c 40
```

Expected: il corpo in chiaro, che inizia con `{"stale":false,`.

- [ ] **Step 16: Commit**

```bash
git add server/fleet.ts server/feedState.ts server/errorChain.ts server/index.ts src/data/sources/selector.ts src/data/sources/adsbFi.ts src/data/sources/tileGrid.ts tests/unit/server/fleet.test.ts tests/unit/server/feedState.test.ts tests/unit/server/errorChain.test.ts tests/unit/data/sources/selector.test.ts tests/unit/data/sources/tileGrid.test.ts
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

Poi, **subito dopo il commit**, verificare che il task non abbia lasciato indietro un file:

```bash
git status --porcelain server/ src/ tests/
```

Expected: **nessun output**. E' il controllo che una riga `git add` scritta a mano non puo' fare su se stessa. Un file creato da uno step e dimenticato nello staging resta qui non tracciato, il commit passa verde in locale — dove il file esiste comunque sul disco — e rompe il primo checkout pulito: e' esattamente cio' che stava per succedere con `server/errorChain.ts`, importato da `server/index.ts` allo Step 9 e assente dalla riga di staging, cioe' `TS2307` in build e deploy rotto. Se compare una riga, aggiungere quel percorso alla riga `git add` qui sopra e rifare il commit con `git commit --amend`; **mai** `git add -A`, che tirerebbe dentro `.claude/`, `.agents/`, `mockups/` e `skills-lock.json`.

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

Il terzo: un singolo snapshot contiene fra **5.900 e 12.500 callsign distinti** a seconda dell'ora, e l'insieme cumulativo nell'arco di una giornata è molto maggiore. A una cadenza rispettosa il primo riempimento richiede **ore**, non minuti. Per questo la cache non si costruisce a runtime ma viene **pre-costruita offline** dal Task 5 e caricata con `seed()`; a runtime il pump serve solo per i callsign nuovi, molto lentamente.

- [x] **Step 1: Scrivere il test che fallisce**

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

- [x] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/server/routeResolver.test.ts`
Expected: FAIL — modulo inesistente

- [x] **Step 3: Creare `server/routeResolver.ts`**

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
  /**
   * WALL clock, epoch ms. Used ONLY to render `suspendedUntil` as an instant
   * callers and /health can read. Never to measure how long anything lasts.
   */
  now?: () => number;
  /**
   * MONOTONIC clock, any origin. The 429 suspension is a DURATION and is
   * timed on this one.
   *
   * Measured on this machine: Date.now() moves by ~528 ms every ~32 s as
   * WSL2 resyncs against the host, and NTP corrects in both directions. A
   * backwards jump would merely extend the silence, which is harmless here.
   * A FORWARD jump is the one that bites: it makes the cooldown look spent
   * and sends a lookup DURING the adsbdb penalty — and a request sent during
   * the penalty RENEWS it, which is the single failure mode this suspension
   * exists to prevent. server/poller.ts draws the same line for the same
   * reason. A wall clock is not a stopwatch.
   */
  monotonicNow?: () => number;
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
  const monotonicNow = opts.monotonicNow ?? (() => performance.now());

  const resolved = new Map<string, FlightRoute>();
  const unknown = new Set<string>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const attempts = new Map<string, number>();
  /** Permanent record of callsigns we stopped trying, so enqueue() skips them. */
  const abandoned = new Set<string>();

  /** On the MONOTONIC clock, like every other duration in this file. */
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
      if (monotonicNow() < suspendedUntil) return 0; // not one request while suspended

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
        if (monotonicNow() < suspendedUntil) {
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
            suspendedUntil = monotonicNow() + cooldown;
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
      // The deadline is monotonic; the instant reported is the wall clock's.
      // Converting here, once, is what keeps the two clocks from mixing.
      const remainingMs = suspendedUntil - monotonicNow();
      return {
        resolved: resolved.size,
        unknown: unknown.size,
        queued: queue.length,
        abandoned: abandoned.size,
        suspendedUntil: remainingMs > 0 ? new Date(now() + remainingMs).toISOString() : null,
        consecutiveRateLimits,
        lastError,
      };
    },
  };
}
```

- [x] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/server/routeResolver.test.ts`
Expected: PASS, **19 test**. Il piano ne prescriveva 18; il diciannovesimo —
`holds the SUSPENSION when the WALL CLOCK jumps FORWARD` — presidia la
separazione degli orologi adottata nel blocco qui sopra. Verificato per
mutazione: rimettendo il cooldown su `Date.now()` i 18 test originali restano
**tutti verdi** e muore solo quello.

- [x] **Step 5: Verificare contro adsbdb reale, con parsimonia** — ESEGUITO il 2026-11-21, cinque richieste

> `resolved: 3, unknown: 2, queued: 0, suspendedUntil: null`, esattamente l'atteso. `BAW274` → British Airways, **LAS McCarran → LHR London Heathrow**; `NJE004M` → `null`, contato fra gli unknown, quindi il ramo 404 funziona. Nella v1 lo stesso volo mostrava Aalborg → Aarhus, come ogni altro volo BA, perché `routeLookup` ignorava il numero e restituiva `list[0]`. Nessun 429, nessuna penalità.

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
git add server/routeResolver.ts tests/unit/server/routeResolver.test.ts
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
- Create: `server/data/route-cache.json` — generato dallo Step 3 e committato. Nessuno step crea un `.gitkeep`: la cartella arriva con il file, e un `git add` di un percorso inesistente farebbe abortire il commit
- Create: `src/data/completeness.ts`
- Create: `server/enrich.ts`, `server/routeCache.ts` — l'arricchimento e il lettore del seed estratti da `server/index.ts`, che è uno script top-level e come tale irraggiungibile da qualunque test (stessa mossa già fatta per `poller.ts` e `healthRoute.ts`)
- Create: `server/providerLock.ts`, `server/lookupPolicy.ts` — l'interlock e la politica di rifiuto dello script offline, per la stessa ragione: `scripts/build-route-cache.mjs` è un programma top-level
- Modify: `server/index.ts`, `server/healthRoute.ts` (lo Step 10 pubblica `routes` e `aircraft`, e quel corpo vive lì dal Task 3), `tsconfig.server.json`, `package.json`, `src/types.ts` (solo il commento del campo `route`, che questo task rende falso)
- Test: `tests/unit/data/completeness.test.ts`, `tests/unit/server/enrich.test.ts`, `tests/unit/server/routeCache.test.ts`, `tests/unit/server/providerLock.test.ts`, `tests/unit/server/lookupPolicy.test.ts`, `tests/unit/server/healthRoute.test.ts` (esteso)

**Interfaces:**
- Consumes: `RouteResolver`, `SeedRecord`, `FlightRoute` dal Task 4; `FlightRouteLite` e `makeAircraftRaw` dal piano precedente
- Produces: `isComplete(ac: AircraftRaw): boolean`; `npm run build:routes`; il file `server/data/route-cache.json` con forma `{ gridCursor: number; records: SeedRecord[] }` — `records` è ciò che `RouteResolver.seed()` consuma, `gridCursor` è la posizione raggiunta nella rotazione sulla griglia di campionamento e serve solo allo script offline. Il lettore del server accetta anche la vecchia forma `SeedRecord[]` nuda, così una cache generata prima di questa correzione non si butta

**Perché una cache pre-costruita e perché NON è un ritorno a `openflights-routes.json`.** Il file che il Task 6 elimina era sbagliato *per costruzione*: `list[0]` restituiva una rotta che non aveva alcun rapporto col volo richiesto. Questo file è verificato per costruzione: ogni voce è la risposta di adsbdb *per quello specifico callsign*. Al più invecchia — e i numeri di volo di linea sono stabili nel tempo, `BAW274` vola ogni giorno — mentre quello era falso il giorno stesso in cui è stato generato.

Lo script campiona il feed a intervalli nell'arco di ore, perché un singolo snapshot contiene fra 5.900 e 12.500 callsign a seconda dell'ora e l'insieme di una giornata è molto maggiore. È **ripartibile in entrambe le metà**: rilegge dal file di cache sia le risposte già ottenute sia la posizione raggiunta nella rotazione sulla griglia, così un'interruzione non butta via il lavoro fatto e la corsa successiva campiona tile nuove. Il cursore sul disco non è un dettaglio: un giro di campionamento prende 20 tile e il cancello ne lascia partire uno ogni 20 minuti, quindi quattro ore percorrono 240 delle 546 tile — con il cursore solo in memoria ogni corsa ripresa, che è il modo d'uso raccomandato, sarebbe ripartita dalla tile 0 e le tile oltre la 240esima non sarebbero mai entrate nella cache.

- [x] **Step 1: Creare `scripts/build-route-cache.mjs`**

> Il blocco qui sotto è la stesura iniziale. La verifica del Task 5 ha poi aggiunto allo script l'interlock (`server/providerLock.ts`) e la politica dei rifiuti non-429 (`server/lookupPolicy.ts`): **il file su disco è la versione corrente**, questo blocco no.

```js
// Builds server/data/route-cache.json by asking adsbdb about the callsigns
// seen in the live feed. Runs for hours on purpose: adsbdb rate-limits hard
// (~1190 lookups at 4.8 req/s earned a 300 s ban, and requests sent during
// the penalty renew it). Resumable in BOTH halves: the answers already
// collected AND the position in the 546-tile sampling rotation are read
// back from the same cache file, so a resumed run asks about new callsigns
// and samples new tiles. Resuming is the normal way to use this script.
//
// Runs under tsx, never under bare node: the sampler imports the server's
// tile grid, which is TypeScript, and node on its own answers
// ERR_MODULE_NOT_FOUND to a .js specifier that resolves to a .ts.
//
//   npm run build:routes                 # default: 4 hours, 240 of 546 tiles
//   npm run build:routes -- --hours 10   # one pass over the whole grid
//
// Four hours is 12 sampling rounds of 20 tiles, one round per ~20.7 min.
// All 546 tiles take 28 rounds, ~9.3 h — so either run it for 10 h or run
// it again: the grid cursor is saved in the cache file and the next run
// continues from it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildTileGrid, TILE_RADIUS_NM } from '../src/data/sources/tileGrid.js';

const UA = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
const OUT = 'server/data/route-cache.json';
const CALLSIGN_RX = /^[A-Z]{3}[A-Z0-9]+$/;
// Radius and centres are imported, not copied. TILE_RADIUS_NM is the margin
// under a provider ceiling that has moved twice in two months; a third copy
// of it here would be the one nobody updates.
const GRID = buildTileGrid();
const TILES_URL = (lat, lon) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${TILE_RADIUS_NM}`;
// Tiles per sampling round, taken from the grid in rotation. A round is 20
// tiles at the 1.5 s courtesy spacing (~40 s with latency), and the gate in
// the main loop lets only one round start every 20 minutes: the sampler
// walks ~58 tiles an hour, so the 546 of the grid take ~9.3 h — not the
// ~14 min a back-to-back walk would suggest. That is why gridCursor is
// PERSISTED in the cache file: with it only in memory a 4 h run covered
// tiles 0..239 and every resumed run — the way this script is meant to be
// used — started again at tile 0, so nothing past tile 240 was ever
// sampled. Unlike the server's poller this has no dormancy, so the price of
// a single definition is the empty tiles, 1.5 s each.
const TILES_PER_ROUND = 20;
/** Position in the grid rotation. Restored from the cache file below. */
let gridCursor = 0;

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
  const parsed = JSON.parse(readFileSync(OUT, 'utf8'));
  // Two shapes are accepted: the bare array written before the cursor
  // existed, and the envelope written since. A cache built by an older run
  // is hours of adsbdb lookups and must not be thrown away by a reader.
  const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
  for (const rec of records) cache.set(rec.callsign, rec.route);
  const saved = Array.isArray(parsed) ? 0 : Number(parsed.gridCursor);
  // Clamped: the grid is rebuilt from code on every run and may be shorter
  // than it was when the cursor was written.
  gridCursor = Number.isInteger(saved) && saved >= 0 ? saved % GRID.length : 0;
  console.log(`resuming from ${cache.size} cached callsigns, grid cursor ${gridCursor}/${GRID.length}`);
}

function save() {
  mkdirSync(dirname(OUT), { recursive: true });
  const records = [...cache.entries()]
    .map(([callsign, route]) => ({ callsign, route }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
  // The cursor travels WITH the answers, in one file and one write. A
  // sidecar file could be deleted, gitignored, or simply left out of the
  // task's `git add` line, and the sampler would silently restart at tile 0
  // again — which is the bug this whole envelope exists to kill.
  writeFileSync(OUT, JSON.stringify({ gridCursor, records }, null, 0));
}

async function sampleFeed() {
  const out = new Set();
  const firstTile = GRID[gridCursor].id;
  for (let i = 0; i < TILES_PER_ROUND; i++) {
    const { lat, lon } = GRID[gridCursor].centre;
    // Advance before the fetch and keep the index normalised: what gets
    // written to the cache file has to be a real index into the grid.
    gridCursor = (gridCursor + 1) % GRID.length;
    try {
      const res = await fetch(TILES_URL(lat, lon), {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      // No `continue` on a bad status: it would skip the courtesy sleep at
      // the bottom of the loop, and a provider answering 403 or 429 to every
      // tile would be hit 20 times with no spacing at all — the one moment
      // the spacing matters most.
      if (!res.ok) {
        console.warn(`[sample] tile ${lat},${lon}: HTTP ${res.status}`);
      } else {
        const data = await res.json();
        for (const ac of data.ac ?? []) {
          const cs = (ac.flight ?? '').trim().toUpperCase();
          if (CALLSIGN_RX.test(cs)) out.add(cs);
        }
      }
    } catch (e) {
      console.warn(`[sample] tile ${lat},${lon}: ${e.message}`);
    }
    await sleep(1500); // same courtesy rate as everything else
  }
  // Printed so the walk is auditable from outside the process: Step 3 reads
  // this line from two consecutive runs to prove the cursor really survived.
  console.log(`[sample] walked ${TILES_PER_ROUND} tiles from ${firstTile}, cursor now ${gridCursor}/${GRID.length}`);
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
      // Saved at once: the cursor on disk is the only thing that makes the
      // next run walk NEW tiles, and a run stopped with Ctrl-C between two
      // progress saves would otherwise re-walk the round it just finished.
      save();
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

  // `> 0` matters: the sum is 0 until the first ok/unknown lands and
  // `0 % 100 === 0`, so a run whose first lookups all fail transport printed
  // a progress line each time — exactly the symptom Step 3 tells you to read
  // as a missing throttle.
  if (resolvedCount + unknownCount > 0 && (resolvedCount + unknownCount) % 100 === 0) {
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
console.log(`grid cursor at ${gridCursor}/${GRID.length} — the next run samples from there`);
console.log(`written to ${OUT} — commit it`);
```

- [x] **Step 2: Aggiungere lo script a `package.json`**

Nel blocco `"scripts"`:

```json
    "build:routes": "tsx scripts/build-route-cache.mjs",
```

`tsx` e non `node`: lo script importa `buildTileGrid` e `TILE_RADIUS_NM` da `src/data/sources/tileGrid.ts`, e node da solo non risolve un `.ts` dietro un import `.js` (`ERR_MODULE_NOT_FOUND`). `tsx` è già una dipendenza del progetto, la stessa con cui gira `npm run server`.

- [x] **Step 3: Lanciare una corsa breve per verificare che funzioni** — ESEGUITO il 2026-11-21

> `68 callsign in cache (56 risolti, 12 unknown), cursore a 20/546`, file da 15,2 KB, exit 0. Throttle verificato prima di lanciare (`await sleep(delayMs)` alla riga 337).
>
> **Difetto trovato dalla corsa, e corretto prima della corsa lunga.** Nove tile su venti hanno risposto `HTTP 429`, e questa diramazione si limitava a loggare e proseguire — spaziata di 1,5 s, ma continuando a bussare per tutto il resto del giro. La metà adsbdb dello script aveva già imparato la lezione (`lookupPolicy.ts`), la metà delle tile no. Ora un rifiuto chiude il giro, riavvolge il cursore sulla tile rifiutata e lo dichiara all'uscita. Il silenzio NON è i 360 s dei lookup: adsb.lol e adsbdb sono provider diversi, e un blocco sul campionatore non deve fermare lookup ancora graditi — il campionamento riprende al giro successivo, a ~20 minuti. Verificato offline con fetch finta: `ending this round at 3/6 tiles, cursor held at 2`.

**Arrestare prima il server**, se è ancora in esecuzione dal Task 3. Il poller emette ~0,67 richieste/s verso adsb.lol e il campionatore altrettante: sommate superano il vincolo di progetto e si avvicinano al tasso che ha già prodotto un 429 su entrambe le sorgenti. Sono due client indipendenti che non si coordinano.

Questo non è più solo un promemoria: lo script **si rifiuta di partire** se qualcosa risponde su `http://127.0.0.1:$PORT/health` o se un altro build tiene `server/data/.build-routes.lock` (`server/providerLock.ts`), esce con stato 1 e non emette una sola richiesta verso i provider. Simulate tre ore con entrambi i processi attivi, la coppia metteva 2.077 delle 8.039 richieste ad adsbdb sotto la soglia di 1.500 ms — e i 360 s di silenzio dopo un 429 sono di un processo solo, mentre l'altro continua a bussare e **rinnova** la penalità.

```bash
pkill -f "tsx watch server/index.ts" || true
curl -sf localhost:3000/health > /dev/null && echo "ATTENZIONE: un server risponde ancora su :3000 — fermalo prima di proseguire" || echo "nessun server locale attivo, procedo"
mkdir -p server/data
npm run build:routes -- --hours 0.05
```

**Prima di lanciarlo, verificare che il throttle esista davvero.** È il punto in cui una stesura precedente sparava a 185 req/s mentre il proprio log dichiarava 0,67:

```bash
grep -n "await sleep(delayMs)" scripts/build-route-cache.mjs
```

Se quella riga non compare nel ciclo principale, **non eseguire lo script**: manca il throttle e il risultato è un ban immediato.

Expected: circa tre minuti di esecuzione e `server/data/route-cache.json` scritto. Il primo giro di campionamento prende ~40 s (20 tile a 1,5 s più la latenza) e restano ~140 s di lookup: con `delayMs` iniziale di 2000 ms sono **al massimo ~70**, con una riga `[sample] walked ...` e **nessuna** riga di avanzamento, perché la prima compare al centesimo esito. Se ne vedi molte di più il throttle non funziona: interrompi con Ctrl-C e attendi sei minuti prima di qualunque altra chiamata ad adsbdb.

Se compare `[blocked] <callsign>: HTTP 429` (oppure 403, o un 5xx: dallo Step 4 della verifica sono trattati tutti allo stesso modo), lo script deve **dormire 360 s in silenzio** e non emettere altre richieste: è il comportamento voluto. Dopo cinque rifiuti **consecutivi** stampa `[abort]`, salva ed esce con stato 1 — una corsa di tre ore contro un provider che rifiuta tutto non deve più somigliare a una corsa riuscita.

Verificare la forma del file:

```bash
python3 -c "
import json
d=json.load(open('server/data/route-cache.json'))
r=d['records']
print('voci:', len(r))
print('con rotta:', sum(1 for x in r if x['route']))
print('cursore griglia:', d['gridCursor'], 'di 546')
print('esempio:', next((x for x in r if x['route']), None))
"
```

Il file è `{ gridCursor, records }`, non un array nudo: il cursore della rotazione sulla griglia vive nello stesso file delle risposte, perché è l'unica cosa che fa sì che l'esecuzione successiva campioni tile **nuove**.

**Verificare che il cursore sopravviva davvero al riavvio.** Senza questa prova il difetto resta invisibile: lo script sembra funzionare benissimo mentre ricampiona per sempre le stesse prime tile.

```bash
grep -n "JSON.stringify({ gridCursor, records }" scripts/build-route-cache.mjs
```

Se quella riga non compare, il cursore non viene scritto: fermati e correggi lo script prima di proseguire.

```bash
# Due corse brevissime di fila: ciascuna fa un solo giro di campionamento.
# Costano ~40 fetch verso adsb.lol in tutto, alla solita spaziatura di 1,5 s.
RUN1=$(npm run build:routes -- --hours 0.01 2>&1 | grep '\[sample\] walked')
CUR1=$(python3 -c "import json;print(json.load(open('server/data/route-cache.json'))['gridCursor'])")
RUN2=$(npm run build:routes -- --hours 0.01 2>&1 | grep '\[sample\] walked')
CUR2=$(python3 -c "import json;print(json.load(open('server/data/route-cache.json'))['gridCursor'])")
echo "giro 1: $RUN1"
echo "giro 2: $RUN2"
echo "cursore: $CUR1 -> $CUR2"
[ "$CUR1" != "$CUR2" ] && echo "OK: il cursore avanza fra un'esecuzione e l'altra" || echo "FALLITO: il cursore non e' persistito, le tile oltre la 240esima non entrerebbero mai nella cache"
```

Expected: le due righe `[sample] walked ... from <tile>` nominano **tile di partenza diverse** e il cursore cresce, per esempio `20 -> 40`. Se nominano la stessa tile, il cursore non sopravvive al riavvio: è esattamente il difetto che questa verifica esiste per vedere.

**L'aritmetica della corsa lunga, da tenere a mente.** Un giro sono 20 tile e il cancello ne lascia partire uno ogni 20 minuti: ~58 tile l'ora, quindi le 546 della griglia sono 28 giri, cioè **~9,3 ore**. Le quattro ore di default coprono **240 tile su 546**. Il lato lookup è ancora più lento: a 2000 ms per richiesta sono ~1800 lookup l'ora, quindi i 5.900–12.500 callsign di un singolo snapshot valgono da soli 3–7 ore di interrogazioni. Il file resta piccolo: un record risolto è ~243 byte di JSON minificato e uno sconosciuto ~35, quindi 12.000 callsign stanno in **~1,8 MB**.

La corsa lunga vera (`npm run build:routes -- --hours 10`) la lancia l'utente quando vuole, ed è ripartibile in entrambe le metà: riprende i callsign già risolti e riprende il giro della griglia da dove si era fermato. Dieci ore e non otto perché 546 tile sono ~9,3 ore di campionamento; con `--hours 8` il giro si ferma intorno alla tile 480 e la corsa successiva riparte da lì. Il piano non la richiede per proseguire: il server funziona anche con una cache parziale, semplicemente con meno aerei blu.

- [x] **Step 4: Scrivere il test che fallisce per `isComplete`**

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

- [x] **Step 5: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: FAIL — modulo inesistente

- [x] **Step 6: Creare `src/data/completeness.ts`**

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

- [x] **Step 7: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/data/completeness.test.ts`
Expected: PASS, 10 test

- [x] **Step 8: Collegare resolver, seed e completezza in `server/index.ts`**

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
    // The file is `{ gridCursor, records }`: the cursor belongs to the
    // offline sampler, the records to the resolver. The bare array is the
    // pre-cursor shape and is still accepted — a cache built by an older run
    // is hours of adsbdb lookups and a reader must not throw it away.
    const parsed = JSON.parse(readFileSync(seedPath, 'utf8'));
    routes.seed(Array.isArray(parsed) ? parsed : (parsed.records ?? []));
    app.log.info({ callsigns: routes.stats().resolved + routes.stats().unknown }, 'route cache seeded');
  } catch (e) {
    app.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'route cache unreadable — starting cold');
  }
} else {
  app.log.warn('no route cache file — starting cold, most aircraft will be incomplete');
}
```

In `tsconfig.server.json`, aggiungere all'`include` il percorso `"src/data/completeness.ts"`: senza, il modulo non entra nel programma del server e `build:server` fallisce.

- [x] **Step 9: Arricchire e marcare dentro `refreshNextTiles`**

**Dopo la guardia `if (!anySuccess) return;` e dopo `fleet.prune(...)`, prima di `const payloadAircraft = fleet.snapshot(MAX_PAYLOAD_AIRCRAFT)`** — cioè prima che il corpo venga serializzato, perché `JSON.stringify` fotografa i record così come sono in quel momento. L'arricchimento gira una volta per ciclo, non una per tile: `result` vive dentro il ciclo delle tile e qui non è visibile.

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

> La verifica ha poi **estratto questo blocco** in `server/enrich.ts` (`enrichAndMark(world, routes)`), e il lettore del seed dello Step 8 in `server/routeCache.ts`. Dentro `runCycle()` nessun test poteva raggiungerli: diciassette mutazioni — nessuna rotta attaccata, origine e destinazione scambiate, completezza calcolata *prima* dell'arricchimento, nessun callsign in coda — lasciavano verde l'intera suite. Stessa mossa già fatta per `poller.ts` e `healthRoute.ts`, per la stessa ragione.

**Poi correggere il commento che questo step rende falso.** In `src/types.ts` il campo `route` porta `// filled by the server; null until Task 6`, ma è questo step a popolarlo: il Task 6 non riempie nulla, cancella soltanto il lookup falso lato client. Sostituire la riga con:

```ts
  route: FlightRouteLite | null;      // filled by the server (Task 5) from the pre-built cache; null = adsbdb has no route for this callsign
```

Il `null` non significa più «non ancora implementato» ma «interrogato e sconosciuto», che è la stessa semantica del `null` in `SeedRecord` e la ragione per cui `isComplete` può fidarsi del campo.

- [x] **Step 10: Avviare il pump e pubblicare lo stato su `/health`**

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

Nel corpo di `/health` — che dal Task 3 vive in **`server/healthRoute.ts`**, non in `server/index.ts`: servono due campi nuovi in `HealthRouteDeps` (`routes?()` e `aircraft?()`, opzionali perché i chiamanti che precedono il resolver, il test della rotta compreso, continuino a compilare) e due righe nella risposta, mentre `server/index.ts` passa le funzioni al factory. Entrambi i file vanno nel commit dello Step 13, o l'albero committato non compila.

```ts
    routes: deps.routes?.(),
    aircraft: deps.aircraft?.(),
```

`routes.stats()` include `suspendedUntil`, `consecutiveRateLimits` e `lastError`: senza questi campi un blocco di adsbdb resterebbe invisibile mentre `/health` continua a dire `ok`, che è la cecità che questo piano esiste per rimuovere.

- [x] **Step 11: Verificare entrambi i programmi**

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
git add scripts/build-route-cache.mjs server/data/route-cache.json \
  src/data/completeness.ts tests/unit/data/completeness.test.ts \
  server/enrich.ts server/routeCache.ts server/providerLock.ts server/lookupPolicy.ts \
  tests/unit/server/enrich.test.ts tests/unit/server/routeCache.test.ts \
  tests/unit/server/providerLock.test.ts tests/unit/server/lookupPolicy.test.ts \
  tests/unit/server/healthRoute.test.ts \
  server/index.ts server/healthRoute.ts src/types.ts tsconfig.server.json package.json

# Nulla di ciò che il task ha toccato può restare fuori dalla riga qui sopra.
# Il Task 3 ha committato una riga `git add` che non nominava né
# server/healthRoute.ts né server/poller.ts, entrambi modificati: l'albero
# committato non compilava. Questo controllo si esegue DOPO il git add e
# prima del commit, e stampa ciò che resterebbe indietro.
git status --porcelain | grep -vE '^\?\? (\.agents/|\.claude/|mockups/|skills-lock\.json)' \
  | grep -vE '^.. docs/' | awk '{print $2}' | while read -r f; do
    git diff --cached --name-only | grep -qx "$f" || echo "FUORI DAL COMMIT: $f"
  done
git commit -m "feat(server): pre-built route cache, wiring and completeness

/api/states now carries a real route and a 'complete' flag, and /health
reports the resolver state including any active rate-limit suspension.

The cache is built offline by scripts/build-route-cache.mjs rather than
at runtime: a snapshot holds 5900-12500 distinct callsigns depending on
the hour, and adsbdb bans at a few requests per second, so filling it
takes hours. The script samples the feed over time, backs off hard on
429, and is resumable in both halves: the answers AND the position in the
546-tile sampling rotation live in the cache file, so a resumed run
samples tiles the previous one never reached. The runtime pump only
absorbs callsigns the seed does not cover, at one lookup every 10 s.

This static file is NOT a return to openflights-routes.json. That one was
wrong by construction — list[0] returned a route unrelated to the flight.
This one is verified by construction: every entry is adsbdb's answer for
that specific callsign. At worst it ages.

The enrichment, the seed reader, the builder's interlock and its refusal
policy are four small modules rather than four blocks inside two top-level
programs: nothing in server/index.ts or in the builder is reachable from a
test, and seventeen mutations of this task's logic — routes drawn backwards,
the fleet never marked complete, the seed never read — left all 205 tests
green. The builder now refuses to start while the server is up or another
build holds the lock, treats 403 and 5xx like the 429 it already knew, logs
every refusal with its status, and stops after five in a row instead of
spending three hours on a provider that is saying no.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Rimuovere il lookup rotte falso

Separato dal Task 5 perché un revisore potrebbe accettare le rotte vere e volere una discussione a parte sulla rimozione di 4,2 MB di dati statici.

**Files:**
- Delete: `src/data/routeLookup.ts`, `public/data/openflights-routes.json`
- Modify: `src/data/resolveFlight.ts`, `tests/unit/data/resolveFlight.test.ts`
- Modify: `tests/unit/data/lookups.test.ts`, `src/data/bootstrap.ts`, `scripts/build-static-data.mjs`
- Modify: `src/types.ts` (rimuove `Route`)

**Interfaces:**
- Consumes: `FlightRouteLite` e `makeAircraftRaw` dal piano precedente
- Produces: `resolveFlight(ac: AircraftRaw): ResolvedFlight | null` — prende l'aereo, non il solo callsign, perché la rotta arriva dal server dentro l'aereo.

- [x] **Step 1: Sostituire integralmente `tests/unit/data/resolveFlight.test.ts`**

Il test viene **prima** dell'implementazione: invertire l'ordine renderebbe impossibile vedere il rosso, perché dopo la riscrittura del modulo il test nuovo passerebbe subito. Il contenuto è nello Step 4.

- [x] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/data/resolveFlight.test.ts`
Expected: FAIL — `resolveFlight` accetta ancora un callsign, non un `AircraftRaw`, quindi l'errore sarà di tipo o di argomento.

- [x] **Step 3: Riscrivere `src/data/resolveFlight.ts`**

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

- [x] **Step 4: Contenuto del test dello Step 1**

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

- [x] **Step 5: Aggiornare `src/data/bootstrap.ts`**

Rimuovere `import { loadRoutesFromBundle } from './routeLookup';` e togliere `loadRoutesFromBundle(),` dalla `Promise.allSettled`. Nel callback `onBatch`, sostituire `const resolved = resolveFlight(r.callsign);` con `const resolved = resolveFlight(r);`.

- [x] **Step 6: Rimuovere modulo, dati e tipo obsoleti**

```bash
git rm src/data/routeLookup.ts public/data/openflights-routes.json
```

In `src/types.ts`, rimuovere `export interface Route { ... }`.

In `tests/unit/data/lookups.test.ts`, rimuovere l'import di `@/data/routeLookup` e ogni blocco che lo esercita, lasciando intatti i test di `airlineLookup` e `airportLookup`.

In `scripts/build-static-data.mjs`, rimuovere il blocco che genera `openflights-routes.json`. Individuarlo con `grep -n "routes" scripts/build-static-data.mjs`.

- [x] **Step 7: Verificare che non restino riferimenti**

```bash
grep -rn "routeLookup\|openflights-routes\|initRoutes" src/ server/ tests/ scripts/ || echo "nessun riferimento residuo"
npm run build:all && npm test -- --run
```

Expected: nessun riferimento residuo, build pulita, test verdi

- [ ] **Step 8: Commit**

```bash
# The two deletions are already staged by the git rm in Step 6. Naming them
# here would abort the commit: git add fails on a path it can no longer find.
git add src/data/resolveFlight.ts tests/unit/data/resolveFlight.test.ts tests/unit/data/lookups.test.ts src/data/bootstrap.ts scripts/build-static-data.mjs src/types.ts
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
- Modify: `src/globe/geoHelpers.ts`, `src/globe/scene.ts`, `src/ui/AppShell.tsx` — è `AppShell.tsx` a chiamare `mountScene` e `bootstrapData`, non `src/App.tsx`, che si limita a renderizzare `<AppShell />`
- Rename: `src/data/openSkyClient.ts` → `src/data/statesClient.ts` (e il suo test)
- Modify: `src/ui/HudCounter.tsx` — il flag `stale` che il Task 3 mette nel corpo della risposta si ferma qui o non serve a niente
- Modify: `tests/unit/state/stores.test.ts`, `tests/unit/data/aircraftStream.test.ts`, `tests/unit/data/statesClient.test.ts`, `tests/unit/globe/geoHelpers.test.ts`
- Create: `tests/component/HudCounter.test.tsx` — `vitest.config.ts` include già `tests/component/**/*.test.{ts,tsx}`, l'ambiente è jsdom e `@testing-library/react` è già una devDependency: non serve attrezzatura nuova

**Interfaces:**
- Consumes: `makeAircraftRaw` dal piano precedente
- Produces: `vec3ToLatLon(v: Vector3): { lat, lon }`; `visibleCapRadiusNm(cameraDistance: number, fovDeg: number): number`; `SceneHandle.viewCentre(): ViewCentre`; `fetchStates(bbox?, signal?, view?)`; `StreamOptions.getViewCentre?`; `bootstrapData(getViewCentre?)`. `useAircraftStore` guadagna `feedFetchedAt: number` (sostituisce `fetchedAt`), `feedStale: boolean` e `feedAgeSeconds(): number`; `updateBatch(raws, batchFetchedAtUnix, stale?)` prende tre argomenti e **sostituisce** la flotta anziché fonderla; `removeStale` viene **rimosso**; `FetchResult` guadagna `stale: boolean`; `StreamOptions.onBatch(aircraft, fetchedAt, stale)` prende tre argomenti; `fetchStates` si sposta in `src/data/statesClient.ts`.

**Il server è l'unica autorità su chi è in volo.** La v1 misurava la staleness lato client contro l'orologio locale, e con un feed congelato cancellava l'intera flotta. La correzione ovvia sarebbe misurarla contro il timestamp del batch — ma con il feed a tile anche quella sarebbe sbagliata: uno sweep completo richiede fra 820 e 1 000 s, cioè 14-17 minuti, al tetto di una richiesta ogni 1,5 s che il poller impone, e il server dimensiona la propria finestra di ritenzione su quel periodo osservato; una finestra client di 120 s cancellerebbe quasi tutta la flotta appena ricevuta. Il globo tornerebbe quasi vuoto, in forma più mite ma per la stessa ragione.

Qui la finestra client sparisce del tutto: il payload del server **è** il mondo, il server fa già `prune`, e il client si limita a sincronizzarsi con ciò che riceve. Due autorità sulla stessa decisione sono una di troppo, e sono destinate a divergere.

**Il flag `stale` deve arrivare fino allo schermo.** Il Task 3 lo sposta nel corpo della risposta, e lo Step 10 dichiara perché: «`statesClient.ts` legge solo `res.json()`, e un header non lo vedrebbe mai». Se poi il client lo butta via, quello spostamento non compra niente e il presidio manca comunque. Il feed della v1 è rimasto congelato 25 giorni proprio perché nessuno strato ha mai *detto* che era congelato: il server serviva uno snapshot vecchio, il client lo disegnava come traffico vivo. Qui il client **dichiara invece di svuotare** — `fetchStates` legge `stale` dal corpo, lo stream lo passa a `onBatch`, lo store lo conserva in `feedStale`, la HUD lo scrive accanto al conteggio. Quattro strati che avrebbero potuto tacere, e nessuno dei quattro tace.

**Tre file importano ciò che questo task rinomina.** Il `git mv` rompe `src/data/aircraftStream.ts`, `tests/unit/data/statesClient.test.ts` **e** `tests/unit/data/aircraftStream.test.ts`, che fa `spyOn` sul modulo. Dimenticare il terzo impedisce alla suite di caricarsi.

- [x] **Step 1: Sostituire il blocco `describe('aircraftStore')` in `tests/unit/state/stores.test.ts`**

Sostituire l'intero blocco `describe('aircraftStore', ...)` esistente con il seguente, lasciando invariati gli altri `describe` del file **e tutti gli import già in cima**. In particolare `makeAircraftRaw` è già importato da `tests/helpers/aircraft.ts`, dove l'ha messo il piano precedente. **Non ri-aggiungerlo**, sarebbe un identificatore duplicato.

```ts
describe('aircraftStore', () => {
  beforeEach(() =>
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    })
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

  it('leaves a position with no lastContact out of the trail', () => {
    // An adapter leaves lastContact null when the provider did not report how
    // stale the fix is. A point nobody timestamped cannot be ordered against
    // the others, and a trail point has no room for a null t.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 0, latitude: 0, lastContact: null })], 1);
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 1, latitude: 1, lastContact: 2 })], 2);
    expect(useAircraftStore.getState().aircraft.get('a1')?.trail).toEqual([]);
  });

  it('KEEPS an aircraft whose last fix is older than a full sweep', () => {
    // A full sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling
    // of one tile every 1.5 s, and the server sizes its retention on that, so
    // a fix 1200 s old is ordinary rather than exceptional. A client-side
    // window of 120 s would delete most of the fleet the server just sent —
    // the v1 empty globe all over again, in a milder form.
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'old', lastContact: batchAt - 1_200 })],
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

  it('keeps the stale flag the server put in the payload', () => {
    // The server moved this flag into the body because fetchStates reads only
    // res.json(). If the store drops it on the floor, the move bought nothing
    // and the guard against a silent outage is still missing.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 100, true);
    expect(useAircraftStore.getState().feedStale).toBe(true);
  });

  it('clears the stale flag as soon as a fresh batch arrives', () => {
    // A warning that cannot switch itself off is a warning nobody reads.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 100, true);
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 160, false);
    expect(useAircraftStore.getState().feedStale).toBe(false);
  });
});
```

- [x] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/unit/state/stores.test.ts`
Expected: FAIL — `updateBatch` accetta un solo argomento, `feedFetchedAt`, `feedStale` e `feedAgeSeconds` non esistono

- [x] **Step 3: Riscrivere `src/state/aircraftStore.ts`**

```ts
import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';

const TRAIL_MAX = 30;

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  /** Unix seconds of the batch currently held — NOT the local clock. */
  feedFetchedAt: number;
  /**
   * What the SERVER said about the batch currently held: true means it was
   * served from cache past its freshness window. The client shows it rather
   * than acting on it — see the HUD. The v1 outage stayed invisible for 25
   * days because no layer ever said the feed had stopped.
   */
  feedStale: boolean;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  /** Replaces the fleet with what the server reports, preserving trails. */
  updateBatch: (raws: AircraftRaw[], batchFetchedAtUnix: number, stale?: boolean) => void;
  feedAgeSeconds: () => number;
}

export const useAircraftStore = create<AircraftState>((set, get) => ({
  aircraft: new Map(),
  feedFetchedAt: 0,
  feedStale: false,
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
   * sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling of one
   * tile every 1.5 s and the server sizes its own retention on that observed
   * period, so any short client window would delete most of a legitimately
   * assembled fleet.
   */
  updateBatch: (raws, batchFetchedAtUnix, stale = false) =>
    set((state) => {
      const next = new Map<string, Aircraft>();
      for (const r of raws) {
        const prev = state.aircraft.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Only real received positions enter the trail — never computed ones.
        if (prev && prev.longitude !== null && prev.latitude !== null && prev.lastContact !== r.lastContact) {
          // lastContact is null when the provider did not say how stale the fix
          // is, and the comparison above does not rule that out: both sides are
          // nullable. A point we cannot timestamp cannot be ordered in the trail.
          if (prev.lastContact !== null) {
            trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          }
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        next.set(r.icao24, { ...r, trail });
      }
      // Aircraft absent from the payload are gone: the server already pruned.
      return { aircraft: next, feedFetchedAt: batchFetchedAtUnix, feedStale: stale };
    }),

  feedAgeSeconds: () => {
    const at = get().feedFetchedAt;
    if (at === 0) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000) - at);
  },
}));
```

- [x] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/unit/state/stores.test.ts`
Expected: PASS

- [x] **Step 5: Rinominare il client — TRE file da aggiornare**

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

- [x] **Step 6: Portare il timestamp del batch attraverso lo stream**

In `src/data/aircraftStream.ts`, cambiare la firma in `StreamOptions`:

```ts
  /**
   * @param fetchedAt when the SERVER assembled this batch.
   * @param stale what the server said about its own payload: true when it
   *   served a cached body past its freshness window. Passed on rather than
   *   acted on — the client declares, it does not empty the globe.
   */
  onBatch: (aircraft: AircraftRaw[], fetchedAt: Date, stale: boolean) => void;
```

e in `tick`, sostituire `opts.onBatch(result.aircraft);` con `opts.onBatch(result.aircraft, result.fetchedAt, result.stale);`.

- [x] **Step 7: Adeguare `aircraftStream.test.ts` ai nuovi argomenti**

`toHaveBeenCalledWith` verifica la lista **completa** degli argomenti, quindi **tre** asserzioni di questo file si rompono: una su `onBatch`, che passa da uno a tre argomenti, e due su `fetchStates`, che passa da uno a tre con lo Step 9. Si rompe anche il doppio di `fetchStates` nel `beforeEach`, e prima ancora non compila: `FetchResult` ha ora un campo `stale` obbligatorio, e senza quello `result.stale` arriverebbe `undefined` all'asserzione. Correggere tutto:

Nel `beforeEach`:

```ts
    vi.spyOn(client, 'fetchStates').mockResolvedValue({
      fetchedAt: new Date(),
      stale: false,
      aircraft: [makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274', lastContact: 0 })],
    });
```

Nel test `calls fetchStates immediately on start`:

```ts
    expect(onBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ icao24: 'a1' })]),
      expect.any(Date),
      false
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

- [x] **Step 8: Aggiornare `src/data/bootstrap.ts`**

Sostituire il callback `onBatch` con:

```ts
    onBatch: (raws, fetchedAt, stale) => {
      const batchUnix = Math.floor(fetchedAt.getTime() / 1000);
      const enriched: Aircraft[] = raws.map((r) => {
        const resolved = resolveFlight(r);
        const ac: Aircraft = { ...r, trail: [] };
        if (resolved) ac.resolved = resolved;
        return ac;
      });
      // The server says whether what it just served is stale; carrying that
      // word to the store is what lets the HUD say it out loud instead of
      // drawing old positions as if they were current.
      useAircraftStore.getState().updateBatch(enriched, batchUnix, stale);
      useAircraftStore.getState().setFetchStatus('idle');
    },
```

- [x] **Step 8a: Scrivere il test del raggio visibile**

Il raggio che il client manda decide quali tile saltano la coda, e nessun test lo guardava: il valore spariva dentro un clamp del server e la revisione precedente ha potuto spedire un calcolo che non poteva produrre un numero operativo (vedi lo Step 9). Prima la misura, poi il codice.

In `tests/unit/globe/geoHelpers.test.ts`, estendere l'import già in cima al file:

```ts
import {
  latLonToVec3,
  latLonAltToVec3,
  altitudeToOffset,
  visibleCapRadiusNm,
  GLOBE_RADIUS,
} from '@/globe/geoHelpers';
```

e aggiungere in fondo:

```ts
describe('visibleCapRadiusNm', () => {
  // The orbit controls in src/globe/scene.ts hold the camera between 3,0 and
  // 10,0 globe radii, with a 38 degree vertical FOV. Those two distances are
  // the ends of the only range the server can ever be told about.
  it('is limited by the frustum when the camera is close in', () => {
    // Zoomed all the way in the globe overflows the viewport, so the edge of
    // the screen decides what is visible, not the horizon — which alone
    // would claim 3 602 NM here.
    expect(visibleCapRadiusNm(3.0, 38)).toBeGreaterThan(1200);
    expect(visibleCapRadiusNm(3.0, 38)).toBeLessThan(1400);
  });

  it('is limited by the horizon once the whole globe fits in the view', () => {
    expect(visibleCapRadiusNm(10.0, 38)).toBeGreaterThan(4800);
    expect(visibleCapRadiusNm(10.0, 38)).toBeLessThan(4950);
  });

  it('grows with distance across the whole zoom range', () => {
    const at = [3.0, 4.0, 5.0, 7.0, 10.0].map((d) => visibleCapRadiusNm(d, 38));
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
  });

  it('stays under the ceiling the server enforces, at every zoom level', () => {
    // The assertion the previous revision could not have passed. With the
    // horizon-only formula the SMALLEST value the camera could produce was
    // 3 602 NM against a server ceiling of 2 000 NM, so every request arrived
    // clamped to exactly 2 000 and the zoom level never reached the server at
    // all. MAX_VIEW_RADIUS_NM is now 5 000, taken from the far end of this
    // very range, and nothing here reaches it.
    for (const d of [3.0, 5.0, 10.0]) expect(visibleCapRadiusNm(d, 38)).toBeLessThan(5000);
  });

  it('never reports more than the horizon, however wide the lens', () => {
    // A lens wide enough to contain the whole globe still cannot see past
    // the horizon, so beyond that width the FOV stops mattering.
    expect(visibleCapRadiusNm(3.0, 170)).toBe(visibleCapRadiusNm(3.0, 120));
    expect(visibleCapRadiusNm(3.0, 170)).toBeGreaterThan(3500);
    expect(visibleCapRadiusNm(3.0, 170)).toBeLessThan(3700);
  });

  it('survives a camera at or inside the surface', () => {
    // The orbit controls forbid it; a division by zero in a feed path is
    // worth one line of guard anyway.
    expect(Number.isFinite(visibleCapRadiusNm(GLOBE_RADIUS, 38))).toBe(true);
    expect(Number.isFinite(visibleCapRadiusNm(0, 38))).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/globe/geoHelpers.test.ts`
Expected: FAIL — `visibleCapRadiusNm` non esiste ancora.

- [x] **Step 9: Completare il lato client della priorità di viewport**

Senza questo il blocco `lat`/`lon`/`radius` del Task 3 è **codice morto**: il client oggi costruisce solo query bbox e non ne passa nemmeno una. La promessa "la regione inquadrata è fresca" non sarebbe mantenuta.

Aggiungere a `src/globe/geoHelpers.ts` l'inversa della proiezione già presente e il raggio della calotta che si sta davvero guardando:

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

/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

/**
 * Radius, in NM along the surface, of the piece of globe actually on screen.
 *
 * Two limits, and the smaller one wins:
 *
 *  - the horizon. From `cameraDistance` nothing past acos(R/d) is visible,
 *    whatever lens you put on.
 *  - the frustum. Zoomed in, the globe overflows the viewport and the edge
 *    of the screen cuts the cap long before the horizon does.
 *
 * An earlier revision used the horizon alone, and the result was dead
 * arithmetic. The orbit controls in scene.ts hold the camera between 3,0 and
 * 10,0 globe radii, so that formula could only ever return between 3 602 and
 * 4 886 NM — and the server clamped every request to 2 000 NM. The camera
 * could not produce a number BELOW the clamp, so the server saw exactly
 * 2 000 at every zoom level: a half-angle computed, serialised, sent and
 * discarded, presented in the plan as if it carried the zoom level. With the
 * frustum term the near end is 1 299 NM and the value moves with the zoom,
 * which is the whole point of sending it.
 *
 * `fovDeg` is three.js's VERTICAL field of view, and the vertical half-angle
 * is the narrow one on a landscape viewport: this returns the cap that is
 * certainly on screen rather than the one that spills past the top and
 * bottom edges. Under-reaching costs priority on a tile at the very edge of
 * the view; over-reaching spends a priority slot — half of each poller batch
 * — on a tile nobody can see.
 */
export function visibleCapRadiusNm(cameraDistance: number, fovDeg: number): number {
  const d = Math.max(cameraDistance, GLOBE_RADIUS + 1e-6);
  const horizonRad = Math.acos(Math.min(1, GLOBE_RADIUS / d));
  const halfFovRad = ((fovDeg / 2) * Math.PI) / 180;
  // Does the edge ray of the frustum reach the sphere at all? When it misses,
  // the whole globe sits inside the view and only the horizon limits the cap.
  const disc = GLOBE_RADIUS ** 2 - (d * Math.sin(halfFovRad)) ** 2;
  let capRad = horizonRad;
  if (disc > 0) {
    const t = d * Math.cos(halfFovRad) - Math.sqrt(disc);
    const across = Math.sin(halfFovRad) * t;
    const along = d - Math.cos(halfFovRad) * t;
    capRad = Math.min(horizonRad, Math.atan2(across, along));
  }
  return Math.round(capRad * NM_PER_RADIAN);
}
```

In `src/globe/scene.ts`, **per prima cosa estendere l'import**, che oggi porta solo una funzione:

```ts
import { latLonAltToVec3, vec3ToLatLon, visibleCapRadiusNm } from './geoHelpers';
```

Senza questa riga il frammento sotto non compila: `TS2304: Cannot find name 'vec3ToLatLon'`. `GLOBE_RADIUS` **non** va importato qui: l'aritmetica della calotta vive ora dentro `visibleCapRadiusNm`, e un import inutilizzato è un errore con `noUnusedLocals`.

Poi estendere `SceneHandle` perché il resto dell'applicazione possa sapere cosa si sta guardando — oggi espone solo `dispose`:

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
      // normalised camera direction. The radius is what the lens actually
      // shows — horizon AND frustum. With the horizon alone this returned
      // between 3 602 and 4 886 NM across the entire zoom range, every value
      // above the server's ceiling, so the server saw one constant and the
      // zoom level never travelled.
      const { lat, lon } = vec3ToLatLon(camera.position);
      return {
        lat,
        lon,
        radiusNm: visibleCapRadiusNm(camera.position.length(), camera.fov),
      };
    },
```

In `src/data/statesClient.ts`, dichiarare la freschezza nel risultato e accettare il punto osservato:

```ts
export interface FetchResult {
  fetchedAt: Date;
  /**
   * What the server said about the body it just sent: true when it served a
   * cached payload past its freshness window. It travels in the BODY because
   * this function reads only res.json() — see Task 3, Step 10.
   */
  stale: boolean;
  aircraft: AircraftRaw[];
}

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
    // 820-1000 s — 14-17 minutes — so without this the region on screen
    // would be as stale as the far side of the planet.
    params.set('lat', view.lat.toFixed(3));
    params.set('lon', view.lon.toFixed(3));
    params.set('radius', String(view.radiusNm));
  }
  const qs = params.toString();
  const res = await fetch(qs ? `${ENDPOINT}?${qs}` : ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Air View proxy: HTTP ${res.status}`);
  const data = (await res.json()) as {
    fetchedAt: string;
    stale?: boolean;
    aircraft: AircraftRaw[];
  };
  // Optional on the wire and defaulted to fresh: a server that predates the
  // flag must not make every batch look stale. Present and true is the only
  // thing that raises the warning, so the warning means something.
  return {
    fetchedAt: new Date(data.fetchedAt),
    stale: data.stale === true,
    aircraft: data.aircraft,
  };
}
```

In `src/data/aircraftStream.ts`, aggiungere **l'import del tipo** e il campo:

```ts
import type { ViewQuery } from './statesClient';
```

```ts
  /** Where the viewer is looking, so the server can refresh those tiles first. */
  getViewCentre?: () => ViewQuery | null;
```

e nella `tick`, passarlo: `const result = await fetchStates(bbox, undefined, opts.getViewCentre?.() ?? null);`

In `src/data/bootstrap.ts`, aggiungere **lo stesso import** e accettare il punto osservato dal chiamante:

```ts
import type { ViewQuery } from './statesClient';
```

```ts
export async function bootstrapData(getViewCentre?: () => ViewQuery | null): Promise<void> {
```

e nelle opzioni dello stream: `getViewCentre,`.

Infine collegare i due in `src/ui/AppShell.tsx` — non in `src/App.tsx`, che si limita a renderizzare `<AppShell />` e non nomina né `mountScene` né `bootstrapData`. Nell'effect l'handle della scena è già nella variabile locale `handle`; sostituire

```tsx
    void bootstrapData().catch((e: unknown) => console.error('bootstrap:', e));
```

con

```tsx
    void bootstrapData(() => handle.viewCentre()).catch((e: unknown) =>
      console.error('bootstrap:', e)
    );
```

Deve essere una closure, non un valore già calcolato: lo stream interroga `getViewCentre` a ogni poll, e passare `handle.viewCentre()` congelerebbe per sempre l'inquadratura del mount — la priorità seguirebbe una camera che non si muove più.

- [x] **Step 9a: Blindare la lettura del flag `stale`**

Il lettore è già scritto — sta nel frammento di `fetchStates` dello Step 9 — ma era già stato scritto una volta e poi tolto, perché niente lo pretendeva. In `tests/unit/data/statesClient.test.ts` (il file rinominato allo Step 5), dentro il `describe('fetchStates', ...)` esistente:

```ts
  it('reads the stale flag out of the body', async () => {
    // The server puts it in the body precisely because this function reads
    // only res.json(). If nobody reads it, that choice bought nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fetchedAt: '2026-05-20T00:00:00Z', stale: true, aircraft: [] }),
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
```

Run: `npx vitest run tests/unit/data/statesClient.test.ts`
Expected: PASS, 5 test. Qui il verde arriva prima del rosso, perché l'implementazione sta nello Step 9: per controllare che questi due test siano vivi e non decorativi, togliere `stale: data.stale === true` dal ritorno di `fetchStates` e verificare che diventino rossi, poi rimetterlo.

- [x] **Step 9b: Scrivere il test della HUD**

Creare `tests/component/HudCounter.test.tsx`. `vitest.config.ts` include già `tests/component/**/*.test.{ts,tsx}`, l'ambiente è jsdom e `@testing-library/jest-dom/vitest` è già caricato da `tests/setup.ts`: non serve configurazione nuova.

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudCounter } from '@/ui/HudCounter';
import { useAircraftStore } from '@/state/aircraftStore';

describe('HudCounter', () => {
  beforeEach(() =>
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    })
  );

  it('says nothing about freshness while the feed is fresh', () => {
    render(<HudCounter />);
    expect(screen.queryByText(/feed stale/)).toBeNull();
  });

  it('declares a stale feed instead of drawing old positions as current', () => {
    // The last link of the chain this plan exists to break. The v1 feed was
    // frozen for 25 days and the globe never said so: the server served a
    // cached snapshot, the client drew it like live traffic, and the only
    // way to notice was to know an aircraft that had landed.
    useAircraftStore.setState({ feedStale: true });
    render(<HudCounter />);
    expect(screen.getByText(/feed stale/)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/component/HudCounter.test.tsx`
Expected: FAIL — la HUD non dice nulla della freschezza.

- [x] **Step 9c: Far dire alla HUD quello che il server ha dichiarato**

In `src/ui/HudCounter.tsx`, accanto alle due letture dello store già presenti:

```tsx
  const stale = useAircraftStore((s) => s.feedStale);
```

e dentro il `<div className="hud">`, dopo il blocco `status === 'error'`:

```tsx
      {stale && (
        <span className="hud__status" aria-label="Feed stale, showing last known positions">
          {' '}
          · feed stale · last known positions
        </span>
      )}
```

Riusa `.hud__status`, che esiste già in `src/ui/styles.css`: nessun foglio di stile da toccare, e il trattamento resta quello di «signal interrupted», che è un avviso dello stesso genere — una condizione del feed, non un dato di volo. Il contenitore ha già `role="status"` e `aria-live="polite"`, quindi la comparsa viene annunciata.

Run: `npx vitest run tests/component/HudCounter.test.tsx`
Expected: PASS, 2 test.

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

**E controllare che il `radius` cambi con lo zoom**, perché per una revisione intera non è cambiato: avvicinarsi e allontanarsi con la rotella e confrontare due richieste. Il valore deve muoversi fra circa **1 300 NM** (limite vicino dei controlli d'orbita) e circa **4 900 NM** (limite lontano). Se è sempre lo stesso numero, o se è sempre 2 000 lato server, `viewCentre()` sta ancora misurando l'orizzonte invece della calotta inquadrata.

La prova che il numero **cambia qualcosa** si prende dove la griglia è rada. Il Pacifico centrale non ha tile entro 1 300 NM e ne ha 181 entro 4 886 (misurato su `buildTileGrid()`, 546 tile). Attendere che `prioritised` sia tornato a 0, poi:

```bash
curl -s "localhost:3000/api/states?lat=0&lon=-160&radius=1299" > /dev/null
curl -s localhost:3000/health | python3 -c "import json,sys; print('zoom vicino, Pacifico:', json.load(sys.stdin)['tiles']['prioritised'])"
curl -s "localhost:3000/api/states?lat=0&lon=-160&radius=4886" > /dev/null
curl -s localhost:3000/health | python3 -c "import json,sys; print('zoom lontano, Pacifico:', json.load(sys.stdin)['tiles']['prioritised'])"
```

Expected: **0** dopo la prima coppia — zoomati sul Pacifico non c'è niente di visibile da anticipare, e i turni prioritari restano alla rotazione — e un valore **maggiore di zero** (fino a 6) dopo la seconda, dove quelle tile sono davvero sullo schermo. Se i due numeri sono uguali il raggio non sta decidendo nulla, ed è esattamente lo stato da cui veniamo.

- [x] **Step 11: Verificare entrambi i programmi e l'intera suite**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, tutti i test verdi. Se la suite non si carica affatto, un import di `openSkyClient` è sopravvissuto (Step 5). Se invece si carica ma due test di `aircraftStream` falliscono con `expected "spy" to be called with arguments`, mancano le correzioni di arity dello Step 7.

- [ ] **Step 12: Commit**

```bash
# The rename is already staged by the git mv in Step 5: only the new paths
# can be named here.
git add src/state/aircraftStore.ts src/data/aircraftStream.ts src/data/bootstrap.ts src/data/statesClient.ts src/globe/geoHelpers.ts src/globe/scene.ts src/ui/AppShell.tsx src/ui/HudCounter.tsx tests/unit/state/stores.test.ts tests/unit/data/aircraftStream.test.ts tests/unit/data/statesClient.test.ts tests/unit/globe/geoHelpers.test.ts tests/component/HudCounter.test.tsx
git commit -m "fix(state): stop deleting the fleet when the feed stops

removeStale compared lastContact against the local clock, so a frozen
feed made every aircraft infinitely stale and the entire fleet was
dropped — the last link in the chain that emptied the globe.

It is deleted rather than fixed. Measuring against the batch timestamp
would still have been wrong under the tiled feed: a full sweep takes
820-1000 s at the poller's ceiling of one tile every 1.5 s and the server
sizes its retention on that, so a 120 s client window would have deleted most of a
legitimately assembled fleet. The server already prunes; the client now mirrors the payload
instead of applying a second, independent rule that is bound to drift.

The client declares instead. The server already marks a payload it served
past its freshness window; that flag now travels the whole way to the HUD —
fetchStates reads it out of the body, the stream passes it on, the store
keeps it, the counter prints it. The v1 outage lasted 25 days because no
layer ever said the feed had stopped.

Also makes the camera's visible radius a number that means something.
viewCentre() measured the horizon, which between the orbit controls' limits
is never below 3 602 NM against a server ceiling of 2 000 NM, so every
request arrived clamped to the same constant whatever the zoom. It now
measures the frustum as well, and the ceiling is taken from the far end of
the range the camera can actually produce.

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

- [x] **Step 1: Creare `scripts/verify-feed.mjs`**

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
const ac = Array.isArray(data.aircraft) ? data.aircraft : [];
if (!Array.isArray(data.aircraft)) fail(`payload has no aircraft array (${JSON.stringify(data.aircraft)}) — /api/states is not answering with the feed shape`);

// Every coverage gate below divides by ac.length, and on an empty fleet
// that is 0/0 = NaN. NaN fails NO comparison: `NaN < 0.8` is false, so the
// registration gate printed `NaN%` and PASSED on exactly the dead feed this
// script exists to condemn. ratio() yields null instead of NaN, and every
// caller treats null as a failure rather than as a pass.
const ratio = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null);
const pct = (n, d) => {
  const r = ratio(n, d);
  return r === null ? 'n/a' : `${(100 * r).toFixed(1)}%`;
};

pass(`source: ${data.source}`);
pass(`aircraft: ${ac.length}`);
if (health.tiles) console.log(`tiles: ${JSON.stringify(health.tiles)}`);
if (health.fleet) console.log(`fleet: ${JSON.stringify(health.fleet)}`);
console.log(`x-feed-stale: ${res.headers.get('x-feed-stale')}`);

// The payload is not a function of what you are looking at: this endpoint
// serves the whole accumulated fleet and ignores the bbox on purpose, so its
// size follows the retention window. Measured here rather than assumed.
if (!health.payload) {
  fail('/health does not report payload size — the body can only be guessed at from outside');
} else {
  const p = health.payload;
  const ratio = p.gzipBytes ? p.bytes / p.gzipBytes : 0;
  console.log(`payload: ${p.aircraft} aircraft, ${(p.bytes / 1e6).toFixed(2)} MB raw, ${(p.gzipBytes / 1e6).toFixed(2)} MB gzip, ${(p.bytes / Math.max(p.aircraft, 1)).toFixed(0)} B/aircraft`);
  if (p.bytes > 10_000_000) fail(`payload is ${(p.bytes / 1e6).toFixed(1)} MB — lower MAX_RETENTION_S, or MAX_PAYLOAD_AIRCRAFT if the window is already at the floor`);
  else pass(`payload under the 10 MB ceiling`);
  if (p.gzipBytes === 0) fail('payload was never compressed — every client would pay the full body');
  else if (ratio < 5) fail(`compression only ${ratio.toFixed(1)}x — is the raw body being served under a gzip header?`);
  else pass(`compression ${ratio.toFixed(1)}x`);
  if (p.capped) fail(`payload capped at ${p.aircraft} of ${p.maxAircraft}: the fleet outgrew the ceiling and the world served is partial`);
  else pass('payload not capped');
}

// The fleet fills in tile by tile: a server that has just started has
// legitimately seen only part of the world. Below a few hundred after a
// full sweep, something is wrong.
if (ac.length < 300) fail(`only ${ac.length} aircraft — has a full sweep completed? tiles: ${JSON.stringify(health.tiles)}`);

// Dormancy is expected over ocean, but the dormant counter alone CANNOT see
// the failure this gate claims to catch: productive is tiles.length minus
// the dormant set, and a tile joins that set only through
// scheduler.record(tileId, 0), which runCycle calls on its success branch.
// If every fetch fails nothing is recorded, productive stays at its maximum,
// and the gate reports a world in perfect health while not one aircraft
// arrives. So the tile counters are cross-checked against the three signals
// that do move when the upstream dies: the age of the feed, the last error
// the poller saw, and the size of the fleet.
const tiles = health.tiles;
if (!tiles || !Number.isFinite(tiles.productive) || !Number.isFinite(tiles.total)) {
  fail(`/health carries no usable tile stats (${JSON.stringify(tiles)}) — the scheduler is not wired into /health`);
} else {
  if (tiles.productive < 20) fail(`only ${tiles.productive} productive tiles of ${tiles.total} — the grid or the source is broken`);
  else pass(`${tiles.productive} productive tiles, ${tiles.dormant} dormant`);

  // After three full sweeps every ocean-edge tile has come back empty three
  // times and must be dormant (dormantAfterEmptySweeps defaults to 3). Zero
  // dormant tiles after three sweeps means no sweep result was ever
  // recorded, which is what a wholly failing upstream looks like from here.
  if (tiles.sweepsCompleted >= 3 && tiles.dormant === 0) {
    fail(`${tiles.sweepsCompleted} sweeps completed and not one dormant tile — tiles are recorded only on success, so this is the shape of an upstream failing every fetch`);
  } else if (!(tiles.sweepsCompleted >= 3)) {
    console.log(`note: ${tiles.sweepsCompleted} sweeps completed — the dormancy cross-check needs three (~41 min of polling)`);
  }

  if (tiles.suspendedUntil) fail(`tile polling suspended until ${tiles.suspendedUntil} — the tile sources rate-limited us`);
}

// Liveness, read without going through any tile counter.
if (!Number.isFinite(health.feedAgeSeconds)) {
  fail(`/health reports feedAgeSeconds ${JSON.stringify(health.feedAgeSeconds)} — no cycle has ever landed a payload`);
} else if (health.feedAgeSeconds > 180) {
  fail(`/health feed is ${health.feedAgeSeconds}s old — a cycle is ~13 s, so the poller is running and nothing is landing`);
} else {
  pass(`/health feed age: ${health.feedAgeSeconds}s`);
}

if (!Number.isFinite(health.fleet?.size) || health.fleet.size === 0) {
  fail(`fleet holds ${JSON.stringify(health.fleet?.size)} aircraft — whatever the tile counters say, nothing is being absorbed`);
} else {
  pass(`fleet holds ${health.fleet.size} aircraft`);
}

// lastError is cleared by the next successful cycle and a cycle is ~13 s, so
// an error standing next to a fresh feed is one tile that failed and
// recovered. Standing next to a stale feed it is the diagnosis.
if (health.lastError && Number.isFinite(health.feedAgeSeconds) && health.feedAgeSeconds <= 60) {
  console.log(`note: last tile error "${health.lastError}" (${health.lastErrorCode ?? 'no code'}), but a cycle landed ${health.feedAgeSeconds}s ago`);
} else if (health.lastError) {
  fail(`tiles are failing: ${health.lastError} (${health.lastErrorCode ?? 'no code'})`);
} else {
  pass('no outstanding tile error');
}

const ageS = (Date.now() - new Date(data.fetchedAt).getTime()) / 1000;
// Same NaN trap as the coverage gates: a missing or unparsable fetchedAt
// makes ageS NaN and `NaN > 600` is false, so a payload with no timestamp at
// all printed `feed age: NaNs` and counted as a pass.
if (!Number.isFinite(ageS)) {
  fail(`fetchedAt is missing or unparsable (${JSON.stringify(data.fetchedAt)}) — the payload carries no feed timestamp`);
} else if (ageS > 600) {
  fail(`fetchedAt is ${Math.round(ageS)}s old — the feed is not live`);
} else {
  pass(`feed age: ${Math.round(ageS)}s`);
}

// A timestamp far in the past or future means a seconds/milliseconds mixup
// in an adapter — the kind of bug unit tests with hand-made mocks miss.
if (Number.isFinite(ageS) && (ageS < -60 || ageS > 86_400)) fail(`fetchedAt is implausible (${Math.round(ageS)}s) — check the epoch units in the source adapter`);

const withReg = ac.filter((a) => a.registration).length;
const withModel = ac.filter((a) => a.modelCode).length;
console.log(`registration: ${withReg} of ${ac.length} (${pct(withReg, ac.length)})`);
console.log(`model: ${withModel} of ${ac.length} (${pct(withModel, ac.length)})`);
const regRatio = ratio(withReg, ac.length);
if (regRatio === null) fail('registration coverage is undefined because the fleet is empty — undefined is not 80%');
else if (regRatio < 0.8) fail(`registration coverage ${pct(withReg, ac.length)} is below 80% — the adapter may be dropping it`);
else pass(`registration coverage ${pct(withReg, ac.length)}`);

const withRoute = ac.filter((a) => a.route).length;
console.log(`route: ${withRoute} of ${ac.length} (${pct(withRoute, ac.length)}) — grows as the resolver cache fills`);
if (health.routes) console.log(`resolver: ${JSON.stringify(health.routes)}`);

// The completeness flag must actually reach the payload: isComplete() being
// written and tested but never wired up is a defect a green suite cannot see.
if (!('stale' in data)) fail('payload has no "stale" field — the freshness flag is header-only, and the client reads only JSON');
else pass(`stale flag in body: ${data.stale}`);

const complete = ac.filter((a) => a.complete === true).length;
if (ac.length === 0) fail('no aircraft at all — the "complete" flag cannot be checked, and an unchecked flag is not a passing one');
else if (ac.some((a) => a.complete === undefined)) fail('payload has no "complete" field — isComplete() is not wired into the response');
else pass(`complete: ${complete} of ${ac.length} (${pct(complete, ac.length)})`);
if (withRoute > 0 && complete === 0) fail('routes are attached but no aircraft is marked complete — check isComplete()');

// The route subsystem dying silently is the failure mode this script exists
// to catch. A conditional check that only fires when routes already exist
// would print PASSED on a server whose resolver has been rate-limited into
// oblivion — which is exactly what happened during review.
if (health.routes?.suspendedUntil) fail(`resolver suspended until ${health.routes.suspendedUntil} — adsbdb rate limit hit`);
else pass('resolver not rate-limited');

const seeded = (health.routes?.resolved ?? 0) + (health.routes?.unknown ?? 0);
// `=== 0` is the wrong test for the same reason as everywhere else here: a
// /health answering with a non-number makes the sum NaN, and NaN === 0 is
// false, so a missing or malformed resolver block would pass.
if (!Number.isFinite(seeded) || seeded === 0) fail(`resolver knows no callsign at all (${JSON.stringify(seeded)}) — is server/data/route-cache.json present and readable?`);
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

- [x] **Step 2: Aggiungere lo script a `package.json`**

Nel blocco `"scripts"`, aggiungere:

```json
    "verify:feed": "node scripts/verify-feed.mjs",
```

- [x] **Step 3: Eseguire la verifica in locale** — ESEGUITO il 2026-11-21, `VERIFICATION PASSED`

```bash
npm run server
```

In un altro terminale, attendere che il poller abbia completato almeno un ciclo, poi:

```bash
npm run verify:feed
```

Expected: `VERIFICATION PASSED`, migliaia di aerei, età del feed plausibile, copertura registrazione sopra l'80%, nessun gruppo di rotte sospetto. Ripetendo dopo qualche minuto, la percentuale `route` deve essere cresciuta.

Su un server appena avviato alcune righe sono note informative e non fallimenti: il controllo incrociato sulla dormienza richiede tre spazzate (~41 minuti di polling) e fino ad allora stampa `note: N sweeps completed`. Al contrario, una flotta vuota non può più produrre `VERIFICATION PASSED`: tutti i cancelli di copertura dividono per il numero di aerei e trattano lo 0/0 come fallimento, invece di stampare `NaN%` e passare. Per vederlo senza rompere nulla, fermare il server e rilanciare `npm run verify:feed`: deve stampare `VERIFICATION FAILED`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-feed.mjs package.json
git commit -m "test: add end-to-end feed verification script

Checks the full chain against the real upstream APIs rather than test
doubles: health status code, live feed age, epoch-unit plausibility,
adapter field coverage, and an explicit assertion that no cluster of
flights shares one route — the shape of the v1 fabrication.

Every numeric gate is NaN-proof. An empty fleet makes each coverage ratio
0/0, and NaN fails no comparison, so `NaN < 0.8` used to let the
registration gate pass on exactly the feed this script exists to condemn.
Liveness is read from the feed age, the outstanding tile error and the
fleet size as well as from the tile counters, because a tile is recorded
only on success: when every fetch fails, the dormancy counters report
perfect health.

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
| 28 | **Critico.** Lo script di pre-seed campionava il feed con lo stesso URL impossibile: `sampleFeed()` avrebbe sollevato 403 a ogni ciclo e la cache sarebbe rimasta vuota | Stesso URL, stesso 403 | Il campionamento percorre a rotazione la griglia di tile del server, venti tile per giro, con la stessa cadenza di cortesia (Task 5) |
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
| 31 | **Critico.** Il client avrebbe cancellato l'81% della flotta appena ricevuta: finestra client di 120 s contro una flotta server che trattiene gli aerei 900 s e tile rivisitate ogni ~620 s. Il globo vuoto della v1, in forma attenuata, nel task che esiste per impedirlo | Sweep reale fra circa 10 minuti al tetto di richieste imposto dal poller; una finestra client di 120 s ne copre una frazione minima. I test del piano non potevano vederlo — usavano scarti di 10 s | `removeStale` eliminato: il server è l'unica autorità, `updateBatch` sincronizza con il payload. Test con scarto di 600 s che asserisce la **conservazione** (Task 7) |
| 32 | **Critico.** `setInterval` ogni 3 s senza guardia di rientranza, mentre una fetch di tile dal vivo impiega da 11 a oltre 90 s: decine di cicli sovrapposti e richieste concorrenti illimitate verso un servizio gratuito | Latenze misurate sul campo; lo Step di verifica guardava solo `/health` e non se ne sarebbe accorto | Guardia `cycleInFlight` e loop che si ripianifica **dopo** il completamento, più uno step che verifica con `grep` che nessun `setInterval` sia rimasto (Task 3) |
| 33 | **Critico.** Due step dicevano di sostituire `refreshGlobalFeed`, una funzione che non esiste in nessun punto del repo: era nel piano precedente, il cui Task 4 non è mai stato implementato | `grep -rn 'refreshGlobalFeed' server/ src/` → nessun risultato | Gli step dicono ora di **creare** la funzione, con il punto di inserimento esatto e il perché (deve stare sotto la dichiarazione di `app`), e il Task 5 nomina `refreshNextTiles` indicando dove inserire l'arricchimento (Task 3, 5) |

## Difetti del sesto preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 34 | **Critico.** La finestra di ritenzione della flotta (900 s fissi) era più corta del tempo reale di una spazzata, quindi `prune` avrebbe cancellato ogni aereo molto prima che la sua tile tornasse: non una flotta cumulativa ma una macchia rotante su circa un sesto della griglia. Il mio «~620 s per sweep» contava **solo** il gap fra cicli, ignorando la pausa fra tile e la latenza di rete che il piano stesso dichiarava di aver misurato | Latenza misurata dal vivo: 17,6 s / 39,7 s / 8,1 s / 52,8 s su quattro tile, mediana **28,6 s** — e 52,8 s per restituire **zero** aerei, quindi la lentezza è del server, non del payload. Sweep sequenziale di 413 tile: **213 minuti** | Otto fetch concorrenti (sweep ~25 min a 0,28 richieste/s) e finestra di ritenzione **derivata dallo sweep osservato** invece che fissata a mano, con floor e cap. I due numeri non possono più divergere perché uno è calcolato dall'altro (Task 3) |
| 35 | Con uno sweep di ~10 minuti, le posizioni della vista globale sarebbero vecchie di decine di minuti: un aereo in crociera percorre oltre 200 NM in venti minuti. È l'opposto del requisito di partenza — posizioni aggiornate di frequente, non icone che sembrano ferme | Aritmetica sulla latenza misurata | Anticipato il fetch guidato dalla camera, che era previsto per il Piano 2: `/api/states` accetta il punto osservato, le tile sotto il viewport saltano la coda e vengono rinfrescate subito, lo sweep globale resta in sottofondo per il colpo d'occhio (Task 2, 3) |

## Nota sul risultato atteso

Con questi vincoli il globo ha due velocità, ed è bene saperlo prima di guardarlo: **la regione inquadrata è fresca**, perché le sue tile hanno priorità; **il resto del pianeta è un contesto che si aggiorna in 820-1 000 s, cioè 14-17 minuti**. Non è un compromesso elegante, è il massimo che la cortesia verso adsb.lol concede: 546 tile, una richiesta ogni 1,5 s e 250 NM di raggio. Il dead reckoning del Piano 2 renderà continuo il movimento di ciò che si guarda; la vista globale resterà, per natura, un colpo d'occhio e non un cronometro.

## Difetti del settimo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 36 | **Critico.** La priorità guidata dalla camera era implementata **solo lato server**: il gestore leggeva `lat`/`lon`/`radius` che nessun client invia. Codice morto, e con esso l'unica risposta al difetto #35 — tutto il globo sarebbe rimasto vecchio di ~10 minuti, inclusa la regione inquadrata. La "Nota sul risultato atteso" prometteva una freschezza che il piano non consegnava | Piano applicato a una copia e server avviato: `curl` manuale con i parametri → `tiles.prioritised = 12`; una richiesta nuda del client reale → `0`. `SceneHandle` espone solo `dispose`, la camera non è raggiungibile dall'esterno | Completato il lato client: `vec3ToLatLon` in geoHelpers, `SceneHandle.viewCentre()` che deriva punto e raggio dalla posizione della camera, `fetchStates` che serializza il punto osservato, `getViewCentre` nello stream e il collegamento in `bootstrap`, più uno step che verifica nel browser che le richieste portino davvero i parametri (Task 7) |
| 37 | **Critico.** Il pump delle rotte usava `setInterval` senza guardia di rientranza e senza timeout sul fetch: esattamente il difetto #32, corretto per il ciclo delle tile e reintrodotto per le rotte poche pagine dopo | Riprodotto durante la revisione: un singolo hang da 300 s con `setInterval` a 10 s ha prodotto **30 lookup concorrenti** verso adsbdb, contro un tetto di progetto di 1 ogni 1,5 s. Il `headersTimeout` di undici è 300 s e il server ne sovrascriveva solo `connect` | Guardia `routePumpInFlight` e loop che si ripianifica dopo il completamento, `AbortSignal.timeout(10_000)` su ogni lookup, e ricontrollo della sospensione **dentro** il batch, così un 429 ferma anche le richieste rimanenti dello stesso giro (Task 5) |

## Difetti dell'ottavo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 38 | **Critico.** La priorità da viewport affamava la rotazione: `next()` serviva la coda prioritaria senza alcun tetto, e un solo visitatore chiedeva 12 tile ogni 30 s contro 8 servite ogni 31-55 s. Il cursore non avanzava mai, `sweepsCompleted` restava 0, la dormienza non si attivava e `prune` cancellava tutto ciò che sta fuori dall'inquadratura — il difetto #34 reintrodotto dalla correzione del #36 | Simulazione sul codice del piano, due ore e griglia reale: camera ferma → **8 tile di rotazione su 413**, `sweepsCompleted` 0; camera in movimento con ciclo lento → backlog prioritario che cresce a 284 senza mai svuotarsi | Metà di ogni batch è riservata alla rotazione; la coda prioritaria è limitata a 12 voci e scarta le più vecchie; `prioritise()` ignora una tile servita negli ultimi 60 s; il client ne chiede 6 invece di 12. In più `observedSweepSeconds` si misura sulle tile **di rotazione**, non su tutte, altrimenti la finestra di ritenzione continuerebbe a mentire (Task 2, 3) |
| 39 | **Critico.** Due asserzioni su `fetchStates` si rompono quando la firma passa da uno a tre argomenti. Il piano enunciava la regola — «`toHaveBeenCalledWith` verifica la lista completa» — e la applicava solo a `onBatch`. Lo step di verifica non poteva passare, e il suo suggerimento diagnostico indicava la causa sbagliata | Riprodotto con vitest 2.1.9 nel repo: `expected "spy" to be called with arguments: [ { lamin: 1 } ] / Received: [ {lamin: 1}, undefined, null ]` | Entrambe le asserzioni corrette nello Step 7, e il suggerimento diagnostico dello Step 11 distingue ora «la suite non si carica» da «due test rossi per arity» (Task 7) |

## Difetto del nono preflight corretto

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 40 | **Critico.** Il test «serves a prioritised tile even when it is dormant» contraddiceva la guardia `minRefreshMs` introdotta dalla correzione precedente: `next(3)` marca le tile come appena servite, quindi `prioritise()` le scartava e `next(1)` restituiva un array vuoto. Due test dello stesso file esigevano regole opposte | Piano applicato verbatim a una copia e suite eseguita: **144 test verdi, 1 solo fallito** — `Cannot read properties of undefined (reading 'id')` su quella riga. Entrambi i programmi TypeScript compilano puliti | Decisa e resa esplicita la precedenza: la richiesta del viewer scavalca la **dormienza** ma non la **freschezza**, perché ri-accodare a ogni poll è il meccanismo che affama la rotazione. Il test isola la prima regola con `minRefreshMs: 0`, la seconda ha il proprio test, e il commento del codice dichiara quale vince (Task 2) |

## Difetti del decimo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 41 | **Critico.** Il ritmo del poller era dimensionato su una latenza di «~29 s mediani», misurata da me in un momento di congestione. Oggi adsb.lol risponde in **0,47 s mediani**: con 8 concorrenti e un gap fisso di 2 s il rate reale sarebbe **3,2 richieste/s**, oltre il doppio del tetto di 1,5 dichiarato nei Global Constraints di questo stesso piano, sostenuto giorno e notte contro il servizio gratuito che ha già bloccato il progetto una volta | Rimisurato: 0,28 / 0,40 / 0,55 / 2,35 / 0,24 / 1,97 s su sei tile, mediana **0,47 s** — e la tile oceanica vuota, che il piano dichiarava impiegare 53 s, risponde in 2,3 s | Il rate **non si deriva più dalla latenza**: un tetto esplicito di 1 richiesta/s, applicato aspettando la differenza quando un ciclo finisce presto. È robusto in entrambi gli scenari — se la latenza torna a 30 s il ciclo è già abbastanza lento da soddisfarlo. Lo sweep diventa di ~10 minuti, e c'è uno step che **misura le richieste al secondo** invece di limitarsi a cercare `setInterval` |
| 42 | **Critico.** Tre import mancanti bloccavano la compilazione: `vec3ToLatLon` e `GLOBE_RADIUS` in `scene.ts`, `ViewQuery` in `aircraftStream.ts` e `bootstrap.ts`. Il blocco Files del Task 7 non elencava nemmeno i tre file che lo Step 9 modifica | `npx tsc --noEmit` sulla copia: tre `TS2304`. Aggiunti gli import, **145 test verdi** e entrambi i programmi puliti | Import dichiarati esplicitamente prima di ogni frammento, e i file aggiunti al blocco Files (Task 7) |

## Difetti dell'undicesimo preflight corretti

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| 43 | **Critico.** Il poller emetteva 8 richieste **simultanee** con `Promise.all`: la media rispettava il tetto di 1 req/s, il pattern istantaneo no. adsb.lol ha risposto 429, il selector ha ritentato la raffica su adsb.fi che ha risposto 429 anch'essa, e il feed è morto | Piano applicato a una copia e server avviato: 8 tile loggate nello stesso millisecondo a 0,28 s / 8,22 s / 16,23 s, poi a 24,36 s `adsb-lol: HTTP 429 \| adsb-fi: HTTP 429` su ogni tile, e da lì in poi entrambe in cooldown. 26 fetch riuscite in totale; flotta congelata a 251 aerei. Il rate misurato era 1,07 tile/s — **dentro** il tetto | Fetch **strettamente sequenziali**, una ogni 1,5 s, mai in parallelo. Il 429 diventa stato di prima classe anche per le tile: sospensione di 5 minuti durante la quale non parte nulla, esposta su `/health`. Lo sweep passa a 820-1 000 s (14-17 minuti). I Global Constraints ora vincolano il **pattern**, non la media |
| 44 | **Critico.** Il Task 1 era già interamente implementato e committato: ogni suo step chiedeva di sostituire testo identico a quello già presente, e il gate TDD non poteva vedere il rosso che pretendeva. Un esecutore fedele si sarebbe bloccato, o avrebbe rotto il codice apposta | `maxRadiusNm: 250` già in entrambi gli adattatori, commenti già byte-per-byte, test già `toBe(250)`, commit con messaggio identico già presente | Il Task 1 diventa una nota di stato con la sola verifica (`build:all` + suite) e il rimando ai commit che l'hanno realizzato |
| 45 | `next()` poteva restituire la stessa tile due volte nello stesso batch — una dalla coda prioritaria e una dalla rotazione — e il chiamante fetcha ogni voce: due richieste identiche contro un provider che punisce le raffiche | Lettura del ciclo di rotazione, che non escludeva le tile già in `out` | Deduplica esplicita e test che la verifica (Task 2) |
| 46 | Nel Task 6 l'ordine era invertito: implementazione allo Step 1, test allo Step 2, e lo Step 3 pretendeva un fallimento impossibile. Lo stesso difetto del Task 1, ma interno al piano | Lettura degli step | Ordine TDD ripristinato: test, rosso, implementazione (Task 6) |
| 47 | **Critico.** `buildTileGrid` lasciava scoperto il 2,1% dell'area dichiarata, e il commento sorgente sosteneva il contrario per la parte interna («copre l'interno di ogni box, con 2 NM di margine»). Due famiglie di buco: la striscia oltre l'ultimo centro di ogni riga e colonna, e una **scalinata fra righe contigue**, perché lo step in longitudine dipende dalla latitudine e righe vicine finivano a longitudini diverse. Il test che pretendeva di dimostrare la copertura interna campionava solo il punto medio fra longitudini adiacenti **della riga inferiore**, quindi non visitava mai la scalinata: un'asserzione verde che non provava la tesi attribuitale | Sul codice vero: (19 N, 89,75 E) nel Golfo del Bengala, racchiuso fra centri su entrambi gli assi, **308,3 NM** dal centro più vicino dell'intera griglia, contro i 227,9 NM asseriti come caso peggiore. Maputo 279 NM, Harbin 270 NM, Cape Breton 316 NM, tutte dentro una bbox e fuori da ogni tile | Lo step diventa un **tetto anziché un incremento**: ogni box è diviso nel minor numero di passi interi che restano sotto il tetto, quindi righe e colonne finiscono esattamente sul bordo dichiarato. Misurato a 0,1 grado: **1 224 760 punti su 1 224 760 entro 230 NM**, peggiore 218,0 NM. 546 tile invece di 413, e tutte le cifre derivate aggiornate. Il test ora scandisce 50 112 punti e pretende **zero** scoperti (Task 2) |
| 48 | Quattro comportamenti dello scheduler erano descritti solo dai commenti: mutandoli la suite restava verde. Il commento diceva «la richiesta più recente è servita per prima» mentre `next()` prelevava con `shift()`, cioè la **più vecchia** — con la camera in movimento si rinfrescava la posizione precedente prima di quella inquadrata, il ritardo che la priorità da viewport esiste per eliminare. E i quattro default — i valori che la produzione usa davvero, perché il Task 3 costruisce lo scheduler senza opzioni — non erano esercitati da nessun test: `maxPriorityQueue` e `minRefreshMs` sono la correzione letterale del difetto #38 e potevano essere annullati senza un rosso | Mutation testing sul file del repo, baseline verde: `shift`→`pop` nel cap, rimozione di `lastServedAt.set()` nel ramo di rotazione, rimozione del dedupe `priority.includes(id)`, e i quattro default portati a valori distruttivi — **tutti e sette i mutanti sopravvivevano** | `next()` preleva con `pop()`: il più recente è ora sia il primo servito sia l'ultimo scartato. Sette test nuovi, ognuno verificato per mutazione: dieci mutanti su dieci muoiono (Task 2) |
| 49 | Gli adattatori sostituivano un valore plausibile a un campo mancante, la regola che questo progetto ha già infranto una volta con le rotte: senza `seen` nel record del provider, `lastContact` diventava l'istante del fetch, cioè un aereo di freschezza **ignota** veniva dichiarato visto adesso. Il dead reckoning avrebbe estrapolato una posizione da un timestamp che nessuno ha riportato — un aereo che ha smesso di trasmettere continua a scivolare sul globo. Peggio: un test lo **benediceva**, intitolato «treats a missing seen as zero staleness rather than guessing», quando zero *è* la congettura | Lettura dei due adattatori e del test | `lastContact` diventa `number \| null`; i tre consumatori (scia, `removeStale`, `FlightCard`) trattano il null come «staleness ignota», non come «fresco». Il test è riscritto e ne è aggiunto uno per il caso con `seen` presente (Task 1) |
| 50 | Gli adattatori scartavano corpo e header della risposta d'errore, quindi i log dicevano «adsb-lol: HTTP 403» e nulla più — e proprio 403 è lo status che non distingue un rifiuto per raggio da uno User-Agent bloccato, cioè le due cause che hanno fermato la v1. Su un 429 si perdeva `Retry-After`, l'unico dato che dice quanto stare zitti | Lettura dei due adattatori | Nuovo `src/data/sources/httpError.ts`: l'errore porta status, corpo (primi 200 caratteri) e `retryAfterSeconds`, tollerando i doppi di test privi di `text`/`headers`. Task 3 può leggere `retryAfterSeconds` invece di indovinare la pausa (Task 1) |
| 51 | Il selector distruggeva la catena `cause`: catturava l'errore originale e ricostruiva un `new Error` dal solo `e.message`. `server/index.ts` legge `e.cause` per loggare `causeMessage`/`causeCode` — la diagnostica aggiunta apposta per il guasto di egress Railway (`UND_ERR_CONNECT_TIMEOUT`, `ENOTFOUND`) — quindi quei campi erano sempre nulli esattamente quando servivano. In più, in un roster misto le sorgenti saltate per raggio sparivano dal messaggio | Lettura di `selector.ts` e di `server/index.ts` | L'errore aggregato porta ora l'errore originale come `cause`, e il messaggio elenca anche le sorgenti saltate per raggio. **Nota per il Task 3**: il nuovo logging deve percorrere la catena `cause` fino alla radice, perché il `code` di undici sta su `e.cause.cause` (Task 1) |
| 52 | La quota riservata alla rotazione non reggeva per batch da una tile: `Math.max(1, Math.floor(1 * 0.5))` vale 1, quindi la coda prioritaria si prendeva l'intero batch e `rotationServed` restava a zero — la fame che `ROTATION_SHARE` esiste per impedire, in un poller da una richiesta ogni 1,5 s, cioè la forma naturale sotto questo rate limit | Lettura di `next()` | La quota si accumula **fra** batch (`priorityCredit`) e si spende una tile intera alla volta: un poller da una tile alterna. Il credito matura solo a coda non vuota, altrimenti una coda inattiva ne accantonerebbe abbastanza da inghiottire un batch successivo (Task 2) |
| 53 | Lo script dei dati statici faceva quattro download senza alcuno `User-Agent`, contro il vincolo globale del piano | Lettura di `scripts/build-static-data.mjs` | Header aggiunto, con la nota del perché la costante è duplicata: il file è `.mjs` e sta fuori da entrambi i programmi TypeScript |
