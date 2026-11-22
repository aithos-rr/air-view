# Air View v2 — Piano 4: il dettaglio del globo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere la frase con cui l'utente ha chiuso il Piano 3, guardando il globo vero: «quando zoomo non zoomo abbastanza e manca il dettaglio che volevo nel globo». Le sue parole su cosa vuole: «se ho un ammasso di aerei devo poter zoomare finché questi si separano fra loro, almeno a grandezza che posso inquadrare l'aeroporto o una città. Poi il nome della città non esce quando sono troppo fuori, però man mano mi avvicino esce.» E il vincolo, esplicito: **la stessa grafica e lo stesso stile**, senza sovraccaricare il browser.

**Architecture:** Lo zoom scende da 322 NM a 39,6 NM di cap visibile, e questo non è un numero tondo: è il punto in cui due aerei alla separazione radar di terminale — 3 NM — stanno a 30 px l'uno dall'altro, due diametri del simbolo. Ma arrivarci rompe cinque cose che il Piano 2 aveva lasciato in equilibrio su 1,9, e il piano le affronta tutte e cinque prima di toccare un pixel di grafica: **il guscio delle quote**, che a 1,575 unità è una esagerazione di 26× e a quello zoom diventa un errore di posizione da 108 px, non una decorazione; **il piano near della camera**, che a 0,1 taglia gli aerei alti già a 1,675; **l'arco di rotta**, che a 1,585 di apice finisce dietro la camera e porta via con sé proprio la rotta che l'utente ha chiesto di vedere; **la linea di costa**, disegnata a 19 km di quota apparente, cioè più alta dell'intero guscio corretto; e **la priorità delle tile**, che il Piano 2 aveva legato ai 218 NM della griglia. Poi, e solo poi, arriva il dettaglio: una cartografia 10m servita come binario di delta Int16 **a corse contate** — 2,06 MB contro i 12,67 del GeoJSON e meno dei 2,94 MB di 50m che già spediamo — disegnata a secchi geografici di 10° in modo che in vista ce ne stia meno di quanto il livello 50m spinge oggi a ogni fotogramma; e i nomi delle città, che sono **già nel bundle e non li disegna nessuno**, scelti per `SCALERANK` e ordinati per `LABELRANK`, che esistono in Natural Earth esattamente per questo.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md` §4.2, §4.3

**Predecessori:** Piani 1, 2 e 3 — `docs/superpowers/plans/2026-11-16-air-view-v2-tiled-feed.md`, `docs/superpowers/plans/2026-11-22-air-view-v2-density-motion.md`, `docs/superpowers/plans/2026-11-21-air-view-v2-panel-focus-search.md` — tutti su `main` e in produzione su https://air-view-production.up.railway.app/. Questo piano **corregge** due numeri del Piano 2 (il fondo corsa `CAMERA_NEAR_LIMIT` e il guscio `altitudeToOffset`) e ne riscrive le due motivazioni: non perché fossero sbagliate allora, ma perché erano corrette **per una corsa che finiva a 1,9**. Vedi D35, D36, D38.

---

## 1. Cosa esiste già — letto nel repo il 2026-11-22

Verificato su `main` al 2026-11-22, **dopo che il lavoro del Piano 3 sulla camera è atterrato** (commit `3c689bd`): **637 test unitari verdi** su 61 file, **20 end-to-end**, `npm run build:all` pulito su entrambi i programmi. Il 577 di una stesura precedente era la misura di prima di quel commit, e ogni numero di §5 è ricalcolato su 637.

| Cosa | Dove | Stato |
|---|---|---|
| La corsa della camera | `src/globe/geoHelpers.ts:22-23` — `CAMERA_NEAR_LIMIT = 1.9`, `CAMERA_FAR_LIMIT = 10.0` | unità di mondo, una sola dichiarazione (D24). Il commento sopra motiva 1,9 con i 218 NM della griglia |
| Il cap visibile | `src/globe/geoHelpers.ts:93`, `visibleCapRadiusNm(d, fov)` | orizzonte **e** frustum, il minore vince. A 1,9 → 322 NM |
| La dimensione del simbolo | `src/globe/aircraft.ts:56`, `pointSizePx(d)` | 7 px a 10,0, 14 px a 1,9, interpolati sul logaritmo (D23) |
| Il guscio delle quote | `src/globe/geoHelpers.ts:43`, `altitudeToOffset(altFt) = 0.025 + (altFt/41000)*0.05` | **una funzione della sola quota**: non sa niente dello zoom. E non è una funzione sola: la stessa riga è **inlinata altre due volte** — `src/globe/aircraft.ts:270` e `src/globe/trails.ts:202`, dentro due `writeLatLonAlt` privati che nessun indice nomina. **Tre copie** |
| Il piano near/far | `src/globe/scene.ts:49`, `new PerspectiveCamera(38, aspect, 0.1, 100)` | `near = 0,1`, `far = 100`, entrambi letterali |
| L'alone atmosferico | `src/globe/atmosphere.ts:10`, `SphereGeometry(GLOBE_RADIUS * 1.04)` con `BackSide` | una sfera a **1,56** unità, sempre accesa. Il `fresnel` del suo fragment shader (righe 27-28) è **codice morto**: con `BackSide` ogni frammento disegnato ha `dot(n, v) ≤ 0`, il `clamp` lo porta a 0 e l'alpha vale **0,18 ovunque**. Non è un bordo di lembo: è una velatura uniforme (§2.6) |
| I confini | `src/globe/continents.ts:22-84`, `buildContinentsFromGeoJSON` + `loadContinents` | `ne_50m_admin_0_countries.geojson`, 2,94 MB, **anelli esterni soltanto**, segmenti suddivisi oltre i 2° |
| L'altezza della costa | `src/globe/continents.ts:24`, `const radius = GLOBE_RADIUS * 1.003` | un letterale dentro una funzione: **0,0045 unità = 10,3 NM = 19,1 km** di quota apparente, più alto dell'intero guscio nuovo. Citato a mano anche in `routeArc.ts:36` e, in una stesura precedente, in un test del Task 1 (§2.7, D47) |
| La geometria dell'arco | `src/globe/routeArc.ts:37-40,118`, `ARC_BASE_OFFSET = 0.018`, `ARC_APEX_MIN = 0.012`, `ARC_APEX_RANGE = 0.055` | tre costanti **assolute**: l'apice arriva a 1,585, cioè sopra la camera al fondo corsa nuovo. Stessa sostanza del guscio, stesso difetto (§2.7, D46) |
| Il fallimento dei confini | `src/globe/scene.ts:116`, `.catch((e) => console.warn('Continents:', e))` | se il file non arriva il globo resta **senza contorni e senza una parola** |
| I marcatori D/A | `src/globe/airportMarkers.ts:92-160` | DOM sopra il canvas, **riproiettato a ogni fotogramma**, nessuna ancora e nessuna cache: è il precedente giusto per le etichette |
| La soglia dell'etichetta D/A | `src/globe/airportMarkers.ts:37`, `MARKER_LABEL_MAX_DISTANCE = sqrt(NEAR*FAR)` | media geometrica della corsa: si ricalcola da sé quando la corsa cambia |
| Le città | `public/data/ne_50m_populated_places.geojson`, 3 350 885 B | **3,20 MB nel bundle che nessuno legge.** `grep -rn populated_places src/` non trova niente |
| La priorità delle tile | `server/index.ts:447`, `tilesNear(tiles, {lat, lon}, radius)` poi `.slice(0, 6)` | prende le tile il cui **centro** cade entro il raggio dichiarato dal client |
| La garanzia della griglia | `src/data/sources/tileGrid.ts:60-62` | nessun punto coperto dista più di **218,0 NM** dal centro della sua tile, su 1 224 760 campioni |
| Il tetto del raggio | `server/index.ts:151`, `MAX_VIEW_RADIUS_NM = 5_000` | è un **tetto**, non un pavimento |
| Il moto per batch | `src/globe/deadReckoning.ts:130`, `radius: GLOBE_RADIUS + altitudeToOffset(...)` | il raggio del guscio è **congelato alla costruzione del batch** |
| La posizione per fotogramma | `src/globe/deadReckoning.ts:208`, `positionAt(m, advanceS, nowMs, out)` | legge `m.radius`, cioè quel raggio congelato |
| La riga di stato | `src/ui/FeedStatus.tsx:43-85`, `role="status" aria-live="polite"` | il posto dove l'HUD dice cosa non ha |
| Il profiler | `src/globe/scene.ts:394-413` | stampa già fps e ms per stadio una volta al secondo |
| I token di colore | `src/ui/styles.css:1-29` | `--color-body-muted: #cccccc` — **12,0 : 1** su `#0a0a14`, già conforme |

Il punto da cui parte tutto il piano: **il file delle città è già scaricato, già nel bundle, e non lo apre nessuno** — esattamente come `complete` prima del Piano 3 e come rotta e velocità prima del Piano 2. Nessun task qui sotto deve andare a cercare un dato nuovo per le etichette.

---

## 2. I numeri veri da cui parte il disegno

Misurati il 2026-11-22 con il codice vero in mano. Le righe in NM/px sono su un canvas alto **800 px** — il caso peggiore realistico, un portatile dopo la cornice del browser; un viewport più alto ha più pixel per lo stesso cap ed è strettamente migliore.

### 2.1 Lo zoom, la separazione e il guscio

`visibleCapRadiusNm(d, 38)` è `geoHelpers.ts:93`; `pointSizePx(d)` è `aircraft.ts:56` con la corsa **nuova** (1,55–10,0).

```
 d        cap NM   NM/px    simbolo  3 NM in px   guscio oggi    gap camera→cima guscio
10,00     4 885,7  12,214     7,0       0,2        0,0750          8,425
 6,00     4 534,4  11,336     8,9       0,3        0,0750          4,425
 3,00     1 298,5   3,246    11,5       0,9        0,0750          1,425     ← fondo corsa v1
 2,50       832,3   2,081    12,2       1,4        0,0750          0,925
 1,90       321,5   0,804    13,2       3,7        0,0750          0,325     ← fondo corsa oggi
 1,75       199,5   0,499    13,5       6,0        0,0750          0,175
 1,675      139,2   0,348    13,7       8,6        0,0750          0,100     ← il near a 0,1 TOCCA il guscio
 1,60        79,3   0,198    13,9      15,1        0,0750          0,025     ← dentro il near: tagliato
 1,55        39,6   0,099    14,0      30,3        0,0750         −0,025     ← camera DENTRO il guscio
 1,505        3,9   0,010    14,0     303,6        0,0750         −0,070
```

### 2.2 Quanto è grande davvero l'esagerazione delle quote

`altitudeToOffset` dice che un'unità di mondo vale `3440,065 / 1,5 = 2 293,4 NM` di arco sulla superficie. Quindi:

```
     0 ft → 0,0250 unità =  57,3 NM = 106 km di quota apparente  (vera:  0,0 km)
10 000 ft → 0,0372 unità =  85,3 NM = 158 km                     (vera:  3,0 km)
38 000 ft → 0,0713 unità = 163,6 NM = 303 km                     (vera: 11,6 km)   ← 26×
41 000 ft → 0,0750 unità = 172,0 NM = 319 km                     (vera: 12,5 km)
```

E il prezzo, che non si paga in bellezza ma in **posizione**. Un aereo a 38 000 ft al bordo del cap visibile non viene disegnato sopra il punto di terra su cui vola: viene disegnato di fianco.

```
 d       cap NM    spostamento rispetto al punto di terra sottostante
10,00    4 885,7     +8,6 px  =   +104,9 NM   ( 2,1 % del raggio inquadrato)
 4,00    2 476,6    +27,0 px  =   +167,2 NM   ( 6,7 %)
 3,00    1 298,5    +37,1 px  =   +120,4 NM   ( 9,3 %)
 1,90      321,5   +107,7 px  =    +86,6 NM   (26,9 %)   ← il fondo corsa di OGGI
 1,75      199,5   +183,6 px  =    +91,6 NM   (45,9 %)
 1,70      159,3   +248,1 px  =    +98,8 NM   (62,0 %)
```

### 2.3 La cartografia, misurata in byte e in vertici

Il file 10m è stato **scaricato e contato**, non stimato. Il conteggio dei segmenti riproduce `continents.ts` riga per riga: solo anelli esterni, Antartide esclusa, salti d'antimeridiano scartati, suddivisione sopra i 2°.

```
                        byte su disco   anelli   punti     segmenti   vertici GPU   buffer GPU   build
ne_50m_admin_0 (oggi)    3 083 490       1 512    94 509     93 005      186 010      2,13 MB   10,1 ms
ne_10m_admin_0          13 287 234       4 095   524 028    519 933    1 039 866     11,90 MB   65,1 ms
```

Lunghezza dei segmenti, e quanta parte di quel dettaglio finisce sotto il pixel:

```
         segmento medio   a d=4,00         a d=2,50        a d=1,90        a d=1,55
50m          5,651 NM     0,91 px (69 %)   2,72 px (15 %)  7,03 px (1 %)   57,14 px (0 %)
10m          1,368 NM     0,22 px (98 %)   0,66 px (84 %)  1,70 px (43 %)  13,83 px (1 %)
                          ^ frazione di segmenti SOTTO il pixel
```

Le codifiche, tutte misurate sullo stesso insieme di anelli:

```
GeoJSON verbatim                                       12,67 MB
geometria sola, 4 decimali, JSON                        9,26 MB   (2,96 gzip / 1,79 brotli)
Float32 binario lon/lat                                 4,00 MB   (3,20 gzip / 1,87 brotli)
Int16 delta a 1e-5 gradi (1,1 m), restart TAGGATO       2,04 MB   (1,83 gzip / 1,69 brotli)
   ↑ 517 999 delta entrano in Int16; 6 029 punti assoluti, cioè 4 095 inizi
     di anello + 1 934 sforamenti.  SCARTATO: non si decodifica — vedi D40
Int16 delta a 1e-5 gradi, a CORSE CONTATE               2,06 MB   ← il formato scelto
   ↑ stessi anelli, stessi punti, stessi delta: cambia solo l'intestazione di
     una corsa, 12 byte dove il record taggato ne usava 9.  2 160 744 byte
     contro 2 142 653: +18 091 byte, +0,84 %
```

Le due righe `Int16` sono lo stesso dato: la seconda è la prima resa decodificabile. Il conto è derivato dai conteggi qui sopra (4 095 anelli, 524 028 punti, 6 029 assoluti, 517 999 delta), non rimisurato — il Task 4 Step 4 lo verifica sui byte veri del file costruito.

E la semplificazione Douglas-Peucker, con l'errore tradotto in pixel al fondo corsa proposto:

```
 tolleranza   a terra   punti tenuti    segmenti    Int16-delta   errore a d=1,55
   0 (nessuna)     0 m   524 028 (100 %)   519 933     2,04 MB        0,0 px
   0,0008      89 m      483 955 ( 92 %)   480 020     1,89 MB        0,5 px
   0,0015     167 m      430 494 ( 82 %)   426 559     1,69 MB        0,9 px
   0,003      334 m      340 401 ( 65 %)   336 474     1,35 MB        1,8 px
   0,012    1 334 m      163 738 ( 31 %)   159 825     0,68 MB        7,3 px
```

La colonna `Int16-delta` è il formato taggato. A corse contate ogni riga cresce di 8 byte per punto assoluto, circa **+0,9 %**: la tolleranza scelta, 0,0008°, passa da 1,89 MB a **1,91 MB**.

Secchi geografici, con il limite peggiore di vertici in vista (somma dei secchi **globalmente più grandi**, cioè un limite superiore pessimistico):

```
              secchi non vuoti   più grande     a d=1,90        a d=1,75        a d=1,55
 5°  ×  5°         954            6 169 seg    100 094 vert     63 604 vert     33 432 vert
10°  × 10°         359            8 702 seg    131 722 vert     64 262 vert     64 262 vert
20°  × 20°         126           20 941 seg    148 504 vert    148 504 vert    148 504 vert
```

**Il livello 50m di oggi spinge 186 010 vertici a ogni fotogramma, sempre, a ogni zoom.**

### 2.4 Le città, contate

`ne_50m_populated_places.geojson`: 1 251 luoghi, 395 sopra il milione di abitanti, campi `SCALERANK` (0–10, 0 = prima a comparire), `LABELRANK`, `NAME`, `POP_MAX`. Ordinato per `SCALERANK` l'insieme diventa una scala a **prefissi**:

```
SCALERANK ≤ 0 :    27 luoghi      ≤ 3 :   522
          ≤ 1 :    68             ≤ 4 : 1 128
          ≤ 2 :   186             ≤ 10: 1 251
```

Quante ne cadono dentro il cap, **centrando la camera su ciascuno dei 1 251 luoghi e tenendo il peggiore**:

```
   d     cap NM   tutte   s≤4   s≤3   s≤2   s≤1   s≤0
10,00    4 885,7   968    895   421   159    55    20
 3,00    1 298,5   204    169    76    43    15     6
 2,50      832,3   125     94    45    31    12     5
 2,00      403,9    57     40    17    14     6     3
 1,90      321,5    42     26    13    11     4     2
 1,75      199,5    20     16     7     6     3     2
 1,60       79,3    10      8     4     4     1     1
 1,55       39,6     8      5     3     3     1     1
```

E quanto spazio chiede un'etichetta (~70 px × 16 px nello stile di `.marker__label`):

```
 d=3,00:  70 px = 227,2 NM      d=1,90:  70 px = 56,3 NM      d=1,55:  70 px = 6,9 NM
```

### 2.5 Le quattro conseguenze che il disegno deve digerire

1. **A 1,9 la separazione non c'è ancora.** Due aerei alla separazione radar di rotta — 5 NM — distano 6,2 px, e alla separazione di terminale — 3 NM — ne distano 3,7, contro un simbolo di 14. Sono un puntino solo. La frase dell'utente «risultano fitti quando lascio tutti gli aerei presenti» è questo numero, non un'impressione. A 1,55 gli stessi due aerei distano 50,6 px e 30,3 px: due diametri del simbolo.
2. **Il guscio non è più una decorazione, è un errore.** Già a 1,9 un aereo di crociera al bordo dell'inquadratura è disegnato **107,7 px** — 86,6 NM — di fianco al punto su cui vola. A 1,7 sono 248 px, il 62 % del raggio inquadrato. Scendere a 1,55 con il guscio di oggi non mostrerebbe una città con i suoi aerei sopra: mostrerebbe una città e, da qualche altra parte, degli aerei.
3. **La camera sbatte nel guscio prima di arrivare.** Gli aerei alti stanno a 1,575 unità. Il `near` di `0,1` li taglia già a **d = 1,675**, e sotto **d = 1,575** la camera è *dentro* al guscio: un aereo a 41 000 ft sopra il punto inquadrato finisce **dietro** alla camera. Nessun fondo corsa sotto 1,675 esiste finché quei due numeri restano dove sono.
4. **La priorità delle tile è legata a 1,9 e si stacca qui.** `tilesNear` nomina le tile il cui centro cade entro il raggio dichiarato, e la griglia garantisce al più 218,0 NM dal centro più vicino. A 322 NM c'era margine; a 39,6 NM un visitatore sopra un punto distante 218 NM dal suo centro non nominerebbe **nessuna** tile e la regione che sta guardando smetterebbe di saltare la coda. Il Piano 2 ha risolto il problema fermando la camera; questo piano lo risolve dove sta davvero, cioè nel server. Vedi D38.

E ce ne sono altre due, trovate al secondo giro di verifica e misurate in **§2.7**: l'arco di rotta, che al fondo corsa finisce dentro il piano near o dietro la camera (D46), e la linea di costa, che è disegnata a 19 km di quota apparente e sbaglia più di quanto la correzione del guscio corregga (D47). Sono lo stesso difetto del punto 2, in un terzo e in un quarto esemplare.

### 2.6 Cosa dipinge davvero l'alone atmosferico, misurato

Questa sezione esiste perché una stesura precedente di D39 aveva **dedotto** cosa dipinge `atmosphere.ts` invece di guardarlo, e aveva dedotto il contrario del vero. Il fragment shader è stato **valutato**: stesso frustum (`fov` 38, 16:9), stessa geometria (`SphereGeometry(1,56, 64, 64)` con `side: BackSide`), stessa espressione `pow(1 − clamp(dot(n, v), 0, 1), 2.5) × 0,18`, su ~71 000 campioni di pixel per distanza.

```
   d      % pixel coperti   alpha min   alpha max   max dot(n,v)
10,000          9,28          0,18000     0,18000     −1,5e−2
 4,000         60,46          0,18000     0,18000     −9,0e−3
 3,002         93,63          0,18000     0,18000     −3,1e−3   ← "piena" secondo la vecchia D39
 2,715        100,00          0,18000     0,18000     −2,4e−2   ← il disco riempie l'inquadratura
 2,610        100,00          0,18000     0,18000     −2,8e−1   ← "zero pixel" secondo la vecchia D39
 2,000        100,00          0,18000     0,18000     −6,8e−1
 1,900        100,00          0,18000     0,18000     −7,2e−1
 1,560        100,00          0,18000     0,18000     −8,2e−1   ← la camera entra nella sfera
 1,550        100,00          0,18000     0,18000     −8,2e−1   ← il fondo corsa nuovo
```

Due fatti, e nessuno dei due è un'opinione:

1. **L'alpha non varia mai.** Minimo e massimo coincidono a `0,18000` a ogni distanza. Il `fresnel` di quel materiale è codice morto: con `BackSide` i soli frammenti disegnati sono quelli rivolti dall'altra parte rispetto alla camera, per tutti vale `dot(n, v) ≤ 0`, il `clamp(…, 0, 1)` lo porta a 0 e `pow(1 − 0, 2.5)` vale 1. **L'alone non è un bordo di lembo: è una velatura uniforme** su tutto il disco della sfera a 1,56.
2. **Alla distanza in cui la vecchia D39 lo portava a zero, copre il 100 % dell'inquadratura.** Il disco riempie lo schermo già a 2,715, cioè *prima* del 2,610 scelto come fine della dissolvenza. Non «zero pixel utili»: tutti i pixel.

E quanto pesa quella velatura su ciò che si vede. Al centro dell'inquadratura il globo è alla sua alpha minima — `mix(0,28, 0,94, …)` con `fresnel = 0`, cioè **0,28** (`globe.ts:61`) — quindi il 72 % di quel pixel è ciò che gli sta sotto:

```
con l'alone      rgb(68, 77, 93)
senza l'alone    rgb(10, 11, 21)   ← lo sfondo della pagina, #0a0a14
```

**L'alone non decora il globo: lo illumina.** Spegnerlo sotto 2,61, come la vecchia D39 prescriveva, avrebbe reso il globo indistinguibile dallo sfondo a ogni zoom in cui questo piano lavora. «Mantenere la stessa grafica» è il vincolo dell'utente e quella dissolvenza era la sua violazione più grossa.

Infine un numero che serve al Task 2 e che nessuno troverebbe leggendo: `SphereGeometry(1,56, 64, 64)` non è una sfera, è un poliedro, e la distanza minima dall'origine a una sua faccia è **1,557653**, non 1,56. Il fondo corsa a 1,55 ci sta dentro con **0,0077** unità di margine. Abbassare ancora il fondo corsa, o ridurre i segmenti della sfera, e un bordo di faccetta attraverserebbe lo schermo.

### 2.7 Le altre due cose che stanno sopra la superficie, e che nessuno aveva misurato

Il guscio degli aerei non è l'unica geometria sollevata dal suolo. Ce ne sono altre due, e **tutte e due sono più alte del guscio nuovo**: finché restano dove sono, portare gli aerei a scala vera non corregge niente, perché li porta sotto le cose sopra cui volano.

**L'arco di rotta.** `routeArc.ts:118` scrive `GLOBE_RADIUS + ARC_BASE_OFFSET + apex × sin(πt)` con `ARC_BASE_OFFSET = 0,018` e `apex = 0,012 + 0,055 × (ω/π)`: tre costanti assolute che non sanno niente dello zoom, esattamente come `altitudeToOffset` prima di D36. L'apice di un arco arriva quindi a `1,5 + 0,018 + 0,067 = 1,585`, cioè **sopra la camera** al fondo corsa nuovo. Misurato su tre rotte vere, con la camera a `d = 1,55` e l'arco al centro dell'inquadratura:

```
 rotta                        ω rad    NM      raggio apice   camera − apice   esito a d=1,55
 LHR→CDG   (corta)            0,05461    188     1,530956       +0,019044      DENTRO il near di 0,02: sparisce
 JFK→LHR   (lungo raggio)     0,86957  2 991     1,545224       +0,004776      DENTRO il near: sparisce
 MAD→AKL   (quasi antipodale) 3,07709 10 585     1,583871       −0,033871      DIETRO la camera
```

E non è solo un taglio: è una **separazione**. A `d = 1,55` il guscio nuovo porta un aereo di crociera a `1,502854` mentre il suo arco resta a `1,53`–`1,58`. I due si staccano, e si staccano **mentre si zooma**, perché uno scende con lo zoom e l'altro no.

**La linea di costa.** `continents.ts:24` la disegna a `GLOBE_RADIUS × 1,003`, cioè **0,0045 unità = 10,3 NM = 19,1 km di quota apparente**. È una volta e mezza l'intero guscio nuovo (0,003) e quattro volte e mezza il suo pavimento (0,001). Tradotto in pixel di scostamento al bordo dell'inquadratura, sulla stessa colonna di §2.2 e con lo stesso canvas da 800 px:

```
   d      cap NM    costa a R × 1,003     aereo a 38 000 ft, guscio NUOVO
10,00     4 885,7        0,54 px                  8,58 px
 3,00     1 298,5        2,25 px                  4,47 px
 1,90       321,5        5,68 px                  5,11 px
 1,55        39,6       41,24 px                 25,24 px     ← la costa sbaglia PIÙ della correzione
```

L'ultima riga è il punto. Al fondo corsa il terreno è spostato di **41 px** e l'aereo, già corretto, di 25: la correzione di D36 verrebbe interamente spesa a inseguire un errore più grande dell'errore che toglie. E posizionalmente l'aereo finirebbe **sotto** la costa: `1,502854 < 1,5045`.

**E la ragione di quell'1,003 è stata verificata, non supposta.** La supposizione naturale è lo z-fighting: una costa a `GLOBE_RADIUS` esatto compenetra la sfera e sfarfalla. In questa scena non può succedere, e non per poco:

```
 materiale                      depthWrite   depthTest
 globe.ts:67        globo          false        true   (default)
 atmosphere.ts:36   alone          false        true   (default)
 continents.ts:44   costa          false       FALSE
 trails.ts:87       scie           false       FALSE
 aircraft.ts:222    puntini        false        true
 routeArc.ts:165    arco           false       FALSE
```

**Nessun materiale della scena scrive la profondità**, quindi il depth buffer resta al valore di pulizia e ogni test passa: non c'è niente con cui litigare. E la costa in particolare ha `depthTest: false`, quindi non viene nemmeno testata — disegna sempre sopra, per `renderOrder`. **La ragione dello z-fighting non regge.**

Ne regge però un'altra, geometrica, che vale meno pixel ma vale davvero, e che nessuno troverebbe leggendo. La costa non è una curva: è una **spezzata di corde**, suddivisa da `continents.ts:64` a non più di 2° per segmento. Una corda di 2° su un raggio di 1,5 affonda sotto la sfera che campiona di

```
 1,5 × (1 − cos(1°)) = 0,000228457 unità = 0,524 NM = 0,970 km
```

e il globo è a sua volta un poliedro (`SphereGeometry(1,5, 128, 128)`), le cui facce stanno **dentro** la sfera ideale fino a 0,000452 ma i cui vertici ci stanno **sopra**. Una costa disegnata a `GLOBE_RADIUS` esatto passerebbe quindi fino a 0,000228 **dentro** il globo nel mezzo di ogni segmento. Oggi non si vedrebbe — `depthTest: false` — ma sarebbe comunque una costa che attraversa il pianeta, e il giorno in cui qualcosa in questa scena scrivesse la profondità diventerebbe visibile in silenzio.

Quindi il sollevamento resta — ma **non è quella saetta: è il suo punto fisso**, e la differenza è stata misurata invece che dedotta. `1,5 × (1 − cos 1°)` è l'affondamento di una corda disegnata su raggio `1,5`. La corda però non viene disegnata lì: viene disegnata su `1,5 + L`, dove la stessa corda affonda `(1,5 + L) × (1 − cos 1°)`, cioè `L × (1 − cos 1°)` **più** del sollevamento che le si è dato. Chiedere che il sollevamento copra il proprio affondamento è un'equazione, e ha una soluzione sola:

```
 L = (1,5 + L) × (1 − cos 1°)  ⟹  L = 1,5 × (sec 1° − 1) = 0,000228492
                                       1,5 × (1 − cos 1°) = 0,000228457
                  differenza = 1,5 × (1 − cos 1°)² / cos 1° = 0,0000000348
```

Trentacinque miliardesimi di unità: il secondo ordine di una correzione che agisce sul quarto decimale, ed è per questo che una stesura precedente non li ha visti. Ma non sono zero e il verso è quello sbagliato. Con `1,5 × (1 − cos 1°)`, **ogni** corda da 2° esatti ha il punto medio `3,48 × 10⁻⁸` **sotto** `GLOBE_RADIUS` — dentro al pianeta, che è precisamente la cosa che il sollevamento esiste per impedire. Con `1,5 × (sec 1° − 1)` quel punto medio cade su `GLOBE_RADIUS` **al bit**: misurato, scarto `2,2 × 10⁻¹⁶`, cioè un ulp di doppia precisione, e nessuna corda scende mai sotto.

E un secondo fatto, che non cambia la costante ma decide **come si scrive l'asserzione**: i vertici finiscono in un `Float32BufferAttribute`, e un ulp di Float32 a 1,5 vale **1,19 × 10⁻⁷** — tre volte e mezzo l'intero termine di secondo ordine. Un test che rilegge quel buffer non può misurare 3,5 × 10⁻⁸ in nessuna direzione: il bit che lo porterebbe non esiste. L'invariante esatto si enuncia in doppia precisione sulle due costanti, `(R + L) × cos(mezzo segmento) ≥ R`; il buffer si interroga con la tolleranza del proprio quanto. Sono due asserzioni in due posti, e il Task 2 Step 7b le scrive così.

In pixel il cambio di formula non si vede: al bordo 0,03 px alla vista pianeta contro 0,54, e 1,91 px al fondo corsa contro 41,24 — **19,7 volte più basso** di oggi, cioè `GLOBE_RADIUS × 1,000152`.

---

## 3. Decisioni di disegno prese qui, con la ragione

La numerazione riprende da D34 del Piano 2. D42 è un'estensione dichiarata di D15, non una regola che gli si affianca. **D36, D37, D46 e D47 sono le quattro condizioni senza le quali D35 affermerebbe il falso**: senza di loro il fondo corsa a 1,55 è una corsa verso uno schermo in cui gli aerei sono nel posto sbagliato (D36), tagliati (D37), senza la rotta che l'utente ha chiesto (D46) e sopra un terreno che sbaglia di più della correzione appena fatta (D47). Le ultime due sono arrivate al secondo giro di verifica, e sono lo stesso difetto di D36 in un terzo e in un quarto esemplare: una geometria sollevata dal suolo di una quantità assoluta, decisa quando la camera non poteva avvicinarsi tanto. **D39 era una quinta condizione e non lo è:** la sua premessa è stata misurata (§2.6) e si è rivelata falsa, e quello che ne resta è il divieto di toccare l'alone.

**D35 — Il fondo corsa scende da 1,9 a 1,55 unità, e il criterio è la separazione di due aerei reali, non un numero tondo.**
La domanda dell'utente è aritmetica: «devo poter zoomare finché questi si separano fra loro». Due aerei si separano quando la distanza fra i loro centri supera il diametro del simbolo, e si **leggono** come due quando la supera di un fattore due. Il metro non lo sceglie il gusto: lo sceglie l'aviazione. La separazione radar minima è **5 NM in rotta** e **3 NM in terminale**, e la seconda è il caso peggiore che esiste davvero. A 1,55 il cap è 39,6 NM, cioè 0,0989 NM/px su 800 px: 3 NM sono **30,3 px**, 2,2 diametri di un simbolo da 14. A 1,9, il fondo corsa di oggi, gli stessi 3 NM sono 3,7 px — un quarto del simbolo, cioè un puntino solo.
E 39,6 NM di raggio sono 79,2 NM — **147 km — di diametro inquadrato**: l'area metropolitana con i suoi aeroporti, che è la seconda metà della richiesta («almeno a grandezza che posso inquadrare l'aeroporto o una città»). La prima metà, l'aeroporto, è dichiarata non-obiettivo: vedi §6.
Quello che a 1,55 **non** si separa, detto qui e non scoperto dall'utente: due aerei a 1 NM stanno a 10,1 px e restano un puntino; e due aerei in attesa su uno stesso punto, separati solo di 1 000 ft in verticale, non si separano a nessuno zoom, perché la separazione è sull'asse che il globo non disegna. Nessuna riga di questo piano promette il contrario.
Il prezzo dichiarato: `pointSizePx` interpola sul logaritmo fra `CAMERA_NEAR_LIMIT` e `CAMERA_FAR_LIMIT`, quindi allungare la corsa in basso sposta tutta la curva. A 1,9 il simbolo passa da 14,0 a **13,2 px**; a 3,0 da 11,5 a 11,5. È uno 0,8 px su una distanza che nessuno guarda come fondo corsa: la corsa adesso finisce altrove. `MARKER_LABEL_MAX_DISTANCE`, che è `sqrt(NEAR × FAR)`, passa da 4,359 a **3,937** e si ricalcola da sé: il codice del Piano 2 è già scritto per questo.

**D36 — Sotto 1,675 l'esagerazione delle quote smette di essere una decorazione e diventa un errore di posizione. Il guscio si assottiglia con il logaritmo dello zoom, e alla vista pianeta resta IDENTICO a oggi, bit per bit.**
`altitudeToOffset` è una funzione della sola quota, ed è un'esagerazione di 26×: 38 000 ft diventano 303 km di quota apparente. Alla vista pianeta quell'esagerazione è il motivo per cui gli aerei si staccano dal lembo e si leggono, e **va lasciata esattamente dov'è**, perché «mantenere la stessa grafica» è un vincolo dell'utente, non una preferenza nostra. Ma al centro dell'inquadratura un guscio non produce nessun sollevamento visibile — un punto sull'asse della camera si proietta nello stesso pixel a qualunque raggio — e al bordo produce solo scostamento. **Più si stringe l'inquadratura, meno l'esagerazione mostra e più sposta.** A 1,9 sposta già 107,7 px.
Quindi il guscio diventa `shellThicknessUnits(cameraDistance)`, interpolato **geometricamente** fra 0,075 a `CAMERA_FAR_LIMIT` e 0,003 a `CAMERA_NEAR_LIMIT`, e la quota entra come frazione: `offset = shell(d) × (1/3 + 2/3 × altFrac)`. Quella scomposizione non è nuova: `0,025 + 0,05·u` **è** `0,075 × (1/3 + 2/3·u)`, la stessa riga scritta in un altro modo. A `d = 10,0` la funzione nuova restituisce 0,02500 a 0 ft e 0,07500 a 41 000 ft, cioè i valori di oggi: la vista pianeta non cambia di niente, e il test lo verifica come identità, non come approssimazione.
Lo 0,003 al fondo corsa non è scelto: 41 000 ft sono 12,497 km, su 6 371 km di raggio e 1,5 unità fanno **0,002942**. Lo 0,003 è l'1,02 × della scala vera. Al fondo corsa il guscio **non è più esagerato**, e lo scostamento residuo di 25 px al bordo del cap è la parallasse che un osservatore vero a quella distanza vedrebbe davvero: è geometria, non artefatto.
Quello che resta, detto: a 1,55 un aereo a 0 ft galleggia comunque a `shell/3` = 0,001 unità = 2,3 NM di quota apparente, cioè **8,5 px** di scostamento al bordo dell'inquadratura e 0 px al centro. Il pavimento resta perché un aereo a terra deve essere un punto **sopra** la linea di costa e non dentro, e perché toglierlo cambierebbe la vista pianeta — che è il vincolo.
Il costo per fotogramma è **negativo**. `Motion.radius` oggi è un numero congelato per batch; diventa `Motion.altFrac`, e il raggio si compone al disegno da uno `shell(d)` calcolato **una volta per fotogramma** (un `log`, un `pow`) più due moltiplicazioni per aereo. Zero chiamate trascendenti in più, contro le due per aereo che il dead reckoning già spende. Il Task 8 lo prova contando, non cronometrando.
E una cosa che va fatta **prima** di tutto il resto, perché senza di essa il resto fa danno: **dare alla formula una sola autorità.** Oggi non ce l'ha. `geoHelpers.altitudeToOffset` è la dichiarazione, ma la stessa riga — `GLOBE_RADIUS + 0.025 + (Math.max(0, altFt) / 41000) * 0.05` — è **inlinata altre due volte**: `src/globe/aircraft.ts:270` e `src/globe/trails.ts:202`, dentro due `writeLatLonAlt` privati che nessun indice nomina e che non chiamano `geoHelpers`. Sono **tre copie**, e la terza è quella che si vede: se il guscio si assottiglia nei puntini e non nelle scie, **ogni aereo si stacca dalla propria scia a ogni zoom** — 107,7 px di distacco a 1,9, 248 px a 1,7. È un difetto che nessun test di `geoHelpers` può vedere, perché i due file non passano da lì, e che `tsc` non può vedere, perché una formula ricopiata non è una chiamata.
L'inline va tenuto: è lì per non allocare un `Vector3` per punto, ed è la ragione giusta. Quello che non va tenuto è la **formula** dentro l'inline. `geoHelpers` esporta quindi `shellOffset(shellUnits, altFrac)` — `shellUnits × (1/3 + 2/3 × altFrac)`, quattro operazioni, nessuna trascendente — e `altitudeToOffset(altFt, d)` diventa `shellOffset(shellThicknessUnits(d), altitudeFraction(altFt))`. I due `writeLatLonAlt` ricevono lo spessore del fotogramma e chiamano `shellOffset`: restano senza allocazioni e smettono di avere un'opinione propria sul guscio. `scene.ts` calcola `shell` **una volta** e lo passa a tutti e due — due `shellThicknessUnits` nello stesso fotogramma sarebbero di nuovo due autorità.
Il test che lo vincola non guarda un valore, guarda i **file**: `tests/unit/globe/oneShellAuthority.test.ts` legge `src/globe/*.ts` e pretende che `41 000` compaia solo in `geoHelpers.ts`. Questo progetto ha già pagato tre volte per **due** copie di un numero (D24, D25, D37); qui ce n'erano tre.

**D37 — Il piano near della camera passa da 0,1 a 0,02 e il far da 100 a 20: il rapporto resta 1 000, quindi il depth buffer non perde un bit.**
A 1,55 la camera dista 0,047 dalla cima del guscio nuovo, 0,0498 dalla linea di costa portata a scala da D47 e 0,050 dalla superficie; l'apice dell'arco di rotta più bombato, dopo D46, sta a 0,0466. Un `near` di 0,1 taglierebbe tutte e quattro. 0,02 passa sotto la più vicina — l'apice dell'arco quasi antipodale, a 0,046645 — con un margine di **2,33 ×**. Il vincolo è verificato in due pezzi e in due task, perché le due geometrie nascono in due task: `cameraTravel.test.ts` (Task 1) lo verifica contro il guscio e contro la costa, `routeArc.test.ts` (Task 2) contro i tre archi misurati. E lo verifica contro un'altezza **calcolata**, non ricopiata: una stesura precedente di quel test scriveva `GLOBE_RADIUS * 1.003` a mano, che era la quarta copia dell'altezza della costa e sarebbe rimasta verde mentre D47 la spostava.
Abbassare il `near` da solo peggiorerebbe la precisione della profondità di un fattore 5; abbassare **anche** il `far` non la riporta soltanto a pari, la migliora. La camera non supera mai 10,0 e il globo si estende 1,5 oltre il centro, quindi 20 è oltre il doppio di quello che serve, e `100` era un letterale senza ragione. Rapporto oggi `100 / 0,1 = 1 000`; rapporto domani `20 / 0,02 = 1 000`, quindi la distribuzione della precisione lungo la scena è identica — e la risoluzione **assoluta** peggiore del depth buffer a 24 bit passa da `5,95 × 10⁻³` a `1,19 × 10⁻³` unità, cinque volte meglio di oggi. E comunque in questa scena nessun materiale scrive la profondità (`globe.ts:67`, `atmosphere.ts:36`, `continents.ts:44`, `routeArc.ts:165`, `trails.ts:87`, `aircraft.ts:222`), quindi il buffer è un'assicurazione per il giorno in cui qualcosa la scriverà, non un meccanismo attivo. I due numeri diventano `CAMERA_NEAR_PLANE` e `CAMERA_FAR_PLANE` in `geoHelpers.ts`, accanto alla corsa, perché un `near` che dipende dal fondo corsa e vive in un altro file è la terza copia di un vincolo che questo repo ha già pagato due volte (D24, D25).

**D38 — La priorità delle tile smette di dipendere dal fondo corsa: il server prioritizza SEMPRE la tile che copre il punto guardato, e il raggio decide solo quante altre.**
D24 del Piano 2 dice, parola per parola, che 1,9 «è il numero della griglia delle tile»: a 322 NM di cap restano 104 NM di margine sui 218,0 NM peggiori, e `tilesNear` nomina almeno una tile. A 39,6 NM quel margine è negativo. Ci sono due modi di cavarsela e uno solo è onesto.
Il modo disonesto è mandare al server un raggio più grande di quello inquadrato — dichiarare di guardare 230 NM mentre se ne guardano 39,6. Il raggio è l'unica cosa che il client dice al server su dove sta guardando, e gonfiarlo è esattamente la forma di D15 applicata a un protocollo invece che a uno schermo.
Il modo onesto è ammettere che la domanda giusta non è mai stata «quali centri di tile cadono entro il mio raggio» ma «**quale tile contiene quello che sto guardando**». `nearestCoveringTile(grid, centre)` restituisce la tile più vicina **il cui centro dista meno di `TILE_RADIUS_NM`**, cioè l'unica che copre davvero quel punto; e la garanzia dei 218,0 NM smette di essere un vincolo sulla camera e diventa la **dimostrazione** che quella funzione non torna mai a mani vuote sopra una regione coperta. Sopra il Pacifico centrale, dove non c'è nessuna tile entro 230 NM, torna `null` e il server non prioritizza niente — che è la verità, non un ripiego: lì non c'è dato da rinfrescare per nessun raggio.
Il server quindi fa l'unione: le tile dentro il raggio dichiarato, più quella che copre il centro se il raggio non l'ha già presa. `MAX_VIEW_RADIUS_NM` resta un tetto e non diventa mai un pavimento. Il commento di `geoHelpers.ts:5-21` va riscritto, non cancellato: la ragione per cui 1,9 era il fondo corsa resta vera **per il server di allora**, e la nota dice cosa è cambiato.

**D39 — L'alone atmosferico non si tocca. Non si spegne, non cambia opacità, e la camera gli passa dentro senza che si veda. La premessa della stesura precedente era falsa e §2.6 la misura.**
La stesura precedente diceva tre cose: l'alone è il **lembo** del pianeta; il lembo esce dall'inquadratura a `d = 1,5 / sin(35,08°) = 2,610`; quindi sotto quella distanza «dipinge zero pixel utili a qualunque opacità» e lo si può portare a zero con una dissolvenza. La prima è sbagliata, e le altre due cadono con lei.
**L'alone non è un lembo.** `atmosphere.ts:27-28` calcola `fresnel = 1 - clamp(dot(vNormalView, vViewDir), 0, 1)` e poi `pow(fresnel, 2.5)`. Con `side: BackSide` i soli frammenti disegnati sono quelli il cui normale esterno punta **via** dalla camera, e per tutti vale `dot(n, v) ≤ 0`: il `clamp` lo porta a 0, `1 − 0 = 1`, `pow(1, 2.5) = 1`. Quel `fresnel` è una costante. L'alpha che il materiale dipinge è `0,18` su **ogni** frammento, a **ogni** distanza — misurato su ~71 000 campioni di un frustum vero, minimo e massimo coincidenti a `0,18000` (§2.6). È una **velatura uniforme** sull'intero disco della sfera a 1,56, non un bordo.
**E il disco riempie l'inquadratura prima del 2,610, non dopo.** Il disco è quello della sfera a 1,56, non del globo a 1,5: riempie fino agli angoli già a `1,56 / sin(35,08°) = 2,715`. Alla distanza in cui la dissolvenza sarebbe arrivata a zero, l'alone copriva il **100 %** dei pixel.
**Spegnerlo non toglieva niente: toglieva tutto.** Il globo è disegnato con `alpha = mix(0,28, 0,94, pow(fresnel, 1.1))` (`globe.ts:61`) e al centro del disco quell'alpha vale 0,28, quindi il 72 % di ciò che si vede lì è lo sfondo più l'alone. Misurato al centro dell'inquadratura: **con** l'alone `rgb(68, 77, 93)`, **senza** `rgb(10, 11, 21)`, che è lo sfondo della pagina. L'alone non decora il globo, lo illumina. La dissolvenza avrebbe annerito il globo appena sotto 2,61 — a ogni zoom in cui questo piano lavora — e «vorrei mantenere la stessa grafica, lo stesso stile» è un vincolo dell'utente, non una preferenza nostra.
**E il guaio che la dissolvenza voleva prevenire non esiste.** Fra `d = 1,56`, dove la camera entra nella sfera, e `d = 1,55`, il fondo corsa, non cambia niente di visibile: dentro o fuori, ogni raggio dell'inquadratura attraversa quella superficie **una volta sola** — l'altra intersezione è dietro la camera, o è scartata dal culling — e riceve la stessa alpha costante. Copertura 100 % da entrambi i lati, alpha 0,18 da entrambi i lati, `max dot(n, v) ≈ −0,82` da entrambi i lati. Non c'è transizione da ammorbidire perché non c'è transizione.
**L'unico vincolo vero che il fondo corsa impone all'alone è di tassellazione**, e va dichiarato perché nessuno lo troverebbe: `SphereGeometry(1,56, 64, 64)` è un poliedro e il suo raggio interno è **1,557653**. La camera a 1,55 resta dentro con 0,0077 unità di margine. Abbassare ancora il fondo corsa, o ridurre i segmenti, e un bordo di faccetta attraversa lo schermo — in silenzio, come sempre.
Quello che questo piano fa all'alone, per intero: **niente**. `atmosphere.ts` non compare fra i file modificati di nessun task, `scene.ts` non guadagna nessuna riga sull'alone, e nessun `limbFadeOpacity` esiste. Il test del Task 2 non verifica una dissolvenza: verifica che **non ce ne sia una**, e che il contratto grafico di quel materiale — `BackSide`, `AdditiveBlending`, `depthWrite: false`, raggio `1,04 × GLOBE_RADIUS`, `renderOrder 0`, un solo uniform `uTime` — sia ancora quello che §2.6 ha misurato.

**D40 — La cartografia fine è Natural Earth 10m servita come binario di delta Int16 a corse contate, non come GeoJSON: 2,06 MB contro 12,67, e meno dei 2,94 MB di 50m che già spediamo.**
Il GeoJSON 10m pesa 13 287 234 byte. Spedirlo sarebbe esattamente il «far scaricare decine di MB» che il vincolo vieta. Ma quei 12,67 MB sono quasi tutti **sintassi e proprietà**: 137 campi per feature, di cui ne servono zero. La geometria sola, in delta Int16 a 1e-5 gradi — 1,1 m, due ordini di grandezza sotto il pixel al fondo corsa — è **2,06 MB**, e con la semplificazione a 0,0008° (89 m, mezzo pixel a 1,55) **1,91 MB**. Misurato, non stimato: 517 999 delta su 524 028 entrano in un Int16, e i 6 029 che non ci entrano sono punti assoluti.
La tolleranza non è scelta a occhio: è il punto in cui l'errore vale mezzo pixel al fondo corsa che D35 stabilisce (0,5 px × 0,0989 NM/px = 0,0494 NM = 0,00082°). E la tabella dice una cosa che vale la pena dichiarare invece di scoprirla dopo: **a quella soglia la semplificazione non serve quasi a niente** — tiene il 92 % dei punti. Al fondo corsa il dato 10m è già al limite del pixel, quindi il risparmio non può venire dal buttare punti: viene dalla **codifica**. Scendere a 0,012° (1,3 km) farebbe 0,68 MB ma con 7,3 px di errore, cioè metà simbolo: a quel punto la costa mente di più di quanto il livello 50m menta oggi.
E la codifica è **a corse contate, non a sentinelle.** Una prima stesura di questo formato marcava i punti assoluti con un tag `u8 = 0xFF` in testa, e lasciava al decodificatore il compito di distinguerli dai delta **sbirciando il primo byte**. Non si può: un punto delta comincia con il byte basso di `dLon`, quindi ogni `dLon` il cui byte basso vale `0xFF` produce esattamente quel byte. Sono **256 valori su 65 536**, e il più comune di tutti è `dLon = −1` — un metro e dieci verso ovest, il delta che una costa produce di continuo. Un decodificatore avrebbe letto 9 byte invece di 4, si sarebbe disallineato, e da lì in poi avrebbe disegnato una costa che non esiste **senza accorgersene**: D42 vista dal lato peggiore, non «il dato non è arrivato» ma «il dato è arrivato e mente». Né l'endianness salva — in big-endian il primo byte è quello alto e vale `0xFF` per ogni `dLon` fra −256 e −1. Il formato per intero, e il conto di cosa costa non sbagliarsi (+0,84 %), sono nel Task 4.
E il conto del bundle si chiude in attivo. `ne_50m_populated_places.geojson` — 3 350 885 byte che **nessuno legge** — esce e viene sostituito da un `cities.json` compatto di **84 178 byte**. Netto: −3 350 885 + 84 178 + 1 910 000 ≈ **−1,36 MB**. Il bundle diventa più piccolo mentre il globo diventa più dettagliato. Il file che esce è **tracciato da git**, quindi «esce» è un `git add` sul percorso cancellato e non un'intenzione: vedi §4 e il Task 4.

**D41 — Il livello fine si carica solo sotto una soglia di zoom e si disegna a secchi di 10°: al più 131 722 vertici in vista, MENO dei 186 010 che il livello 50m spinge oggi a ogni fotogramma.**
Un `LineSegments` da 1 039 866 vertici disegnato ogni fotogramma sarebbero 62 milioni di vertici al secondo per una costa di cui, a `d = 2,50`, l'**84,3 %** dei segmenti sta sotto il pixel. È lavoro pagato per non vedersi.
Il taglio è geografico e sfrutta una proprietà che `continents.ts` ha già: il livello è fatto di **segmenti indipendenti**, non di una polilinea, quindi partizionarlo non costa niente di strutturale. Ogni segmento va nel secchio di 10° × 10° del suo punto medio (il segmento medio è 1,368 NM: non c'è un secchio che ne contenga metà in modo significativo), ogni secchio non vuoto — ne restano 359 — diventa una `BufferGeometry` che condivide **un solo** `LineBasicMaterial`, e per fotogramma si decide `visible` con **un prodotto scalare** fra la direzione precalcolata del secchio e quella della camera. Zero trascendenti per fotogramma, 359 prodotti scalari — 21 540 al secondo, contro i 205 mila che il dead reckoning del Piano 2 considerava trascurabili.
Il limite superiore è pessimistico apposta — somma dei secchi **globalmente** più grandi, non di quelli davvero adiacenti — e vale 131 722 vertici a `d = 1,90`, 64 262 a `d = 1,55`. Contro 186 010 del livello 50m di oggi, che è l'intero pianeta a ogni fotogramma. **Il globo diventa più dettagliato e insieme più leggero.** 5° farebbe 100 094 ma con 954 oggetti di scena invece di 359: il guadagno non vale il triplo di oggetti, e il numero che conta — il limite a 1,90, dove avviene lo scambio — sta sotto 186 010 in entrambi i casi.
La soglia dello scambio è 1,90, ed è misurata: il segmento medio del 50m vale 7,03 px lì e 11,3 px a 1,75 — oltre quello una costa smette di leggersi come una costa e si legge come un poligono, che è letteralmente ciò che l'utente vede adesso. Sopra 1,90 il 10m sarebbe per il 43 % e più sotto il pixel. Il download parte a **2,60** — prima che serva, perché 1,91 MB a 10 Mbit/s sono 1,6 s e la costruzione a blocchi ne prende altri 0,25 — e lo scambio è una dissolvenza incrociata di **300 ms**, la stessa finestra editoriale di `FOCUS_FADE_MS` e `RECONCILE_MS`, sull'orologio di `requestAnimationFrame`. Quello che l'utente vede durante lo scambio sono due contorni delle stesse coste, uno più mosso dell'altro, mai un buco.
La costruzione è a blocchi di **64 000 vertici per fotogramma**: 0,0626 µs per vertice misurati, quindi 4,0 ms a blocco, quindi 15 fotogrammi — 0,25 s — per 960 040 vertici. Un'unica passata da 65,1 ms sarebbe stata quattro fotogrammi saltati nel momento esatto in cui l'utente sta zoomando.

**D42 — (estensione di D15) Se il dettaglio non arriva, lo schermo NON mostra un mondo più povero fingendo che sia tutto: lo dice.**
D15 ha chiuso la famiglia «lo schermo dichiara più di quanto disegna». Questa è la stessa famiglia vista dall'altro lato: **lo schermo disegna meno di quanto il piano promette e non lo dice**. Un utente a `d = 1,60` davanti a una costa poligonale non ha modo di distinguere «il livello fine non è arrivato» da «il livello fine è questo».
E il buco esiste già, oggi, prima di questo piano: `scene.ts:116` cattura il fallimento di `loadContinents` con un `console.warn` e basta. Se `ne_50m_admin_0_countries.geojson` non arriva — un 404 dopo un deploy, una rete che cade — il globo resta **senza un contorno al mondo e senza una parola**. Questo piano lo chiude insieme agli altri due.
Il meccanismo è lo stesso dei contatori del Piano 3: uno stato dichiarato, letto da chi disegna e da chi parla, mai due opinioni. `useDetailStore` tiene `coastline: 'none' | 'coarse' | 'loading' | 'fine' | 'coarse-only'` e `cities: 'absent' | 'ready' | 'unavailable'`, e `FeedStatus` — che è già `role="status" aria-live="polite"` — stampa la riga che manca. `'coarse-only'` è lo stato in cui il fine è stato **chiesto e non è arrivato**, e si distingue da `'coarse'`, in cui non è stato ancora chiesto perché lo zoom non lo richiede: due fatti diversi, due parole diverse. È D15b.

**D43 — I nomi delle città escono per SCALERANK, in ordine di LABELRANK, al più 24 insieme, e non si sovrappongono fra loro.**
«Il nome della città non esce quando sono troppo fuori, però man mano mi avvicino esce» è, parola per parola, la descrizione di `SCALERANK`: Natural Earth lo mette lì per dire **a quale scala di mappa un luogo merita di comparire**, e inventarsi una soglia sulla popolazione sarebbe rifare peggio un lavoro già fatto da cartografi. L'array si ordina **una volta sola, in fase di build**, per `(SCALERANK, LABELRANK, −POP_MAX)`, e la scala diventa un prefisso: scorrere i primi N elementi È la selezione.
La scala è tarata sui conteggi peggiori misurati in §2.4, non su un'intuizione, e il metro è il raggio inquadrato in NM — la grandezza fisica — non la distanza della camera:

```
  cap > 1 400 NM        nessuna etichetta      (a 227 NM per etichetta, il puntino è 1 px)
  700 < cap ≤ 1 400     SCALERANK ≤ 1          peggiore misurato: 15 candidate
  350 < cap ≤   700     SCALERANK ≤ 2          peggiore misurato: 31
  140 < cap ≤   350     SCALERANK ≤ 4          peggiore misurato: 26
        cap ≤   140     tutte                  peggiore misurato: 11
```

Il tetto è **24 etichette**, e non è il numero di DOM che il browser regge — ne reggerebbe mille — è il numero oltre il quale una mappa smette di essere leggibile. La non-sovrapposizione è avida sull'ordine già stabilito: si accetta un'etichetta se il suo riquadro di 70 × 16 px con 4 px di margine non interseca nessuno dei riquadri già accettati, al più 276 test di intersezione per fotogramma. I marcatori D/A entrano fra i riquadri già accettati con **priorità assoluta**, perché quelli sono la rotta che l'utente ha chiesto e una città non la può coprire.
Lo stile lo decide `styles.css`, non questo piano: stessa famiglia, stesso `font-size: 11px`, stesso `letter-spacing: 0.06em`, stessa `text-shadow` di `.marker__label` — e `--color-body-muted` (#cccccc, **12,0 : 1** su #0a0a14) invece del blu dei marcatori, perché una città è geografia e un marcatore è una rotta, e i due non devono poter essere confusi. Le etichette sono `aria-hidden="true"`: non sono comandi, non si cliccano, e annunciarne 24 in una regione live sarebbe rumore sopra un pannello che già parla.
Il costo per fotogramma è **zero trascendenti**: la direzione unitaria di ogni luogo si calcola una volta al caricamento — 1 251 × 4 = 5 004 chiamate, una tantum — e per fotogramma restano due prodotti scalari per candidata (lato vicino, dentro il cap) e una proiezione per quelle che passano. Riproiettare lat/lon a ogni fotogramma, come fa `projectMarker` per due marcatori, costerebbe 96 trascendenti per fotogramma: con due marcatori è nulla, con 24 etichette su 1 128 candidate sarebbe uno spreco che si sceglie di non fare.

**D44 — Le etichette non evitano gli aerei, e il piano lo dichiara invece di provarci.**
Evitare gli aerei vorrebbe dire interrogare fino a 24 000 punti per fotogramma con una griglia in spazio schermo che nessun test può fissare, per un guadagno che il disegno risolve da sé: l'etichetta sta **sotto** i puntini nell'ordine di disegno, quindi dove si incontrano vince l'aereo, che è l'ordine di importanza giusto. Un utente non perde mai un aereo per colpa di un nome di città. Perde, ogni tanto, una lettera di un nome — e questo è il prezzo, detto qui.

**D45 — Il file delle città esce dal bundle verbatim ed entra compatto, e paga per intero il livello fine.**
`ne_50m_populated_places.geojson` sono 3 350 885 byte di cui servono sei campi su 137, ed è elencato da `git ls-files public/data`. Il `cities.json` costruito da `scripts/build-static-data.mjs` — stessi 1 251 luoghi, `{n, s, l, p, lat, lon}`, coordinate a 4 decimali (11 m, un decimo del pixel al fondo corsa), già ordinato per la scala di D43 — pesa **84 178 byte**, 25 071 in gzip. Il GeoJSON verbatim non viene più scritto in `public/data/`: lo script lo scarica, lo trasforma e tiene solo il risultato, che è esattamente ciò che fa già per `airports.json` e `airlines.json`.

**D46 — (condizione di D35, come D36 e D37) L'arco di rotta scende sul guscio insieme ai puntini. Le sue tre costanti assolute diventano tre FRAZIONI del guscio, e alla vista pianeta l'arco resta identico a oggi bit per bit.**
D36 ha tolto l'esagerazione al guscio degli aerei e ha lasciato dov'era la geometria dell'arco, che è fatta della stessa sostanza: `routeArc.ts:37-40` dichiara `ARC_BASE_OFFSET = 0,018`, `ARC_APEX_MIN = 0,012`, `ARC_APEX_RANGE = 0,055`, tre numeri assoluti che non sanno niente dello zoom. Il prezzo misurato è in §2.7 e sono due cose, non una.
**La prima è che l'arco sparisce.** A `d = 1,55` l'apice di una rotta corta (LHR→CDG, ω = 0,0546) sta a **0,019044** dalla camera, cioè dentro il piano near di 0,02; quello di un lungo raggio (JFK→LHR, ω = 0,8696) a **0,004776**, molto più dentro; e quello di una rotta quasi antipodale (MAD→AKL, ω = 3,0771) a **−0,033871**, cioè **dietro** la camera. Un utente che chiede di essere portato su un volo, al massimo zoom, vedrebbe il volo e non la sua rotta — e nessun errore, nessun avviso, niente in `FeedStatus`: D15 vista dal lato peggiore.
**La seconda è che l'arco si separa dal volo.** Anche dove non viene tagliato, un arco che resta a `1,53`–`1,58` mentre il suo aereo scende a `1,5029` è un arco che si stacca dal proprio aeroplano **mentre si zooma**, con lo stesso meccanismo per cui le scie si sarebbero staccate dai puntini se `trails.ts` fosse rimasto fuori dal Task 2. È lo stesso difetto, in un terzo esemplare.
La riparazione è la stessa di D36 e per la stessa ragione: la **forma** dell'arco resta, la sua **scala** smette di essere assoluta. I tre numeri diventano frazioni dello spessore del guscio — `0,018/0,075 = 0,24`, `0,012/0,075 = 0,16`, `0,055/0,075 = 11/15` — e `geodesicPoints` prende lo `shellUnits` del fotogramma, lo stesso numero che ricevono i puntini e le scie. A `CAMERA_FAR_LIMIT` lo spessore vale 0,075 e i tre prodotti tornano `0,018`, `0,012` e `0,055` **esattamente**, non per approssimazione: in doppia precisione `0,075 × 0,24 === 0,018` è vero, e il test lo verifica con `===` e non con `toBeCloseTo`. La vista pianeta non cambia di un bit, che è il vincolo.
Al fondo corsa i tre casi misurati diventano `0,048762`, `0,048191` e `0,046645` dalla camera: nessuno sotto il `near` di 0,02, il peggiore con **2,33 ×** di margine. E il rapporto fra l'offset dell'arco e lo spessore del guscio è lo **stesso a ogni distanza** — è questa, e non una soglia, la proprietà che impedisce al volo e alla sua rotta di separarsi, ed è questa che il test fissa.
Quello che l'arco **non** condivide con i puntini è la `shellOffset` di D36: il suo pavimento è `0,24` dello spessore, sotto il `1/3` del guscio degli aerei, perché un arco deve passare **sotto** l'aeroplano che lo percorre e sopra la costa. Due forme diverse sullo stesso spessore, una sola autorità sullo spessore. Il commento di `routeArc.ts:36` — «Just clear of the surface, and of the continent hairlines at R × 1.003» — va riscritto, perché dopo D47 quella costa non è più lì.

**D47 — (condizione di D36) La linea di costa scende da R × 1,003 a R × 1,000152, e il numero non è scelto: è il sollevamento di cui la corda più lunga che la suddivisione ammette ha bisogno al raggio su cui viene disegnata.**
`continents.ts:24` disegna la costa a `GLOBE_RADIUS × 1,003`, cioè **0,0045 unità = 10,3 NM = 19,1 km di quota apparente**: una volta e mezza l'intero guscio nuovo e quattro volte e mezza il suo pavimento. Al fondo corsa quella costa è spostata di **41,24 px** al bordo dell'inquadratura, contro i 25,24 px di un aereo a 38 000 ft già corretto da D36. **Correggere gli aerei sopra un terreno sbagliato di più della correzione non corregge niente**, e posizionalmente è peggio di niente: a `d = 1,55` un aereo di crociera sta a 1,502854 e la costa a 1,5045, cioè l'aereo è disegnato **sotto** la costa su cui vola. Che si veda comunque — `renderOrder` 3 contro 2 — non lo rende vero.
**La ragione di quell'1,003 è stata verificata, e quella che tutti si aspettano non regge.** Lo z-fighting in questa scena non è improbabile: è impossibile. Nessuno dei sei materiali scrive la profondità (§2.7), quindi il depth buffer resta al valore di pulizia e ogni test passa; e la costa ha per di più `depthTest: false`, quindi non viene nemmeno testata. Non c'è niente con cui litigare.
**Ne regge però un'altra, e va dichiarata perché è l'unica che decide il numero.** La costa non è una curva, è una spezzata di corde: `continents.ts:64` suddivide ogni segmento a non più di 2°, e una corda di 2° su raggio 1,5 affonda `1,5 × (1 − cos 1°) = 0,000228457` sotto la sfera che campiona. Il globo è a sua volta un poliedro i cui **vertici** stanno sulla sfera ideale, quindi una costa a `GLOBE_RADIUS` esatto attraverserebbe il pianeta nel mezzo di ogni segmento. Invisibile oggi, visibile il giorno in cui qualcosa scriverà la profondità — e in silenzio, come sempre.
Il valore più piccolo che soddisfa quella ragione **non è quella saetta: è il suo punto fisso**, perché la corda non viene disegnata su `GLOBE_RADIUS` ma su `GLOBE_RADIUS + L`, dove affonda `L × (1 − cos 1°)` di più. L'equazione `L = (R + L)(1 − cos)` dà `L = R × (sec − 1) = 0,000228492`, cioè `3,48 × 10⁻⁸` sopra la saetta — e con la saetta nuda **ogni corda da 2° esatti resta sotto `GLOBE_RADIUS`**, che è l'unica cosa che questa decisione doveva impedire (§2.7, misurato su 20 corde su 20). Si scrive quindi come formula e non come cifra: `COASTLINE_LIFT = GLOBE_RADIUS × (1 / cos(COASTLINE_MAX_SEGMENT_DEG/2) − 1)`. Due conseguenze volute. La prima: se qualcuno un giorno cambia la suddivisione, il sollevamento lo segue da sé invece di restare indietro. La seconda: il livello fine del Task 5 **non** può scegliersene uno suo, perché importa lo stesso, e per lo stesso motivo deve rispettare la stessa suddivisione — due coste a due altezze diverse si sdoppierebbero durante la dissolvenza incrociata di D41.
Quanto cambia la vista pianeta: **0,54 px → 0,03 px** di scostamento al bordo estremo dell'inquadratura, zero al centro. Mezzo pixel al lembo, su un contorno largo un pixel, è l'unica differenza che D47 produce dove l'utente ha chiesto di non cambiare niente — e va dichiarata invece che taciuta. Al fondo corsa, dove il piano lavora, sono 41,24 px → 1,91 px.
Il sollevamento resta inoltre **sotto** le due cose che gli devono stare sopra, a ogni distanza: il pavimento del guscio (0,001 al fondo corsa, 0,025 alla vista pianeta) e la base dell'arco di D46 (0,00072 al fondo corsa). Un aereo a terra resta un punto **sopra** la linea di costa, che era la ragione del pavimento di D36.
`GLOBE_RADIUS × 1,003` non è una costante dichiarata: è un letterale dentro una funzione, e compare anche in un commento di `routeArc.ts` e in un test del Task 1. Diventa una costante sola in `geoHelpers.ts`, accanto a `GLOBE_RADIUS` e ai piani della camera, perché un'altezza del terreno da cui dipende il piano near e che vive in un altro file è la copia che questo repo ha già pagato tre volte (D24, D25, D37).

---

## 4. Global Constraints

- **Nessun dato inventato.** Un campo sconosciuto è `null` e l'interfaccia tace. In questo piano la regola ha una forma nuova: **il client non gonfia mai il raggio che dichiara al server** per far tornare una priorità (D38), e un livello cartografico che non è arrivato non si fa passare per quello che c'è (D42).
- **Le durate si misurano con un orologio monotono.** La dissolvenza di 300 ms fra i due livelli cartografici e il budget di 4,0 ms per blocco di costruzione usano il timestamp di `requestAnimationFrame`. `Date.now()` salta di ~528 ms ogni ~32 s su questa macchina.
- **L'invariante D15 vale integra**, e D42 la estende. Ogni livello di dettaglio che non si disegna passa da `useDetailStore` e finisce in una riga di `FeedStatus`. Un `catch` muto che scrive su `console.warn` è un difetto di piano, non un dettaglio di implementazione — e ce n'è già uno, a `scene.ts:116`.
- **Due programmi TypeScript.** `tsconfig.json` (`Bundler`) per il client: alias `@/`, niente estensioni. `tsconfig.server.json` (`NodeNext`) per il server: percorsi relativi con suffisso `.js`, **mai `@/`**. `src/data/sources/tileGrid.ts` è compilato da **entrambi**: `nearestCoveringTile` si aggiunge lì con import relativi `.js`, come `tilesNear`.
- **`noUnusedLocals` è attivo, e nessun parametro nuovo prende un default.** Il parametro `cameraDistance` aggiunto a `altitudeToOffset` e a `latLonAltToVec3`, e il parametro `shellUnits` aggiunto a `positionAt`, a `TrailsLayer.update`, a `geodesicPoints` e a `RouteArcLayer.update` sono errori di compilazione finché ogni chiamante non li passa: è il compilatore che trova i chiamanti, non una `grep`. Un valore di default li renderebbe comodi e **invisibili**, ed è esattamente il contrario di quello che serve qui — un chiamante che non è stato guardato è un pezzo di schermo rimasto sul guscio vecchio.
- **Ma il compilatore non trova le copie inlinate, ed è lì che sta il guaio.** `aircraft.ts:270` e `trails.ts:202` non *chiamano* `altitudeToOffset`: ne riscrivono la formula a mano dentro due `writeLatLonAlt` privati. `tsc` resta verde mentre il guscio si sdoppia, e lo schermo mostra aerei staccati dalle proprie scie. Per quelle due copie serve un test che legge i file invece di compilarli: `tests/unit/globe/oneShellAuthority.test.ts` (D36).
- **`npm run build` non type-checka il server.** Verificare sempre con `npm run build:all`.
- **Nessuna richiesta di rete verso adsbdb, adsb.lol o adsb.fi**, né mentre si scrive né mentre si verifica. `scripts/build-static-data.mjs` scarica da Natural Earth, OpenFlights e OurAirports ed è l'unico file che lo fa; gli E2E intercettano `/api/states` e `/data/*` con `page.route()`.
- **`scripts/build-static-data.mjs` è `.mjs`, ma non è più isolato.** Da questo piano gira sotto `tsx` — come `scripts/build-route-cache.mjs`, che alla riga 28 importa `src/data/sources/tileGrid.js` — e **importa** `src/globe/coastlineCodec.js` invece di ricopiarne il formato. Un formato binario allineato a mano sarebbe la quarta copia di un numero in un repo che ne ha già pagate tre, e sarebbe la copia peggiore: un disallineamento non darebbe un errore, darebbe una costa sbagliata. Restano nello script solo le costanti che il client non legge mai — `COASTLINE_TOLERANCE_DEG` — e `USER_AGENT` (righe 13-16), che resta allineato a mano perché quello è un valore, non una struttura.
- **Una riga `git add` che nomina un percorso inesistente non è un refuso: è un commit che non avviene.** `git add` su un pathspec che non corrisponde a niente stampa `fatal: pathspec … did not match any files` ed **esce con 1**, quindi ogni `&& git commit` che segue non viene eseguito e il task finisce con l'albero sporco e il lavoro fuori dal repo. Una stesura precedente ne aveva due nello stesso task — `tests/unit/data/tileGrid.test.ts`, che è `tests/unit/data/sources/tileGrid.test.ts` scritto una directory troppo in alto, e `tests/unit/server/viewPriority.test.ts`, dichiarato nuovo e creato da nessuno step. Per questo ogni task che mette in staging un file che non esiste ancora lo fa creare da uno step **numerato**, e il Task 3, che ne aveva due, verifica con un `ls -1` prima di aggiungere.
- **Mai `git add -A` né `git add .`.** Questo working tree ha percorsi non tracciati e non ignorati — `.agents/`, `.claude/`, `mockups/`, `skills-lock.json`. Ogni commit elenca i propri file uno per uno, **compresi quelli generati**: `public/data/` non è in `.gitignore` e `airports.json` e `airlines.json` sono tracciati, quindi `coastline-10m.bin` e `cities.json` non entrano da soli.
- **Una cancellazione si mette in staging come una modifica.** `public/data/ne_50m_populated_places.geojson` è tracciato — `git ls-files public/data` lo elenca — e il Task 4 smette di scriverlo. Finché nessuno fa `git add` su **quel percorso**, il file resta nel repo e nel bundle, e il piano dichiarerebbe un risparmio di 3,2 MB che non è avvenuto. `git add -- <percorso cancellato>` mette in staging la cancellazione: è lo stesso comando, sullo stesso percorso, e va scritto.
- **Ogni task chiude con il proprio `git status --porcelain` vuoto** sui percorsi che ha toccato, e il comando sta nel task. Non è una buona intenzione: è il difetto di cucitura che questo progetto ha pagato **cinque volte**, e guardare non è bastato nessuna delle cinque: il Task 8 Step 4 lo confronta con uno script.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy è una decisione dell'utente.
- Messaggi di commit in inglese. Commenti in inglese, e un commento dice **perché**, citando la misura o il guasto, mai cosa fa la riga sotto.

**Stato di partenza del cancello:** `npm test -- --run` → **637 passed** (61 file, misurato il 2026-11-22 dopo `3c689bd`); `npm run test:e2e` → **20 passed**; `npm run build:all` pulito. Ogni task dichiara il numero atteso dopo di sé.

---

### Task 1: L'aritmetica del fondo corsa, del guscio e del piano near

Quattro numeri che si tengono per mano: non si può abbassare il fondo corsa senza assottigliare il guscio, non si può assottigliare il guscio senza che la camera abbia un `near` che ci passi sotto, e non si può mettere il `near` lì sotto senza sapere a che altezza sta il terreno — che oggi è più alto del guscio corretto (D47). Tutti e quattro sono costanti o funzioni pure in `geoHelpers.ts`, fuori da ogni ciclo di disegno, perché una soglia che vive solo a 60 fps è invisibile a chi la rompe — la stessa ragione per cui `pointSizePx` non sta dentro il vertex shader (D23).

**Files:**
- Modify: `src/globe/geoHelpers.ts` — la corsa, il guscio, i due piani della camera, l'altezza della costa
- Modify: `src/globe/airportMarkers.ts` — **solo un commento**: la riga 31 scrive «1,9 to 10,0» e il 1,9 smette di esistere in questo task. `MARKER_LABEL_MAX_DISTANCE` si ricalcola da sé e il codice non si tocca (Step 6c)
- Test: `tests/unit/globe/cameraTravel.test.ts` (nuovo), `tests/unit/globe/geoHelpers.test.ts` (esteso), `tests/unit/globe/pointSize.test.ts` (corretto), `tests/unit/globe/cameraTurn.test.ts` e `tests/unit/globe/focusCamera.test.ts` (adeguati) — questi due sono arrivati su `main` con il commit `3c689bd`, chiamano `latLonAltToVec3` con tre argomenti, e li elenca il comando dello Step 4, non la memoria di chi scrive

**Interfaces:**
- Produces: `CAMERA_NEAR_LIMIT = 1.55`, `CAMERA_FAR_LIMIT = 10.0`, `CAMERA_NEAR_PLANE = 0.02`, `CAMERA_FAR_PLANE = 20`, `shellThicknessUnits(cameraDistance: number): number`, `shellOffset(shellUnits: number, altFrac: number): number`, `altitudeToOffset(altFt: number, cameraDistance: number): number`, `latLonAltToVec3(lat, lon, altFt, cameraDistance): Vector3`, `altitudeFraction(altFt: number): number`, `COASTLINE_MAX_SEGMENT_DEG = 2.0`, `COASTLINE_LIFT` (D47)
- Lascia intatti, e il Task lo verifica: `GLOBE_RADIUS`, `latLonToVec3`, `vec3ToLatLon`, `visibleCapRadiusNm`, `isInView`, `isOnNearSide`
- Consumes: `visibleCapRadiusNm` (invariata)
- **Questo task non tocca `continents.ts`**: dichiara soltanto il numero che quel file consumerà nel Task 2. Un Task 1 che spostasse la costa farebbe fallire il proprio stesso cancello, perché `continents.ts` non è nella sua riga `git add`.

- [x] **Step 1: Creare `tests/unit/globe/cameraTravel.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_FAR_PLANE,
  CAMERA_NEAR_LIMIT,
  CAMERA_NEAR_PLANE,
  COASTLINE_LIFT,
  COASTLINE_MAX_SEGMENT_DEG,
  GLOBE_RADIUS,
  altitudeFraction,
  altitudeToOffset,
  isInView,
  isOnNearSide,
  latLonToVec3,
  shellOffset,
  shellThicknessUnits,
  vec3ToLatLon,
  visibleCapRadiusNm,
} from '@/globe/geoHelpers';

/**
 * The viewport every NM/px figure in the plan is taken on: 800 CSS px of
 * canvas height, a laptop once the browser chrome is gone. visibleCapRadiusNm
 * returns the cap that spans HALF the viewport height, so the divisor is 400.
 * A taller viewport has more pixels for the same cap and is strictly better.
 */
const HALF_VIEWPORT_PX = 400;
const FOV = 38;

function nmPerPixel(d: number): number {
  return visibleCapRadiusNm(d, FOV) / HALF_VIEWPORT_PX;
}

/** The symbol diameter at the near end — aircraft.ts POINT_PX_NEAR. */
const SYMBOL_PX = 14;

describe('the near end of the travel is chosen by separation, not by a round number', () => {
  it('turns the terminal radar minimum into two readable dots', () => {
    // 3 NM is the tightest horizontal separation that exists in controlled
    // airspace. Two dots read as two when their centres are more than two
    // diameters apart; at 1,9 the same 3 NM was 3,7 px against a 14 px
    // symbol, which is one dot (§2.5.1).
    const px = 3 / nmPerPixel(CAMERA_NEAR_LIMIT);
    expect(px).toBeGreaterThan(SYMBOL_PX * 2);
  });

  it('separates the en-route minimum with room to spare', () => {
    expect(5 / nmPerPixel(CAMERA_NEAR_LIMIT)).toBeGreaterThan(SYMBOL_PX * 3);
  });

  it('does NOT claim to separate one nautical mile', () => {
    // Said out loud so nobody discovers it on the globe: at the bottom of
    // the travel two aircraft 1 NM apart are 10,1 px apart and still one
    // dot. Zoom stops here for reasons D35 states; it does not stop because
    // everything is separated (D35).
    expect(1 / nmPerPixel(CAMERA_NEAR_LIMIT)).toBeLessThan(SYMBOL_PX);
  });

  it('frames a city, which is the other half of what was asked for', () => {
    // 39,6 NM of radius is 79,2 NM — 147 km — across: a metropolitan area
    // with its airports. The airport scale itself is a declared non-goal.
    const capNm = visibleCapRadiusNm(CAMERA_NEAR_LIMIT, FOV);
    expect(capNm).toBeLessThan(60);
    expect(capNm).toBeGreaterThan(25);
  });
});

describe('the altitude shell thins with the zoom and never moves at planet view', () => {
  it('is bit-for-bit what it was at the far end of the travel', () => {
    // The whole point of the taper: "keep the same graphics" is the user's
    // constraint, so planet view must not change at all. 0,025 + 0,05·u IS
    // 0,075 × (1/3 + 2/3·u), the same line written differently (D36).
    expect(altitudeToOffset(0, CAMERA_FAR_LIMIT)).toBeCloseTo(0.025, 10);
    expect(altitudeToOffset(41_000, CAMERA_FAR_LIMIT)).toBeCloseTo(0.075, 10);
    expect(altitudeToOffset(38_000, CAMERA_FAR_LIMIT)).toBeCloseTo(
      0.025 + (38_000 / 41_000) * 0.05,
      10
    );
  });

  it('reaches true scale at the near end', () => {
    // 41 000 ft is 12,497 km; over 6 371 km of Earth radius and 1,5 world
    // units that is 0,002942. At the bottom of the travel the shell is no
    // longer an exaggeration at all — it is the thing itself.
    const trueOffset = ((41_000 * 0.0003048) / 6371) * GLOBE_RADIUS;
    const shown = altitudeToOffset(41_000, CAMERA_NEAR_LIMIT);
    expect(shown / trueOffset).toBeGreaterThan(0.9);
    expect(shown / trueOffset).toBeLessThan(1.2);
  });

  it('never grows as the camera comes in', () => {
    let previous = Infinity;
    for (let d = CAMERA_FAR_LIMIT; d >= CAMERA_NEAR_LIMIT; d -= 0.05) {
      const here = shellThicknessUnits(d);
      expect(here).toBeLessThanOrEqual(previous + 1e-12);
      previous = here;
    }
  });

  it('clamps outside the travel instead of extrapolating', () => {
    expect(shellThicknessUnits(0)).toBe(shellThicknessUnits(CAMERA_NEAR_LIMIT));
    expect(shellThicknessUnits(1e6)).toBe(shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(Number.isFinite(shellThicknessUnits(Number.NaN))).toBe(true);
  });

  it('keeps the camera outside the shell at every distance it can reach', () => {
    // At 1,9 with the OLD shell the camera cleared the top by 0,325; at
    // 1,675 the near plane touched it and at 1,575 the camera was INSIDE
    // it — a 41 000 ft aircraft under the camera would have been BEHIND it
    // (§2.5.3). That is what this assertion exists to prevent.
    for (let d = CAMERA_NEAR_LIMIT; d <= CAMERA_FAR_LIMIT; d += 0.05) {
      const top = GLOBE_RADIUS + altitudeToOffset(41_000, d);
      expect(d - top).toBeGreaterThan(CAMERA_NEAR_PLANE);
    }
  });

  it('turns a quota into a fraction once, so the draw loop composes instead of computing', () => {
    expect(altitudeFraction(0)).toBe(0);
    expect(altitudeFraction(41_000)).toBe(1);
    expect(altitudeFraction(82_000)).toBe(1);
    expect(altitudeFraction(-500)).toBe(0);
    // The identity the renderer relies on (D36).
    for (const ft of [0, 9_000, 31_000, 41_000]) {
      for (const d of [CAMERA_NEAR_LIMIT, 3.0, CAMERA_FAR_LIMIT]) {
        expect(shellThicknessUnits(d) * (1 / 3 + (2 / 3) * altitudeFraction(ft))).toBeCloseTo(
          altitudeToOffset(ft, d),
          12
        );
      }
    }
  });
});

describe('the camera planes keep the depth buffer exactly as precise as it was', () => {
  it('passes under the closest thing the camera can approach', () => {
    // At the near end the surfaces are the shell top (0,047 away), the
    // coastline (0,0498 after D47) and the globe itself (0,050). The route
    // arc's apex is nearer still at 0,0466, and it is checked in Task 2's
    // routeArc.test.ts, where the arc learns about the shell (D46) — this
    // module has no opinion about arcs and must not grow one.
    //
    // COASTLINE_LIFT, not `GLOBE_RADIUS * 1.003` written out here. An
    // earlier draft of this test spelled that factor by hand, which made it
    // the FOURTH place the coastline's height was stated — and the one that
    // would have stayed green while D47 moved the other three.
    const closest = Math.min(
      CAMERA_NEAR_LIMIT - (GLOBE_RADIUS + altitudeToOffset(41_000, CAMERA_NEAR_LIMIT)),
      CAMERA_NEAR_LIMIT - (GLOBE_RADIUS + COASTLINE_LIFT)
    );
    expect(CAMERA_NEAR_PLANE).toBeLessThan(closest / 2);
  });

  it('keeps the far/near ratio at 1 000, which is what depth precision is made of', () => {
    // Lowering near alone would cost a factor five of depth resolution.
    // 100/0,1 was 1 000; 20/0,02 is 1 000 (D37).
    expect(CAMERA_FAR_PLANE / CAMERA_NEAR_PLANE).toBeCloseTo(1000, 6);
  });

  it('still contains the whole scene', () => {
    // The camera never goes past CAMERA_FAR_LIMIT and the globe extends
    // GLOBE_RADIUS beyond the centre.
    expect(CAMERA_FAR_PLANE).toBeGreaterThan(CAMERA_FAR_LIMIT + GLOBE_RADIUS);
  });
});

describe('the ground the aircraft are drawn over is at ground level', () => {
  it('is the sag of the longest chord AT the radius that chord is drawn on', () => {
    // The coastline is a polyline of CHORDS, capped at 2 degrees by
    // continents.ts, and the globe mesh's VERTICES sit on the ideal sphere —
    // so a coastline drawn at GLOBE_RADIUS exactly would pass through the
    // planet in the middle of every segment.
    //
    // The obvious lift is the sagitta on GLOBE_RADIUS, and it is wrong by its
    // own second order: the chord is drawn on GLOBE_RADIUS + lift, where it
    // sags lift × (1 − cos h) further than the sagitta accounts for. The
    // fixed point has one solution, sec and not cos, and the two differ by
    // R (1 − cos h)² / cos h = 3,48e-8 — small, and entirely on the wrong
    // side: under the cos form every 2 degree chord's midpoint lands that
    // far INSIDE GLOBE_RADIUS, measured on 15 of continents.test.ts's 20
    // chords (D47).
    const half = (COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360;
    expect(COASTLINE_LIFT).toBe(GLOBE_RADIUS * (1 / Math.cos(half) - 1));
    expect(COASTLINE_LIFT).toBeCloseTo(0.000228492, 9);

    // The invariant itself, on the two constants, in double precision — the
    // only place it CAN be stated. The drawn vertices are Float32, where one
    // ulp at 1,5 is 1,19e-7: three and a half times the whole term this test
    // is about. continents.test.ts reads that buffer and so asserts the same
    // thing to within its own quantum, not to within nothing.
    expect((GLOBE_RADIUS + COASTLINE_LIFT) * Math.cos(half)).toBeGreaterThanOrEqual(
      GLOBE_RADIUS
    );
    // And the proof that the cos form would NOT have cleared it. This is the
    // line that goes red if someone later "simplifies" the constant back.
    const sagittaOnly = GLOBE_RADIUS * (1 - Math.cos(half));
    expect((GLOBE_RADIUS + sagittaOnly) * Math.cos(half)).toBeLessThan(GLOBE_RADIUS);
  });

  it('is no longer nineteen kilometres of apparent altitude', () => {
    // R × 1,003 was 0,0045 units = 10,3 NM = 19,1 km: one and a half times
    // the WHOLE new shell and four and a half times its floor. At the
    // bottom of the travel that terrain was displaced 41,24 px at the edge
    // of the frame while a corrected aircraft at 38 000 ft was displaced
    // 25,24 px — the ground lying MORE than the correction D36 had just
    // made. A cruising aircraft came out at 1,502854, below a coast at
    // 1,5045: drawn under the land it was flying over (§2.7).
    const old = GLOBE_RADIUS * 0.003; // what continents.ts:24 used to add
    expect(old / COASTLINE_LIFT).toBeGreaterThan(19);
    // And the proof that the old value was not merely large but WRONG: it
    // stood above the shell floor an aircraft at 0 ft sits on.
    expect(old).toBeGreaterThan(altitudeToOffset(0, CAMERA_NEAR_LIMIT));
  });

  it('stays under everything that has to be above it, at EVERY distance', () => {
    // The floor of the shell exists so an aircraft at 0 ft is a dot ABOVE
    // the coastline rather than inside it (D36). That only holds while the
    // coastline is below the floor — which it was not going to be, since
    // 0,0045 is four and a half times the 0,001 the floor reaches at the
    // bottom of the travel.
    for (let d = CAMERA_NEAR_LIMIT; d <= CAMERA_FAR_LIMIT; d += 0.05) {
      expect(COASTLINE_LIFT, `d=${d}`).toBeLessThan(altitudeToOffset(0, d));
    }
  });
});

describe('rewriting the travel and the shell leaves the rest of the module alone', () => {
  it('still exports latLonToVec3, which lives BETWEEN the two blocks being replaced', () => {
    // geoHelpers.ts:25-38 sits in the middle of the range Step 3 edits, and
    // an earlier draft of that step said "replace lines 5-49" while its
    // replacement block did not redeclare this function. It is the most
    // called thing in the module — latLonAltToVec3, continents.ts,
    // airportMarkers.ts, routeArc.ts and every marker go through it — so a
    // faithful implementer would have amputated the module in silence.
    // This is the tripwire; Step 3 is written so it never fires.
    expect(typeof latLonToVec3).toBe('function');
    expect(latLonToVec3(0, 0, GLOBE_RADIUS).z).toBeCloseTo(GLOBE_RADIUS, 12);
    expect(latLonToVec3(90, 0, GLOBE_RADIUS).y).toBeCloseTo(GLOBE_RADIUS, 12);
    expect(latLonToVec3(0, 90, GLOBE_RADIUS).x).toBeCloseTo(GLOBE_RADIUS, 12);
  });

  it('still exports everything below the second block', () => {
    for (const fn of [vec3ToLatLon, visibleCapRadiusNm, isInView, isOnNearSide]) {
      expect(typeof fn).toBe('function');
    }
    const back = vec3ToLatLon(latLonToVec3(45.46, 9.19, GLOBE_RADIUS));
    expect(back.lat).toBeCloseTo(45.46, 9);
    expect(back.lon).toBeCloseTo(9.19, 9);
  });

  it('exposes the shell SHAPE on its own, so no other file has to spell it', () => {
    // aircraft.ts:270 and trails.ts:202 each inline the whole formula
    // today. shellOffset is the four operations they will call instead,
    // with no transcendental and no allocation, so the inline stays and
    // only the arithmetic moves (D36).
    expect(shellOffset(shellThicknessUnits(CAMERA_FAR_LIMIT), 0)).toBeCloseTo(0.025, 12);
    expect(shellOffset(shellThicknessUnits(CAMERA_FAR_LIMIT), 1)).toBeCloseTo(0.075, 12);
    expect(shellOffset(shellThicknessUnits(CAMERA_NEAR_LIMIT), 1)).toBeCloseTo(
      altitudeToOffset(41_000, CAMERA_NEAR_LIMIT),
      12
    );
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
cd /home/riccardo/projects/air-view && npx vitest run tests/unit/globe/cameraTravel.test.ts
```

Atteso: fallisce in import — `CAMERA_NEAR_PLANE`, `CAMERA_FAR_PLANE`, `shellThicknessUnits`, `altitudeFraction`, `COASTLINE_LIFT`, `COASTLINE_MAX_SEGMENT_DEG` non esistono, e `altitudeToOffset` prende un argomento solo.

- [x] **Step 3: Sostituire il blocco della corsa e del guscio in `src/globe/geoHelpers.ts`**

**Due sostituzioni separate, e fra le due c'è una funzione che NON si tocca.**

Alle righe 25-38 di quel file, cioè **in mezzo** a quello che va riscritto, sta `latLonToVec3`: la funzione più chiamata del modulo, da cui passano `latLonAltToVec3`, `continents.ts`, `airportMarkers.ts`, `routeArc.ts`, `raycaster.ts` e ogni marcatore. Una stesura precedente di questo step diceva «sostituire le righe 5-49» elencando fra parentesi solo il commento, le due costanti, `altitudeToOffset` e `latLonAltToVec3` — e il blocco sostitutivo non ridichiarava `latLonToVec3`. Un esecutore fedele avrebbe cancellato la funzione più usata del modulo.

Gli intervalli qui sotto sono quindi dichiarati **citando il testo che esiste davvero nel file**, perché i numeri di riga si spostano e una citazione no. I numeri di riga fra parentesi sono quelli del file letto il 2026-11-22 e servono solo a orientarsi.

**Sostituzione A** — dalla riga

```
/**
 * The camera's travel, in WORLD UNITS — which is what OrbitControls
```

fino alla riga

```
export const CAMERA_FAR_LIMIT = 10.0;
```

**compresa** (righe 5-23 oggi), con:

```ts
/**
 * The camera's travel, in WORLD UNITS — which is what OrbitControls
 * compares against, and not what three comments in this repo once called
 * it. GLOBE_RADIUS is 1,5, so 1,55 to 10,0 units is 1,03 to 6,67 globe
 * radii.
 *
 * The near end is chosen by SEPARATION, and the metre is aviation's, not
 * ours. At 1,55 the visible cap is 39,6 NM, i.e. 0,0989 NM per pixel on an
 * 800 px canvas: two aircraft at the 3 NM terminal radar minimum are 30,3
 * px apart, 2,2 diameters of a 14 px symbol. At 1,9 — the previous floor —
 * the same 3 NM were 3,7 px and the two aircraft were one dot, which is
 * what the user reported seeing (D35).
 *
 * Plan 2 set this floor at 1,9 for a different and, at the time, correct
 * reason: tilesNear names the tiles whose CENTRE falls inside the declared
 * radius, the grid guarantees no covered point is more than 218,0 NM from
 * a centre (tileGrid.ts:60-62), and below 1,9 a viewer could name no tile
 * at all and quietly lose the priority the region on screen depends on.
 * That reason has not stopped being true — it has stopped being the
 * camera's problem. nearestCoveringTile() now prioritises the tile that
 * CONTAINS the point being looked at, whatever radius the client declares,
 * so the 218,0 NM is no longer a floor under the zoom but the proof that
 * that function never comes back empty over a covered region (D38).
 */
export const CAMERA_NEAR_LIMIT = 1.55;
export const CAMERA_FAR_LIMIT = 10.0;

/**
 * The camera's near and far planes.
 *
 * At 1,55 the four things in front of the camera are the apex of the most
 * bowed route arc (0,0466 away, D46), the top of the shell (0,047), the
 * coastline (0,0498 once COASTLINE_LIFT replaces R × 1,003, D47) and the
 * globe surface (0,050). The old near of 0,1 cut all four — and cut the
 * aircraft shell already at 1,675, long before the floor.
 *
 * The far plane moves WITH it, on purpose. How depth precision is spread
 * across the scene is a function of the RATIO, and 100/0,1 was 1 000 just
 * as 20/0,02 is 1 000; the ABSOLUTE worst resolution on a 24-bit buffer
 * goes from 5,95 × 10⁻³ to 1,19 × 10⁻³ units, five times better than
 * today. The camera never goes past 10,0 and the globe extends 1,5 beyond
 * the centre, so 20 is more than twice what the scene needs; 100 was a
 * literal with no reason behind it (D37).
 */
export const CAMERA_NEAR_PLANE = 0.02;
export const CAMERA_FAR_PLANE = 20;

/**
 * The longest chord continents.ts and coastlineFine.ts may draw, in degrees.
 *
 * continents.ts:64 already subdivides above this; it is declared here so
 * that COASTLINE_LIFT below is derived from it rather than guessed beside
 * it, and so the fine level of Plan 4 cannot pick a different one — two
 * coastlines at two heights would come apart during the 300 ms crossfade.
 */
export const COASTLINE_MAX_SEGMENT_DEG = 2.0;

/**
 * How far above the surface the coastline is drawn.
 *
 * It used to be GLOBE_RADIUS × 1,003, a literal inside a function: 0,0045
 * units, i.e. 10,3 NM — 19,1 km of apparent altitude, one and a half times
 * the WHOLE shell this file now gives an aircraft at 41 000 ft and four and
 * a half times its floor. At the bottom of the travel that put the terrain
 * 41,24 px off at the edge of the frame against 25,24 px for a corrected
 * aircraft at 38 000 ft: the ground lying more than the correction. And a
 * cruising aircraft came out at 1,502854 under a coast at 1,5045 — drawn
 * beneath the land it was flying over (D47).
 *
 * The obvious reason for lifting it at all — z-fighting against the globe —
 * does not hold here and was checked rather than assumed: not one material
 * in this scene writes depth (globe.ts:67, atmosphere.ts:36,
 * continents.ts:44, trails.ts:87, aircraft.ts:222, routeArc.ts:165), so the
 * buffer never leaves its clear value, and the coastline has depthTest
 * false on top of that. There is nothing to fight with.
 *
 * The reason that DOES hold is the polyline's own geometry. A coastline is
 * chords, not arcs, and a chord of COASTLINE_MAX_SEGMENT_DEG sinks below the
 * sphere it samples, while the globe mesh's vertices sit ON that sphere: at
 * GLOBE_RADIUS exactly the coast would pass through the planet in the middle
 * of every segment — invisible today, visible and silent the day something
 * here writes depth.
 *
 * So the lift is that sag — but the sag AT THE RADIUS THE CHORD IS DRAWN ON,
 * which is not the same number and is the one that matters. A chord on
 * GLOBE_RADIUS sags R × (1 − cos half); the chord is drawn on GLOBE_RADIUS +
 * lift, where it sags lift × (1 − cos half) further. "The lift covers its
 * own sag" is a fixed point with one solution, sec and not cos:
 *
 *     L = (R + L)(1 − cos h)   ⟹   L = R (sec h − 1)
 *
 * The two differ by R (1 − cos h)² / cos h = 3,48e-8, which is small and
 * entirely on the wrong side: under the cos form every 2 degree chord's
 * midpoint lands 3,48e-8 INSIDE GLOBE_RADIUS, measured. Under this one it
 * lands on it to
 * the last bit. 0,000228492 units, 0,524 NM, 0,97 km — nineteen times lower
 * than R × 1,003, and still below the shell floor an aircraft at 0 ft sits
 * on, at every camera distance.
 *
 * Written as the formula and not as a figure, so that changing the
 * subdivision moves the lift with it.
 */
export const COASTLINE_LIFT =
  GLOBE_RADIUS * (1 / Math.cos((COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360) - 1);
```

**Qui lo step si ferma.** Le righe 25-38 — il commento `Lat/lon (degrees) → 3D position on a sphere.` e la funzione `latLonToVec3` che lo segue — **restano esattamente come sono**: non si riscrivono, non si spostano, non si rinominano.

**Sostituzione B** — riprende sotto `latLonToVec3`, dal commento

```
/**
 * Visual altitude offset (real ratio ~0.0018 is too tiny — exaggerated for visibility).
 */
```

fino alla chiusura di `latLonAltToVec3`

```
export function latLonAltToVec3(lat: number, lon: number, altFt: number): Vector3 {
  return latLonToVec3(lat, lon, GLOBE_RADIUS + altitudeToOffset(altFt));
}
```

**compresa** (righe 40-49 oggi), con:

```ts
/** A quota as a fraction of the shell, clamped. 41 000 ft is the top. */
export function altitudeFraction(altFt: number): number {
  if (!Number.isFinite(altFt)) return 0;
  return Math.min(1, Math.max(0, altFt) / 41000);
}

const SHELL_UNITS_FAR = 0.075;
/**
 * 41 000 ft is 12,497 km; over 6 371 km of Earth radius and 1,5 world
 * units that is 0,002942. This is 1,02 × the real thing: at the bottom of
 * the travel the shell is not an exaggeration any more.
 */
const SHELL_UNITS_NEAR = 0.003;

/**
 * How thick the 0 → 41 000 ft shell is, at this camera distance.
 *
 * The old altitudeToOffset knew only the quota, and it exaggerated by 26 ×:
 * 38 000 ft became 303 km of apparent altitude. At planet view that is what
 * lifts the dots off the limb and it is left exactly where it was — "keep
 * the same graphics" is the user's constraint. But a shell lifts nothing at
 * the centre of the frame (a point on the camera axis projects to the same
 * pixel at any radius) and displaces everything at the edge, so the closer
 * the camera gets the less it shows and the more it lies. Measured: at
 * d = 1,9 an aircraft at 38 000 ft at the edge of the cap was drawn 107,7 px
 * — 86,6 NM — from the ground it was over; at 1,7, 248 px, 62 % of the view
 * radius (D36).
 *
 * Geometric interpolation, like pointSizePx: the zoom is logarithmic and so
 * is this.
 */
export function shellThicknessUnits(cameraDistance: number): number {
  const d = Math.min(
    Math.max(cameraDistance || CAMERA_NEAR_LIMIT, CAMERA_NEAR_LIMIT),
    CAMERA_FAR_LIMIT
  );
  const t = Math.log(d / CAMERA_NEAR_LIMIT) / Math.log(CAMERA_FAR_LIMIT / CAMERA_NEAR_LIMIT);
  return SHELL_UNITS_NEAR * Math.pow(SHELL_UNITS_FAR / SHELL_UNITS_NEAR, t);
}

/**
 * Visual altitude offset, at this camera distance.
 *
 * `0,025 + 0,05·u` IS `0,075 × (1/3 + 2/3·u)` — the same line, factored so
 * the thickness can move while the SHAPE of the shell cannot. At
 * CAMERA_FAR_LIMIT this returns 0,02500 and 0,07500 exactly, so planet view
 * is unchanged bit for bit, and a test asserts that as an identity rather
 * than an approximation.
 *
 * The 1/3 floor survives at every distance: an aircraft at 0 ft must still
 * be a dot ABOVE the coastline rather than inside it. At the near end that
 * floor is 0,001 units — 2,3 NM — which is 8,5 px of displacement at the
 * very edge of the frame and 0 px at its centre. Declared, not hidden.
 */
export function altitudeToOffset(altFt: number, cameraDistance: number): number {
  return shellOffset(shellThicknessUnits(cameraDistance), altitudeFraction(altFt));
}

/**
 * The SHAPE of the shell, given a thickness and a quota fraction.
 *
 * It exists as its own export for one reason: this formula had THREE
 * copies. geoHelpers was the declaration, and aircraft.ts:270 and
 * trails.ts:202 each wrote `GLOBE_RADIUS + 0.025 + (altFt/41000)*0.05` out
 * again by hand, inside private writeLatLonAlt helpers, to avoid allocating
 * a Vector3 per point. That reason was good and the inlining stays; what
 * cannot stay is a second and third opinion about where an aircraft is. A
 * thinning shell reaching the dots but not the trails would detach every
 * aircraft from its own trail at every zoom — 107,7 px at 1,9 — and
 * neither tsc nor any geoHelpers test could see it, because a copied
 * formula is not a call (D36).
 *
 * Four operations, no transcendental, no allocation: a hot loop can call
 * this per point and lose nothing.
 */
export function shellOffset(shellUnits: number, altFrac: number): number {
  return shellUnits * (1 / 3 + (2 / 3) * altFrac);
}

export function latLonAltToVec3(
  lat: number,
  lon: number,
  altFt: number,
  cameraDistance: number
): Vector3 {
  return latLonToVec3(lat, lon, GLOBE_RADIUS + altitudeToOffset(altFt, cameraDistance));
}
```

**Cosa resta intatto, per nome:** `GLOBE_RADIUS` (riga 3); `latLonToVec3` con il suo commento sulla convenzione (righe 25-38); e tutto ciò che segue da `vec3ToLatLon` in giù — `visibleCapRadiusNm`, `isInView`, `isOnNearSide`. `COASTLINE_MAX_SEGMENT_DEG` e `COASTLINE_LIFT` entrano in coda alla Sostituzione A e **non** sono usati da nessuna funzione di questo file: li consuma il Task 2 (`continents.ts`) e il Task 5 (`coastlineFine.ts`). Un export che nessuno ancora importa non è un `noUnusedLocals`. Verifica meccanica prima di passare allo step dopo:

```bash
cd /home/riccardo/projects/air-view && grep -c 'export function latLonToVec3' src/globe/geoHelpers.ts
```

Atteso: `1`. Se stampa `0`, la Sostituzione A ha mangiato la Sostituzione B e va rifatta: è esattamente il guasto che questo step è stato riscritto per impedire, e il test «still exports latLonToVec3» dello Step 1 lo ripete in rosso.

- [x] **Step 4: Verificare il verde del nuovo file e il rosso di quelli vecchi**

```bash
cd /home/riccardo/projects/air-view && npx vitest run tests/unit/globe/
```

Atteso: `cameraTravel.test.ts` verde. Falliscono, e devono fallire:
- `pointSize.test.ts:60` — `expect(visibleCapRadiusNm(CAMERA_NEAR_LIMIT, 38)).toBeGreaterThan(218)` → riceve 39,6. È l'asserzione che D38 rende falsa di proposito.
- `pointSize.test.ts:66` — `expect(CAMERA_NEAR_LIMIT - 1.575).toBeGreaterThan(0.1)` → riceve −0,025. È §2.5.3.
- `geoHelpers.test.ts:30,33` — `altitudeToOffset` con un argomento solo.
- **`cameraTurn.test.ts:208` e `cameraTurn.test.ts:274`** — e questi non sono un adeguamento di firma: sono due asserzioni che si **ribaltano**, perché in quel file `CAMERA_NEAR_LIMIT` non è un argomento, è la **distanza della camera**. Lo Step 6b le misura e le riscrive. Non cercarle a mano: sono le sole due del file, e sono le sole due dell'intera suite.
- **ogni** chiamante di `latLonAltToVec3` nei test. L'elenco **non** si scrive qui a mano, perché un elenco scritto a mano invecchia: lo stampa il comando sotto, e al 2026-11-22 sono `deadReckoning.test.ts`, `motion.test.ts`, `horizon.test.ts`, `geoHelpers.test.ts` più i due file non tracciati che un altro lavoro ha in corso in questo working tree, `cameraTurn.test.ts` e `focusCamera.test.ts`.

```bash
cd /home/riccardo/projects/air-view && grep -rln 'latLonAltToVec3\|altitudeToOffset' tests src
```

Ogni percorso stampato da questo comando è un file che questo task o il Task 2 deve correggere **e mettere in staging**. Se ne compare uno che la riga `git add` dello Step 8 non elenca, va aggiunto lì — è esattamente il difetto che il `git status --porcelain` in coda esiste per vedere. Al 2026-11-22 stampa dieci percorsi: quattro sorgenti (`geoHelpers.ts`, `deadReckoning.ts`, `scene.ts`, `raycaster.ts`, tutti del Task 2 tranne il primo) e sei test, di cui `cameraTurn.test.ts` e `focusCamera.test.ts` sono quelli che il commit `3c689bd` ha portato qui dopo la prima stesura di questo piano.

- [x] **Step 5: Correggere le due asserzioni di `tests/unit/globe/pointSize.test.ts`**

Sostituire il blocco `describe('the camera travel is one declaration', ...)` con:

```ts
describe('the camera travel is one declaration', () => {
  it('no longer depends on the tile grid, because the server stopped needing it to', () => {
    // Plan 2 asserted visibleCapRadiusNm(NEAR) > 218 here, and that was
    // right while tilesNear was the only way a viewport reached the
    // scheduler. nearestCoveringTile prioritises the tile that CONTAINS the
    // centre whatever the radius, so the floor is free to follow the
    // separation arithmetic instead (D38). The assertion that replaces it is
    // in tests/unit/data/sources/tileGrid.test.ts — the path that actually
    // exists; an earlier draft of this plan named it one directory too high
    // and put that non-path on a `git add` line, where a pathspec matching
    // nothing exits 1 and takes the && chain, and the commit, with it.
    expect(visibleCapRadiusNm(CAMERA_NEAR_LIMIT, 38)).toBeGreaterThan(0);
  });

  it('leaves the aircraft shell in front of the near plane', () => {
    // The shell is no longer a constant 0,075: it thins with the zoom, so
    // the clearance is checked against the shell AT this distance (D36/D37).
    const top = GLOBE_RADIUS + altitudeToOffset(41_000, CAMERA_NEAR_LIMIT);
    expect(CAMERA_NEAR_LIMIT - top).toBeGreaterThan(CAMERA_NEAR_PLANE);
  });
});
```

E aggiungere `GLOBE_RADIUS, CAMERA_NEAR_PLANE, altitudeToOffset` all'import da `@/globe/geoHelpers`.

- [x] **Step 6a: L'adeguamento meccanico, dove davvero non cambia niente**

Nel `describe('altitudeToOffset')` passare `CAMERA_FAR_LIMIT` come secondo argomento alle due asserzioni esistenti (restano `0.025` e `0.075`: è D36 che lo garantisce), e in `describe('latLonAltToVec3')` passare `CAMERA_FAR_LIMIT` come quarto.

Lo stesso, meccanicamente, in ogni file che il comando dello Step 4 ha stampato: `CAMERA_FAR_LIMIT` come ultimo argomento. Per le **posizioni** questo non cambia un bit — `shellThicknessUnits(CAMERA_FAR_LIMIT)` è esattamente `0,075`, e `shellOffset(0,075, altFrac)` è esattamente la riga di oggi — ed è ciò che rende l'adeguamento meccanico invece che un ridisegno. Se il comando stampa un file che **non** è tracciato da git, appartiene a un lavoro ancora in corso: va corretto comunque e messo in staging con questo task, perché un test rosso lasciato indietro è un cancello che nessuno può più chiudere.

**E `CAMERA_FAR_LIMIT`, non `CAMERA_NEAR_LIMIT`, anche dove la camera del test sta al fondo corsa.** Sembra più coerente passare la distanza che quel test usa davvero, e invece rompe. Misurato: con il guscio di `CAMERA_NEAR_LIMIT` un aereo a 38 000 ft sta a `1,502854` invece che a `1,571341`, e il cono di `isOnNearSide` visto da `d = 1,55` si chiude da **22,51°** a **15,00°**. `cameraTurn.test.ts:224` pretende che un punto a 20° di longitudine sia sul lato visibile: con il guscio sottile diventerebbe **falso**, e si sarebbe rotta una terza asserzione per coerenza con un parametro che `isInView` non guarda nemmeno — quella funzione confronta **direzioni**, e il raggio si semplifica.

- [x] **Step 6b: Le due asserzioni di `cameraTurn.test.ts` che il nuovo fondo corsa RIBALTA**

Qui «nessun valore atteso cambia» sarebbe falso, e un esecutore lo scoprirebbe a metà strada. Il file è arrivato su `main` con il commit `3c689bd`, mentre questo piano veniva scritto, e in **due** punti `CAMERA_NEAR_LIMIT` non è un argomento da adeguare: è la **distanza della camera**, cioè ciò che decide quanto largo è il frustum. Il cap passa da **322 NM a 40 NM** e il semiangolo inquadrato da **5,363° a 0,666°**: ogni bersaglio «appena dentro l'inquadratura» scelto per 1,9 finisce fuori.

Misurato, con `latLonAltToVec3(..., CAMERA_FAR_LIMIT)` cioè a posizioni identiche a oggi:

```
 sito                              a d = 1,9              a d = 1,55
 :208  lon 0,3°  =   18,0 NM        in view              in view      (il valore NUOVO)
 :208  lon 2,0°  =  120,1 NM        in view (cap 322)    FUORI (cap 40)   ← si ribalta
 :274  lon 4,8°  =  288,2 NM        in view (cap 322)    FUORI (cap 40)   ← si ribalta
 :274  lon 6,0°  =  360,2 NM        fuori                fuori
 :224  lon 20°   = 1200,8 NM        near side, fuori     near side (22,51°), fuori
```

Le due righe segnate sono le **sole due** asserzioni dell'intera suite che cambiano verdetto: `horizon.test.ts:27` (80°, fuori da entrambi i coni), `geoHelpers.test.ts:110-113,132-134,152-155` (20° e 10° sul lato visibile, fuori inquadratura a tutti e due i fondi corsa; e il cono per un aereo a 38 000 ft resta 22,51° > 20° > 10°), `airportMarkers.test.ts:45-51` (`sqrt(1,55 × 10) = 3,937`, ancora fra i due estremi) e `pointSize.test.ts:29-30` (la spaziatura **cresce**) restano verdi senza toccarle. `focusCamera.test.ts` non usa `CAMERA_NEAR_LIMIT` affatto: le sue camere stanno a 4,6.

**Sostituzione 1** — dentro `it('does not move a camera that is already framing the flight')`, le ultime quattro righe:

```ts
    // And the same at the near end of the travel, where the frame is a
    // 40 NM cap: 0,3 degrees off the view axis is 18 NM, comfortably
    // inside it, and still nothing moves. It was 2 degrees against a
    // 321 NM cap while the travel ended at 1,9 — the same sentence, at
    // the distance the travel actually ends at now (D35).
    const zoomedIn = new Vector3(0, 0, CAMERA_NEAR_LIMIT);
    const justOffAxis = latLonAltToVec3(0, 0.3, 38000, CAMERA_FAR_LIMIT);
    expect(turn.begin(view(zoomedIn), justOffAxis, 1000, false)).toBe(false);
    expect(turn.active).toBe(false);
```

**Sostituzione 2** — dentro `it('measures "already on screen" against the lens it was handed')`, l'array `cases` e il commento che lo precede:

```ts
    const cases = [
      // 1,55 units out: the near end of the travel. The frame reaches
      // 0,666 degrees off the view axis, a half lens 0,317 and a double
      // lens 1,516 — and the near SIDE reaches 22,5, which is what makes
      // the hemisphere the wrong question. These were 4,8 and 6 against a
      // 5,363 degree frame while the travel ended at 1,9; the margins are
      // re-measured, the sentence is the same.
      { distance: CAMERA_NEAR_LIMIT, inside: 0.5, outside: 0.9 },
      // 3,0 units out: 21,64 degrees, against 9,78 and 60,0. Untouched —
      // nothing in this row depends on where the travel ends.
      { distance: 3, inside: 20, outside: 24 },
    ];
```

`0,5` e `0,9` non sono due numeri comodi: sono gli unici due che tengono in piedi **entrambi** i mutanti che quel test esiste per uccidere. A `d = 1,55` il cap è 40 NM con la lente vera, **19 NM** con la lente dimezzata e **91 NM** con quella raddoppiata. `inside = 0,5°` sono 30,0 NM: dentro i 40 della lente vera, **fuori** dai 19 della lente dimezzata. `outside = 0,9°` sono 54,0 NM: fuori dai 40 della lente vera, **dentro** i 91 di quella raddoppiata. Con `inside = 0,3` il mutante dimezzato sopravviverebbe; con `outside = 2,0` sopravviverebbe quello raddoppiato.

- [x] **Step 6c: I tre commenti che citano 1,9 e diventano falsi**

Un numero che non esiste più, scritto in un commento, è la copia che si aggiorna in un posto su due — e questo piano lo dice già di `routeArc.ts:36` (D47). Qui ce ne sono tre, e sono in tre file diversi:

- `tests/unit/globe/cameraTurn.test.ts:212-220`, dentro `it('turns for a flight on the visible side that the frame does not reach')`: «at the near end of the travel the near side reaches ~38 degrees off the view axis and the frame reaches 5,4» diventa **«the near side reaches 22,5 degrees and the frame reaches 0,67»**. L'asserzione non cambia: 20° resta dentro il cono e fuori dall'inquadratura, con 2,5° di margine invece di 21 — e **quel margine va scritto lì**, perché è ciò che un domani qualcuno consumerebbe senza saperlo.
- `tests/unit/globe/geoHelpers.test.ts:105-108`, dentro `it('refuses a point on the visible side that the lens does not reach')`: stesso 37,9 e stesso 5,4, stessa sostituzione, stessa asserzione invariata.
- `src/globe/geoHelpers.ts`, nel commento di `isInView` (righe 217-220 di oggi): «At the near end of the camera's travel the near side reaches ~38 degrees from the view axis while the frame reaches 5,4». **Solo quelle due cifre** cambiano — 22,5 e 0,67. Il corpo di `isInView` non si tocca, quindi il «resta intatto» dello Step 3 vale ancora per il codice; e il commento è nel file che questo task già riscrive e già mette in staging.

E un quarto, nel file che il blocco **Files** aggiunge per questa sola riga: `src/globe/airportMarkers.ts:31` scrive «The travel is CAMERA_NEAR_LIMIT..CAMERA_FAR_LIMIT world units — 1,9 to 10,0 — and this is its geometric midpoint». Diventa **«1,55 to 10,0»**, e la frase successiva può dire il numero nuovo: `sqrt(1,55 × 10) = 3,937`, dove prima era 4,359 (D35). `MARKER_LABEL_MAX_DISTANCE` si ricalcola da sé — è esattamente ciò per cui il Piano 2 l'aveva scritta come media geometrica — e **nessuna riga di codice di quel file cambia**.

- [x] **Step 7: Cancello**

```bash
cd /home/riccardo/projects/air-view && npx vitest run tests/unit/globe/ && npx tsc --noEmit -p tsconfig.json
```

Atteso: i test di `globe/` verdi; `tsc` ancora rosso su `deadReckoning.ts`, `raycaster.ts`, `scene.ts` — sono il Task 2.

- [ ] **Step 8: Commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/globe/geoHelpers.ts \
             src/globe/airportMarkers.ts \
             tests/unit/globe/cameraTravel.test.ts \
             tests/unit/globe/geoHelpers.test.ts \
             tests/unit/globe/pointSize.test.ts \
             tests/unit/globe/cameraTurn.test.ts \
             tests/unit/globe/focusCamera.test.ts \
  && git commit -m "$(cat <<'EOF'
feat(globe): the zoom floor is an arithmetic about aircraft, not a round number

At 1,9 two aircraft at the 3 NM terminal radar minimum were 3,7 px apart
against a 14 px symbol: one dot. At 1,55 they are 30,3 px apart. Getting
there needed the altitude shell to stop being a 26x exaggeration — at 1,9
it already drew a cruising aircraft 107,7 px from the ground it was over —
and needed a near plane that passes under a camera 0,0455 from the coast.
The shell is unchanged bit for bit at planet view, which is the constraint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests
```

Atteso: **nessuna riga**. Se ne stampa una, è un chiamante di `latLonAltToVec3` o di `altitudeToOffset` che questo task ha corretto e che la riga `git add` sopra non elencava: va aggiunto a quella riga e il commit rifatto con `git commit --amend --no-edit`. Non è pignoleria — è il difetto di cucitura che questo progetto ha pagato cinque volte, e qui si vede in una riga.

**Test attesi dopo il Task 1: 655 passed.**

---

### Task 2: Il guscio arriva al disegno, la camera ci passa sotto, e tutto ciò che sta sopra il suolo scende insieme

Il guscio adesso dipende dalla camera, e `Motion.radius` è un numero congelato alla costruzione del batch. Questo task scioglie quel nodo nel modo che costa meno di oggi: il raggio smette di essere memorizzato e diventa una composizione di due moltiplicazioni al disegno, da uno spessore calcolato **una volta per fotogramma**.

E lo fa per **tutte** le geometrie sollevate dal suolo, non solo per i puntini. Ce ne sono quattro in questa scena — puntini, scie, arco di rotta, linea di costa — e abbassarne una sola non è una correzione parziale: è una **separazione**. Se i puntini scendono e le scie no, ogni aereo si stacca dalla propria scia; se l'arco non scende, il volo si stacca dalla propria rotta e al fondo corsa la rotta sparisce del tutto dietro il piano near (D46); se la costa non scende, l'aereo corretto finisce sotto un terreno sbagliato di 41 px contro i 25 della correzione (D47). Il criterio per sapere se questo task è finito non è «il guscio si assottiglia», è **«tutto quello che sta sopra il suolo sta sullo stesso suolo a ogni zoom»**.

**Files:**
- Modify: `src/types.ts` — `Motion.radius` → `Motion.altFrac`
- Modify: `src/globe/deadReckoning.ts` — `deriveMotion`, `positionAt`, e **`reconcile`**, che chiama `positionAt` due volte (righe 275-276) e che il piano precedente non nominava: senza di essa questo file non compila
- Modify: `src/globe/aircraft.ts` — lo spessore per fotogramma, `writePoint`, e `writeLatLonAlt` (righe 263-277), che è la **seconda** copia della formula
- Modify: `src/globe/trails.ts` — la **terza** copia: `TrailsLayer.update` (righe 47-56 e 98-104) prende lo spessore del fotogramma e `writeLatLonAlt` (righe 195-209) smette di avere la sua. Senza questo file i puntini scendono sul guscio nuovo e le scie restano su quello vecchio: ogni aereo staccato dalla propria scia a ogni zoom. Il piano precedente non nominava `trails.ts` in nessun task e in nessuna riga `git add`
- Modify: `src/globe/routeArc.ts` — le tre costanti assolute `ARC_BASE_OFFSET`/`ARC_APEX_MIN`/`ARC_APEX_RANGE` diventano tre frazioni dello spessore, `geodesicPoints` e `RouteArcLayer.update` prendono `shellUnits` (D46). Senza questo file, al fondo corsa la rotta di una tratta corta cade dentro il piano near e quella di una quasi antipodale finisce dietro la camera
- Modify: `src/globe/continents.ts` — `GLOBE_RADIUS * 1.003` diventa `GLOBE_RADIUS + COASTLINE_LIFT` e la suddivisione legge `COASTLINE_MAX_SEGMENT_DEG` invece del `2.0` letterale della riga 64 (D47)
- Modify: `src/globe/raycaster.ts` — la stessa composizione per il picking
- Modify: `src/globe/scene.ts` — `near`/`far` della camera, i tre `latLonAltToVec3`, e **un solo** `shellThicknessUnits` per fotogramma passato a tutti e tre gli strati (puntini, scie, arco)
- **NON modificato: `src/globe/atmosphere.ts`.** La stesura precedente di questo task gli metteva un uniform di opacità e una dissolvenza; §2.6 ha misurato che la premessa era falsa e che la dissolvenza avrebbe annerito il globo. Il file resta com'è, e un test lo difende da chi ci riprova (D39)
- **NON modificato, e dichiarato qui invece di lasciarlo scoprire: `src/state/aircraftStore.ts`.** È l'unico file fuori da `src/globe` che tocca questa catena — `updateBatch` chiama `reconcile` alla riga 152 — e un esecutore che facesse passare `shellUnits` attraverso `reconcile` dovrebbe cambiarlo. Lo Step 5 dice perché non si fa e come lo si evita. È comunque nella riga `git add` di questo task: è tracciato, quindi un `git add` su di esso non può fallire, e se qualcuno ce le mettesse comunque le mani il commit se lo porterebbe dietro invece di lasciarlo fuori
- Test: `tests/unit/globe/shellAtDraw.test.ts` (nuovo), `tests/unit/globe/oneShellAuthority.test.ts` (nuovo), `tests/unit/globe/atmosphereUnchanged.test.ts` (nuovo); e da adeguare, uno per uno e tutti nella riga `git add`: `tests/unit/globe/deadReckoning.test.ts`, `tests/unit/globe/motion.test.ts`, `tests/unit/globe/horizon.test.ts`, `tests/unit/globe/routeArc.test.ts`, `tests/unit/globe/continents.test.ts`, `tests/unit/state/sceneView.test.ts`

**Interfaces:**
- Produces: `Motion.altFrac: number`; `positionAt(m, advanceS, nowMs, shellUnits, out)`; `TrailsLayer.update(aircraft, selectedIcao, rule, shellUnits)`; `geodesicPoints(a, b, shellUnits)`; `RouteArcLayer.update(arc, shellUnits)`; `ARC_BASE_FRAC`, `ARC_APEX_MIN_FRAC`, `ARC_APEX_RANGE_FRAC` da `routeArc.ts`
- Invariata, ed è una scelta: `reconcile(fresh, elapsedOnFreshS, previous, elapsedOnPreviousS, nowMs, animate)`. Vedi lo Step 5
- Consumes: `shellThicknessUnits`, `shellOffset`, `altitudeFraction`, `CAMERA_NEAR_PLANE`, `CAMERA_FAR_PLANE`, `COASTLINE_LIFT`, `COASTLINE_MAX_SEGMENT_DEG`
- **Non produce niente in `atmosphere.ts`**: nessun `limbFadeOpacity`, nessun `setOpacity`, nessun uniform nuovo

- [x] **Step 1: Creare `tests/unit/globe/shellAtDraw.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { deriveMotion, positionAt } from '@/globe/deadReckoning';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  GLOBE_RADIUS,
  altitudeToOffset,
  shellThicknessUnits,
} from '@/globe/geoHelpers';
import type { AircraftRaw } from '@/types';

function raw(over: Partial<AircraftRaw> = {}): AircraftRaw {
  return {
    icao24: 'abc123',
    callsign: 'TEST1',
    latitude: 45,
    longitude: 9,
    baroAltitudeFt: 38_000,
    velocityKt: 450,
    headingDeg: 90,
    lastContact: 1_700_000_000,
    complete: true,
    ...(over as object),
  } as AircraftRaw;
}

describe('the shell is composed at draw time, not frozen at batch time', () => {
  it('puts the same aircraft on a different shell at a different zoom', () => {
    // The defect this replaces: Motion.radius was GLOBE_RADIUS +
    // altitudeToOffset(alt) computed once per batch, so a shell that
    // depends on the camera could never have reached the dot (D36).
    const m = deriveMotion(raw(), 1_700_000_000);
    expect(m).not.toBeNull();
    const far = { x: 0, y: 0, z: 0 };
    const near = { x: 0, y: 0, z: 0 };
    positionAt(m!, 0, 0, shellThicknessUnits(CAMERA_FAR_LIMIT), far);
    positionAt(m!, 0, 0, shellThicknessUnits(CAMERA_NEAR_LIMIT), near);
    const rFar = Math.hypot(far.x, far.y, far.z);
    const rNear = Math.hypot(near.x, near.y, near.z);
    expect(rFar).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38_000, CAMERA_FAR_LIMIT), 10);
    expect(rNear).toBeCloseTo(GLOBE_RADIUS + altitudeToOffset(38_000, CAMERA_NEAR_LIMIT), 10);
    expect(rNear).toBeLessThan(rFar);
  });

  it('keeps the direction identical whatever the shell does', () => {
    // The shell must move the dot OUT, never sideways: a taper that also
    // turned the aircraft would be a position error of its own.
    const m = deriveMotion(raw(), 1_700_000_000)!;
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, shellThicknessUnits(CAMERA_FAR_LIMIT), a);
    positionAt(m, 0, 0, shellThicknessUnits(CAMERA_NEAR_LIMIT), b);
    const na = Math.hypot(a.x, a.y, a.z);
    const nb = Math.hypot(b.x, b.y, b.z);
    expect(a.x / na).toBeCloseTo(b.x / nb, 12);
    expect(a.y / na).toBeCloseTo(b.y / nb, 12);
    expect(a.z / na).toBeCloseTo(b.z / nb, 12);
  });

  it('spends no transcendental call on the shell, per aircraft', () => {
    // Plan 2 proved its cost by COUNTING rather than by timing, because an
    // assertion in milliseconds on a CI machine fails for the weather. The
    // shell is one log and one pow per FRAME, and two multiplications per
    // aircraft: positionAt on a still aircraft must call neither (D36).
    const m = deriveMotion(raw({ velocityKt: 0, headingDeg: null }), 1_700_000_000)!;
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    const log = vi.spyOn(Math, 'log');
    const pow = vi.spyOn(Math, 'pow');
    const out = { x: 0, y: 0, z: 0 };
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    log.mockClear();
    pow.mockClear();
    for (let i = 0; i < 1000; i++) positionAt(m, 0, 0, shell, out);
    expect(sin).not.toHaveBeenCalled();
    expect(cos).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(pow).not.toHaveBeenCalled();
    sin.mockRestore();
    cos.mockRestore();
    log.mockRestore();
    pow.mockRestore();
  });

  it('stores a fraction, not a radius', () => {
    expect(deriveMotion(raw({ baroAltitudeFt: 0 }), 1_700_000_000)!.altFrac).toBe(0);
    expect(deriveMotion(raw({ baroAltitudeFt: 41_000 }), 1_700_000_000)!.altFrac).toBe(1);
    // A missing quota keeps the 38 000 ft the whole repo assumes, and the
    // assumption stays in ONE place (deadReckoning.ts:130 today).
    expect(deriveMotion(raw({ baroAltitudeFt: null }), 1_700_000_000)!.altFrac).toBeCloseTo(
      38_000 / 41_000,
      10
    );
  });
});
```

- [x] **Step 2: Creare i due test che difendono ciò che questo task non deve cambiare di nascosto**

Il primo, `tests/unit/globe/oneShellAuthority.test.ts`, non guarda un valore: guarda i **file**. È l'unico modo di vedere una formula ricopiata, perché una copia non è una chiamata e `tsc` non la trova.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GLOBE_DIR = join(process.cwd(), 'src/globe');
const FILES = readdirSync(GLOBE_DIR).filter((f) => f.endsWith('.ts'));

/**
 * The file with its comment lines removed.
 *
 * This suite reads source instead of calling it, so it has to say which
 * occurrences count. A number QUOTED in a comment to record what changed
 * and why is this plan's house style and must stay legal; the same number
 * in an expression is a second authority and must not. The line test is
 * crude on purpose — a block comment's continuation lines start with `*`,
 * and nothing in src/globe hides code behind one.
 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');
}

/**
 * The altitude shell had THREE copies before this task: geoHelpers.ts:44,
 * aircraft.ts:270 and trails.ts:202, the last two inlined inside private
 * writeLatLonAlt helpers that nothing named. The price is not abstract: a
 * shell that thins with the zoom would have reached the dots and not the
 * trails, so every aircraft would have flown detached from its own trail
 * at every zoom, and nothing in this repo could have reported it. This
 * project has paid three times for TWO copies of a number (D24, D25, D37);
 * here there were three.
 */
describe('the altitude shell has exactly one authority', () => {
  it('names 41 000 ft in geoHelpers.ts and nowhere else under src/globe', () => {
    const offenders = FILES.filter(
      (f) => f !== 'geoHelpers.ts' && /41[ _]?000/.test(readFileSync(join(GLOBE_DIR, f), 'utf8'))
    );
    // Comments count. A number quoted in a comment is a number somebody
    // will update in one place out of three.
    expect(offenders).toEqual([]);
  });

  it('writes the old 0,025 / 0,05 shell literals nowhere at all', () => {
    // They do not survive even in geoHelpers: the thickness is
    // SHELL_UNITS_NEAR / SHELL_UNITS_FAR and the shape is 1/3 + 2/3 (D36).
    for (const f of FILES) {
      expect(readFileSync(join(GLOBE_DIR, f), 'utf8'), f).not.toMatch(/0\.025\s*\+/);
    }
  });

  it('makes every layer that draws an aircraft compose through shellOffset', () => {
    // aircraft.ts and trails.ts keep their allocation-free writeLatLonAlt —
    // that part was always right — and take the offset from the one
    // function that owns it. deadReckoning.ts is in this list because
    // positionAt is where the radius is finally composed, and an earlier
    // draft of this plan had positionAt spell `shellUnits * (1/3 + 2/3 *
    // m.altFrac)` out by hand — a FOURTH copy, written in the very step
    // whose purpose was to delete three, and in direct contradiction with
    // this assertion (D36).
    for (const f of ['aircraft.ts', 'trails.ts', 'deadReckoning.ts']) {
      expect(readFileSync(join(GLOBE_DIR, f), 'utf8'), f).toMatch(/shellOffset\(/);
    }
  });

  it('never writes 1/3 + 2/3 anywhere but inside shellOffset itself', () => {
    // The SHAPE of the shell, like its thickness, has exactly one author.
    // Comments are stripped first, because a comment that QUOTES the shape
    // to say what changed is documentation, while a second expression that
    // computes it is a second authority — and this plan asks its comments
    // to quote the old numbers on purpose.
    for (const f of FILES) {
      const code = codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8'));
      const hits = code.match(/1\s*\/\s*3\s*\+\s*\(?\s*2\s*\/\s*3/g) ?? [];
      expect(hits.length, `${f} computes the shell shape ${hits.length} times`).toBe(
        f === 'geoHelpers.ts' ? 1 : 0
      );
    }
  });

  it('leaves no absolute height above the surface in any layer', () => {
    // The shell was not the only geometry lifted off the ground by a
    // constant: routeArc.ts:37-40 had 0,018 / 0,012 / 0,055 and
    // continents.ts:24 had GLOBE_RADIUS * 1.003 — 19,1 km of apparent
    // altitude, taller than the whole corrected shell. Every height above
    // the surface is now either a FRACTION of the per-frame shell (D46) or
    // COASTLINE_LIFT (D47), and neither may be spelled as a literal here.
    //
    // 1\.00 and not 1\.0: atmosphere.ts draws its veil at GLOBE_RADIUS *
    // 1.04 and D39 forbids this plan from touching that file at all.
    // 0\.0\d and not 0\.\d: three layers set a bounding sphere at
    // GLOBE_RADIUS + 0.5, which is a cull radius and not an altitude.
    for (const f of FILES) {
      if (f === 'geoHelpers.ts') continue; // where both constants now live
      const code = codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8'));
      expect(code, f).not.toMatch(/GLOBE_RADIUS\s*\*\s*1\.00/);
      expect(code, f).not.toMatch(/GLOBE_RADIUS\s*\+\s*0\.0\d/);
    }
  });

  it('makes the route arc take its scale from the frame, not from itself', () => {
    const src = readFileSync(join(GLOBE_DIR, 'routeArc.ts'), 'utf8');
    expect(src).toMatch(/shellUnits/);
    // The three old constants are gone as offsets and survive only as
    // ratios, which is what keeps planet view bit-for-bit identical.
    expect(src).toMatch(/ARC_BASE_FRAC/);
    expect(src).not.toMatch(/ARC_BASE_OFFSET\s*=\s*0\.018/);
  });
});
```

Il secondo, `tests/unit/globe/atmosphereUnchanged.test.ts`, è **verde prima che il task cominci** e deve restarlo. Non verifica una dissolvenza: verifica che non ce ne sia una.

```ts
import { describe, it, expect } from 'vitest';
import { AdditiveBlending, BackSide, type BufferGeometry, type Mesh, type ShaderMaterial } from 'three';
import { createAtmosphere } from '@/globe/atmosphere';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, GLOBE_RADIUS } from '@/globe/geoHelpers';

const FOV = 38;
const ASPECT = 16 / 9;

/** Half the diagonal of the frustum, which is where the globe fills it. */
function halfDiagonalRad(fovDeg: number, aspect: number): number {
  const halfV = ((fovDeg / 2) * Math.PI) / 180;
  return Math.atan(Math.tan(halfV) * Math.sqrt(1 + aspect * aspect));
}

/**
 * The largest dot(n, viewDir) over the fragments three.js actually draws.
 *
 * With side: BackSide only the faces whose outward normal points AWAY from
 * the camera are drawn, which is exactly the set with dot <= 0 — and that
 * is the whole point: atmosphere.ts:27 clamps dot to [0, 1] before
 * subtracting it from 1, so on every drawn fragment the "fresnel" is
 * 1 and pow(1, 2.5) is 1. The alpha is the constant 0,18 (§2.6).
 */
function maxDotOverDrawnFragments(d: number, steps = 400): number {
  const R = GLOBE_RADIUS * 1.04;
  let worst = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI; // angle from the camera axis
    const p = [R * Math.sin(theta), 0, R * Math.cos(theta)];
    const toCam = [-p[0]!, 0, d - p[2]!];
    const lc = Math.hypot(toCam[0]!, toCam[2]!);
    if (lc === 0) continue;
    const dot = (p[0]! * toCam[0]! + p[2]! * toCam[2]!) / (R * lc);
    if (dot <= 0 && dot > worst) worst = dot;
  }
  return worst;
}

/** Distance from the origin to the nearest FACE, not the nearest vertex. */
function innerRadiusOfTessellation(geom: BufferGeometry): number {
  const pos = geom.getAttribute('position').array as ArrayLike<number>;
  const idx = geom.getIndex()!.array as ArrayLike<number>;
  let min = Infinity;
  for (let i = 0; i < idx.length; i += 3) {
    const a = [0, 1, 2].map((k) => pos[idx[i]! * 3 + k]!);
    const b = [0, 1, 2].map((k) => pos[idx[i + 1]! * 3 + k]!);
    const c = [0, 1, 2].map((k) => pos[idx[i + 2]! * 3 + k]!);
    const u = b.map((v, k) => v - a[k]!);
    const v = c.map((w, k) => w - a[k]!);
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const ln = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (ln === 0) continue;
    const dist = Math.abs((n[0]! * a[0]! + n[1]! * a[1]! + n[2]! * a[2]!) / ln);
    if (dist < min) min = dist;
  }
  return min;
}

describe('the atmosphere is a uniform veil, and this plan does not touch it', () => {
  it('exposes no zoom knob at all', () => {
    // An earlier draft of D39 added limbFadeOpacity, a uOpacity uniform and
    // setOpacity. §2.6 measured why that was wrong. This is the tripwire
    // for anyone who tries it again.
    const atm = createAtmosphere();
    expect(Object.keys(atm).sort()).toEqual(['mesh', 'setTime']);
    const mat = atm.mesh.material as ShaderMaterial;
    expect(Object.keys(mat.uniforms)).toEqual(['uTime']);
    expect(mat.fragmentShader).not.toMatch(/uOpacity/);
  });

  it('keeps the six values that ARE the graphics', () => {
    // "Vorrei mantenere la stessa grafica, lo stesso stile" is the user's
    // constraint, and this is what it means for this file.
    const atm = createAtmosphere();
    const mat = atm.mesh.material as ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(BackSide);
    expect(mat.blending).toBe(AdditiveBlending);
    expect(atm.mesh.renderOrder).toBe(0);
    expect(
      (atm.mesh.geometry as BufferGeometry & { parameters: { radius: number } }).parameters.radius
    ).toBeCloseTo(GLOBE_RADIUS * 1.04, 12);
  });

  it('paints a CONSTANT alpha, which is why fading it would darken every pixel', () => {
    // The premise the first draft rested on — "below 2,61 the glow paints
    // zero useful pixels at any opacity" — is false here: every drawn
    // fragment has dot(n, v) <= 0, so the fresnel term is dead code and
    // the alpha is 0,18 from the limb to the far pole (§2.6).
    for (const d of [CAMERA_FAR_LIMIT, 4, 3.002, 2.715, 2.61, 2, CAMERA_NEAR_LIMIT]) {
      expect(maxDotOverDrawnFragments(d), `d=${d}`).toBeLessThanOrEqual(0);
    }
  });

  it('fills the whole frame exactly where the first draft switched it off', () => {
    // The disc is the 1,56 sphere's, not the globe's: it fills the corners
    // from 1,56 / sin(35,08°) = 2,715 down. At 2,610 — where the fade
    // reached zero — coverage is 100 %, not 0 %.
    const fillsFrom = (GLOBE_RADIUS * 1.04) / Math.sin(halfDiagonalRad(FOV, ASPECT));
    expect(fillsFrom).toBeGreaterThan(2.61);
    expect(fillsFrom).toBeCloseTo(2.715, 2);
  });

  it('keeps the camera inside the TESSELLATED shell at the bottom of the travel', () => {
    // SphereGeometry(1,56, 64, 64) is a polyhedron: its inner radius is
    // 1,557653, not 1,56, and at 1,55 the camera clears it by 0,0077. Lower
    // the floor or coarsen the sphere and a facet edge sweeps the screen,
    // silently (§2.6). This is the only constraint the new floor really
    // puts on the atmosphere.
    const inner = innerRadiusOfTessellation(createAtmosphere().mesh.geometry);
    expect(inner).toBeCloseTo(1.557653, 5);
    expect(inner).toBeGreaterThan(CAMERA_NEAR_LIMIT);
  });
});
```

- [x] **Step 3: Verificare il rosso**

```bash
cd /home/riccardo/projects/air-view && npx vitest run tests/unit/globe/shellAtDraw.test.ts tests/unit/globe/oneShellAuthority.test.ts tests/unit/globe/atmosphereUnchanged.test.ts
```

Atteso: `shellAtDraw` rosso (`positionAt` prende quattro argomenti, `Motion.altFrac` non esiste); `oneShellAuthority` rosso su `aircraft.ts` e `trails.ts`, che oggi scrivono `41000` e `0.025 +` a mano, su `continents.ts`, che scrive `GLOBE_RADIUS * 1.003`, e su `routeArc.ts`, che scrive `ARC_BASE_OFFSET = 0.018` e non nomina `shellUnits`; `atmosphereUnchanged` **verde già adesso**, perché descrive un file che questo task non deve toccare — se è rosso, qualcuno ha già cambiato `atmosphere.ts` e va capito perché prima di proseguire.

- [x] **Step 4: `src/types.ts` — `radius` diventa `altFrac`**

Nell'interfaccia `Motion` (riga 48) sostituire il campo `radius: number` con:

```ts
  /**
   * The quota as a fraction of the 0 → 41 000 ft shell.
   *
   * NOT a radius. The shell's THICKNESS now depends on how far out the
   * camera is (D36), so a radius frozen when the batch was built could
   * never follow the zoom. The draw loop composes
   * `GLOBE_RADIUS + shell(d) × (1/3 + 2/3 × altFrac)` from a thickness it
   * computes ONCE per frame: two multiplications per aircraft, no
   * transcendental call, strictly less than what was being spent.
   */
  altFrac: number;
```

- [x] **Step 5: `src/globe/deadReckoning.ts`**

In `deriveMotion`, sostituire il campo `radius:` del valore di ritorno con:

```ts
    // The shell's thickness belongs to the camera, not to the batch: see
    // Motion.altFrac. The 38 000 ft default for a missing quota stays here,
    // in the one place that has ever stated it.
    altFrac: altitudeFraction(ac.baroAltitudeFt ?? 38000),
```

e l'import da `./geoHelpers` diventa `{ GLOBE_RADIUS, altitudeFraction, shellOffset }` — `altitudeToOffset` esce, `shellOffset` entra, `GLOBE_RADIUS` resta perché `positionAt` e `reconcile` lo usano entrambi.

In `positionAt`, aggiungere il parametro e comporre il raggio **chiamando `shellOffset`**:

```ts
/**
 * @param shellUnits the shell thickness for THIS frame, from
 *   shellThicknessUnits(cameraDistance). Passed in rather than computed
 *   here because it is one log and one pow for the whole fleet, and a
 *   per-aircraft call would be 24 000 of each per frame (D36).
 */
export function positionAt(
  m: Motion,
  advanceS: number,
  nowMs: number,
  shellUnits: number,
  out: Xyz
): void {
  const radius = GLOBE_RADIUS + shellOffset(shellUnits, m.altFrac);
  if (advanceS > 0 && m.omegaPerS > 0) {
```

(il resto del corpo è invariato, con `m.radius` sostituito da `radius` nelle sei occorrenze).

**`shellOffset(shellUnits, m.altFrac)`, non `shellUnits * (1 / 3 + (2 / 3) * m.altFrac)`.** Una stesura precedente di questo step scriveva la seconda forma, e la scriveva **nel passo che esiste per cancellarne tre**: sarebbe stata la quarta copia della forma del guscio, in un file che lo Step 2 pretende espressamente contenga `shellOffset(` — cioè una contraddizione fra uno step del piano e il test dello step precedente, in cui il test vince e lo step va rifatto. Peggio: sarebbe stata la copia in `positionAt`, cioè nel punto da cui passa **ogni** posizione di **ogni** aereo di **ogni** fotogramma. `shellOffset` sono quattro operazioni, nessuna trascendente e nessuna allocazione (D36): non c'è niente da risparmiare scrivendola a mano, e c'è un'autorità da perdere.

E in `reconcile` — che è nello stesso file, chiama `positionAt` **due volte** (righe 275-276) e senza questo punto non compila:

```ts
  // 0, not the frame's shell, and the two reasons are different in kind.
  //
  // The first is availability: reconcile runs inside updateBatch, in the
  // store, OUTSIDE the render loop. There is no camera there, and giving
  // the store one — threading shellUnits through reconcile and down from
  // aircraftStore.ts:152 — would make a batch arrival depend on where the
  // camera happens to be pointing, which is a dependency this application
  // has never had and does not need.
  //
  // The second is correctness, and it is the better one. What reconcile
  // measures is an ANGULAR error: how far from the fix we were drawing an
  // aircraft when a new one arrived. Measuring it on the globe's own
  // surface makes `gapNm = |was − now| / GLOBE_RADIUS × NM_PER_RADIAN`
  // exactly what it already claimed to be, and it removes a defect that
  // was there before this plan: with the OLD per-aircraft radius an
  // aircraft climbing 8 000 ft between two batches moved 0,0098 units
  // radially, which reads as 22,4 NM of "gap" against a 15 NM budget — so
  // every climbing aircraft failed the budget test and SNAPPED instead of
  // sliding, for a climb, not for a drawing error.
  //
  // The price, measured: the offset is taken on the surface and then added
  // unchanged to a point one shell higher, so it is short by exactly
  // shell/GLOBE_RADIUS — 5 % at planet view, 0,2 % at the bottom of the
  // travel. On the largest correction that can exist, one DR_CAP_S of
  // travel at 450 kt = 15 NM, that is 0,75 NM = 0,06 px at planet view and
  // 0,03 NM = 0,3 px at 1,55, on a correction that is gone in 300 ms.
  // Sub-pixel at BOTH ends, which is why it is a price and not a defect.
  positionAt(previous, advanceSeconds(previous, elapsedOnPreviousS), nowMs, 0, was);
  positionAt(fresh, advanceSeconds(fresh, elapsedOnFreshS), nowMs, 0, now);
```

**`reconcile` quindi non cambia firma, e `src/state/aircraftStore.ts` non cambia affatto.** Questo è il punto in cui va detto a voce, perché è l'unico file fuori da `src/globe` che questa catena raggiunge e perché nessun blocco **Files** del piano precedente lo nominava: un esecutore che avesse dato a `reconcile` un parametro `shellUnits` avrebbe dovuto modificare lo store, e lo store non era in nessuna riga `git add` di nessun task. La verifica è meccanica e non a occhio — `npm run build:all` nello Step 8 type-checka entrambi i programmi: se `tsc` nomina `aircraftStore.ts`, qualcuno ha threadato il parametro e va tolto, non staged.

- [x] **Step 6: `src/globe/aircraft.ts`, `src/globe/trails.ts`, `src/globe/raycaster.ts`, `src/globe/scene.ts`**

- In `AircraftLayer.update`, accanto a `const px = pointSizePx(frame.cameraDistance);` aggiungere `const shell = shellThicknessUnits(frame.cameraDistance);` e passarlo a ogni `positionAt`.
- In `aircraft.ts`, `writeLatLonAlt` (righe 263-277) prende un parametro `shellUnits` in più e la sua riga del raggio

  ```ts
  const radius = GLOBE_RADIUS + 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
  ```

  diventa

  ```ts
  const radius = GLOBE_RADIUS + shellOffset(shellUnits, altitudeFraction(altFt));
  ```

  Resta inline, resta senza allocazioni — che era la ragione vera di quella riga — e smette di avere una formula propria. Stesso trattamento al ramo senza moto di `writePoint`.
- **In `src/globe/trails.ts`, identico, perché è la terza copia.** `TrailsLayer.update` (dichiarata alle righe 47-56, implementata alla 98) guadagna un quarto parametro `shellUnits`, e `writeLatLonAlt` alla riga 195-209 subisce la stessa sostituzione riga per riga. Questo file non compariva da nessuna parte nella stesura precedente del piano: senza questo punto le scie resterebbero sul guscio vecchio e ogni aereo volerebbe staccato dalla propria scia.
- In `raycaster.ts:81`, `latLonAltToVec3(..., frame.cameraDistance)`.
- In `scene.ts`: la `PerspectiveCamera` prende `CAMERA_NEAR_PLANE` e `CAMERA_FAR_PLANE` invece di `0.1, 100`; `shell` si calcola **una volta sola** dentro `animate()`, accanto a `frame`, con `const shell = shellThicknessUnits(frame.cameraDistance);`; i due `latLonAltToVec3` (il soggetto del focus e la leader line) e la `positionAt` della leader line prendono `frame.cameraDistance` / `shell`; `trailsLayer.update(...)` e `arcLayer.update(...)` ricevono **lo stesso `shell`** che ricevono i puntini — lo stesso numero, non un secondo `shellThicknessUnits(frame.cameraDistance)`, perché due calcoli nello stesso fotogramma sono di nuovo due autorità e questo task esiste per toglierne tre.
- **`atmosphere.ts` non si tocca, e `scene.ts` non guadagna nessuna riga sull'alone.** Vedi D39 e §2.6: il materiale dipinge un'alpha costante su tutto il disco e il disco riempie l'inquadratura a ogni distanza sotto 2,715, quindi una dissolvenza avrebbe tolto `rgb(58, 66, 72)` da ogni pixel invece che niente da zero pixel.

- [x] **Step 6b: `src/globe/routeArc.ts` — l'arco scende sul guscio insieme ai puntini (D46)**

Le tre costanti delle righe 37-40 smettono di essere offset e diventano rapporti. **I tre denominatori sono lo stesso `0,075` di `SHELL_UNITS_FAR`**, e il risultato è un'identità esatta in doppia precisione — `0.075 * 0.24 === 0.018` è vero, e così gli altri due — quindi la vista pianeta non cambia di un bit, che è il vincolo dell'utente:

```ts
/**
 * How high the arc rides, as FRACTIONS of the per-frame altitude shell.
 *
 * These were three absolute offsets — 0,018, 0,012 and 0,055 — chosen when
 * the camera could not come closer than 1,9 and nothing above the surface
 * had to move. At 1,55 they put the apex of a short hop 0,019044 from the
 * camera, i.e. INSIDE a near plane of 0,02, and the apex of a near
 * antipodal route 0,033871 BEHIND it: the user asks to be taken to a
 * flight, arrives, and the route they asked for is not drawn (§2.7, D46).
 *
 * As ratios of SHELL_UNITS_FAR = 0,075 they are 0,24 / 0,16 / 11:15, and at
 * CAMERA_FAR_LIMIT the products are 0,018, 0,012 and 0,055 EXACTLY — not
 * nearly: the test asserts === and not toBeCloseTo.
 *
 * 0,24 is below the shell's own 1/3 floor on purpose. An arc has to pass
 * UNDER the aeroplane flying it and OVER the coastline (D47), which is a
 * different shape from the aircraft shell on the same thickness — so this
 * file does not call shellOffset, it takes shellUnits and states its own
 * shape, once.
 */
export const ARC_BASE_FRAC = 0.018 / 0.075;
export const ARC_APEX_MIN_FRAC = 0.012 / 0.075;
export const ARC_APEX_RANGE_FRAC = 0.055 / 0.075;
```

`geodesicPoints` prende `shellUnits` come terzo parametro — **obbligatorio, non con un default**, perché un default renderebbe invisibili al compilatore proprio i chiamanti che questo piano deve trovare (§4) — e la riga 118 diventa:

```ts
  const apexFrac = ARC_APEX_MIN_FRAC + ARC_APEX_RANGE_FRAC * (omega / Math.PI);
  // ...
    const radius =
      GLOBE_RADIUS + shellUnits * (ARC_BASE_FRAC + apexFrac * Math.sin(Math.PI * t));
```

`RouteArcLayer.update(arc, shellUnits)` lo passa a `geodesicPoints`. E il commento della riga 36 — «Just clear of the surface, and of the continent hairlines at R \* 1.003» — va riscritto, perché dopo D47 quella costa non sta più lì: la frase resta vera (`0,24 × guscio` è sopra `COASTLINE_LIFT` a ogni distanza) ma il numero che cita è sbagliato, e un commento che cita un numero che non esiste più è la copia che si aggiorna in un posto su due.

I due chiamanti che il compilatore troverà: `routeArc.ts:192` (dentro `update`) e `tests/unit/state/sceneView.test.ts:313`, che chiama `geodesicPoints` per verificare che due punti coincidenti diano `null` — lì `shellUnits` non conta e si passa `shellThicknessUnits(CAMERA_FAR_LIMIT)`.

- [x] **Step 6c: `src/globe/continents.ts` — la costa scende a scala vera (D47)**

Due sostituzioni, tutte e due di letterali:

```ts
// riga 24
const radius = GLOBE_RADIUS + COASTLINE_LIFT;
// riga 64
const steps =
  arc > COASTLINE_MAX_SEGMENT_DEG ? Math.ceil(arc / COASTLINE_MAX_SEGMENT_DEG) : 1;
```

e l'import da `./geoHelpers` guadagna i due nomi. La seconda sostituzione non è cosmetica: `COASTLINE_LIFT` **è** la saetta di `COASTLINE_MAX_SEGMENT_DEG`, quindi lasciare il `2.0` letterale qui sotto vorrebbe dire che qualcuno può allungare le corde senza alzare il sollevamento, e la costa tornerebbe dentro il pianeta — in silenzio, come sempre. Le due righe sono un vincolo solo e devono leggere lo stesso numero.

Cosa NON cambia in questo file: il materiale, il colore, l'opacità 0,45, `AdditiveBlending`, `depthWrite: false`, `depthTest: false`, `renderOrder = 2`, l'esclusione dell'Antartide e lo scarto dei salti d'antimeridiano. «Stessa grafica» vale anche qui, e la sola differenza visibile che D47 produce alla vista pianeta è **mezzo pixel al lembo** (0,54 px → 0,03 px).

- [x] **Step 7: Adeguare i test del Piano 2 che chiamano `positionAt` e `latLonAltToVec3`**

`tests/unit/globe/deadReckoning.test.ts`, `tests/unit/globe/motion.test.ts`, `tests/unit/globe/horizon.test.ts` e **ogni test che chiama `trailsLayer.update`**: passare `shellThicknessUnits(CAMERA_FAR_LIMIT)` e `CAMERA_FAR_LIMIT` dove i test del Piano 2 assumevano il guscio pieno. **Nessun valore atteso cambia**, perché D36 garantisce l'identità alla vista pianeta: è esattamente ciò che rende questo adeguamento meccanico invece che un ridisegno dei test.

E un test nuovo che il Piano 2 non poteva avere, perché il guscio non si muoveva: in `tests/unit/globe/shellAtDraw.test.ts`, **i puntini e le scie stanno sullo stesso guscio**. Costruire un aereo con una scia di due punti alla stessa quota, chiamare lo strato dei puntini e quello delle scie con lo **stesso** `shellUnits` a `CAMERA_NEAR_LIMIT`, e pretendere che il raggio dell'ultimo vertice della scia e quello del puntino coincidano a 1e-12. È l'asserzione che sarebbe fallita se `trails.ts` fosse rimasto fuori dal task.

- [x] **Step 7b: I test dell'arco e della costa — i tre casi misurati, non una soglia**

In `tests/unit/globe/routeArc.test.ts`, oltre a passare `shellThicknessUnits(CAMERA_FAR_LIMIT)` ai `geodesicPoints` già presenti (nessun valore atteso cambia: è l'identità di D46), aggiungere:

```ts
/**
 * The three routes §2.7 measured, and they are three different KINDS of
 * failure rather than three samples of one: a short hop whose apex lands
 * just inside the near plane, a long haul whose apex lands well inside it,
 * and a near antipodal route whose apex lands BEHIND the camera. A single
 * threshold test would have passed on two of the three.
 */
const ARC_CASES = [
  { name: 'LHR→CDG, short hop', a: { lat: 51.4775, lon: -0.4614 }, b: { lat: 49.0097, lon: 2.5479 } },
  { name: 'JFK→LHR, long haul', a: { lat: 40.6413, lon: -73.7781 }, b: { lat: 51.47, lon: -0.4543 } },
  { name: 'MAD→AKL, near antipodal', a: { lat: 40.4719, lon: -3.5626 }, b: { lat: -37.0082, lon: 174.785 } },
];

describe('the route arc rides the shell the aircraft ride', () => {
  it('is bit-for-bit what it was at planet view', () => {
    // "Vorrei mantenere la stessa grafica" is the constraint, and these
    // three products are exact in double precision — not nearly exact.
    const far = shellThicknessUnits(CAMERA_FAR_LIMIT);
    expect(far * ARC_BASE_FRAC).toBe(0.018);
    expect(far * ARC_APEX_MIN_FRAC).toBe(0.012);
    expect(far * ARC_APEX_RANGE_FRAC).toBe(0.055);
  });

  it('stays in front of the near plane at the bottom of the travel, on all three', () => {
    // The defect, in one loop. At 1,55 with the old absolute offsets the
    // short hop's apex was 0,019044 from the camera — inside a near plane
    // of 0,02 — the long haul's 0,004776, and the near antipodal one's
    // −0,033871, i.e. behind the camera. The user is taken to the flight
    // and the route they asked for is not there (D46).
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    for (const c of ARC_CASES) {
      for (const p of geodesicPoints(c.a, c.b, shell)!) {
        // Worst case for a camera that always looks at the origin: the
        // point sits straight under it, so its clearance is d − |p|.
        expect(CAMERA_NEAR_LIMIT - p.length(), `${c.name}`).toBeGreaterThan(
          CAMERA_NEAR_PLANE
        );
      }
    }
  });

  it('never puts a vertex behind the camera, on all three', () => {
    const shell = shellThicknessUnits(CAMERA_NEAR_LIMIT);
    for (const c of ARC_CASES) {
      for (const p of geodesicPoints(c.a, c.b, shell)!) {
        expect(p.length(), `${c.name}`).toBeLessThan(CAMERA_NEAR_LIMIT);
      }
    }
  });

  it('keeps the same ratio to the shell at EVERY distance, which is what stops it separating', () => {
    // Not a threshold: a ratio. A flight and its route come apart WHILE
    // zooming exactly when this ratio moves, and no single-distance
    // assertion can see that.
    for (const c of ARC_CASES) {
      const ratios: number[] = [];
      for (const d of [CAMERA_FAR_LIMIT, 6, 3, 1.9, CAMERA_NEAR_LIMIT]) {
        const shell = shellThicknessUnits(d);
        const pts = geodesicPoints(c.a, c.b, shell)!;
        const apex = Math.max(...pts.map((p) => p.length()));
        ratios.push((apex - GLOBE_RADIUS) / shell);
      }
      for (const r of ratios) expect(r, c.name).toBeCloseTo(ratios[0]!, 12);
    }
  });

  it('passes under the aircraft that flies it and over the coastline, at both ends', () => {
    // The arc's floor is 0,24 of the shell: below the aircraft floor of
    // 1/3 and above COASTLINE_LIFT (D46/D47). Both halves at both ends of
    // the travel, because an ordering that holds only at planet view is
    // the ordering this plan is here to fix.
    for (const d of [CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT]) {
      const shell = shellThicknessUnits(d);
      const pts = geodesicPoints(ARC_CASES[0]!.a, ARC_CASES[0]!.b, shell)!;
      const lowest = Math.min(...pts.map((p) => p.length())) - GLOBE_RADIUS;
      expect(lowest, `d=${d}`).toBeLessThan(altitudeToOffset(0, d));
      expect(lowest, `d=${d}`).toBeGreaterThan(COASTLINE_LIFT);
    }
  });
});
```

Gli import di quel file crescono di `ARC_BASE_FRAC`, `ARC_APEX_MIN_FRAC`, `ARC_APEX_RANGE_FRAC` da `@/globe/routeArc` e di `CAMERA_FAR_LIMIT`, `CAMERA_NEAR_LIMIT`, `CAMERA_NEAR_PLANE`, `COASTLINE_LIFT`, `altitudeToOffset`, `shellThicknessUnits` da `@/globe/geoHelpers`. `GLOBE_RADIUS` e `vec3ToLatLon` ci sono già.

E in `tests/unit/globe/continents.test.ts`, che oggi importa il solo `buildContinentsFromGeoJSON` e guadagna `COASTLINE_LIFT`, `COASTLINE_MAX_SEGMENT_DEG`, `GLOBE_RADIUS` da `@/globe/geoHelpers`.

**Prima una misura, perché la prima stesura di questo blocco falliva sulla propria fixture e la cosa da capire era quale delle tre parti avesse torto.** `ONE_SQUARE` produce **20 corde**. Eseguito il codice vero: con `expect(...).toBeGreaterThanOrEqual(GLOBE_RADIUS)` sui punti medi, **15 su 20** erano rosse. Non era la fixture — è rappresentativa, e anzi è il caso peggiore possibile. Le 15 rosse sono i lati che corrono sull'**equatore** e sui due **meridiani**: lì 2° di lat/lon sono 2° di cerchio massimo esatti, cioè la corda più lunga che la suddivisione ammette. Le 5 verdi sono il lato che corre sul **parallelo a 10° N**, dove 2° di longitudine valgono 1,9696° di cerchio massimo e la corda affonda meno. Il difetto era nelle altre due parti, tutte e due:

```
                                      punto medio − GLOBE_RADIUS, su 20 corde
 costante        lettura     sotto R    peggiore
 R(1−cos h)      double        15      −3,48e−8   ← la costante sbagliata (§2.7)
 R(sec h−1)      double         0      +2,2e−16   ← esatta: cade su R al bit
 R(sec h−1)      Float32        5      −1,07e−8   ← rumore di quantizzazione, non geometria
 nessun lift     Float32       20      −2,28e−4   ← ciò che il test deve continuare a vedere
```

Due difetti distinti, quindi, e due riparazioni in due posti. **Il primo** è la costante, e si ripara in `geoHelpers.ts` (§2.7, D47, Task 1 Step 3): `sec` e non `cos`. **Il secondo** è l'asserzione: `pos.getX(i)` legge un `Float32BufferAttribute`, dove un ulp a 1,5 vale `1,19e−7`. Un confronto `>= GLOBE_RADIUS` su quei numeri pretende una cifra che il buffer non trasporta — e lo stesso vale per il `toBeCloseTo(..., 12)` sui vertici, che chiede `5e−13` a un dato che ne porta `4,7e−8`. Le asserzioni esatte sulle due costanti stanno in `cameraTravel.test.ts`, in doppia precisione; **qui** si misura ciò che la GPU riceve davvero, con la tolleranza del quanto che lo trasporta. La tolleranza non ammorbidisce niente: senza sollevamento l'affondamento è di **1 917 ulp**, e questo test resta rosso con lo stesso margine di prima.

```ts
/**
 * One ulp of Float32 at GLOBE_RADIUS, which is in [1, 2): 2^-23 = 1,19e-7.
 *
 * Everything below reads a Float32BufferAttribute — the numbers the GPU is
 * actually handed — so this is the floor on what any of it can measure. The
 * exact statements about the lift are in cameraTravel.test.ts, in double
 * precision, on the two constants and nothing else (D47).
 */
const F32_ULP = 2 ** -23;

describe('the coastline is drawn at ground level', () => {
  it('lifts every drawn vertex just clear of the sphere and no further', () => {
    // R × 1,003 was 19,1 km of apparent altitude — taller than the whole
    // corrected shell, and 41,24 px of displacement at the edge of the
    // frame at 1,55 against the 25,24 px of a corrected aircraft. The
    // ground was lying more than the correction (D47).
    //
    // To within one Float32 ulp, and not to within 1e-12: the measured
    // spread of these radii is 4,7e-8, which is the attribute's own
    // rounding and nothing to do with the lift.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(Math.abs(r - (GLOBE_RADIUS + COASTLINE_LIFT))).toBeLessThan(F32_ULP);
    }
  });

  it('keeps every drawn CHORD outside the globe, which is the only reason the lift exists', () => {
    // The vertices are not the question: the midpoints are. A chord of
    // COASTLINE_MAX_SEGMENT_DEG sags below the sphere it samples, and the
    // globe mesh's vertices sit on that sphere, so at GLOBE_RADIUS exactly
    // the coast would pass THROUGH the planet in the middle of every
    // segment — invisible today only because nothing in this scene writes
    // depth (§2.7).
    //
    // Within one ulp, for the reason F32_ULP states: with the correct
    // constant these midpoints are ON GLOBE_RADIUS in double precision, so
    // what is left here is the sign of the rounding, which is not a fact
    // about geometry. The tolerance softens nothing — with no lift at all
    // the same midpoints sit 2,28e-4 under the surface, 1 917 ulps, and
    // this line goes red by the same margin it always did.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const mx = (pos.getX(i) + pos.getX(i + 1)) / 2;
      const my = (pos.getY(i) + pos.getY(i + 1)) / 2;
      const mz = (pos.getZ(i) + pos.getZ(i + 1)) / 2;
      expect(Math.hypot(mx, my, mz)).toBeGreaterThan(GLOBE_RADIUS - F32_ULP);
    }
  });

  it('subdivides by the same constant the lift is derived from', () => {
    // If the subdivision could grow without the lift growing, the chords
    // would sag back inside the planet. One number, two readers.
    const lines = buildContinentsFromGeoJSON(ONE_SQUARE);
    const pos = lines.geometry.getAttribute('position');
    const maxChord =
      2 * (GLOBE_RADIUS + COASTLINE_LIFT) *
      Math.sin((COASTLINE_MAX_SEGMENT_DEG * Math.PI) / 360);
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const len = Math.hypot(
        pos.getX(i + 1) - pos.getX(i),
        pos.getY(i + 1) - pos.getY(i),
        pos.getZ(i + 1) - pos.getZ(i)
      );
      expect(len).toBeLessThanOrEqual(maxChord * 1.001);
    }
  });
});
```

`ONE_SQUARE` è la `FeatureCollection` di dieci gradi di lato che quel file costruisce già nel suo primo test, estratta in una costante del modulo: quattro lati da 10°, ciascuno suddiviso in cinque corde da 2°, **20 corde in tutto**. Tre lati su quattro — l'equatore e i due meridiani — danno corde di 2° di cerchio massimo **esatti**, cioè il caso peggiore che la suddivisione ammette, ed è esattamente lì che il termine di secondo ordine si vede; il quarto, sul parallelo a 10° N, dà corde più corte e tiene onesto il confronto. Esercita quindi sia il taglio sia il sollevamento, e nel punto in cui entrambi sono al limite.

- [x] **Step 8: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run build:all
```

- [ ] **Step 9: Commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/types.ts \
             src/globe/deadReckoning.ts \
             src/globe/aircraft.ts \
             src/globe/trails.ts \
             src/globe/routeArc.ts \
             src/globe/continents.ts \
             src/globe/raycaster.ts \
             src/globe/scene.ts \
             src/state/aircraftStore.ts \
             tests/unit/globe/shellAtDraw.test.ts \
             tests/unit/globe/oneShellAuthority.test.ts \
             tests/unit/globe/atmosphereUnchanged.test.ts \
             tests/unit/globe/deadReckoning.test.ts \
             tests/unit/globe/motion.test.ts \
             tests/unit/globe/horizon.test.ts \
             tests/unit/globe/routeArc.test.ts \
             tests/unit/globe/continents.test.ts \
             tests/unit/state/sceneView.test.ts \
  && git commit -m "$(cat <<'EOF'
feat(globe): the altitude shell belongs to the camera, and has one author

Motion.radius was frozen when the batch was built, so a shell that thins
with the zoom could never have reached the dot. It becomes altFrac and the
draw loop composes the radius from a thickness computed once per frame:
two multiplications per aircraft, no transcendental call.

The formula had three copies. aircraft.ts and trails.ts each wrote it out
by hand inside a private writeLatLonAlt, so tsc stayed green while the
dots came down onto the new shell and the trails stayed on the old one —
every aircraft detached from its own trail at every zoom. Both now call
shellOffset, and a test reads the files to keep it that way.

The route arc and the coastline came down with them, because a shell that
reaches three of four lifted geometries is not a correction, it is a
separation. The arc's three absolute offsets become three fractions of the
same thickness: at 1,55 a short hop's apex used to sit 0,019044 from the
camera, inside a near plane of 0,02, and a near antipodal one 0,033871
BEHIND it — the user taken to a flight and shown no route. And the
coastline was drawn at R * 1,003, 19,1 km of apparent altitude: 41,24 px
of displacement at the edge of the frame against the 25,24 px of the
aircraft we had just corrected, with a cruising aircraft coming out BELOW
the coast it flies over. It is now the sag of the longest chord the
subdivision allows, measured AT the radius that chord is drawn on:
0,000228492, the fixed point R (sec h - 1) and not the sagitta
R (1 - cos h), which misses by its own second order and leaves every 2
degree chord 3,48e-8 inside the planet. The z-fighting the 1,003 looked
like it was for cannot happen here: not one material in this scene writes
depth.

The camera's near plane drops to 0,02 with the far at 20, so the ratio —
and the depth precision — is the 1 000 it already was. The atmosphere is
NOT touched: its fresnel is dead code under BackSide, it paints a constant
0,18 over the whole frame, and fading it out would have taken 58 levels of
red off every pixel of a globe the user asked to keep unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests
```

Atteso: **nessuna riga**. Due in particolare: `src/globe/atmosphere.ts` non deve comparire — se compare, qualcuno ha rimesso la dissolvenza (D39); e `src/state/aircraftStore.ts` non deve comparire **come modificato** — se compare, `reconcile` ha preso un parametro che lo Step 5 dice di non dargli, e la cosa da fare è toglierlo, non commetterlo.

**Test attesi dopo il Task 2: 682 passed.**

---

### Task 3: La priorità delle tile si stacca dal fondo corsa

**Files:**
- Modify: `src/data/sources/tileGrid.ts` — `nearestCoveringTile` e `viewPriorityTiles`
- Modify: `server/index.ts` — chiama l'unione invece di comporla
- Test: `tests/unit/data/sources/tileGrid.test.ts` (esteso)

**Due percorsi che la stesura precedente metteva in staging e che non esistono.** `tests/unit/data/tileGrid.test.ts` era il file dei test della griglia scritto **una directory troppo in alto**: quello vero è `tests/unit/data/sources/tileGrid.test.ts`, come `src/data/sources/tileGrid.ts`. E `tests/unit/server/viewPriority.test.ts` era elencato come «(nuovo)» senza che **nessuno step lo creasse**. Non è una svista cosmetica: `git add` su un pathspec che non corrisponde a niente stampa `fatal: pathspec ... did not match any files` ed **esce con 1**, quindi la catena `&& git commit` si interrompe e il commit di questo task **non avviene mai** — i test e il codice restano fuori dal repo e il Task 4 parte da un albero sporco. È il quinto difetto di cucitura di questo progetto, e il primo che fallisce rumorosamente invece che in silenzio.
La seconda riparazione non è solo togliere il percorso: il test del server serviva, e serve ancora. Serve **dove si può scrivere senza avviare un server**, cioè sopra una funzione pura. `viewPriorityTiles` è quella funzione, e `server/index.ts` smette di comporre un'unione a mano dentro un handler che nessun test unitario raggiunge.

**Interfaces:**
- Produces: `nearestCoveringTile(grid: Tile[], centre: GeoPoint): Tile | null`, `viewPriorityTiles(grid: Tile[], centre: GeoPoint, radiusNm: number, limit: number): string[]`

- [x] **Step 1: Estendere `tests/unit/data/sources/tileGrid.test.ts`**

`haversineNm` esiste già in quel file (riga 116) ed è scritto apposta indipendentemente dalla sorgente, «so the ordering assertions cannot be satisfied by a shared bug»: si riusa, non si riscrive. L'unico aiuto nuovo è `farthestCoveredSample`, che ripercorre le stesse dieci caselle del test di copertura e restituisce il punto peggiore — quello a 218,0 NM dal centro più vicino, che è esattamente il caso che D38 esiste per servire.

```ts
/** The covered point farthest from any tile centre: the 218,0 NM worst case. */
function farthestCoveredSample(grid: ReturnType<typeof buildTileGrid>): GeoPoint {
  let worst = { lat: 0, lon: 0 };
  let worstD = -1;
  for (const [latMin, latMax, lonMin, lonMax] of SAMPLE_BOXES) {
    for (let lat = latMin; lat <= latMax + 1e-9; lat += 0.5) {
      for (let lon = lonMin; lon <= lonMax + 1e-9; lon += 0.5) {
        let nearest = Infinity;
        for (const t of grid) {
          const d = haversineNm({ lat, lon }, t.centre);
          if (d < nearest) nearest = d;
        }
        if (nearest > worstD) {
          worstD = nearest;
          worst = { lat, lon };
        }
      }
    }
  }
  return worst;
}

describe('nearestCoveringTile — which tile CONTAINS what is being looked at', () => {
  const grid = buildTileGrid();

  it('names a tile for every covered point, at any view radius', () => {
    // This is the assertion that used to live in pointSize.test.ts as a
    // floor under the camera. The grid guarantee — no covered point more
    // than 218,0 NM from a centre, on 1 224 760 samples (tileGrid.ts:60-62)
    // — stops being a constraint on the zoom and becomes the PROOF that
    // this function never comes back empty over a covered region (D38).
    for (const sample of [
      { lat: 45.46, lon: 9.19 },   // Milano
      { lat: 40.71, lon: -74.0 },  // New York
      { lat: 1.35, lon: 103.82 },  // Singapore
      { lat: -33.87, lon: 151.21 },// Sydney
      { lat: 19.07, lon: 72.88 },  // Mumbai
    ]) {
      const tile = nearestCoveringTile(grid, sample);
      expect(tile, `${sample.lat},${sample.lon}`).not.toBeNull();
      expect(haversineNm(sample, tile!.centre)).toBeLessThanOrEqual(TILE_RADIUS_NM);
    }
  });

  it('refuses rather than naming a tile that covers nothing on screen', () => {
    // Mid-Pacific: the nearest centre is thousands of NM away and
    // prioritising it would spend a slot on a tile nobody can see. Null is
    // the truth here, not a shortfall — there is no data to refresh.
    expect(nearestCoveringTile(grid, { lat: 0, lon: -150 })).toBeNull();
  });

  it('agrees with tilesNear whenever tilesNear says anything at all', () => {
    const centre = { lat: 45.46, lon: 9.19 };
    const wide = tilesNear(grid, centre, 400);
    expect(wide.length).toBeGreaterThan(0);
    expect(nearestCoveringTile(grid, centre)!.id).toBe(wide[0]!.id);
  });

  it('is what a 39,6 NM viewport gets when tilesNear gets nothing', () => {
    // The whole point. At the new zoom floor the cap is 39,6 NM and a
    // viewer can sit 218 NM from the nearest centre: tilesNear returns
    // nothing and, before this, the region on screen silently stopped
    // jumping the queue.
    const lonely = farthestCoveredSample(grid);
    expect(tilesNear(grid, lonely, 39.6)).toHaveLength(0);
    expect(nearestCoveringTile(grid, lonely)).not.toBeNull();
  });
});

describe('viewPriorityTiles — the union, where a unit test can reach it', () => {
  const grid = buildTileGrid();

  it('puts the covering tile FIRST when the radius missed it', () => {
    // This is the assertion the plan used to put in a
    // tests/unit/server/viewPriority.test.ts that no step ever created —
    // a path on a `git add` line that matched nothing, which exits 1 and
    // takes the commit with it. The union belongs in a pure function, and
    // then it belongs in this file.
    const lonely = farthestCoveredSample(grid);
    const ids = viewPriorityTiles(grid, lonely, 39.6, 6);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(nearestCoveringTile(grid, lonely)!.id);
  });

  it('does not name the covering tile twice when the radius already had it', () => {
    const centre = { lat: 45.46, lon: 9.19 };
    const ids = viewPriorityTiles(grid, centre, 400, 6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(nearestCoveringTile(grid, centre)!.id);
  });

  it('honours the limit, because half of each poller batch is the rotation', () => {
    expect(viewPriorityTiles(grid, { lat: 45.46, lon: 9.19 }, 2000, 6)).toHaveLength(6);
  });

  it('returns nothing at all over the mid-Pacific, which is the truth there', () => {
    // No tile covers it and none is within the radius: prioritising the
    // nearest centre thousands of NM away would spend a slot on a tile
    // nobody can see. Empty is not a shortfall (D38).
    expect(viewPriorityTiles(grid, { lat: 0, lon: -150 }, 39.6, 6)).toEqual([]);
  });

  it('never inflates the radius it was given', () => {
    // D15 applied to a protocol: the client declares what it is looking at
    // and the server answers that, rather than the client declaring more
    // so the old arithmetic keeps working.
    const centre = { lat: 45.46, lon: 9.19 };
    const narrow = viewPriorityTiles(grid, centre, 39.6, 6);
    const wide = viewPriorityTiles(grid, centre, 400, 6);
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow.every((id) => wide.includes(id))).toBe(true);
  });
});
```

`SAMPLE_BOXES` è l'array `boxes` che il test di copertura costruisce già alla riga 44, estratto in una costante del modulo: le stesse dieci caselle, lette da due test invece che da uno, perché due elenchi di caselle sarebbero due idee di che cosa è coperto.

- [x] **Step 2: Verificare il rosso, poi implementare in `src/data/sources/tileGrid.ts`**

```ts
/**
 * The tile that CONTAINS this point, or null when none does.
 *
 * tilesNear answers "which tile centres fall inside my radius", which was
 * the right question while the camera could not frame less than 322 NM. At
 * 39,6 NM it is the wrong one: a viewer 218 NM from the nearest centre
 * names nothing and the region on screen quietly stops jumping the poller's
 * queue. The honest fix is not to inflate the radius the client declares —
 * that is D15 applied to a protocol — but to ask the question that was
 * always meant: which tile covers what I am looking at (D38).
 *
 * TILE_RADIUS_NM, not the nearest centre unconditionally: over the
 * mid-Pacific the nearest centre is thousands of NM away, covers nothing on
 * screen, and prioritising it would spend a slot — half of each poller
 * batch — on a tile nobody can see.
 */
export function nearestCoveringTile(grid: Tile[], centre: GeoPoint): Tile | null {
  let best: Tile | null = null;
  let bestD = TILE_RADIUS_NM;
  for (const tile of grid) {
    const d = distanceNm(centre, tile.centre);
    if (d <= bestD) {
      bestD = d;
      best = tile;
    }
  }
  return best;
}

/**
 * The tiles to prioritise for a viewer at `centre` framing `radiusNm`.
 *
 * The union lives HERE, and not inside the request handler, for one
 * mechanical reason: a `server/index.ts` route is reachable only by starting
 * a server, so an assertion about it can only be written by a test that
 * boots one. An earlier draft of this plan declared exactly such a test —
 * tests/unit/server/viewPriority.test.ts — listed it as new, never wrote a
 * step that created it, and then put it on a `git add` line, where a
 * pathspec matching nothing exits 1 and takes the commit with it. Four
 * sentences in a pure function cost nothing and can be asserted.
 *
 * The tile that COVERS the centre always comes first; the radius decides
 * only how many more follow. `limit` is the caller's policy, not this
 * module's: server/index.ts reserves half of each poller batch for the
 * rotation, which is why it passes 6.
 */
export function viewPriorityTiles(
  grid: Tile[],
  centre: GeoPoint,
  radiusNm: number,
  limit: number
): string[] {
  const wanted = tilesNear(grid, centre, radiusNm);
  const covering = nearestCoveringTile(grid, centre);
  if (covering !== null && !wanted.some((t) => t.id === covering.id)) {
    wanted.unshift(covering);
  }
  return wanted.slice(0, limit).map((t) => t.id);
}
```

- [x] **Step 3: `server/index.ts` — chiamare l'unione**

Sostituire le righe 447-450 con:

```ts
    // The tile UNDER the camera always jumps the queue; the radius only
    // decides how many more do. Below a 218 NM cap tilesNear can return
    // nothing at all while the viewer is staring straight at a covered
    // region, and the client must never inflate its declared radius to work
    // around that (D38).
    //
    // Six, not twelve: the scheduler reserves half of each batch for the
    // rotation, so asking for more only grows a queue that cannot be served.
    // The number is the server's policy and stays here; the union is
    // viewPriorityTiles' and stays where a unit test can reach it.
    scheduler.prioritise(viewPriorityTiles(tiles, { lat: viewLat, lon: viewLon }, radius, 6));
```

e l'import di `tilesNear` da `../src/data/sources/tileGrid.js` diventa `viewPriorityTiles` — con il suffisso `.js`, perché questo è il programma `NodeNext` e mai `@/` (§4). Se `tilesNear` resta senza altri lettori in questo file, `noUnusedLocals` lo dice.

- [x] **Step 4: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run build:all
```

- [ ] **Step 5: Staging, uno per uno, e commit**

Prima della riga `git add`, la verifica che la stesura precedente non aveva e che le sarebbe costata il commit — **ogni percorso che si sta per mettere in staging deve esistere**:

```bash
cd /home/riccardo/projects/air-view && ls -1 src/data/sources/tileGrid.ts server/index.ts tests/unit/data/sources/tileGrid.test.ts
```

Atteso: tre righe, nessun `No such file`. `git add` su un pathspec che non corrisponde a niente esce con 1 e porta via la catena `&&`, quindi questo `ls` è la differenza fra un commit e un albero sporco.

```bash
cd /home/riccardo/projects/air-view \
  && git add src/data/sources/tileGrid.ts \
             server/index.ts \
             tests/unit/data/sources/tileGrid.test.ts \
  && git commit -m "$(cat <<'EOF'
feat(server): the tile under the camera always jumps the queue

The union moved into viewPriorityTiles, a pure function, because the
earlier shape of this change lived inside a request handler and could only
have been asserted by a test that boots a server — one that was listed as
new, never written, and then put on a git add line, where a pathspec
matching nothing exits 1 and takes the commit with it.

tilesNear asks which tile CENTRES fall inside the declared radius, and
that was the right question while the camera could not frame less than
322 NM. At 39,6 NM it is the wrong one: a viewer 218 NM from the nearest
centre names no tile at all and the region on screen quietly stops being
refreshed first. nearestCoveringTile asks what was always meant — which
tile covers the point being looked at — so the zoom floor stops being the
server's business and the client never has to inflate the radius it
declares, which would be D15 applied to a protocol.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src server tests
```

Atteso: **nessuna riga**.

**Test attesi dopo il Task 3: 695 passed.**

---

### Task 4: La cartografia fine e le città, costruite in fase di build

Qui non si disegna niente: si produce il dato. `scripts/build-static-data.mjs` smette di scrivere il GeoJSON delle città verbatim e scrive due file nuovi, e il client guadagna un codec puro che si testa senza una GPU e senza una rete.

**Files:**
- Modify: `scripts/build-static-data.mjs` — scarica 10m, semplifica, codifica; `cities.json`; smette di scrivere `ne_50m_populated_places.geojson` e lo cancella se c'è
- Modify: `package.json` — `"build:static": "tsx scripts/build-static-data.mjs"`, accanto a `build:routes`, perché da qui lo script **importa** il codec invece di ricopiarlo
- Create: `src/globe/coastlineCodec.ts` — il formato, il codificatore e il decodificatore, in **un file solo**
- Create: `tests/unit/globe/coastlineCodec.test.ts`
- Create: `public/data/coastline-10m.bin`, `public/data/cities.json` — generati. **`public/data/` non è in `.gitignore`** e gli altri generati (`airports.json`, `airlines.json`) sono tracciati, quindi questi due vanno aggiunti a mano o non entreranno mai nel repo
- Delete: `public/data/ne_50m_populated_places.geojson` — **tracciato** (`git ls-files public/data` lo elenca). La cancellazione va messa in staging come una modifica, o i 3,2 MB che D45 dichiara di togliere restano dove sono

**Interfaces:**
- Produces: `public/data/coastline-10m.bin`, `public/data/cities.json`; `encodeCoastline(rings: Int32Array[]): ArrayBuffer`, `decodeCoastline(buffer: ArrayBuffer): { rings: Int32Array[] }`, `encodedByteLength(rings: Int32Array[]): number`, `COASTLINE_MAGIC`, `COASTLINE_VERSION`, `COASTLINE_UNITS_PER_DEGREE`
- (`BUCKET_DEGREES` non è di questo task: è del Task 5, dove si disegna)

#### Il formato, e perché non è quello che questo piano diceva prima

Dichiarato qui perché due programmi lo devono leggere allo stesso modo — ed è **a corse contate, non a sentinelle**.

```
offset  tipo    campo
  0     u8[4]   magic "AVC1"
  4     u16     version = 1
  6     u16     reserved = 0
  8     u32     unitsPerDegree = 100000      (1e-5 deg = 1,1 m)
 12     u32     ringCount
 16     u32     pointCount        — totale su tutti gli anelli
 20     ...     per anello:  u32 runCount
                  per corsa:   i32 lon0, i32 lat0, u32 deltaCount
                               deltaCount × (i16 dLon, i16 dLat)
                  (tutti gli interi little-endian)
```

Una **corsa** è un punto assoluto seguito da quanti delta ci stanno in un Int16. Quando un delta sfora, la corsa finisce e ne comincia un'altra: è lo stesso meccanismo che la stesura precedente chiamava «restart», ma dichiarato da un **conteggio già letto** invece che da un byte che si spera unico.

**Perché non un tag.** La stesura precedente scriveva `point 0 : u8 tag = 0xFF, i32 lon, i32 lat` e `point k : i16 dLon, i16 dLat` **oppure** di nuovo il tag, e lasciava al decodificatore il compito di distinguerli sbirciando il primo byte. Non si può. Un punto delta è `i16 dLon, i16 dLat` little-endian, quindi il suo primo byte è il **byte basso di `dLon`**: ogni `dLon` con `(dLon & 0xFF) === 0xFF` produce un byte indistinguibile dal tag. Sono **256 valori su 65 536**, uno ogni 128, e fra loro c'è `dLon = −1` — circa 1,1 m verso ovest, il delta che una linea di costa produce di continuo. Il decodificatore avrebbe letto 9 byte invece di 4, si sarebbe disallineato, e da lì in poi avrebbe disegnato una costa che non esiste **senza accorgersene**. Né l'endianness salva: in big-endian il primo byte è quello alto, e vale `0xFF` per ogni `dLon` fra −256 e −1.

**Perché non un sentinella fuori dallo spazio dei valori.** Riservare `dLon = −32768` (`0x8000`) funzionerebbe davvero: nessun delta legittimo lo userebbe, perché −32768 unità sono già di per sé uno sforamento. È stato scartato lo stesso, per una ragione che vale più dei 18 KB che fa risparmiare: sposta la correttezza dal **formato** al **codificatore**. Il decodificatore non può verificare che quel valore non sia mai stato emesso, può solo fidarsi; e chiunque un domani allargasse l'intervallo dei delta — una tolleranza più grossa, una semplificazione più aggressiva — riaprirebbe la stessa falla senza toccare una riga del decodificatore, e di nuovo in silenzio. I conteggi invece rendono l'ambiguità **strutturalmente impossibile**: il cursore non guarda mai il contenuto per sapere dove andare, perché ogni byte ha un ruolo deciso da numeri già letti.

E i conteggi pagano altre due cose:
- **la lunghezza è calcolabile in anticipo** — `20 + ringCount×4 + runCount×12 + deltaCount×4` — quindi un file troncato si riconosce con un confronto invece che con un `catch`, ed è esattamente l'asserzione che lo Step 1 pretende;
- **`pointCount` in testa è l'unica preallocazione che serve**: 524 028 punti in un buffer solo, nessun array che cresce. Non è una seconda autorità sullo stesso numero — è una cifra di controllo, e il decodificatore alla fine pretende *sia* che i punti scritti siano `pointCount` *sia* che il cursore sia esattamente `byteLength`, e lancia se le due cose non coincidono.

**Il prezzo, contato.** L'intestazione di corsa costa 12 byte dove il record taggato ne costava 9. Sui conteggi misurati in §2.3 — 4 095 anelli, 524 028 punti, 6 029 assoluti, 517 999 delta — sono **2 160 744 byte (2,06 MB)** contro 2 142 653 (2,04 MB): **+18 091 byte, +0,84 %**. Con la semplificazione a 0,0008° sono ≈ **1,91 MB** contro 1,89. Resta sotto i 2,94 MB di 50m che spediamo già oggi, ed è la differenza fra un file che si decodifica e uno che no.

- [x] **Step 1: Creare `tests/unit/globe/coastlineCodec.test.ts`**

Il test centrale è il primo, e non è un caso di contorno: è il caso che ha rotto la prima versione del formato.

```ts
import { describe, it, expect } from 'vitest';
import {
  COASTLINE_MAGIC,
  COASTLINE_UNITS_PER_DEGREE,
  COASTLINE_VERSION,
  decodeCoastline,
  encodeCoastline,
  encodedByteLength,
} from '@/globe/coastlineCodec';

/** A ring is a flat Int32Array of [lon, lat] pairs in 1e-5 degree units. */
function ring(lon0: number, lat0: number, deltas: Array<[number, number]>): Int32Array {
  const out = new Int32Array((deltas.length + 1) * 2);
  out[0] = lon0;
  out[1] = lat0;
  for (let i = 0; i < deltas.length; i++) {
    out[(i + 1) * 2] = out[i * 2]! + deltas[i]![0];
    out[(i + 1) * 2 + 1] = out[i * 2 + 1]! + deltas[i]![1];
  }
  return out;
}

function roundTrip(rings: Int32Array[]): Int32Array[] {
  return decodeCoastline(encodeCoastline(rings)).rings;
}

describe('the coastline format cannot be mis-framed', () => {
  it('round-trips a ring whose every delta is dLon = -1', () => {
    // THE case. -1 unit is 1,1 m west, the commonest delta a coastline
    // produces, and as an Int16 it is 0xFFFF — whose FIRST byte is 0xFF.
    // The first version of this format used 0xFF as the restart tag, so a
    // decoder peeking at that byte read nine bytes instead of four, lost
    // alignment, and from there drew a world that does not exist without
    // an error, a warning or a line in FeedStatus. Counts make that
    // unreachable, and this test is why the format has them (D40).
    const r = ring(900_000, 4_500_000, Array.from({ length: 64 }, () => [-1, -1] as [number, number]));
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips every single Int16 delta whose low byte is 0xFF', () => {
    // 256 of the 65 536 values collide with a 0xFF tag, one every 128.
    // Not one of them may be special.
    const nasty: Array<[number, number]> = [];
    for (let d = -32_768; d <= 32_767; d++) if ((d & 0xff) === 0xff) nasty.push([d, -d]);
    expect(nasty).toHaveLength(256);
    const r = ring(0, 0, nasty);
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips a ring that overflows Int16 in the middle, which is what a run break is for', () => {
    const r = ring(-1_000_000, 200_000, [
      [-1, -1],
      [900_000, -900_000], // no Int16 holds this: the run ends and another starts
      [-1, 0],
      [0, 32_767],
      [-32_768 + 1, 1],
    ]);
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips three rings and keeps them three', () => {
    const rings = [ring(0, 0, [[-1, -1]]), ring(17, -17, []), ring(-5, 5, [[1, 1], [-1, -1]])];
    const back = roundTrip(rings);
    expect(back).toHaveLength(3);
    rings.forEach((r, i) => expect(Array.from(back[i]!)).toEqual(Array.from(r)));
  });

  it('says in advance exactly how long the file will be', () => {
    // A length computed rather than discovered is how truncation gets
    // caught by comparison instead of by a crash.
    const rings = [ring(0, 0, [[-1, -1], [2, 2]]), ring(10, 10, [[70_000, 1]])];
    expect(encodeCoastline(rings).byteLength).toBe(encodedByteLength(rings));
  });

  it('keeps coordinates inside 1e-5 degrees through the round trip', () => {
    const lon = Math.round(9.18951 * COASTLINE_UNITS_PER_DEGREE);
    const lat = Math.round(45.46427 * COASTLINE_UNITS_PER_DEGREE);
    const back = roundTrip([ring(lon, lat, [[-1, 3]])])[0]!;
    expect(Math.abs(back[0]! / COASTLINE_UNITS_PER_DEGREE - 9.18951)).toBeLessThan(1e-5);
    expect(Math.abs(back[1]! / COASTLINE_UNITS_PER_DEGREE - 45.46427)).toBeLessThan(1e-5);
  });

  it('refuses a foreign file instead of drawing one', () => {
    const buf = encodeCoastline([ring(0, 0, [[1, 1]])]);
    new Uint8Array(buf)[0] = 0x00;
    expect(() => decodeCoastline(buf)).toThrow(/coastline-10m\.bin/);
  });

  it('refuses a version it was not written for', () => {
    const buf = encodeCoastline([ring(0, 0, [[1, 1]])]);
    new DataView(buf).setUint16(4, COASTLINE_VERSION + 1, true);
    expect(() => decodeCoastline(buf)).toThrow(/version/i);
  });

  it('refuses a truncated file instead of returning half a world', () => {
    // D42 from its worst side: half-decoded data is worse than none,
    // because it draws a coastline nobody can tell from the real one.
    const full = encodeCoastline([ring(0, 0, [[-1, -1], [-1, -1], [-1, -1]])]);
    expect(() => decodeCoastline(full.slice(0, full.byteLength - 2))).toThrow(/truncat/i);
  });

  it('refuses a file whose counts do not add up to its length', () => {
    const buf = encodeCoastline([ring(0, 0, [[-1, -1], [-1, -1]])]);
    new DataView(buf).setUint32(16, 99, true); // pointCount lies
    expect(() => decodeCoastline(buf)).toThrow();
  });

  it('declares the two numbers the build script shares with the client', () => {
    expect(COASTLINE_MAGIC).toBe('AVC1');
    expect(COASTLINE_UNITS_PER_DEGREE).toBe(100_000);
  });
});
```

- [x] **Step 2: Implementare `src/globe/coastlineCodec.ts`**

`DataView`, nessuna dipendenza, **nessun `import`**, nessun `fetch`: la rete sta nel Task 5 e questo file si testa in Node. Contiene **codificatore e decodificatore insieme**, perché il formato è una cosa sola e due file sarebbero due autorità su di essa — che è precisamente il difetto che questo piano ha già dovuto riparare due volte. `encodeCoastline` lo usa solo la build e `decodeCoastline` solo il client; `noUnusedLocals` non si lamenta di un export.

Il decodificatore non sbircia **mai** un byte per decidere quanto leggere: legge `runCount`, poi per ogni corsa legge `deltaCount` e avanza di `12 + 4 × deltaCount` byte. Alla fine pretende `cursor === buffer.byteLength` e `written === pointCount`, e lancia un `Error` che **nomina `public/data/coastline-10m.bin`** se una delle due non torna — perché un messaggio che non dice quale file è un messaggio che costa mezz'ora.

- [x] **Step 3: Estendere `scripts/build-static-data.mjs`**

Sostituire il blocco delle due GeoJSON (righe 26-30) con: 50m countries verbatim (invariato); 10m countries scaricato, anelli esterni estratti, Douglas-Peucker a `0.0008`, codificato con `encodeCoastline`; 50m populated places scaricato, trasformato in `cities.json`, e il verbatim — `public/data/ne_50m_populated_places.geojson`, che è **tracciato da git** — **cancellato** dal disco con `fs.rm(..., { force: true })`. Il percorso si scrive per esteso qui perché è l'unico file del piano che nessuno *scrive*, e un file che solo la riga di staging nomina è un file che un esecutore dimentica. Lo script stampa i byte veri di ogni file e il `runCount`, perché le cifre di §2.3 devono restare verificabili dopo ogni ricostruzione.

Il codec **non si ricopia**: lo script lo importa. Il precedente esiste già nel repo e questo task lo lascia stare: `scripts/build-route-cache.mjs` importa il modulo della griglia alla riga 28 e gira sotto `tsx`.

Per questo `package.json` guadagna `"build:static": "tsx scripts/build-static-data.mjs"` accanto a `build:routes`, e da qui in avanti lo script si lancia con quello e non più con `node`.

```js
import { encodeCoastline, COASTLINE_UNITS_PER_DEGREE } from '../src/globe/coastlineCodec.js';

// 0,0008 deg = 89 m = half a pixel at the deepest zoom the camera reaches
// (0,0989 NM/px at CAMERA_NEAR_LIMIT = 1,55, src/globe/geoHelpers.ts).
// Measured: at this tolerance simplification keeps 92 % of the points, so
// the saving comes from the ENCODING, not from dropping detail. At 0,012
// the file would be 0,68 MB and the error 7,3 px — half a symbol, i.e. the
// coastline would lie more than the 50m level lies today.
const COASTLINE_TOLERANCE_DEG = 0.0008;
```

`COASTLINE_UNITS_PER_DEGREE` arriva dal codec e **non** è una seconda copia. Era l'unico numero che §7 dichiarava allineato a mano; con l'import quel rischio sparisce invece di essere sorvegliato, ed è la scelta giusta perché un formato binario disallineato non dà un errore, dà una costa sbagliata. Nello script resta solo `COASTLINE_TOLERANCE_DEG`, che il client non legge mai.

- [x] **Step 4: Eseguire lo script e verificare le cifre**

```bash
cd /home/riccardo/projects/air-view && npm run build:static && ls -l public/data/
```

Atteso: `coastline-10m.bin` ≈ **1,91 MB**, `cities.json` ≈ 84 KB, `ne_50m_populated_places.geojson` **assente dal disco**. Se `coastline-10m.bin` esce oltre 2,2 MB o `cities.json` oltre 100 KB, fermarsi: una delle misure di §2.3 non regge più e il piano va rimisurato, non adattato.

E la verifica che lega i byte all'aritmetica del formato, che è l'unica che accorgerebbe di una corsa scritta male:

```bash
cd /home/riccardo/projects/air-view && npx tsx -e "
import { readFileSync } from 'node:fs';
import { decodeCoastline, encodedByteLength } from './src/globe/coastlineCodec.ts';
const b = readFileSync('public/data/coastline-10m.bin');
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { rings } = decodeCoastline(ab);
console.log('rings', rings.length, 'bytes', ab.byteLength, 'recomputed', encodedByteLength(rings));
"
```

Atteso: `bytes` e `recomputed` **identici**. Se differiscono, il file si decodifica ma non si ri-codifica allo stesso modo, e il formato ha un ramo che nessun test copre.

- [x] **Step 5: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run build:all
```

- [ ] **Step 6: Staging, uno per uno, cancellazione compresa**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/globe/coastlineCodec.ts \
             tests/unit/globe/coastlineCodec.test.ts \
             scripts/build-static-data.mjs \
             package.json \
             public/data/coastline-10m.bin \
             public/data/cities.json \
  && git add -- public/data/ne_50m_populated_places.geojson
```

L'ultima riga è separata apposta: quel percorso **non esiste più sul disco**, è tracciato, e `git add` su un percorso tracciato e cancellato mette in staging la **cancellazione**. Senza di essa il file resta nel repo e nel bundle, e i 3,2 MB che D45 dichiara di risparmiare non vengono risparmiati — il difetto di cucitura che questo progetto ha già pagato cinque volte. Mai `git add -A`: `.agents/`, `.claude/`, `mockups/` e `skills-lock.json` sono qui e non sono ignorati.

Verifica, prima del commit:

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests scripts package.json public/data
```

Atteso: **nessuna riga**. Una riga `??` su `public/data/` significa che un file generato non è in staging; una riga ` D` significa che la cancellazione non lo è.

- [ ] **Step 7: Commit**

```bash
cd /home/riccardo/projects/air-view && git commit -m "$(cat <<'EOF'
feat(data): a 10m coastline that is 1,91 MB and cannot be mis-framed

The first draft of this format tagged absolute points with 0xFF, which
collides with every Int16 delta whose low byte is 0xFF — 256 values out of
65 536, among them dLon = -1, about 1,1 m west and the commonest delta a
coastline produces. A decoder peeking at that byte reads nine bytes
instead of four, loses alignment, and from there draws a world that is not
there, with no error and no warning. Counted runs cost 0,84 % more and
cannot be mis-framed at all: no byte's role is ever decided by its own
value, and the file's length is computable before it is read.

The encoder and the decoder are one module, imported by the build script
under tsx the way build-route-cache.mjs already imports tileGrid, so the
fixed-point divisor stops being a copy aligned by hand.

The 3,2 MB of populated places nobody has ever read leaves the bundle as
an 84 KB cities.json. Net: -1,36 MB, while the globe gains detail.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Test attesi dopo il Task 4: 712 passed.**

---

### Task 5: Il livello fine entra in scena, a secchi e a blocchi

**Files:**
- Create: `src/globe/coastlineFine.ts` — secchi, costruzione a blocchi, cancello di zoom, dissolvenza
- Modify: `src/globe/continents.ts` — diventa esplicitamente il livello COARSE e guadagna un'opacità
- Modify: `src/globe/scene.ts` — monta il livello fine e lo aggiorna per fotogramma
- Test: `tests/unit/globe/coastlineFine.test.ts` (nuovo)

**Interfaces:**
- Produces: `bucketIndex(lat, lon): number`, `bucketCentreDirection(index): Vector3`, `bucketVisible(index, cameraDir, capHalfAngleRad): boolean`, `createFineCoastline(): FineCoastline` con `{ group, feedChunk(budgetVertices): boolean, update(cameraDistance, cameraPos, capNm, nowMs): void }`
- Consumes: `decodeCoastline`, `visibleCapRadiusNm`, `CAMERA_NEAR_LIMIT`, **`COASTLINE_LIFT`, `COASTLINE_MAX_SEGMENT_DEG`** — gli stessi due di `continents.ts`, non due suoi: due coste a due altezze si sdoppierebbero per 300 ms a ogni dissolvenza incrociata, e due suddivisioni diverse romperebbero la saetta su cui il sollevamento è calcolato (D47)

Le costanti, tutte misurate in §2.3:

```ts
/** 10° buckets: 359 non-empty, at most 131 722 vertices in view at the
 *  switch distance — fewer than the 186 010 the 50m level pushes at EVERY
 *  frame today. 5° would be 100 094 but 954 scene objects instead of 359,
 *  and the number that matters is under the 50m figure either way (D41). */
export const BUCKET_DEGREES = 10;
/** Where the fine level replaces the coarse one. Measured: the 50m mean
 *  segment is 7,03 px here and 11,3 px at 1,75 — past that a coast stops
 *  reading as a coast and reads as a polygon, which is what the user is
 *  looking at now. Above it, 43 % and more of the 10m segments are
 *  sub-pixel: detail paid for and not seen (D41). */
export const FINE_SWITCH_DISTANCE = 1.9;
/** Where the download starts: 1,91 MB at 10 Mbit/s is 1,6 s and the
 *  chunked build takes 0,25 s more, so it begins before it is needed. */
export const FINE_PREFETCH_DISTANCE = 2.6;
/** 0,0626 µs per vertex measured, so 64 000 is 4,0 ms — a quarter of a
 *  16,7 ms frame. One 65,1 ms pass would be four dropped frames at the
 *  exact moment the user is zooming. */
export const FINE_BUILD_CHUNK_VERTICES = 64_000;
/** The editorial window DESIGN.md sets, the one FOCUS_FADE_MS and
 *  RECONCILE_MS already occupy. On the rAF clock, never Date.now(). */
export const FINE_CROSSFADE_MS = 300;
```

- [x] **Step 1: Creare `tests/unit/globe/coastlineFine.test.ts`** — le funzioni pure, senza GPU:
  - `bucketIndex` copre il mondo senza buchi né sovrapposizioni, e i poli e l'antimeridiano stanno in un secchio solo;
  - `bucketVisible` **non è mai un falso negativo**: su 10 000 punti casuali, se il punto è dentro il cap allora il suo secchio è visibile (un falso positivo costa vertici, un falso negativo è un pezzo di costa che sparisce — e sparire senza dirlo è D42);
  - al limite superiore, il numero di secchi visibili a `FINE_SWITCH_DISTANCE` moltiplicato per il secchio più grande resta sotto i 186 010 vertici del livello 50m;
  - la dissolvenza: a `t = 0` il coarse è a 1 e il fine a 0, a `t = FINE_CROSSFADE_MS` l'inverso, monotona, e con `prefersReducedMotion` è istantanea.

- [x] **Step 2: Implementare `src/globe/coastlineFine.ts`** — due passate sui segmenti decodificati (la prima conta per secchio, senza trigonometria; la seconda scrive gli XYZ), una `BufferGeometry` per secchio non vuoto, **un solo** `LineBasicMaterial` condiviso con lo stesso colore, opacità e blending di `continents.ts`, perché «stessa grafica» significa che il contorno fine deve essere indistinguibile dal grossolano se non per il dettaglio.

La rete sta in **una funzione sola** di questo file, `loadFineCoastline()`: `fetch('/data/coastline-10m.bin')` e poi `decodeCoastline`. Una sola, perché il Task 6 Step 5 le aggiunge le tre righe che dicono allo schermo com'è andata, e due vie di rete sarebbero due `catch` di cui uno resterebbe muto — che è esattamente il difetto che il Task 6 esiste per chiudere.

Il raggio è `GLOBE_RADIUS + COASTLINE_LIFT`, importato, **mai riscritto** — e i segmenti del livello fine sono suddivisi dallo stesso `COASTLINE_MAX_SEGMENT_DEG`. Il dato 10m ha un segmento medio di 1,368 NM, cioè 0,023°, molto sotto i 2°, ma la semplificazione a 0,0008° può lasciare corde lunghe dove la costa è dritta: senza il taglio una di quelle corde affonderebbe sotto il sollevamento calcolato per 2° e il livello fine passerebbe dentro il pianeta dove il grossolano non ci passa. `oneShellAuthority.test.ts` del Task 2 lo vede già: quel test gira su **tutti** i `.ts` di `src/globe`, quindi un `GLOBE_RADIUS * 1.00…` o un `GLOBE_RADIUS + 0.0…` in questo file nuovo lo fa diventare rosso.

- [x] **Step 3: `continents.ts` e `scene.ts`** — il livello coarse guadagna `setOpacity`; `scene.ts` chiama `feedChunk` dentro `animate()` finché torna `false`, e `update(...)` dopo `controls.update()`.

- [x] **Step 4: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run build:all
```

- [ ] **Step 5: Staging, uno per uno, e commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/globe/coastlineFine.ts \
             src/globe/continents.ts \
             src/globe/scene.ts \
             tests/unit/globe/coastlineFine.test.ts \
  && git commit -m "$(cat <<'EOF'
feat(globe): the fine coastline, in 10 degree buckets and 4 ms chunks

One LineSegments of 1 039 866 vertices would be 62 million vertices a
second for a coast of which 84 % of the segments are sub-pixel at d=2,50.
Ten-degree buckets put at most 131 722 vertices in view at the switch
distance — fewer than the 186 010 the 50m level pushes at EVERY frame
today — and the visibility test is one dot product per bucket, 359 of
them, against the 205 000 Plan 2 called negligible. The globe gets more
detailed and lighter at the same time.

The build is chunked at 64 000 vertices, 4,0 ms measured: one 65,1 ms
pass would be four dropped frames at the exact moment the user is zooming.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests
```

Atteso: **nessuna riga**.

**Test attesi dopo il Task 5: 725 passed.**

---

### Task 6: Quando il dettaglio non arriva, lo schermo lo dice

Estensione di D15, e chiusura di un buco che esiste già: `scene.ts:116` oggi cattura il fallimento di `loadContinents` con un `console.warn` e lascia il globo senza contorni e senza una parola.

**Files:**
- Create: `src/state/detailStore.ts`
- Modify: `src/globe/scene.ts`, `src/globe/coastlineFine.ts` — scrivono lo stato
- Modify: `src/ui/FeedStatus.tsx` — lo legge
- Test: `tests/unit/state/detailStore.test.ts` (nuovo), `tests/component/FeedStatus.test.tsx` (esteso), `tests/e2e/globe-detail.spec.ts` (nuovo)

```ts
export type CoastlineDetail =
  | 'none'        // not even the 1:50 M outline loaded: the globe has no coasts
  | 'coarse'      // the 1:50 M outline, and the zoom has not asked for more
  | 'loading'     // the fine level is on its way
  | 'fine'        // the fine level is drawn
  | 'coarse-only'; // the fine level was ASKED FOR and did not arrive
```

`'coarse'` e `'coarse-only'` sono due fatti diversi — «non l'ho ancora chiesto» e «l'ho chiesto e non è arrivato» — e fonderli sarebbe la mezza verità che questo repo ha già pagato (D15b). Le righe che `FeedStatus` stampa:

```
'none'         · no coastline · map data did not load
'coarse-only'  · fine coastline unavailable · showing the 1:50 M outline
cities 'unavailable'  · city names unavailable
```

- [x] **Step 1: Creare `tests/unit/state/detailStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { nextCoastline, useDetailStore } from '@/state/detailStore';
import type { CoastlineDetail } from '@/state/detailStore';

const ALL: CoastlineDetail[] = ['none', 'coarse', 'loading', 'fine', 'coarse-only'];

describe('the detail store says what the globe is actually drawing', () => {
  beforeEach(() => useDetailStore.setState({ coastline: 'none', cities: 'absent' }));

  it('starts at the only thing that is true before anything has loaded', () => {
    // Not 'coarse'. The outline is fetched, so the first frames are drawn
    // without it: starting at 'coarse' would be the store asserting a level
    // the screen has not got yet, which is the whole family of D15.
    expect(useDetailStore.getState().coastline).toBe('none');
    expect(useDetailStore.getState().cities).toBe('absent');
  });

  it('walks both endings: the one that arrives and the one that does not', () => {
    const s = () => useDetailStore.getState();
    s().setCoastline('coarse');
    s().setCoastline('loading');
    s().setCoastline('fine');
    expect(s().coastline).toBe('fine');

    useDetailStore.setState({ coastline: 'coarse' });
    s().setCoastline('loading');
    s().setCoastline('coarse-only');
    expect(s().coastline).toBe('coarse-only');
  });

  it('cannot reach fine from anywhere but loading', () => {
    // THE rule. 'fine' means the fine level is on screen, and the only road
    // to being on screen is fetched, decoded and built — which is what
    // 'loading' names. Any other way in would let a caller announce a level
    // nobody drew (D42), including the worst one: a fetch that failed, left
    // the state at 'coarse-only', and then declared success anyway.
    for (const from of ALL) {
      useDetailStore.setState({ coastline: from });
      useDetailStore.getState().setCoastline('fine');
      expect(useDetailStore.getState().coastline, `from ${from}`).toBe(
        from === 'loading' || from === 'fine' ? 'fine' : from
      );
    }
    expect(nextCoastline('coarse', 'fine')).toBe('coarse');
    expect(nextCoastline('coarse-only', 'fine')).toBe('coarse-only');
  });

  it('refuses an illegal move in place instead of throwing', () => {
    // These setters are called from a fetch handler and from inside the
    // render loop. An exception there takes the globe down over a
    // bookkeeping mistake, which is a worse answer than keeping the last
    // word that was true.
    useDetailStore.setState({ coastline: 'none' });
    expect(() => useDetailStore.getState().setCoastline('coarse-only')).not.toThrow();
    expect(useDetailStore.getState().coastline).toBe('none');
  });
});
```

- [x] **Step 2: Estendere `tests/component/FeedStatus.test.tsx`**

Il file guadagna `import { useDetailStore } from '@/state/detailStore';` e un secondo `describe` accanto a quello che c'è:

```tsx
describe('FeedStatus — the detail levels that are not there', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    });
    useDetailStore.setState({ coastline: 'coarse', cities: 'absent' });
  });

  it('says nothing about a detail level that IS there', () => {
    // A level that arrived is not news, and a HUD that narrates its
    // successes is a HUD nobody is still reading when it narrates a
    // failure. 'loading' is silent for the same reason: 1,6 s of download
    // is not a fact about the globe, it is a fact about the next second.
    for (const c of ['coarse', 'loading', 'fine'] as const) {
      useDetailStore.setState({ coastline: c });
      const { unmount } = render(<FeedStatus />);
      expect(screen.queryByText(/coastline/)).toBeNull();
      expect(screen.queryByText(/map data/)).toBeNull();
      unmount();
    }
  });

  it('says so when the globe has no coastline at all', () => {
    // The hole that predates this plan: scene.ts caught loadContinents
    // failing with a console.warn, so a 404 after a deploy drew a globe
    // with no coasts and not one word about it.
    useDetailStore.setState({ coastline: 'none' });
    render(<FeedStatus />);
    expect(screen.getByText(/no coastline/)).toBeInTheDocument();
    expect(screen.getByText(/map data did not load/)).toBeInTheDocument();
  });

  it('distinguishes "not asked for" from "asked for and did not arrive"', () => {
    // D15b, in one render. Merging the two words would tell a viewer whose
    // fine level 404s exactly what it tells a viewer who has not zoomed in
    // yet: nothing.
    useDetailStore.setState({ coastline: 'coarse-only', cities: 'unavailable' });
    render(<FeedStatus />);
    expect(screen.getByText(/fine coastline unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/1:50 M outline/)).toBeInTheDocument();
    expect(screen.getByText(/city names unavailable/)).toBeInTheDocument();
  });
});
```

- [x] **Step 3: E2E `tests/e2e/globe-detail.spec.ts`** — `page.route('**/data/coastline-10m.bin', r => r.fulfill({status: 404}))`, zoomare sotto la soglia, e verificare che la riga compaia **e** che il contorno grossolano sia ancora disegnato. Un secondo test con `abort()` a metà risposta, per il troncamento.

- [x] **Step 3b: Verificare il rosso**

```bash
cd /home/riccardo/projects/air-view && npx vitest run tests/unit/state/detailStore.test.ts tests/component/FeedStatus.test.tsx
```

Atteso: entrambi falliscono **in import** — `@/state/detailStore` non esiste. È il rosso giusto: i quattro step che seguono sono i file che quel modulo e i suoi lettori devono diventare.

- [x] **Step 4: Creare `src/state/detailStore.ts`**

```ts
import { create } from 'zustand';

/**
 * Which coastline the globe is actually drawing.
 *
 * Five words and not three. 'coarse' and 'coarse-only' are two different
 * FACTS — "the zoom has not asked for the fine level" and "it was asked for
 * and did not arrive" — and a viewer who cannot tell them apart cannot tell
 * a globe that is working from a globe that is broken. Merging them is the
 * half-truth D15 exists to forbid (D42).
 *
 * 'none' is a hole that predates Plan 4: scene.ts caught loadContinents
 * failing with a console.warn and left the globe with no coasts and not one
 * word about it.
 */
export type CoastlineDetail = 'none' | 'coarse' | 'loading' | 'fine' | 'coarse-only';

/**
 * Whether the city names are there. 'absent' is the honest start: nobody
 * has asked for them yet, which is not the same as having asked and failed.
 * src/data/cityPlaces.ts writes this one (Plan 4 Task 7).
 */
export type CityDetail = 'absent' | 'ready' | 'unavailable';

/**
 * The moves the coastline level may make, and the one that matters.
 *
 * 'fine' is reachable ONLY from 'loading'. 'fine' means the fine level is on
 * screen, and the only road to being on screen is fetched, decoded and
 * built — which is what 'loading' names. Every other way in is refused,
 * because a store that will say 'fine' on request is not a declaration about
 * the screen, it is a second opinion about it (D15, D42). It also makes one
 * particular mistake impossible to write: a fetch that failed leaves
 * 'coarse-only', and a builder that then announces 'fine' is ignored.
 *
 * Refused IN PLACE, never thrown: these setters are called from a fetch
 * handler and from inside the render loop, and an exception in either takes
 * the globe down over a bookkeeping mistake.
 */
const LEGAL: Record<CoastlineDetail, readonly CoastlineDetail[]> = {
  none: ['none', 'coarse'],
  coarse: ['coarse', 'loading'],
  loading: ['loading', 'fine', 'coarse-only'],
  fine: ['fine', 'coarse'],
  'coarse-only': ['coarse-only', 'loading', 'coarse'],
};

export function nextCoastline(from: CoastlineDetail, to: CoastlineDetail): CoastlineDetail {
  return LEGAL[from].includes(to) ? to : from;
}

interface DetailState {
  coastline: CoastlineDetail;
  cities: CityDetail;
  setCoastline: (v: CoastlineDetail) => void;
  setCities: (v: CityDetail) => void;
}

export const useDetailStore = create<DetailState>((set) => ({
  coastline: 'none',
  cities: 'absent',
  setCoastline: (v) => set((s) => ({ coastline: nextCoastline(s.coastline, v) })),
  setCities: (v) => set({ cities: v }),
}));
```

- [x] **Step 5: `src/globe/coastlineFine.ts` — le tre righe che dicono com'è andata**

Il file esiste dal Task 5. Questo step gli aggiunge `import { useDetailStore } from '@/state/detailStore';` e **tre** dichiarazioni, non due. `loadFineCoastline()` diventa:

```ts
/**
 * The one network path of the fine level, and the one place that says what
 * happened on it.
 *
 * 'loading' BEFORE the request, because 1,91 MB at 10 Mbit/s plus a chunked
 * build is a second and a half of being in a state, not an instant. It
 * prints nothing on its own — a level on its way is not news — but it is
 * what makes 'fine' reachable at all (detailStore.ts).
 *
 * 'coarse-only' on every ending that is not the right one: a 404, a network
 * error, a truncated body that decodeCoastline refuses by name. The coarse
 * outline is still there and still correct, so this is not the globe
 * failing — it is ONE level failing, and the line on screen says which.
 */
export async function loadFineCoastline(): Promise<Int32Array[] | null> {
  useDetailStore.getState().setCoastline('loading');
  try {
    const res = await fetch('/data/coastline-10m.bin');
    if (!res.ok) throw new Error(`coastline-10m.bin: HTTP ${res.status}`);
    return decodeCoastline(await res.arrayBuffer()).rings;
  } catch (e) {
    console.warn('Fine coastline:', e);
    useDetailStore.getState().setCoastline('coarse-only');
    return null;
  }
}
```

E la terza, che è quella in cui si sbaglia posto: `'fine'` **non** si dichiara qui. Si dichiara dentro `feedChunk`, nel punto esatto in cui sta per tornare `false` avendo aggiunto al gruppo l'ultimo secchio — cioè **dopo** l'`add` e non dopo il `fetch`:

```ts
    if (/* l'ultimo secchio è stato aggiunto al gruppo */) {
      // NOW it is on screen. Announcing it when the bytes arrived would
      // name a level that is decoded and not yet drawn, which is the screen
      // claiming more than it shows (D15) — and the gap is 0,25 s of build,
      // i.e. fifteen frames of a line that is not true yet.
      useDetailStore.getState().setCoastline('fine');
      return false;
    }
```

I nomi del `if` sono quelli che il Task 5 Step 2 ha scelto per il cursore dei secchi: questo step non li ribattezza. Quello che questo step fissa è **dove** sta la riga. E se il caricamento è fallito non c'è niente da costruire, `feedChunk` non arriva mai lì — e se per un errore ci arrivasse, `nextCoastline('coarse-only', 'fine')` restituisce `'coarse-only'`: lo store rende la bugia non scrivibile invece di fidarsi di chi chiama.

- [x] **Step 6: `src/globe/scene.ts` — il `console.warn` che dura da sempre**

L'import da `@/state/detailStore`, e il blocco delle righe 113-116 di oggi — il commento compreso — diventa:

```ts
  // Continents (async). The coarse outline is a fact about the screen, so it
  // is declared in BOTH directions: 'coarse' when it is in the scene,
  // 'none' when it is not. This catch used to be a console.warn and nothing
  // else, so a 404 after a deploy drew a globe with no coasts and said
  // nothing — the oldest D15 hole in this file, and not one Plan 4 opened.
  void loadContinents()
    .then((c) => {
      scene.add(c);
      useDetailStore.getState().setCoastline('coarse');
    })
    .catch((e: unknown) => {
      console.warn('Continents:', e);
      useDetailStore.getState().setCoastline('none');
    });
```

Il `console.warn` **resta**: la riga sullo schermo è per chi guarda, la console è per chi ripara, e l'errore vero — quale `fetch`, quale stato HTTP — non entra in una riga di HUD.

- [x] **Step 7: `src/ui/FeedStatus.tsx` — le tre righe**

Due letture accanto a quelle che ci sono già (righe 18-22):

```tsx
  const coastline = useDetailStore((s) => s.coastline);
  const cities = useDetailStore((s) => s.cities);
```

e tre `span` in coda agli altri, **dopo** il blocco `{stale && (...)}` e dentro lo stesso `div role="status"`: la cartografia viene dopo il feed perché un feed fermo è la notizia più urgente, e perché questo `div` è già `aria-live="polite"` e l'ordine di lettura è l'ordine del DOM.

```tsx
      {coastline === 'none' && (
        <span className="hud__status" aria-label="No coastline, the map data did not load">
          {' '}
          · no coastline · map data did not load
        </span>
      )}
      {coastline === 'coarse-only' && (
        <span
          className="hud__status"
          aria-label="Fine coastline unavailable, showing the 1 to 50 million outline"
        >
          {' '}
          · fine coastline unavailable · showing the 1:50 M outline
        </span>
      )}
      {cities === 'unavailable' && (
        <span className="hud__status" aria-label="City names unavailable">
          {' '}
          · city names unavailable
        </span>
      )}
```

`aria-label` scritto per esteso — «1 to 50 million» — perché `1:50 M` letto da uno screen reader è «uno due punti cinquanta emme». È la stessa regola che le altre quattro righe di questo file seguono già.

**Nessuna riga di CSS.** `.hud__status` esiste e queste tre spans la usano: «mantenere la stessa grafica» vale anche per l'HUD.

- [x] **Step 8: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run test:e2e && npm run build:all
```

- [ ] **Step 9: Staging, uno per uno, e commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/state/detailStore.ts \
             src/globe/scene.ts \
             src/globe/coastlineFine.ts \
             src/ui/FeedStatus.tsx \
             tests/unit/state/detailStore.test.ts \
             tests/component/FeedStatus.test.tsx \
             tests/e2e/globe-detail.spec.ts \
  && git commit -m "$(cat <<'EOF'
feat(ui): a detail level that did not arrive says so

scene.ts caught loadContinents failing with a console.warn, so a 404
after a deploy left the globe with no coastline at all and not one word
about it. That hole predates this plan; it closes here with the two it
adds. 'coarse' and 'coarse-only' stay two words because they are two
facts — not asked for yet, and asked for and not arrived — and merging
them would be the half-truth D15 exists to forbid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests
```

Atteso: **nessuna riga**.

**Test attesi dopo il Task 6: 732 unitari, 22 e2e.**

---

### Task 7: I nomi delle città

**Files:**
- Create: `src/data/cityPlaces.ts` — carica `cities.json`, precalcola le direzioni unitarie
- Create: `src/globe/cityLabels.ts` — la scala, la selezione, la non-sovrapposizione, i nodi DOM
- Modify: `src/ui/AppShell.tsx` — un contenitore `.app-cities` accanto a `.app-markers`
- Modify: `src/ui/styles.css` — `.city`, `.city__dot`, `.city__name`
- Modify: `src/globe/scene.ts` — monta e aggiorna
- Test: `tests/unit/globe/cityLabels.test.ts` (nuovo), `tests/unit/data/cityPlaces.test.ts` (nuovo), `tests/e2e/a11y.spec.ts` (esteso)

**Interfaces:**
- Produces: `scalerankCeilingFor(capNm: number): number | null`, `selectCityLabels(candidates, projected, taken, maxLabels): CityLabel[]`, `MAX_CITY_LABELS = 24`, `createCityLabels(container): CityLabels`

```ts
/**
 * Which places are eligible at this view radius.
 *
 * SCALERANK is Natural Earth's own statement of the map scale at which a
 * place deserves to appear — the user's "il nome della città non esce
 * quando sono troppo fuori, però man mano mi avvicino esce", already
 * answered by cartographers. Inventing a population threshold would be
 * redoing that work worse.
 *
 * The thresholds are the worst-case counts measured by centring the camera
 * on each of the 1 251 places in turn (plan §2.4), not an intuition:
 *
 *   cap > 1 400 NM   nothing        (70 px of label is 227 NM: the dot is 1 px)
 *   700 … 1 400      SCALERANK ≤ 1  worst 15 candidates
 *   350 … 700        SCALERANK ≤ 2  worst 31
 *   140 … 350        SCALERANK ≤ 4  worst 26
 *   ≤ 140            all            worst 11
 *
 * Returns null for "no labels at all", which is not the same as 0 — 0 is
 * the 27 world cities of SCALERANK 0.
 */
export function scalerankCeilingFor(capNm: number): number | null {
  if (capNm > 1400) return null;
  if (capNm > 700) return 1;
  if (capNm > 350) return 2;
  if (capNm > 140) return 4;
  return 10;
}
```

- [x] **Step 1: `tests/unit/data/cityPlaces.test.ts`** — l'array arriva già ordinato per `(SCALERANK, LABELRANK, −POP_MAX)` e la scala è quindi un **prefisso**; un `cities.json` malformato o mancante lascia lo store a `'unavailable'` e non lancia; le direzioni unitarie si calcolano **una volta** (1 251 × 4 = 5 004 trascendenti) e il conteggio lo prova con uno spy.

- [x] **Step 2: `tests/unit/globe/cityLabels.test.ts`**
  - la scala: nessuna etichetta sopra 1 400 NM; a 1 298 NM (d = 3,0) solo `SCALERANK ≤ 1`; a 39,6 NM tutte;
  - mai più di `MAX_CITY_LABELS`, su un insieme costruito con 300 candidate sovrapposte;
  - la non-sovrapposizione: due riquadri accettati non si intersecano mai, e l'ordine di accettazione è quello dell'array (quindi deterministico, quindi testabile);
  - **i marcatori D/A vincono sempre**: una città il cui riquadro tocca quello di un marcatore viene scartata, non il contrario;
  - **zero trascendenti per fotogramma**: uno spy su `Math.sin`/`Math.cos` attorno a 100 `update()` con 1 128 candidate deve contare zero (D43).

- [x] **Step 3: Implementare `src/data/cityPlaces.ts` e `src/globe/cityLabels.ts`**, con `projectMarker` di `airportMarkers.ts` riusato per la proiezione — è già DOM riproiettato a ogni fotogramma ed è il precedente giusto — ma con la direzione unitaria **precalcolata** invece che ricostruita da lat/lon, perché 24 etichette su 1 128 candidate sarebbero 96 trascendenti per fotogramma per niente.

- [x] **Step 4: `styles.css`**

```css
/* City names — the same family, size and shadow as .marker__label, because
   "keep the same graphics" is the constraint. The colour is the difference:
   a city is geography and a D/A marker is the route the user asked for, and
   the two must not be confusable. --color-body-muted is #cccccc, 12,0 : 1
   on #0a0a14, so the contrast is not a judgement call. */
.app-cities { position: fixed; inset: 0; z-index: 4; pointer-events: none; }
.city {
  position: absolute; top: 0; left: 0;
  display: flex; align-items: center; gap: 5px;
  color: var(--color-body-muted);
  font-family: var(--font-stack);
}
.city__dot {
  width: 3px; height: 3px; border-radius: var(--radius-pill);
  background: var(--color-body-muted); opacity: 0.8;
}
.city__name {
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
}
```

`z-index: 4`, sotto `.app-markers` (5): dove una città e un marcatore si incontrano vince il marcatore, che è l'ordine di importanza. Gli aerei sono sul canvas a `z-index: 1`, quindi **sotto** le etichette — e questo è il prezzo di D44, detto qui: ogni tanto un nome di città copre un puntino. L'alternativa sarebbe interrogare 24 000 punti per fotogramma con una griglia in spazio schermo che nessun test può fissare.

- [x] **Step 5: a11y** — i nodi sono `aria-hidden="true"`, non focalizzabili, `pointer-events: none`. L'E2E `a11y.spec.ts` guadagna un passaggio di axe **dopo** uno zoom sotto i 350 NM, perché un'etichetta che esiste solo zoomati è un'etichetta che axe non ha mai visto.

- [x] **Step 6: Cancello**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run test:e2e && npm run build:all
```

- [ ] **Step 7: Staging, uno per uno, e commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add src/data/cityPlaces.ts \
             src/globe/cityLabels.ts \
             src/globe/scene.ts \
             src/ui/AppShell.tsx \
             src/ui/styles.css \
             tests/unit/data/cityPlaces.test.ts \
             tests/unit/globe/cityLabels.test.ts \
             tests/e2e/a11y.spec.ts \
  && git commit -m "$(cat <<'EOF'
feat(globe): city names that appear the way cartographers decided

"Il nome della citta non esce quando sono troppo fuori, pero man mano mi
avvicino esce" is, word for word, what Natural Earth's SCALERANK already
says, and the file saying it has been in the bundle unread the whole
time. The thresholds are the worst-case counts measured by centring the
camera on each of the 1 251 places in turn, not an intuition.

Zero transcendental calls per frame: the unit directions are computed
once at load. The labels do not dodge aircraft and do not pretend to —
they draw under the dots, so where they meet the aircraft wins.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src tests
```

Atteso: **nessuna riga**.

**Test attesi dopo il Task 7: 747 passed.**

---

### Task 8: Il costo, il browser, e il cancello

Il Piano 2 ha dimostrato il costo **contando** le chiamate trascendenti invece di cronometrarle, perché un'asserzione sui millisecondi su una macchina di CI è un test che fallisce per il meteo. Stessa prova qui, su tre numeri.

**Files:**
- Create: `tests/unit/globe/detailCost.test.ts`
- Modify: `tests/e2e/globe-detail.spec.ts` — lo zoom vero in un browser vero
- Modify: `README.md` — la riga sui dati statici

- [x] **Step 1: `tests/unit/globe/detailCost.test.ts`**

```ts
describe('the detail costs less per frame than what it replaces', () => {
  it('spends zero transcendental calls per frame on the coastline', () => {
    // 359 bucket visibility decisions are 359 dot products — 21 540 per
    // second, against the 205 000 Plan 2 called negligible. The directions
    // are precomputed once when the file is decoded (D41).
  });

  it('keeps the vertices in view under what the 50m level pushes today', () => {
    // 131 722 at the switch distance against 186 010 every frame, at every
    // zoom, for the whole planet. The globe gets MORE detailed and LIGHTER.
  });

  it('spends zero transcendental calls per frame on the city labels', () => {
    // 1 251 × 4 = 5 004 once at load; two dot products per candidate per
    // frame after that (D43).
  });

  it('builds the fine level in chunks that fit inside a frame', () => {
    // 0,0626 µs per vertex measured: 64 000 vertices is 4,0 ms, a quarter
    // of a 16,7 ms frame. One 65,1 ms pass would be four dropped frames at
    // the exact moment the user is zooming (D41).
  });
});
```

- [x] **Step 2: E2E — lo zoom vero**

Un test che porta la camera a `CAMERA_NEAR_LIMIT` via `__airViewCamera` (il gancio che `scene.ts:208` espone già) e verifica, in un browser vero: il contorno fine è nella scena; almeno un'etichetta di città è visibile e nessuna ne copre un'altra (riquadri letti con `getBoundingClientRect`); nessun aereo è stato tagliato dal piano near; e il profiler non è sceso sotto i 50 fps su un feed intercettato da 11 625 aerei.

- [x] **Step 3: Cancello finale**

```bash
cd /home/riccardo/projects/air-view && npm test -- --run && npm run test:e2e && npm run build:all
```

- [x] **Step 4: Il controllo di cucitura, su tutto il piano, eseguito da uno script**

Non è una formalità: è il difetto che questo progetto ha avuto **cinque volte**, e tutte e cinque era stato cercato a occhio. Otto task dopo è l'ultimo momento per vederlo, e un elenco confrontato da uno script non si distrae.

Lo script sta **qui dentro**, non in un file del repo: un controllo di cucitura che aggiunge un file da mettere in staging sarebbe il difetto che controlla. Si incolla e si esegue.

```bash
cd /home/riccardo/projects/air-view && python3 - <<'PY'
import os, re, subprocess
PLAN = "docs/superpowers/plans/2026-11-22-air-view-v2-globe-detail.md"
lines = open(PLAN, encoding="utf-8").read().split("\n")
tracked = set(subprocess.run(["git","ls-files"], capture_output=True, text=True,
                             check=True).stdout.split("\n")) - {""}
TOP  = r"(?:src|server|tests|scripts|public|docs)"
PATH = re.compile(rf"\b{TOP}/[A-Za-z0-9._\-/]+\.(?:ts|tsx|mjs|js|json|css|bin|geojson|md|yml)\b")
PKG  = re.compile(r"\bpackage\.json\b|\bREADME\.md\b")
def inp(t):
    out = [m.group(0) for m in PATH.finditer(t)] + [m.group(0) for m in PKG.finditer(t)]
    # `src/data/sources/tileGrid.js` is a NodeNext import SPECIFIER, not a file.
    return [p for p in out if not (p.endswith(".js") and p[:-3] + ".ts" in tracked)]
heads = [(i, m.group(1)) for i, l in enumerate(lines) if (m := re.match(r"^### Task (\d+): ", l))]
def task_end(start, nxt):
    # A task ends at the next task OR at the next "## " section, whichever comes
    # first. Without the second bound the LAST task swallows sections 5-7 and
    # inherits every `git add` their prose quotes.
    for i in range(start + 1, nxt):
        if lines[i].startswith("## "): return i
    return nxt
spans = [(n, s, task_end(s, heads[k+1][0] if k+1 < len(heads) else len(lines)))
         for k, (s, n) in enumerate(heads)]
END = re.compile(r"^(\*\*[A-Za-z]|- \[ \]|####|---|```)")
def files_block(body):
    out, on = [], False
    for l in body:
        if re.match(r"^\*\*Files:\*\*", l): on = True; continue
        if on and END.match(l): break
        if on: out.append(l)
    return out
def adds(body):
    out, i = [], 0
    while i < len(body):
        if "git add" in body[i]:
            c = body[i]
            while c.rstrip().endswith("\\") and i+1 < len(body): i += 1; c += " " + body[i]
            out.append(c)
        i += 1
    return out
NEW = re.compile(r"\(nuovo\)|generat")
created, untouched = set(), set()
for n, s, e in spans:
    for l in files_block(lines[s:e]):
        for p in inp(l):
            tail = l.split(p, 1)[1][:24]
            if re.match(r"^\s*-\s*\*{0,2}(Create|Crea)", l) or "generat" in l or NEW.search(tail):
                created.add(p)
            if re.search(r"NON\s+modificat|Non\s+modificat", l): untouched.add(p)
for n, s, e in spans:
    for l in lines[s:e]:
        if re.match(r"^- \[ \] \*\*Step .*(Creare|Create)", l): created.update(inp(l))
WRITE = re.compile(r"Crear|Sostitu|aggiung|Aggiung|Modif|diventa|riceve|prende|subisce|"
                   r"stendere|Implementar|Corregger|Adeguar|passare|guadagna|scrive", re.I)
hard = soft = 0
for n, s, e in spans:
    body = lines[s:e]; fb = files_block(body)
    decl = sorted({p for l in fb for p in inp(l)})
    cmds = adds(body)
    stg  = sorted({p for c in cmds for t in re.split(r"git add", c)[1:]
                     for p in inp(re.split(r"&&|\|\||;", t)[0])})
    ids = {id(l) for l in fb}
    steps = [l for l in body if id(l) not in ids and "git add" not in l]
    cited = sorted({p for l in steps for p in inp(l)})
    D, R = [], []
    for p in cited:
        if p not in decl and any(WRITE.search(c) for c in steps if p in c):
            R.append(("STEP-NOT-IN-FILES", p))
    if cmds:
        D += [("FILES-NOT-STAGED", p) for p in decl if p not in stg and p not in untouched]
    for p in stg:
        if p not in tracked and p not in created: D.append(("ADD-WOULD-FAIL", p))
        if p not in decl:                         D.append(("ADD-NOT-IN-FILES", p))
    print(f"Task {n}: Files {len(decl)} | staged {len(stg)} | cited {len(cited)}"
          + ("   OK" if not D and not R else ""))
    for k, p in D:
        print(f"  DEFECT [{k}] {p} (tracked={p in tracked}, on-disk={os.path.exists(p)}, "
              f"plan-creates={p in created})")
    for k, p in R:
        print(f"  REVIEW [{k}] {p} (tracked={p in tracked}, on-disk={os.path.exists(p)})")
    hard += len(D); soft += len(R)
print("TOTAL SEAM DEFECTS:", hard, " REVIEW lines needing a verdict:", soft)
PY
```

Per ogni task estrae tre insiemi di percorsi — quelli citati negli step, quelli del blocco **Files**, quelli della riga `git add` — e li confronta fra loro e con `git ls-files` e il disco. Riporta quattro difetti: un percorso che uno step modifica e che **Files** non dichiara; un percorso dichiarato che nessun `git add` mette in staging; un percorso su una riga `git add` che **non esisterà quando quel comando girerà** (non tracciato, e creato da nessuno step: `git add` esce con 1 e porta via il commit); e un percorso messo in staging che **Files** non nomina.

Atteso: **TOTAL SEAM DEFECTS: 0**. Se non è zero, il difetto si ripara nel piano o nel commit, mai sopprimendo la riga.

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src server scripts tests public docs package.json
```

Atteso: **nessuna riga**. Poi, sui tre file che il piano crea e sul file che il piano toglie:

```bash
cd /home/riccardo/projects/air-view \
  && git ls-files --error-unmatch public/data/coastline-10m.bin public/data/cities.json \
  && ! git ls-files --error-unmatch public/data/ne_50m_populated_places.geojson
```

Atteso: i primi due elencati, il terzo **non** trovato. Se il terzo c'è ancora, il bundle non si è ristretto di 1,36 MB come D45 dichiara, e la dichiarazione va corretta o il file va tolto — mai lasciata in piedi una cifra che il repo smentisce.

- [ ] **Step 5: Staging, uno per uno, e commit**

```bash
cd /home/riccardo/projects/air-view \
  && git add tests/unit/globe/detailCost.test.ts \
             tests/e2e/globe-detail.spec.ts \
             README.md \
  && git commit -m "$(cat <<'EOF'
test(globe): the detail costs less per frame than what it replaces

Plan 2 proved its cost by COUNTING transcendental calls rather than by
timing them, because an assertion in milliseconds on a CI machine fails
for the weather. Same proof here, on three numbers: zero transcendentals
per frame for the coastline, zero for the city labels, and 131 722
vertices in view against the 186 010 the 50m level pushes at every frame
today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

```bash
cd /home/riccardo/projects/air-view && git status --porcelain -- src server scripts tests public docs package.json
```

Atteso: **nessuna riga**.

**Test attesi dopo il Task 8: 753 unitari, 24 e2e.**

---

## 5. Riepilogo dei test attesi

| Dopo il task | Unitari | E2E |
|---|---|---|
| partenza (dopo `3c689bd`, misurato) | 637 | 20 |
| 1 — l'aritmetica della corsa, del guscio, dei piani e del suolo | 655 | 20 |
| 2 — il guscio al disegno, e con esso arco e costa | 682 | 20 |
| 3 — la priorità delle tile | 695 | 20 |
| 4 — il dato, costruito | 712 | 20 |
| 5 — il livello fine in scena | 725 | 20 |
| 6 — quando non arriva, lo dice | 732 | 22 |
| 7 — i nomi delle città | 747 | 22 |
| 8 — il costo e il cancello | 753 | 24 |

I numeri sono stime a meno di un paio di casi per task; quello che il cancello di ogni task pretende è che **non calino** e che nessun test resti rosso, non che l'intero coincida.

E ogni riga ha un secondo cancello, che non è un conteggio: `git status --porcelain` sui percorsi del task deve stampare **zero righe**. Il piano aggiunge due file generati in `public/data/` e ne toglie uno tracciato; nessuna delle tre cose avviene da sé.

---

## 6. Cosa questo piano NON fa

**La scala aeroporto è un non-obiettivo dichiarato.** L'utente ha chiesto «almeno a grandezza che posso inquadrare l'aeroporto o una città», e questo piano consegna la città — 147 km di diametro inquadrato — e non l'aeroporto. La ragione non è la fatica, sono quattro cose che cambiano tutte insieme:

1. **Il dato non c'è e non è Natural Earth.** Inquadrare un aeroporto significa 3-5 NM di raggio, cioè `d ≈ 1,506`. A quella scala servono piste, terminal, strade: tile vettoriali OSM, cioè una dipendenza nuova, un formato nuovo (Mapbox Vector Tiles, protobuf), un server di tile o un abbonamento, e una licenza da rispettare. Nessuna di queste cose è nel repo oggi.
2. **La proiezione è un'altra.** Le tile vettoriali sono in Web Mercator su un piano; questo globo è una sfera con `latLonToVec3`. Riproiettare ogni tile sulla sfera per fotogramma, o cucire le tile in un piano tangente locale, è un sottosistema, non una funzione.
3. **Tutto lo stile andrebbe rifatto.** Una tile OSM arriva con la sua gerarchia di strati e i suoi colori. «Mantenere la stessa grafica» — il vincolo esplicito — vorrebbe dire ristilare da zero ogni strato per farlo somigliare al contorno bianco additivo di oggi. È il lavoro più grande dei quattro e il meno visibile.
4. **La geometria si rompe prima di arrivarci.** A `d = 1,506` la superficie dista 0,006 unità dalla camera: il piano near dovrebbe scendere sotto quella cifra, e con `far` fermo il rapporto esploderebbe. E le posizioni stanno in `Float32BufferAttribute`: a raggio 1,5 la risoluzione del float32 è `1,5 × 2⁻²³ ≈ 1,8 × 10⁻⁷` unità, cioè **0,76 m** sulla superficie. Una pista è larga 45 m e una via di rullaggio 23: 0,76 m di granularità non è un errore di disegno, è un tremolio visibile quando la camera si muove. Servirebbe un'origine mobile — ricentrare il mondo sotto la camera e disegnare in coordinate relative — che è una riscrittura di ogni posizione in ogni strato.

**Cosa servirebbe, detto per intero:** una sorgente di tile vettoriali con licenza, un decodificatore MVT, una proiezione tile→sfera, un foglio di stile per ogni strato, un piano near adattivo con origine mobile in float64 → float32 relativo. È un piano suo, non un task di questo.

**Le altre due cose che l'utente ha nominato e che non stanno qui**, perché lui stesso le ha messe dopo: la copertura dei dati (nessun aereo sugli oceani, sul Sud America, sull'Africa — `tileGrid.ts:13-20` dice già che è una verità sui ricevitori, non sul traffico) e la frazione di aerei con destinazione ignota. Nessuna delle due è un problema del globo: sono due problemi della sorgente.

**E tre cose più piccole che questo piano lascia dove sono:** il clustering resta vietato (D26 del Piano 2); le etichette non evitano gli aerei (D44); e due aerei in attesa sopra lo stesso punto, separati solo in verticale, restano un puntino a qualunque zoom — perché la separazione è sull'asse che un globo non disegna, e dirlo qui è meglio che lasciarlo scoprire.

---

## 7. Il rischio principale, dichiarato

**Il rischio non è la grafica: è che tre numeri del Piano 2 si muovano insieme.** `CAMERA_NEAR_LIMIT`, `altitudeToOffset` e il `near` della camera sono legati da una disuguaglianza — `CAMERA_NEAR_LIMIT − (GLOBE_RADIUS + altitudeToOffset(41 000, CAMERA_NEAR_LIMIT)) > CAMERA_NEAR_PLANE` — e chiunque ritocchi uno dei tre senza gli altri due ottiene uno schermo in cui gli aerei alti spariscono al massimo zoom, **in silenzio**: nessun errore, nessun avviso, solo meno puntini. È la forma più pura del difetto che D15 esiste per vietare.

Per questo quella disuguaglianza è un test (`cameraTravel.test.ts`, «keeps the camera outside the shell at every distance it can reach») che gira su **tutta** la corsa a passi di 0,05 e non solo agli estremi, e per questo i tre numeri stanno nello stesso file a venti righe di distanza.

**Il secondo rischio è la stessa malattia, ma su una formula invece che su una disuguaglianza: una copia che nessun compilatore può vedere.** Il guscio delle quote esisteva in **tre** esemplari — `geoHelpers.ts:44`, `aircraft.ts:270`, `trails.ts:202` — e i due inlinati non *chiamano* niente, quindi `tsc` resta verde mentre lo schermo mostra ogni aereo staccato dalla propria scia. La risposta non è stare attenti: è `shellOffset`, una sola autorità che i due `writeLatLonAlt` chiamano senza allocare, e `tests/unit/globe/oneShellAuthority.test.ts`, che **legge i file** e pretende che `41 000` compaia in un file solo. Questo progetto ha già pagato tre volte per due copie di un numero; questa volta erano tre copie.
E quel rischio si è già materializzato **dentro questo piano**, che è la prova migliore che non basta stare attenti: lo Step 5 del Task 2 — il passo che esiste per cancellare le tre copie — scriveva `GLOBE_RADIUS + shellUnits * (1 / 3 + (2 / 3) * m.altFrac)` a mano dentro `positionAt`. Una **quarta** copia, nel punto da cui passa ogni posizione di ogni aereo di ogni fotogramma, e in contraddizione diretta con il test dello step precedente, che pretende `shellOffset(` in quello stesso file. Da qui le due asserzioni nuove di `oneShellAuthority`: una conta quante volte la **forma** `1/3 + 2/3` viene calcolata (una sola, e solo in `geoHelpers.ts`), l'altra vieta qualunque altezza assoluta sopra la superficie in qualunque strato. Le due misurano codice, non commenti, perché questo piano chiede ai suoi commenti di citare i numeri vecchi per dire che cosa è cambiato.

**Il terzo rischio è che la correzione arrivi a tre geometrie su quattro.** Sopra il suolo, in questa scena, stanno i puntini, le scie, l'arco di rotta e la linea di costa. Abbassarne una parte non è una correzione parziale: è una separazione nuova, e le separazioni di questo tipo si vedono solo zoomando, che è l'unico posto dove nessun test unitario guarda da sé. L'arco ne era fuori e al fondo corsa sparisce dentro il piano near o finisce dietro la camera (D46); la costa ne era fuori e sbaglia 41 px dove l'aereo corretto ne sbaglia 25 (D47). La risposta non è un'altra lista di file da ricordare: è che l'unica altezza assoluta rimasta in `src/globe` sia `COASTLINE_LIFT`, e che un test lo legga dai file.

**Il quarto è un formato binario che si decodifica male in silenzio**, e lo ha già fatto una volta, su carta. Un tag `0xFF` in testa ai punti assoluti collideva con 256 valori di delta su 65 536 — `dLon = −1` fra loro, cioè il delta più comune che una costa produca — e un decodificatore disallineato avrebbe disegnato una costa inesistente senza un errore, senza un avviso, senza una riga in `FeedStatus`: D42 vista dal lato peggiore. La risposta non è un sentinella più furbo, che sposterebbe soltanto la correttezza dal formato al codificatore: è un formato a **corse contate**, in cui nessun byte decide il proprio ruolo dal proprio valore, una lunghezza calcolabile prima di leggere (`encodedByteLength`), e un test che codifica e decodifica proprio `dLon = −1` e pretende l'identità. Il divisore del punto fisso smette anche di essere una copia allineata a mano: lo script importa il codec sotto `tsx`, come `build-route-cache.mjs` fa già con `tileGrid`.

**Il quinto non è di aritmetica, è di cucitura, ed è quello che questo progetto ha avuto più volte di tutti: i file non si mettono in staging da soli — e, peggio, una riga `git add` sbagliata non lascia passare il commit.** Il piano crea `public/data/coastline-10m.bin` e `public/data/cities.json`, che `public/data/` non ignora e che quindi nascono non tracciati; e toglie `public/data/ne_50m_populated_places.geojson`, che è tracciato e che resta nel repo finché qualcuno non mette in staging la sua **cancellazione**. Per questo ogni task da 1 a 8 elenca i propri file in una riga `git add` — mai `git add -A`, con `.agents/`, `.claude/`, `mockups/` e `skills-lock.json` qui intorno — e chiude con un `git status --porcelain` che deve stampare zero righe. Il Task 8 Step 4 lo ripete su tutto il piano e verifica con `git ls-files` che i due nuovi ci siano e che il vecchio non ci sia più: altrimenti il −1,36 MB di D45 è una cifra che il repo smentisce.
E ha una seconda faccia, scoperta al secondo giro di verifica: un percorso **inesistente** su una riga `git add` fa uscire il comando con 1 e la catena `&&` si interrompe, quindi non è il file sbagliato a entrare — è il commit intero a non avvenire. Il Task 3 ne aveva due, `tests/unit/data/tileGrid.test.ts` (una directory troppo in alto) e `tests/unit/server/viewPriority.test.ts` (dichiarato nuovo, creato da nessuno step), e il suo commit non sarebbe mai stato fatto. La risposta è nei due posti in cui il difetto nasce: ogni percorso che un task mette in staging senza che sia già tracciato è creato da uno step **numerato**, e il Task 3 verifica con `ls -1` prima di aggiungere.
E la verifica di tutto questo **non si fa a occhio**. Un elenco confrontato a mano è esattamente come sono passati i cinque difetti precedenti. Il confronto è uno script che, per ogni task, estrae i percorsi citati negli step, quelli del blocco **Files** e quelli della riga `git add`, e interroga `git ls-files` e il disco: quattro insiemi, tre differenze, nessuna attenzione richiesta.
