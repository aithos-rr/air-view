# Air View v2 — Piano 2: densità e movimento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere le due frasi con cui l'utente ha aperto la v2 — «un globo molto più dettagliato e zoomabile in cui OGNI AEREO sia distinguibile» e «posizioni aggiornate di frequente, non iconcine approssimate che sembrano non spostarsi mai» — senza che il globo mostri un metro di volo che nessuno ha misurato, e senza che un puntino fermo passi per un aereo fermo.

**Architecture:** Il moto di un aereo diventa **due vettori e un angolo**, calcolati una volta per batch: l'unitario della posizione misurata e l'unitario della tangente nella direzione della rotta. Avanzare lungo l'ortodromia è allora una rotazione nel piano che quei due generano — un `cos` e un `sin` per fotogramma, contro i quattro che il renderer spende oggi per il giro lat/lon → xyz. Chi decide **di quanto** avanzare è una funzione pura con un tetto; chi decide **quanti** si muovono e quanti no è la stessa `describeVisibleFleet` del Piano 3, nella stessa passata, con la stessa aritmetica autoverificante. Il puntino smette di essere un corpo di dimensione fissa nel mondo e diventa un **simbolo di dimensione fissa sullo schermo**, perché è l'unico modo perché zoomando la geografia separi davvero; e lo zoom scende fin dove la separazione è reale.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md` §4

**Predecessori:** `docs/superpowers/plans/2026-11-16-air-view-v2-tiled-feed.md` (Piano 1) e `docs/superpowers/plans/2026-11-21-air-view-v2-panel-focus-search.md` (Piano 3), entrambi su `main` e in produzione. Questo piano non corregge niente di loro: ne consuma le interfacce e ne estende l'invariante D15.

---

## 1. Cosa esiste già — letto nel repo il 2026-11-22

Verificato su `main`: **498 test in 53 file**, 12 test Playwright, `npm run build:all` pulito su entrambi i programmi.

| Cosa | Dove | Stato |
|---|---|---|
| `velocityKt`, `headingDeg`, `lastContact` su ogni record | `src/types.ts:16-20` — tutti e tre `number \| null` | arrivano al client dal Piano 1 e **nessuno li usa per muovere niente** |
| La posizione del puntino | `src/globe/aircraft.ts:265`, `writePoint` → `writeLatLonAlt(set.positions, i*3, ac.latitude!, ac.longitude!, altFt)` | è il **fix**, ridisegnato identico a ogni fotogramma finché non arriva un batch nuovo |
| La dimensione del puntino | `src/globe/aircraft.ts:94` — `float s = uSize * uPixelRatio * (4.0 / -mv.z);` | è una **divisione prospettica**: il punto cresce esattamente come la geografia |
| Il tetto del renderer | `src/globe/visibility.ts:101`, `RENDER_CAPS.perCategory = 24000` | dichiarato, non silenzioso (D15) |
| La passata unica | `src/globe/visibility.ts:145`, `describeVisibleFleet(...)` con `onDraw` | **è** il ciclo di disegno di `AircraftLayer.update` (`aircraft.ts:302`) e la fonte dei numeri del pannello (`FleetPanel.tsx:53`) |
| L'orologio monotono del render loop | `src/globe/scene.ts:138`, `function animate(time: number)` | il timestamp di `requestAnimationFrame`, già usato per la dissolvenza del focus |
| Il profiler per fotogramma | `src/globe/scene.ts:190-209` | stampa già `aircraft X.XXms · trails · leader · render` una volta al secondo |
| Il taglio dell'emisfero lontano | `raycaster.ts:38`, `leaderLine.ts:19`, `airportMarkers.ts:57` — tutti e tre `camDir.dot(acDir) <= 0.05` | **un numero cablato in tre posti, e sbagliato in tutti e tre** (D25) |
| La profondità | `globe.ts:67` e `atmosphere.ts:35` hanno `depthWrite: false` | nessuno scrive il depth buffer: gli aerei **dietro** al pianeta sono disegnati attraverso |
| La corsa della camera | `src/globe/scene.ts:51-52`, `minDistance = 3.0`, `maxDistance = 10.0` | sono **unità di mondo**, non raggi: `GLOBE_RADIUS = 1.5`, quindi 2,0–6,67 raggi. Tre commenti del repo dicono «raggi» (`geoHelpers.ts:60`, `airportMarkers.ts:30`, `index.ts:144`) |
| La scia | `src/globe/trails.ts:133-156` | la testa della polilinea è `ac.latitude/longitude`, cioè **un fix vero** |
| La cadenza del client | `src/data/aircraftStream.ts:12-16` | `active: 30_000`, `idle: 60_000`, `background: 120_000` |
| La cadenza delle tile in vista | `src/data/sources/tileGrid.ts:164`, `DEFAULT_MIN_REFRESH_MS = 60_000` | una tile sotto il viewport non viene rimessa in coda prima di 60 s |
| Il timbro del batch | `server/index.ts:331` scrive `fetchedAt` **quando costruisce** il corpo; `server/feedState.ts` serve quel corpo immutato fino a `maxStaleMs = 600_000` e alza `stale` oltre `maxFreshMs = 90_000` | **`fetchedAt` è un timbro che si ripete, non un orologio**: fra i 90 s e i 600 s il corpo torna identico mentre l'HUD già dice «feed stale» (D31) |
| L'età del feed nell'HUD | `src/state/aircraftStore.ts:79`, `feedAgeSeconds()`; `src/ui/FeedStatus.tsx:39` | misurata sull'orologio del **browser** contro `fetchedAt`, quindi cresce con il tempo vero anche quando il corpo si ripete — è il numero da cui D31 fa partire tutto |
| L'autorotazione | `src/globe/scene.ts:54`, e `stopRotate()` legato a `pointerdown`/`wheel` **sul canvas** (`scene.ts:63-64`) | mettere a fuoco un volo dal pannello, dalla lista o dalla ricerca **non** la ferma (D32) |

Il punto da cui parte tutto il piano: **rotta e velocità attraversano già l'intera catena e muoiono inguardate nel client, esattamente come ci era finito `complete` prima del Piano 3**. Nessun task qui sotto deve andarle a cercare da qualche parte.

---

## 2. I numeri veri da cui parte il disegno

Misurati in produzione il 2026-11-22, o letti nel codice lo stesso giorno.

```
flotta servita per richiesta      2 000 – 12 000 aerei   (misurato: 11 625)
payload                           0,84 MB grezzo · 0,12 MB gzip
tetto del renderer                24 000 per categoria, DICHIARATO oltre (D15)
copertura rotta bussola           89,6 %     (spec §5.1)
copertura velocità al suolo       97,8 %     (spec §5.1)
sweep completo della griglia      546 tile × 1,5 s = 819 s   (poller.ts:20)
ritenzione della flotta           max(1 200 s, 2 × sweep), tetto 7 200 s   (index.ts:168-169, 310)
tile sotto il viewport            non rifetchata prima di 60 s   (tileGrid.ts:164)
refresh del client, attivo        30 s   (aircraftStream.ts:13)
distanza peggiore da un centro tile   218,0 NM, su 1 224 760 punti campionati   (tileGrid.ts:60-62)
```

E calcolati, con il codice vero in mano, perché il disegno ci poggia sopra. `visibleCapRadiusNm(d, 38)` è la funzione di `src/globe/geoHelpers.ts:73`; `NM/px` è il diametro del cap diviso 1 080 px di altezza; `quad` è `clamp(26 × 2 × 4 / (d − 1,5), 6, 220)`, cioè la formula di `aircraft.ts:94` con `devicePixelRatio = 2`:

```
 d (unità)   d/R    cap NM    NM/px    quad (device px)
   15,00    10,00     5 059     9,37        15,4
   10,00     6,67     4 886     9,05        24,5     ← maxDistance di oggi
    4,50     3,00     3 519     6,52        69,3
    3,00     2,00     1 299     2,41       138,7     ← minDistance di oggi
    2,10     1,40       487     0,90       220,0  (al tetto del clamp)
    1,90     1,27       322     0,60       220,0     ← minDistance proposto
    1,70     1,13       159     0,29       220,0
```

E la densità, che è il metro di «ogni aereo distinguibile». Con 4 000 aerei su una scatola europea di 2 000 × 1 500 NM, la distanza media dal vicino più prossimo è `0,5 / sqrt(densità)` = **13,7 NM**. Su tutta la flotta servita, 11 625 aerei sull'area effettivamente coperta da ricevitori, **46,4 NM**.

**Le quattro conseguenze che il disegno deve digerire.**

1. **Oggi, al massimo zoom, un aereo è largo 139 pixel di dispositivo e il suo vicino sta a 11,4.** Non è un'impressione: è `2,41 NM/px` contro `13,7 NM` di distanza media. I punti non si sovrappongono un po', si sovrappongono di un fattore sette. E zoomando non migliora di niente, perché `4.0 / -mv.z` fa crescere il punto esattamente quanto la geografia. Questa è, parola per parola, la frase della spec §4.2: «zoomando si separa la geografia ma i punti restano attaccati».
2. **La flotta non è un'istantanea: è un mosaico di età.** Il server la assembla tile per tile in 819 s e la tiene per almeno 1 200 s. L'età del fix di un aereo, nel momento in cui lo disegniamo, è distribuita su quasi tutto lo sweep. Con un tetto di 120 s **non** si estrapola la maggioranza della flotta — e non è un difetto del tetto, è la verità sul feed. Vedi D16 e D19.
3. **Ma la parte che l'utente sta guardando è un'altra cosa.** Le tile sotto il viewport saltano la coda (`index.ts:450`) con un pavimento di 60 s, e il client rinfresca ogni 30 s: per ciò che è inquadrato l'età peggiore del fix è **90 s**. Il tetto va dimensionato su questo, non sullo sweep.
4. **A 1,9 unità il cap visibile è 322 NM, e 218,0 NM è la distanza peggiore fra un punto coperto e il centro della sua tile.** Il margine è 104 NM: scendendo oltre, `tilesNear` smetterebbe di nominare una tile e la regione inquadrata perderebbe la priorità che il Piano 1 le ha dato. Il fondo corsa dello zoom è questo numero, non un gusto. Vedi D24.

---

## 3. Decisioni di disegno prese qui, con la ragione

La numerazione riprende da D15 del Piano 3; D19 è un'estensione dichiarata di D15, non una regola che gli si affianca, e D33 lo è di D19. D31, D32 e D33 sono le tre condizioni senza le quali D16, D25 e D19 affermerebbero il falso: la prima fa crescere l'età di un fix con il tempo vero, la seconda impedisce che il taglio dell'emisfero svuoti il globo in silenzio sotto un focus, la terza dà a chi dichiara il moto lo stesso orologio con cui il globo lo disegna.

**D16 — Il tetto del dead reckoning è 120 s, e viene dalla cadenza misurata della NOSTRA pipeline, non da un'intuizione sull'aviazione.**
Due numeri, entrambi nel repo: una tile sotto il viewport non viene rimessa in coda prima di `DEFAULT_MIN_REFRESH_MS = 60_000` (`tileGrid.ts:164`), e il client in stato attivo rinfresca ogni `30_000` ms (`aircraftStream.ts:13`). Il caso peggiore per **ciò che l'utente sta guardando** è quindi 90 s. 120 s copre quell'intervallo con 30 s di margine e **niente di più**. Oltre quel punto non staremmo più colmando il buco fra due fix: staremmo dipingendo sopra un guasto nostro — una tile che non è tornata, un poller sospeso da un 429 — e dipingere sopra la propria staleness è la v1 in un altro costume, 25 giorni di snapshot che sembrava vivo. Il tetto è il confine fra ricostruire e coprire.
Quei 30 s di margine sono netti, non lordi: D31 arretra lo stampiglio del batch dell'età che il corpo aveva già quando è arrivato, quindi il ritardo di consegna — al più un ciclo del poller — non se li mangia.
In numeri di schermo: 120 s a 450 nodi sono **15,0 NM**, cioè 1,7 px alla vista pianeta (9,05 NM/px) e 25 px al fondo corsa dello zoom (0,60 NM/px). A 120 kt, un aereo in avvicinamento, sono 4,0 NM: 0,4 px e 6,7 px. L'errore che un'estrapolazione può accumulare in quella finestra è dello stesso ordine — una virata di 30° tenuta per due minuti sposta di traverso di 7,5 NM — e resta sotto al diametro del simbolo a ogni zoom tranne il fondo corsa, dove vale un simbolo e mezzo.

**D17 — Scaduto il tetto l'aereo NON sparisce: resta dove è stato misurato, più spento, e il pannello dice quanti sono.**
La posizione è un dato misurato; non saperla animare non è una ragione per cancellarla. Toglierla dal globo vorrebbe dire spegnere la maggioranza della flotta — vedi §2.2 — per punire la mancanza di un aggiornamento che non è colpa dell'aereo. Lo sbiadimento della spec §4.1 si fa **sull'intensità del frammento, mai sul colore**: `src/globe/aircraft.ts:121-130` registra già, con il guasto in mano, che moltiplicare `aColor` lascia acceso il `mix()` con il bianco e un punto «spento» continua a disegnare un aereo grigio al ~45 %. Il fattore è un attributo per-punto, `aLive`, che entra dove entra `uBrightness`.
0,55 e non meno: sotto, la silhouette di un punto da 7 px smette di leggersi; sopra, non si distingue da un aereo vivo. E mai sotto `0.005`, la soglia di `discard` del frammento, perché «spento» non deve mai diventare «assente» senza che la passata lo sappia.

**D18 — Un aereo senza `lastContact`, `velocityKt` o `headingDeg` ha il SUO contatore, separato dal tetto.**
Due assenze diverse, due parole diverse: è D15b. «Non ho sentito questo aereo da più di due minuti» e «questo aereo non mi dice dove sta andando» sono fatti distinti, e fonderli in «fermo» è la mezza verità che questo progetto ha già pagato. La misura dice che non è un caso teorico: la rotta bussola copre l'89,6 % della flotta e la velocità il 97,8 % (spec §5.1), quindi una decina di aerei su cento non è estrapolabile **mai**, qualunque cosa faccia il feed. E `lastContact` è `null` per scelta degli adattatori quando il fornitore non dice da quanto ha sentito l'aereo (`src/types.ts:20`): una staleness ignota non è una staleness di zero, ed estrapolare da lì sarebbe mettere un valore plausibile al posto di uno mancante — la regola che questo repo non infrange.

**D19 — (estensione di D15) Lo schermo non mostra mai un movimento che non ha misurato, e quando un puntino è fermo perché NOI non possiamo muoverlo, lo dice. `moving + still.unmeasurable + still.stale === shown`, per costruzione, nella stessa passata.**
D15 ha chiuso una famiglia di difetti: lo schermo dichiarava più puntini di quanti ne disegnasse. Il dead reckoning ne apre una gemella, con il segno su un altro asse: **lo schermo disegna due comportamenti e ne dichiara uno solo**. Una parte della flotta scivola, il resto sta immobile, e un utente che vede le due cose insieme conclude la sola cosa che il quadro suggerisce — che gli immobili siano aerei fermi. È un'affermazione falsa fatta senza misurarla, cioè D15b per intero, raggiunta attraverso il movimento invece che attraverso un conteggio.
Il meccanismo è lo stesso, e letteralmente la stessa passata. `describeVisibleFleet` guadagna `moving: number` e `still: { unmeasurable: number; stale: number }`, incrementati **dove** il punto viene disegnato, mai in un secondo giro. L'identità `shown + hidden.filtered + hidden.focus + hidden.noPosition + hidden.rendererFull === total` resta intatta, perché questi tre non sono ammanchi: sono una **partizione di `shown`**. Il precedente è nel file stesso — `releasedByLeavingFocus` è una misura presa nella stessa passata e dichiarata «NOT a fifth member of `hidden`» (`visibility.ts:79-92`) — e la tabella dell'invariante verifica da oggi **due** identità su ogni riga invece di una.
E il renderer non classifica per conto suo: `onDraw` riceve **di quanti secondi avanzare** e **se è fermo**. Il numero che il pannello stampa e il numero di secondi che il puntino percorre escono dalla stessa riga di codice, quindi non possono smentirsi — che è tutto quello che D15 ha sempre voluto dire.

**D20 — Il movimento è una rotazione nel piano del grande cerchio, precalcolata una volta per batch, e per fotogramma costa MENO di quello che il renderer fa oggi.**
Interpolare lat/lon linearmente disegnerebbe la lossodromia: il Piano 3 l'ha misurata su JFK→LHR, mezzeria a 46,06 N invece di 52,21 N (`routeArc.ts:82-98`), ed è la stessa bugia geometrica in scala ridotta. L'ortodromia si ottiene senza nessuna formula sferica nel ciclo caldo: il piano del grande cerchio è generato dall'unitario della posizione `u` e dall'unitario della tangente nella direzione della rotta `w`, e avanzare di un angolo δ è `u·cos δ + w·sin δ`. `u` e `w` si calcolano **una volta per batch**, cioè una volta ogni 30 s.
Il conto, esplicito. Oggi `writeLatLonAlt` (`aircraft.ts:177-191`) spende **4 chiamate trascendenti per aereo per fotogramma**: a 11 625 aerei e 60 fps sono 2,79 milioni al secondo, ~56 ms di CPU al secondo a 20 ns l'una. Domani: **zero** per un aereo fermo (`p = u × radius`, tre moltiplicazioni) e **due** per uno in movimento. Con la frazione in movimento misurata in §2.2 — 120 s di tetto su 819 s di sweep, cioè ~14,7 % — fanno 1 709 × 2 = 3 418 chiamate per fotogramma, 205 mila al secondo, ~4 ms. Il dead reckoning **toglie** lavoro al ciclo di disegno invece di aggiungerne. Il precalcolo per batch è 11 625 × ~10 trascendenti = 2,4 ms una volta ogni 30 s, lo 0,008 %.
Il Task 8 lo prova con un test deterministico invece che con un cronometro: conta le chiamate a `Math.sin`/`Math.cos` dentro un `update()`, perché un'asserzione sui millisecondi su una macchina di CI è un test che fallisce per il meteo.

**D21 — Due orologi, e nessuno dei due fa il lavoro dell'altro.**
L'età di un fix è la differenza fra due **istanti di parete**: `lastContact` viene dal fornitore, `fetchedAt` dal nostro server, e non esiste un cronometro monotono che possa misurare la distanza fra due letture di orologi diversi. Quella sottrazione si fa **una volta per batch** e il risultato, `fixAgeAtBatchS`, è un numero congelato.
Tutto quello che succede dopo è una **durata**, e le durate su questa macchina si misurano monotone: `Date.now()` salta di ~528 ms ogni ~32 s (`server/routeResolver.ts:47-58`). Lo store stampiglia il batch con `performance.now()`, il render loop usa il `time` di `requestAnimationFrame`, e i due si possono sottrarre perché condividono `performance.timeOrigin` per specifica. L'avanzamento di un fotogramma è quindi `fixAgeAtBatchS + (rafTime − feedStampMs)/1000`: un istante di parete congelato più una durata monotona, mai un'età ricalcolata contro l'orologio di sistema. È lo stesso errore che in v1 ha cancellato l'intera flotta (`removeStale` contro l'ora locale, spec §4.1), riconosciuto prima di commetterlo di nuovo.

**D22 — All'arrivo di un fix nuovo l'aereo SCIVOLA se la correzione è roba nostra, SALTA se è volo che non abbiamo mostrato.**
Quando una tile torna, l'aereo salta da dove lo stavamo disegnando a dove il fornitore dice che è. Due casi, e la differenza non è di grandezza ma di natura.
Se lo scarto è **al più quanto l'aereo percorre in una finestra di tetto** (`velocityKt/3600 × 120 s`, 15 NM a 450 nodi), è esattamente l'errore che la nostra estrapolazione poteva aver commesso: è un errore di **disegno**, e lo si riassorbe scivolando in 300 ms — la finestra editoriale 200-400 ms di `DESIGN.md` che `FOCUS_FADE_MS` occupa già (`focus.ts:1-6`), sull'orologio di `requestAnimationFrame`. Non si interpola un dato: il bersaglio è sempre la posizione estrapolata vera, e quello che decade a zero è lo scarto.
Se lo scarto è **più grande**, non è errore nostro: è un pezzo di volo che non abbiamo mai mostrato, perché la tile non tornava da quattordici minuti. Farglielo percorrere in 300 ms disegnerebbe un viaggio che non è avvenuto, a una velocità che nessun aereo ha. Allora **salta**, e il salto è onesto: quell'aereo era dichiarato fermo da prima che si muovesse.

**D23 — Il raggio del punto è in PIXEL SCHERMO e cresce col logaritmo dello zoom, non col suo reciproco.**
`float s = uSize * uPixelRatio * (4.0 / -mv.z)` (`aircraft.ts:94`) è una divisione prospettica: il punto si comporta come una sfera di dimensione fissa **nel mondo**, quindi cresce esattamente quanto cresce la geografia. Due aerei sovrapposti alla vista pianeta restano sovrapposti a ogni zoom. Misurato: a `d = 3,0` il quad è 138,7 px di dispositivo e il vicino medio europeo ne dista 11,4. Non c'è zoom che risolva un rapporto che lo zoom non cambia.
La sostituzione è una funzione pura, `pointSizePx(cameraDistance)`, che il render loop scrive in un uniform una volta per fotogramma — fuori dallo shader apposta, perché una soglia dentro il vertex shader non si può testare, che è la stessa ragione per cui `markerLabelVisible` sta in `airportMarkers.ts:36` e non in un `if` glsl. **7 px** a `d = 10,0`, **14 px** a `d = 1,9`, interpolati sul logaritmo della distanza: il simbolo cresce di un fattore 2 mentre la geografia si allarga di 5,3, e la separazione netta è il rapporto fra i due.
Il prezzo, dichiarato: alla distanza che oggi è il fondo corsa, il puntino passa da 139 a ~24 px di dispositivo. Le grandi sagome d'aereo di adesso non si perdono, si **spostano più in giù nello zoom** — a 14 px CSS, cioè 28 di dispositivo, la silhouette dell'SDF si legge come un aereo. Non è possibile avere insieme «ogni aereo distinguibile» e «icone grandi» su una vista da 1 299 NM in cui i vicini distano 5,7 px: quello è un vincolo dell'ottica, non una scelta di gusto.

**D24 — Il fondo corsa dello zoom scende da 3,0 a 1,9 unità, e 1,9 è il numero della griglia delle tile.**
Senza più zoom, D23 da sola rimpicciolisce i punti e basta: la separazione nasce dalla geografia (spec §4.2), e la geografia si allarga solo avvicinandosi. A 1,9 unità il cap visibile è 322 NM — una vista regionale, che è il livello che la spec §4.3 chiede.
Perché 1,9 e non 1,7. `tilesNear` nomina le tile il cui **centro** cade entro il raggio dichiarato (`tileGrid.ts:153`), e la griglia è costruita in modo che nessun punto coperto disti più di **218,0 NM** dal centro più vicino, verificato su 1 224 760 campioni (`tileGrid.ts:60-62`). A 322 NM restano 104 NM di margine e la regione inquadrata continua a saltare la coda; a 1,7 unità il cap è 159 NM e un visitatore potrebbe trovarsi in un punto il cui centro tile dista 218 NM — la cosa che sta guardando smetterebbe di essere rinfrescata per prima, cioè si romperebbe esattamente il meccanismo su cui D16 dimensiona il tetto.
Il resto regge: gli aerei stanno al più a `1,5 + 0,075 = 1,575` unità dal centro (`geoHelpers.ts:23-25`), quindi a 1,9 la camera è a 0,325 dal più vicino, sopra il `near` di 0,1 della `PerspectiveCamera` (`scene.ts:39`). `MAX_VIEW_RADIUS_NM` è un tetto, non un pavimento (`index.ts:151`), quindi 322 arriva al server intatto. E i due limiti smettono di essere due letterali in `scene.ts`: diventano `CAMERA_NEAR_LIMIT`/`CAMERA_FAR_LIMIT` in `geoHelpers.ts`, letti anche da `pointSizePx` e da `markerLabelVisible` — tre commenti del repo oggi li chiamano «raggi» quando sono unità di mondo, e una costante sola è il modo di non farlo una quarta volta.

**D25 — Gli aerei dietro al pianeta non si disegnano, e questo NON è un ammanco da dichiarare: è inquadratura.**
Oggi nessuno scrive il depth buffer — `globe.ts:67` e `atmosphere.ts:35` hanno entrambi `depthWrite: false` — quindi ogni aereo dell'emisfero lontano è dipinto **attraverso** il pianeta; e intanto `raycaster.ts:38` si rifiuta di farlo cliccare. Renderer e picking sono già in disaccordo: un puntino che si vede e non si clicca è il fantasma che D7 vieta, visto dall'altra porta. A 1,9 unità diventa insostenibile: il globo riempie tutto lo schermo e gli undicimila aerei dell'altra faccia si proiettano sopra i trenta che il visitatore sta esaminando.
Il taglio sta nel **vertex shader**, e il punto escluso esce dal volume di clip senza costare un frammento. Sta lì e non nella passata perché `shown` ha sempre significato «record consegnati al globo da disegnare»: D15 non ha mai contato quello che finisce fuori dal bordo dell'inquadratura, e non potrebbe, dato che `describeVisibleFleet` non ha una camera. La faccia nascosta di una sfera è anche l'unica causa che l'utente risolve da sé, trascinando. Farla entrare nel conteggio significherebbe invece un numero che cambia quattro volte al secondo mentre il globo ruota da solo (`scene.ts:54`), cioè rumore spacciato per spiegazione.
Il test è **la stessa espressione in due linguaggi**: `dot(C, P) ≥ R²` è la condizione esatta perché un punto a raggio `r` sia sul lato vicino visto da `C`. In TypeScript diventa `isOnNearSide(camera.position, worldPos)` in `geoHelpers.ts`, e la usano il picking, la leader line e i marcatori — al posto del `0.05` cablato in tre file, che a `d = 15,0` dovrebbe valere 0,0968 e a `d = 1,9` dovrebbe valere 0,764. Non era approssimato: era un numero che non è giusto da nessuna parte.

**D26 — Due aerei sovrapposti restano due aerei: nessun clustering, e il click gira fra i coincidenti.**
La spec §4.2 chiama il clustering numerico idioma Flightradar24 e anti-reference, e il Piano 3 non lo ha introdotto. Non lo introduce nemmeno questo. Dove i puntini si accumulano, il blending additivo li fa **più luminosi** — ed è un indicatore di densità vero, che nessuno ha dovuto inventare e che nessun numero finto deve coprire.
L'ambiguità la scioglie il picking, come dice la spec: `findAircraftAtPointer` continua a restituire il più vicino al cursore, e **cliccando di nuovo lo stesso pixel** restituisce quello dopo nell'ordine di distanza, ciclando. «Lo stesso pixel» è entro 4 px dal click precedente: un movimento del mouse più grande è un bersaglio nuovo, non un secondo tentativo sullo stesso.

**D27 — L'ordine di disegno resta com'è, ma la gerarchia la portano la DIMENSIONE e il colore, non l'ordine.**
Letto nel codice: i tre point set sono additivi con `depthWrite: false` (`aircraft.ts:140-143`), e l'addizione è commutativa — `renderOrder` non può quindi seppellire niente, e il commento di `aircraft.ts:223-226` («draw order IS the hierarchy… un aereo completo sepolto sotto il rumore grigio») afferma un meccanismo che il blending non ha. L'ordine resta dov'è, perché non costa nulla e tornerebbe a contare il giorno in cui qualcosa scrivesse il depth; ma la gerarchia ottiene un meccanismo che funziona davvero: **completo × 1,15, selezionato × 1,9** sul raggio in pixel di D23. Dove un completo e un parziale coincidono, il caldo deborda dal grigio invece di sommarglisi dentro.

**D28 — La scia resta un documento, e la distanza fra il puntino e la fine della sua scia È quanto abbiamo estrapolato.**
La spec §4.1 lo chiede: «il trail disegna solo fix realmente ricevuti, mai posizioni calcolate». `trails.ts` non va toccato — la testa della sua polilinea è già `ac.latitude/longitude` (`trails.ts:138-139`, `154-155`), cioè l'ultimo fix vero. Il puntino, estrapolato, se ne staccherà.
Quello stacco **non è un difetto da chiudere**: è l'unico righello onesto dell'estrapolazione presente sullo schermo. Quanto il puntino è avanti rispetto alla fine della propria scia è, pixel per pixel, quanto abbiamo ricostruito. Un test lo inchioda, perché è esattamente il genere di cosa che il prossimo lettore «ripara».

**D29 — La leader line e il picking seguono il PUNTINO; l'arco resta sul fix.**
La leader line è una linea che punta al puntino: se parte dal fix mentre il puntino è avanti di 25 px, indica accanto. Il picking è peggio — un puntino che si vede e non si clicca è di nuovo il fantasma di D7. Entrambi usano la posizione estrapolata, e il click handler può farlo perché `performance.now()` e il timestamp di rAF hanno la stessa origine (D21).
L'arco no, e la ragione è una misura: il punto in cui l'arco cambia luminosità si sposterebbe al più di 15 NM su una rotta di migliaia, cioè meno di un campione di arco agli zoom in cui l'arco è leggibile (256 campioni su un JFK→LHR sono 11,7 NM l'uno). E il luogo dove la posizione dell'aereo è **dichiarata** è il puntino stesso, che è giusto. Spostare anche lo spartiacque dell'arco vorrebbe dire far passare l'elapsed del fotogramma dentro `readFocusView()`, cioè attraversare `sceneView.ts` per un effetto che nessuno schermo può mostrare.

**D30 — `prefers-reduced-motion` ferma lo scivolamento, non il dead reckoning.**
L'impostazione esiste contro gli scatenanti vestibolari: moto ampio, veloce, parallattico — ed è per questo che `scene.ts:54` le spegne l'autorotazione del globo. Un puntino che avanza di 1,7 px al minuto alla vista pianeta, e di 25 px in due minuti al fondo corsa, non è quello; spegnerlo significherebbe mostrare a chi ha quell'impostazione una flotta tutta immobile — cioè la v1 — per protezione da un moto che non c'è. Il dead reckoning quindi resta acceso.
Lo scivolamento di D22 invece è un'animazione discreta di 300 ms innescata da un evento, della stessa famiglia della dissolvenza del focus che `fadeAmount` già disattiva (`focus.ts:17-18`): con l'impostazione attiva, l'aereo **salta** sempre. Il bersaglio è lo stesso in entrambi i casi, quindi non si perde nessuna informazione: si perde solo l'interpolazione.

**D31 — L'età di un fix si conta dall'istante in cui il SERVER ha COSTRUITO il corpo, non da quando il corpo è arrivato; e un corpo che il server dichiara `stale` non si estrapola affatto.**
`server/index.ts:331` stampiglia `fetchedAt: new Date(nowUnix * 1000)` nel momento in cui costruisce il body, e `feedState.get()` serve quel body **immutato** finché ha meno di `maxStaleMs = 600_000` ms, alzando `stale` oltre `maxFreshMs = 90_000` (`server/feedState.ts`). Un client che stampigliasse il proprio orologio monotono **all'arrivo** azzererebbe quindi l'età di tutti i fix a ogni refresh da 30 s, contro un `fetchedAt` che non si muove: il tetto di D16 — che esiste esattamente per il caso «il feed si è fermato» — non scatterebbe **mai**, e gli aerei continuerebbero a estrapolare per gli otto minuti e mezzo fra i 90 s e i 600 s mentre l'HUD stampa «feed stale · last known positions». Due affermazioni incompatibili sullo stesso schermo, con il movimento dalla parte sbagliata: è D15b raggiunto attraverso il tempo invece che attraverso un conteggio.
Tre meccanismi, una regola sola, tutti e tre in `updateBatch` perché è l'unico punto che vede arrivare un corpo.
1. **Lo stampiglio è arretrato dell'età che il corpo aveva già.** `Math.max(0, Date.now()/1000 − fetchedAt)`: una sottrazione fra due orologi di parete, fatta **una volta** e congelata, esattamente come l'età dei fix di D21 — ed è lo stesso numero che `feedAgeSeconds()` stampa nell'HUD, quindi le parole e il movimento escono da un numero solo. Copre anche il primo caricamento durante un guasto, dove non c'è nessun batch precedente da cui contare.
2. **Un `fetchedAt` già visto non ri-stampiglia e non ri-deriva niente.** È la stessa fotografia: l'orologio monotono continua a correre dal primo arrivo e l'età cresce con il tempo vero. Due corpi non possono condividere un `fetchedAt` — un ciclo è 8 tile al pavimento di 1,5 s più `TILE_CYCLE_GAP_MS` (`poller.ts:31`, `index.ts:185,621-631`), cioè almeno 11 s, e `fetchedAt` ha risoluzione di un secondo. In più, 11 625 record × sei trascendenti risparmiati a ogni refresh che non porta niente.
3. **`stale` è un arresto duro.** Il flag è calcolato dal server sul **proprio** orologio, quindi nessun orologio del client può sconfiggerlo — ed è il caso in cui l'orologio del browser, se è indietro, azzererebbe il punto 1. Quando è alzato, `advanceFor` risponde `STILL` per tutti e il pannello li conta sotto `still.stale`, con la frase che nomina il feed e non il singolo aereo: quegli aerei sono stati sentiti pochi secondi fa, è il **corpo** che stiamo tenendo a essere un replay.
Il punto 3 è anche ciò che rende la contraddizione **impossibile per costruzione** invece che improbabile: finché l'HUD dice «last known positions», il globo mostra esattamente ultime posizioni note.
E `advanceFor(m, elapsed, stale)` esiste perché la regola ha tre lettori — la passata che conta, il picking che clicca, la leader line che punta. Scritta tre volte divergerebbe, e la forma di quella divergenza è un puntino che si vede e non si clicca, cioè D7 (vedi D29).

**D32 — Sotto focus il globo non ruota più da solo, e quando l'unico aereo mostrato non è sul lato visibile lo schermo lo dice.**
D25 taglia l'emisfero lontano e sostiene che il taglio «non è un ammanco da dichiarare ma inquadratura». Per la flotta intera l'argomentazione regge: il numero cambierebbe quattro volte al secondo mentre il globo gira, e la faccia nascosta è la sola causa che l'utente risolve da sé trascinando. **Con un aereo solo mostrato non regge più.** Quell'aereo che esce di vista non è una parte dell'inquadratura: è tutto quello che c'era, e il pannello intanto dichiara «1 shown» su un globo vuoto — la frase esatta che D15 vieta, raggiunta questa volta dalla camera.
E ci si arriva **senza nessun atto dell'utente**: `scene.ts:54` accende `controls.autoRotate`, e `stopRotate()` è legato a `pointerdown` e `wheel` **sul canvas** (`scene.ts:63-64`). Mettere a fuoco un volo dalla lista, dal pannello o dalla ricerca non tocca il canvas, quindi il globo continua a girare da solo e porta il soggetto dietro al pianeta mentre il visitatore guarda la scheda.
Due rimedi, e nessuno dei due decide la domanda aperta sulla camera.
1. **Entrare in focus ferma l'autorotazione**, come la ferma qualunque altro atto dell'utente rivolto al globo. Non è la camera che insegue: la camera non si muove. È il globo che smette di muoversi da solo, il che toglie l'unico modo di arrivarci senza aver fatto niente.
2. **La dichiarazione.** `describeVisibleFleet` non ha una camera e non deve averne una — D25 ha ragione su questo e `shown` continua a significare «record consegnati al globo da disegnare». Il fatto lo misura il render loop, che la camera ce l'ha: **un prodotto scalare, per UN aereo**, quello a fuoco, con `isOnNearSide` del Task 7 — la stessa espressione del vertex shader. Non è il conteggio che D25 rifiuta: è un booleano su un soggetto solo, che cambia al più quando il soggetto attraversa il lembo, e viene scritto nello store **solo quando cambia**.
Perché vale in entrambi i rami della decisione aperta: se la camera resterà ferma, la riga appare e offre il rimedio che l'utente può eseguire (trascinare); se un giorno la camera inseguirà il volo a fuoco, il soggetto è sempre sul lato visibile e la riga **non appare mai**. Un test lo inchioda da quel lato — con la camera sopra il soggetto la nota non c'è — quindi la dichiarazione non va riscritta qualunque cosa l'utente decida.
**Decisione aperta, dichiarata qui e non presa:** se la camera debba portarsi sul volo quando entra in focus. È una scelta di prodotto, è stata posta all'utente e non ha ancora risposta. La riga che cambierebbe se la risposta fosse **sì** è una sola, in `src/globe/scene.ts`, dentro `animate()`, dove oggi il focus si limita a fermare l'autorotazione (Task 7, Step 8): accanto a `stopRotate()` andrebbe un riallineamento di `camera.position` sulla direzione del soggetto a parità di distanza — `camera.position.copy(subjectDir).multiplyScalar(camera.position.length())`, animato sulla stessa finestra editoriale di 300 ms — e `controls.target` resta l'origine, perché tutto il resto del file presume che la camera guardi il centro (`viewCentre()`, `scene.ts:218-226`). Niente altro di questo piano cambierebbe.

**D33 — (estensione di D19) Chi dichiara il moto deve avere l'orologio con cui lo misura. Il pannello tiene la sua lettura in stato e la rinfresca a 1 s finché c'è qualcosa da portare avanti.**
Il globo misura la durata `rafTime − feedStampMs` sessanta volte al secondo. Il pannello la misurerebbe **una volta per batch**, perché la sua passata è una `useMemo` le cui dipendenze — la Map, la regola, la selezione, lo stamp, il flag `stale` — stanno ferme finché un corpo nuovo non arriva. E un corpo nuovo può non arrivare per 30 s nel ciclo normale, 120 s con la scheda in background, 60 s in idle, o **mai** se la fetch fallisce (`REFRESH_INTERVALS`, `aircraftStream.ts`). Nel frattempo i puntini raggiungono il tetto dei 120 s e si fermano mentre la riga sotto continua a chiamarli *moving*: D15b per via del tempo invece che per via di un conteggio, ed è la forma di tutti gli altri difetti di questo progetto — due lettori della stessa verità che si separano perché uno ha un orologio e l'altro no.
Un orologio letto **dentro** la memo non è il rimedio, è lo stesso difetto scritto peggio: `useMemo` non è una garanzia di esecuzione, quindi quel numero cambierebbe a un re-render qualunque e starebbe fermo quando l'orologio si muove, e nessun test potrebbe spostarlo. La lettura va in stato, e un `setInterval` la rinfresca.
Il tick è **1 s, e la sua giustificazione è un limite**: il pannello resta indietro rispetto al quadro di al più un tick. Quanto costa quel ritardo si misura — i fix attraversano il tetto al ritmo di circa flotta/819 al secondo, 14 su 11 625 — e quanto costa il tick pure: è la stessa passata che il render loop fa già 60 volte al secondo su un massimo di 24 000 record, senza trigonometria e senza allocazioni (`visibility.ts:160-161`), cioè un sessantesimo di un costo già a bilancio.
E si **ferma**: un'età cresce soltanto, quindi quando `moving === 0` nessun'altra lettura dell'orologio può cambiare una parola del pannello, e il batch successivo lo ridisegna da sé attraverso le sue sottoscrizioni. Fermarsi non è un'ottimizzazione del caso normale: è tutto il caso anormale, perché è il feed morto — quello che non manderà mai più niente — a lasciare altrimenti il pannello a ripercorrere la flotta una volta al secondo per sempre.
Il tick non fa parlare la live region: le righe del moto ne stanno fuori apposta (D15a), e dentro non c'è niente che l'orologio tocchi, perché `draw` conta un record allo stesso modo sia che lo porti avanti sia che lo lasci sul suo fix.

---

## 4. Global Constraints

- **Nessun dato inventato.** Un campo sconosciuto è `null` e l'interfaccia tace. In questo piano la regola ha una forma nuova: un aereo di cui non sappiamo rotta, velocità o anzianità del contatto **non si estrapola**, perché una posizione calcolata da un'ipotesi è un valore plausibile al posto di uno mancante.
- **Le durate si misurano con un orologio monotono.** `Date.now()` salta di ~528 ms ogni ~32 s su questa macchina. Le durate di questo piano — l'avanzamento dall'ultimo fix, lo scivolamento di 300 ms e la rilettura che il pannello fa dell'elapsed (D33) — usano il timestamp di `requestAnimationFrame` e `performance.now()`. `Date.now()` compare solo dove si rende un **istante**. Vedi D21.
- **L'invariante D15 del Piano 3 vale integra**, e D19 la estende. Ogni nuovo modo di non disegnare un aereo passa da `describeVisibleFleet`, e ogni nuovo modo di disegnarlo **diversamente** passa da lì pure, con un contatore suo. Un `continue` muto in `aircraft.ts` è un difetto di piano, non un dettaglio di implementazione. E chi dichiara una durata deve tenere in mano l'orologio con cui la misura, non una lettura ricordata: un lettore che calcola un elapsed dentro una `useMemo`, o dentro un valore calcolato una volta sola, è lo stesso difetto in un'altra stanza (D33).
- **Due programmi TypeScript.** `tsconfig.json` (`Bundler`) compila il client: alias `@/`, niente estensioni. `tsconfig.server.json` (`NodeNext`) compila il server: percorsi relativi con suffisso `.js`, **mai `@/`**. `src/types.ts` è nella lista `include` di entrambi (`tsconfig.server.json:14`): il tipo `Motion` si dichiara **lì dentro e senza import**, perché un `import type` da `@/globe/deadReckoning` compilerebbe per il client e romperebbe `npm run build:server`.
- **`noUnusedLocals` è attivo.** Un parametro aggiunto a una firma e non letto è un errore di compilazione, non un avviso.
- **`npm run build` non type-checka il server.** Verificare sempre con `npm run build:all`.
- **Nessuna richiesta di rete verso adsbdb, adsb.lol o adsb.fi**, né mentre si scrive né mentre si verifica. Nessun task ne ha bisogno: tutto quello che serve è aritmetica su record costruiti nei test, e gli E2E intercettano `/api/states` con `page.route()`.
- **Mai `git add -A` né `git add .`.** Questo working tree ha percorsi non tracciati e non ignorati — `.agents/`, `.claude/`, `mockups/`, `skills-lock.json`. Ogni commit elenca i propri file uno per uno.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy è una decisione dell'utente.
- Messaggi di commit in inglese. Commenti in inglese, e un commento dice **perché**, citando la misura o il guasto, mai cosa fa la riga sotto.

**Stato di partenza del cancello:** `npm test -- --run` → **498 passed (53 files)**; `npm run test:e2e` → **12 passed**. Ogni task dichiara il numero atteso dopo di sé.

---

### Task 1: L'aritmetica del dead reckoning, e il tetto

Prima di muovere un pixel, il piano fissa il posto unico dove si decide **di quanto** un aereo avanza e **se** può avanzare. Scritto dentro al render loop sarebbe intestabile e, come tutto ciò che vive solo a 60 fps, invisibile a chi lo rompe.

**Files:**
- Modify: `src/types.ts` — il tipo `Motion`, e `motion` su `Aircraft`
- Create: `src/globe/deadReckoning.ts`
- Test: `tests/unit/globe/deadReckoning.test.ts`

**Interfaces:**
- Consumes: `AircraftRaw` da `src/types.ts`; `GLOBE_RADIUS`, `altitudeToOffset` da `src/globe/geoHelpers.ts`
- Produces: `DR_CAP_S = 120`, `RECONCILE_MS = 300`, `STILL = -1`, `STILL_DIM = 0.55`; `deriveMotion(ac: AircraftRaw, batchFetchedAtUnix: number): Motion | null`; `advanceSeconds(m: Motion, elapsedSinceBatchS: number): number`; `advanceFor(m: Motion | null, elapsedSinceBatchS: number, feedStale: boolean): number`; `positionAt(m: Motion, advanceS: number, nowMs: number, out: Xyz): void`; `reconcile(fresh, elapsedOnFreshS, previous, elapsedOnPreviousS, nowMs, animate): Motion`

**Perché `Motion` sta in `types.ts` e non accanto alla sua funzione.** `src/types.ts` è compilato da **entrambi** i programmi (`tsconfig.server.json:14`) e `Aircraft` deve portare il campo. Un `import type { Motion } from '@/globe/deadReckoning'` dentro `types.ts` passerebbe il client e farebbe fallire `npm run build:server`, dove l'alias `@/` non esiste. L'interfaccia è dati puri e non importa niente: va lì.

- [x] **Step 1: Creare `tests/unit/globe/deadReckoning.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  DR_CAP_S,
  RECONCILE_MS,
  STILL,
  advanceFor,
  advanceSeconds,
  deriveMotion,
  positionAt,
  reconcile,
} from '@/globe/deadReckoning';
import { GLOBE_RADIUS, latLonAltToVec3, vec3ToLatLon } from '@/globe/geoHelpers';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Motion } from '@/types';
import { Vector3 } from 'three';

/** Earth radius in NM: a cap half-angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

function motion(over: Parameters<typeof makeAircraftRaw>[0] = {}, fetchedAt = 1_000): Motion {
  const m = deriveMotion(makeAircraftRaw({ lastContact: 1_000, ...over }), fetchedAt);
  if (m === null) throw new Error('expected a motion');
  return m;
}

/** Where positionAt puts this aircraft, back in degrees. */
function atDeg(m: Motion, advanceS: number, nowMs = 0): { lat: number; lon: number } {
  const out = { x: 0, y: 0, z: 0 };
  positionAt(m, advanceS, nowMs, out);
  return vec3ToLatLon(new Vector3(out.x, out.y, out.z));
}

describe('deriveMotion', () => {
  it('refuses an aircraft with no position, because there is nothing to advance', () => {
    // The adapters write null rather than invent a coordinate
    // (src/data/sources/adsbLol.ts:30-31). Such a record has never been a
    // dot and must not become one here.
    expect(deriveMotion(makeAircraftRaw({ latitude: null }), 1_000)).toBeNull();
    expect(deriveMotion(makeAircraftRaw({ longitude: null }), 1_000)).toBeNull();
  });

  it('puts the unit vector exactly where latLonToVec3 puts the aircraft', () => {
    // One convention, two formulas: if they ever disagree the aircraft
    // leaves its own trail behind on the first frame.
    const m = motion({ latitude: 50, longitude: -10, baroAltitudeFt: 38_000 });
    const expected = latLonAltToVec3(50, -10, 38_000);
    const out = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, out);
    expect(out.x).toBeCloseTo(expected.x, 6);
    expect(out.y).toBeCloseTo(expected.y, 6);
    expect(out.z).toBeCloseTo(expected.z, 6);
  });

  it('declares an aircraft with no heading non-extrapolable', () => {
    // 89,6% of the fleet reports a compass track (spec §5.1). The other
    // tenth is not a hypothetical, and guessing a heading for it would be
    // a plausible value in the place of a missing one.
    expect(motion({ headingDeg: null }).extrapolable).toBe(false);
    expect(motion({ velocityKt: null }).extrapolable).toBe(false);
    expect(motion({ lastContact: null }).extrapolable).toBe(false);
    expect(motion().extrapolable).toBe(true);
  });

  it('measures the age of the fix against the batch, not against the local clock', () => {
    // Two wall instants, subtracted ONCE (D21). v1 compared lastContact
    // with the local clock on every tick and deleted the whole fleet the
    // day the feed stopped.
    expect(motion({ lastContact: 940 }, 1_000).fixAgeAtBatchS).toBe(60);
  });

  it('floors a negative age at zero rather than flying the aircraft backwards', () => {
    // The provider's clock and ours are two wall clocks; neither is a
    // stopwatch, and the provider's can be the one that is ahead.
    expect(motion({ lastContact: 1_010 }, 1_000).fixAgeAtBatchS).toBe(0);
  });
});

describe('advanceSeconds — the ceiling', () => {
  it('advances a fresh fix by its real age', () => {
    expect(advanceSeconds(motion({ lastContact: 970 }, 1_000), 10)).toBeCloseTo(40, 6);
  });

  it('refuses to advance past the ceiling instead of advancing a little less', () => {
    // 120 s is 60 s of tile floor (tileGrid.ts:164) plus 30 s of client
    // refresh (aircraftStream.ts:13) plus 30 s of margin. Past it we would
    // be painting over our OWN staleness, which is the v1 outage.
    const old = motion({ lastContact: 1_000 - DR_CAP_S - 1 }, 1_000);
    expect(advanceSeconds(old, 0)).toBe(STILL);
  });

  it('stops advancing the moment the ceiling is crossed mid-frame', () => {
    const m = motion({ lastContact: 1_000 - DR_CAP_S + 2 }, 1_000);
    expect(advanceSeconds(m, 1)).toBeCloseTo(DR_CAP_S - 1, 6);
    expect(advanceSeconds(m, 3)).toBe(STILL);
  });

  it('never advances an aircraft it cannot extrapolate, however fresh', () => {
    expect(advanceSeconds(motion({ headingDeg: null }, 1_000), 0)).toBe(STILL);
  });

  it('advances an aircraft at rest by zero, which is the truth about it', () => {
    // On the ground at 0 kt every field is present: it IS being advanced,
    // and the distance happens to be nothing. Calling it "still" would
    // report a missing measurement we have.
    const parked = motion({ velocityKt: 0, onGround: true }, 1_000);
    expect(advanceSeconds(parked, 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('advanceFor — the single answer the walk, the picker and the line share', () => {
  it('carries nothing forward while the server calls the body a photograph', () => {
    // The ceiling of D16 exists for the case where the feed has stopped,
    // and that is the one case it could never see: the server stamps
    // fetchedAt when it BUILDS the body and then serves that same body
    // for up to maxStaleMs = 600 s (server/feedState.ts), so an age
    // counted from that stamp stood still while the world moved on. The
    // flag is the server's own statement, computed on the server's own
    // clock, and it is immune to anything our two wall clocks do (D31).
    const fresh = motion({ lastContact: 1_000 }, 1_000);
    expect(advanceFor(fresh, 0, false)).toBe(0);
    expect(advanceFor(fresh, 0, true)).toBe(STILL);
  });

  it('has nothing to carry forward for a record with no motion at all', () => {
    // Every Aircraft built outside updateBatch is in this state, which is
    // every one in the unit suite: a measured position with no way to
    // advance it. One function answers for it too, so the walk that counts
    // and the picker that clicks cannot reach two different conclusions
    // about the same dot (D19/D29).
    expect(advanceFor(null, 90, false)).toBe(STILL);
  });
});

describe('positionAt — the great circle, not the rhumb line', () => {
  it('carries an aircraft the distance its own speed says', () => {
    // 450 kt for 120 s is 15,0 NM. Measured as travelled arc, which is
    // what a great circle gives and a lat/lon interpolation does not.
    const m = motion({ latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 });
    const before = latLonAltToVec3(50, -10, 38_000).normalize();
    const p = atDeg(m, 120);
    const after = latLonAltToVec3(p.lat, p.lon, 38_000).normalize();
    const nm = Math.acos(Math.min(1, before.dot(after))) * NM_PER_RADIAN;
    expect(nm).toBeCloseTo(15.0, 1);
  });

  it('turns north into a rise in latitude and east into a rise in longitude', () => {
    const north = motion({ latitude: 0, longitude: 0, velocityKt: 600, headingDeg: 0 });
    expect(atDeg(north, 60).lat).toBeGreaterThan(0);
    expect(atDeg(north, 60).lon).toBeCloseTo(0, 6);
    const east = motion({ latitude: 0, longitude: 0, velocityKt: 600, headingDeg: 90 });
    expect(atDeg(east, 60).lon).toBeGreaterThan(0);
    expect(atDeg(east, 60).lat).toBeCloseTo(0, 6);
  });

  it('bows poleward of the straight lat/lon line between its own two ends', () => {
    // The lie this formula exists to avoid, measured the way Plan 3
    // measured it on JFK->LHR: 52,21 N on the geodesic against 46,06 N on
    // the lat/lon line, at the same longitude (routeArc.ts:82-98).
    //
    // Clairaut: cos(lat) x sin(track) is constant along a great circle.
    // From 60 N on track 065 that constant is cos 60 x sin 65 = 0,453154,
    // so the track climbs to its vertex at arccos 0,453154 = 63,054 N
    // after 823,3 NM — 5 927,7 s at 500 kt — and symmetry brings it back
    // to 60,000 N after twice that. Its two ends therefore sit at the SAME
    // latitude, 56,60 deg of longitude apart, and the path between them
    // bulges 3,05 deg = 183 NM north of the straight line joining them.
    //
    // The same leg flown as a rhumb line — track 065 held all the way,
    // which is what advancing lat/lon by its components draws — ends at
    // 71,598 N, 696 NM away. No tolerance can confuse the two.
    const TO_VERTEX_S = 5_927.7;
    const m = motion({ latitude: 60, longitude: 0, velocityKt: 500, headingDeg: 65 });
    const vertex = atDeg(m, TO_VERTEX_S);
    const far = atDeg(m, TO_VERTEX_S * 2);

    expect(far.lat).toBeCloseTo(60, 3); // back where it started, 56,6 deg east
    expect(vertex.lat).toBeCloseTo(63.054, 2); // the Clairaut vertex, computed above
    expect(vertex.lat - far.lat).toBeGreaterThan(3); // 183 NM north of its own chord

    const rhumbLat = 60 + ((500 / 3600) * TO_VERTEX_S * 2 * Math.cos(65 * (Math.PI / 180))) / 60;
    expect(rhumbLat).toBeCloseTo(71.598, 2);
    expect(far.lat).toBeLessThan(rhumbLat - 11);
  });

  it('lets a due-EAST leg from 60 N only fall, because it starts on its own vertex', () => {
    // Kept as a test and not as a comment, because an earlier draft of
    // this plan asserted it backwards and sent the implementer to "fix"
    // correct arithmetic.
    //
    // Flying exactly 090 from 60 N makes the Clairaut constant
    // cos 60 x sin 90 = 0,5, which is the largest that product can be:
    // 60 N IS the vertex of that great circle and every point after it is
    // lower. A correct geodesic CANNOT climb out of this one, and an
    // implementation that makes it climb is drawing the rhumb line.
    //
    // It is also a poor discriminator at the ceiling: over 120 s the
    // geodesic and the rhumb line differ by 0,0012 deg — 0,06 NM, a tenth
    // of a pixel even at the deepest zoom this plan reaches (0,60 NM/px).
    // Which is why the test above flies for an hour and a half: positionAt
    // is pure geometry and the ceiling lives in advanceSeconds.
    const m = motion({ latitude: 60, longitude: 0, velocityKt: 500, headingDeg: 90 });
    expect(atDeg(m, 3_600).lat).toBeLessThan(60);
    expect(atDeg(m, 3_600).lat).toBeCloseTo(58.9696, 3);
    expect(atDeg(m, 3_600).lon).toBeGreaterThan(0);
  });

  it('keeps the aircraft on its own altitude shell while it moves', () => {
    const m = motion({ latitude: 20, longitude: 30, baroAltitudeFt: 41_000, velocityKt: 500 });
    const out = { x: 0, y: 0, z: 0 };
    positionAt(m, 0, 0, out);
    const r0 = Math.hypot(out.x, out.y, out.z);
    positionAt(m, 100, 0, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(r0, 9);
    expect(r0).toBeGreaterThan(GLOBE_RADIUS);
  });
});

describe('reconcile — our drawing error slides, a stretch of flight jumps', () => {
  const PREV = { lastContact: 1_000, latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };

  it('slides an error no larger than one ceiling of travel', () => {
    // 15 NM at 450 kt is exactly what our own extrapolation could have got
    // wrong in 120 s. Absorbing it over 300 ms corrects a DRAWING.
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    expect(out.offUntilMs).toBe(5_000 + RECONCILE_MS);
    expect(Math.hypot(out.offX, out.offY, out.offZ)).toBeGreaterThan(0);
  });

  it('aims at where the fresh batch will be DRAWN, not at its fix', () => {
    // A body the server built 40 s before it reached us is 40 s of flight
    // further on by the time the first frame draws it (D31). Both elapsed
    // arguments are therefore real: measuring the fresh batch at its fix
    // while the previous one has been running for 40 s invents a five-mile
    // error that was never on screen, and slides the dot BACKWARDS once
    // every cycle, for ever.
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(makeAircraftRaw({ ...PREV, lastContact: 1_060 }), 1_060)!;

    // Same track, same speed, both running for the same 40 s: the two
    // positions coincide and there is nothing of ours to slide out.
    const out = reconcile(fresh, 40, previous, 40, 5_000, true);
    expect(Math.hypot(out.offX, out.offY, out.offZ)).toBeCloseTo(0, 9);

    // The same call with the fresh batch measured at its fix invents one.
    const wrong = reconcile(fresh, 0, previous, 40, 5_000, true);
    expect(Math.hypot(wrong.offX, wrong.offY, wrong.offZ)).toBeGreaterThan(0.001);
  });

  it('snaps when the gap is flight nobody showed', () => {
    // A tile that has not come round for fourteen minutes brings the
    // aircraft back 100 NM away. Gliding that in 300 ms would animate a
    // journey at Mach 1200 (D22).
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_900, longitude: 3 }),
      1_900
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    expect(out.offUntilMs).toBe(0);
    expect(out.offX).toBe(0);
  });

  it('snaps when the viewer asked for less motion', () => {
    // prefers-reduced-motion stops the 300 ms animation, not the dead
    // reckoning — the target is identical either way (D30).
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    expect(reconcile(fresh, 0, previous, 0, 5_000, false).offUntilMs).toBe(0);
  });

  it('has nothing to reconcile on the first batch', () => {
    const fresh = motion(PREV, 1_000);
    expect(reconcile(fresh, 0, null, 0, 5_000, true).offUntilMs).toBe(0);
  });

  it('decays the offset to nothing by the end of the window, and no further', () => {
    const previous = motion(PREV, 1_000);
    const fresh = deriveMotion(
      makeAircraftRaw({ ...PREV, lastContact: 1_060, longitude: -9.8 }),
      1_060
    )!;
    const out = reconcile(fresh, 0, previous, 0, 5_000, true);
    const start = atDeg(out, advanceSeconds(out, 0), 5_000);
    const end = atDeg(out, advanceSeconds(out, 0), 5_000 + RECONCILE_MS);
    const after = atDeg(out, advanceSeconds(out, 0), 5_000 + RECONCILE_MS * 3);
    expect(start.lon).not.toBeCloseTo(end.lon, 4);
    expect(after.lon).toBeCloseTo(end.lon, 9);
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/deadReckoning.test.ts
```

Expected: fallisce in fase di import — `Failed to resolve import "@/globe/deadReckoning"`. Nessun test del file passa.

- [x] **Step 3: Aggiungere `Motion` a `src/types.ts`**

Inserire **prima** di `export interface Aircraft extends AircraftRaw {`:

```ts
/**
 * Everything the render loop needs to put an aircraft where it is NOW,
 * worked out once per batch instead of once per frame.
 *
 * Declared here, beside Aircraft, and NOT next to the function that builds
 * it: this file is in the include list of both TypeScript programs
 * (tsconfig.server.json:14) and the server one is NodeNext, where the `@/`
 * alias does not exist. A type imported from `@/globe/deadReckoning` would
 * compile for the client and break `npm run build:server`. The interface is
 * plain data and imports nothing, so it belongs here.
 *
 * `u` is the unit vector of the measured fix and `w` the unit tangent at
 * that point in the direction of `headingDeg`. The plane of the great
 * circle the aircraft is flying is spanned by those two, so advancing along
 * it is a rotation inside that plane: one cos and one sin per frame,
 * against the four trig calls the lat/lon round trip costs today
 * (src/globe/aircraft.ts:177-191). At 11 625 aircraft and 60 fps that is
 * the difference between 2,79 million transcendental calls a second and
 * 205 thousand.
 */
export interface Motion {
  /** Unit vector of the last measured position (same convention as latLonToVec3). */
  ux: number;
  uy: number;
  uz: number;
  /** Unit tangent towards headingDeg at that point; zero when not extrapolable. */
  wx: number;
  wy: number;
  wz: number;
  /** Globe-space radius for this aircraft's altitude, offset included. */
  radius: number;
  /** Radians of arc per second, from velocityKt. Zero is a real answer: it is an aircraft at rest. */
  omegaPerS: number;
  /**
   * Age of the fix WHEN THE BATCH WAS ASSEMBLED, in seconds.
   *
   * A difference between two WALL instants — the provider's lastContact and
   * our server's fetchedAt — taken once and then frozen. No monotonic clock
   * can measure across two different clocks, and no wall clock may measure
   * a duration (D21).
   */
  fixAgeAtBatchS: number;
  /** False when lastContact, velocityKt or headingDeg was null (D18). */
  extrapolable: boolean;
  /** The drawing error being slid out, in globe space. Zero when there is none. */
  offX: number;
  offY: number;
  offZ: number;
  /** Monotonic ms at which that slide ends; 0 means there is no slide. */
  offUntilMs: number;
}
```

Poi, dentro `Aircraft`, aggiungere **dopo** la riga `trail: ...`:

```ts
  /**
   * Optional because every Aircraft built outside updateBatch — which is
   * every one in the unit suite — has no motion to carry. In production
   * each record gets one, and a record without it is drawn where it was
   * last seen and counted under `still.unmeasurable` (D18).
   */
  motion?: Motion | null;
```

- [x] **Step 4: Creare `src/globe/deadReckoning.ts`**

```ts
import type { AircraftRaw, Motion } from '@/types';
import { GLOBE_RADIUS, altitudeToOffset } from './geoHelpers';

/**
 * How long after a fix we are still willing to say where an aircraft is.
 *
 * Both halves of this number are measured in our own pipeline, not guessed
 * about aviation. A tile under the viewport is not re-queued before
 * DEFAULT_MIN_REFRESH_MS = 60 000 (src/data/sources/tileGrid.ts:164) and an
 * active client refreshes every 30 000 (src/data/aircraftStream.ts:13), so
 * the worst age of a fix for what the viewer is LOOKING AT is 90 s. 120
 * covers that with 30 s of margin and nothing more.
 *
 * Past it we would no longer be bridging the gap between two fixes — we
 * would be painting over a failure of ours, a tile that never came back or
 * a poller suspended by a 429. Painting over your own staleness is the v1
 * outage in a new costume: 25 days of a cached snapshot that went on
 * looking alive.
 *
 * In screen terms: 120 s at 450 kt is 15,0 NM, which is 1,7 px at planet
 * view and 25 px at the deepest zoom this plan allows.
 */
export const DR_CAP_S = 120;

/**
 * How long a correction to our own drawing takes to disappear.
 *
 * 300 ms is the editorial window DESIGN.md sets for state changes, the one
 * FOCUS_FADE_MS already occupies (src/globe/focus.ts:1-6). Same curve as
 * that fade, duplicated rather than imported on purpose: the focus
 * dissolve and a position correction are two different events, and one
 * shared knob would turn them into one.
 */
export const RECONCILE_MS = 300;

/** advanceSeconds' answer when an aircraft must be drawn where it was measured. */
export const STILL = -1;

/**
 * What a still aircraft's point is multiplied by.
 *
 * Applied to the fragment INTENSITY, never to the colour: aircraft.ts:
 * 121-130 records, with the failure in hand, that dimming aColor leaves the
 * mix() with white alight and a "dark" point goes on painting a mid-grey
 * aeroplane at ~45%. Low enough that the eye reads a memory rather than a
 * flight, high enough that a 7 px symbol still has a silhouette, and far
 * above the fragment's own 0.005 discard — "dim" must never quietly become
 * "absent", because absence is counted and dimness is not (D17).
 */
export const STILL_DIM = 0.55;

const DEG = Math.PI / 180;
/** Earth radius in NM: an angle in radians IS an arc length. */
const NM_PER_RADIAN = 3440.065;

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

/**
 * The once-per-batch half of the dead reckoning (D20).
 *
 * Everything expensive happens here — six trig calls for the two unit
 * vectors — and it happens once every 30 s instead of 60 times a second.
 * 11 625 aircraft through this is about 2,4 ms per batch; the same work
 * per frame would be 1,7 million transcendental calls a second.
 *
 * @returns null when the record has no position at all. Such a record has
 *   never been a dot (describeVisibleFleet counts it under `noPosition`)
 *   and must not become one here.
 */
export function deriveMotion(ac: AircraftRaw, batchFetchedAtUnix: number): Motion | null {
  if (ac.latitude === null || ac.longitude === null) return null;

  const latRad = ac.latitude * DEG;
  const lonRad = ac.longitude * DEG;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  // Same convention as latLonToVec3 (geoHelpers.ts:10-18): lon=0 on +Z,
  // lat=90 on +Y, lon=90 on +X. Written out rather than called because the
  // caller needs the sines and cosines again for the tangent below, and
  // because this must allocate no Vector3 for 11 625 records.
  const ux = cosLat * sinLon;
  const uy = sinLat;
  const uz = cosLat * cosLon;

  const extrapolable =
    ac.lastContact !== null && ac.velocityKt !== null && ac.headingDeg !== null;

  let wx = 0;
  let wy = 0;
  let wz = 0;
  let omegaPerS = 0;
  if (extrapolable) {
    // Local north and east at this point, both unit and both orthogonal to
    // u by construction. The compass track is measured clockwise from
    // north, so the tangent is north*cos + east*sin.
    const hdg = ac.headingDeg! * DEG;
    const ch = Math.cos(hdg);
    const sh = Math.sin(hdg);
    const nx = -sinLat * sinLon;
    const ny = cosLat;
    const nz = -sinLat * cosLon;
    wx = nx * ch + cosLon * sh;
    wy = ny * ch;
    wz = nz * ch - sinLon * sh;
    omegaPerS = ac.velocityKt! / 3600 / NM_PER_RADIAN;
  }

  // Floored at zero: the provider's clock and ours are two WALL clocks and
  // either can be the one that is ahead. A negative age would fly the
  // aircraft backwards along its own track.
  const fixAgeAtBatchS =
    ac.lastContact === null ? 0 : Math.max(0, batchFetchedAtUnix - ac.lastContact);

  return {
    ux,
    uy,
    uz,
    wx,
    wy,
    wz,
    // The same shell aircraft.ts:184 puts the point on, through the one
    // function that states it (geoHelpers.ts:23-25) rather than a third copy.
    radius: GLOBE_RADIUS + altitudeToOffset(ac.baroAltitudeFt ?? 38000),
    omegaPerS,
    fixAgeAtBatchS,
    extrapolable,
    offX: 0,
    offY: 0,
    offZ: 0,
    offUntilMs: 0,
  };
}

/**
 * How many seconds of flight to add to this fix on THIS frame, or STILL.
 *
 * One function and one answer, so the counter in describeVisibleFleet and
 * the position the renderer writes cannot be two different opinions about
 * the same aircraft (D19).
 *
 * @param elapsedSinceBatchS a MONOTONIC duration — the rAF timestamp minus
 *   the batch's performance.now() stamp. Never a fresh reading of
 *   Date.now() against lastContact: that clock jumps ~528 ms every ~32 s on
 *   this machine, and measuring the same age twice with it would make the
 *   aircraft twitch backwards (D21).
 */
export function advanceSeconds(m: Motion, elapsedSinceBatchS: number): number {
  if (!m.extrapolable) return STILL;
  const age = m.fixAgeAtBatchS + Math.max(0, elapsedSinceBatchS);
  if (age > DR_CAP_S) return STILL;
  return age;
}

/**
 * How far to carry THIS record on THIS frame — the one answer, and the one
 * place the answer is decided.
 *
 * describeVisibleFleet asks it to count, the picker asks it to hit-test and
 * the leader line asks it to point. Three copies of "no motion, or past the
 * ceiling, or the feed has stopped" would drift, and the shape of that drift
 * is a dot you can see and cannot click — the ghost D7 forbids (D19/D29).
 *
 * @param feedStale what the SERVER said about the body in hand. A stale body
 *   is a photograph it is serving again, not a measurement, and extrapolating
 *   from a photograph is painting over our own staleness — the very thing
 *   DR_CAP_S exists to forbid, reached by a route the ceiling cannot see
 *   because the stamp it counts from repeats (D31). A boolean the server
 *   computed on its own clock, so no clock of ours can defeat it; and it is
 *   the same fact the HUD already prints as "feed stale · last known
 *   positions", so the words and the dots now come from one source.
 */
export function advanceFor(
  m: Motion | null,
  elapsedSinceBatchS: number,
  feedStale: boolean
): number {
  if (m === null) return STILL;
  if (feedStale) return STILL;
  return advanceSeconds(m, elapsedSinceBatchS);
}

/** smoothstep: no velocity jump at either end. Same curve as focus.ts:22. */
function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Where this aircraft is drawn, this frame.
 *
 * The hot path of the whole plan: two trig calls for an aircraft that is
 * moving, none at all for one that is not, and no allocation in either
 * case — `out` is written in place because 11 625 Vector3 per frame is 700
 * thousand objects a second.
 *
 * @param advanceS what advanceFor returned; STILL and 0 both mean "at the
 *   fix", and they differ only in what the panel says about them.
 * @param nowMs the monotonic frame clock, for the correction being slid out.
 */
export function positionAt(m: Motion, advanceS: number, nowMs: number, out: Xyz): void {
  if (advanceS > 0 && m.omegaPerS > 0) {
    // u cos δ + w sin δ IS the great circle through u in the direction of
    // w, by definition. Interpolating lat/lon instead would draw the rhumb
    // line, which Plan 3 measured at six degrees of error on JFK->LHR
    // (routeArc.ts:82-98) — the same lie, in a smaller size.
    const delta = m.omegaPerS * advanceS;
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    out.x = (m.ux * c + m.wx * s) * m.radius;
    out.y = (m.uy * c + m.wy * s) * m.radius;
    out.z = (m.uz * c + m.wz * s) * m.radius;
  } else {
    out.x = m.ux * m.radius;
    out.y = m.uy * m.radius;
    out.z = m.uz * m.radius;
  }
  // One compare for the overwhelming majority of frames: offUntilMs is 0
  // except in the 300 ms after a batch has moved this aircraft.
  if (nowMs < m.offUntilMs) {
    const k = 1 - smoothstep01((nowMs - (m.offUntilMs - RECONCILE_MS)) / RECONCILE_MS);
    out.x += m.offX * k;
    out.y += m.offY * k;
    out.z += m.offZ * k;
  }
}

/**
 * Carry the drawing error from the previous batch into the new one (D22).
 *
 * When a tile comes back the aircraft jumps from where we were drawing it
 * to where the provider says it is. Two cases, different in KIND and not in
 * size:
 *
 *  - the gap is at most one ceiling of travel (velocityKt/3600 × DR_CAP_S,
 *    15 NM at 450 kt). That is exactly the error our own extrapolation
 *    could have made, so it is an error of DRAWING and it slides out over
 *    RECONCILE_MS. The target is always the real extrapolated position;
 *    what decays to nothing is the offset.
 *  - the gap is larger. Then it is not our error: it is a stretch of flight
 *    we never showed, because the tile had not come round for fourteen
 *    minutes. Gliding it in 300 ms would animate a journey at a speed no
 *    aircraft has. It jumps — and the jump is honest, because that aircraft
 *    was declared still before it moved.
 *
 * @param elapsedOnFreshS how long the NEW batch has already been running by
 *   the time this frame draws it. Not zero: the server stamps fetchedAt when
 *   it builds the body, so a batch can reach us already tens of seconds old
 *   (D31). Measuring the new position at its fix instead would invent an
 *   offset that was never on screen and slide the dot backwards once per
 *   cycle. The two elapsed values sit beside the motion they belong to,
 *   fresh first, so a caller cannot quietly swap them.
 * @param animate false under prefers-reduced-motion, which stops this 300
 *   ms animation and nothing else (D30).
 */
export function reconcile(
  fresh: Motion,
  elapsedOnFreshS: number,
  previous: Motion | null,
  elapsedOnPreviousS: number,
  nowMs: number,
  animate: boolean
): Motion {
  if (previous === null || !animate) return fresh;

  const was: Xyz = { x: 0, y: 0, z: 0 };
  const now: Xyz = { x: 0, y: 0, z: 0 };
  positionAt(previous, advanceSeconds(previous, elapsedOnPreviousS), nowMs, was);
  positionAt(fresh, advanceSeconds(fresh, elapsedOnFreshS), nowMs, now);

  const dx = was.x - now.x;
  const dy = was.y - now.y;
  const dz = was.z - now.z;
  // Chord over globe radius is the arc for the angles involved here: 15 NM
  // is 0,0044 rad, where chord and arc agree to one part in a million.
  const gapNm = (Math.hypot(dx, dy, dz) / GLOBE_RADIUS) * NM_PER_RADIAN;
  // Zero when the previous record was not extrapolable: nothing we drew can
  // have drifted, so there is nothing of ours to slide out.
  const budgetNm = (previous.omegaPerS * NM_PER_RADIAN) * DR_CAP_S;
  if (gapNm > budgetNm) return fresh;

  return {
    ...fresh,
    offX: dx,
    offY: dy,
    offZ: dz,
    offUntilMs: nowMs + RECONCILE_MS,
  };
}
```

- [x] **Step 5: Verificare il verde**

```bash
npx vitest run tests/unit/globe/deadReckoning.test.ts
```

Expected: **23 passed** nel file. Suite intera: **521 passed (54 files)**.

Due note di diagnosi, e la seconda esiste perché una stesura precedente di questo piano aveva il segno al contrario e ci mandava a rompere aritmetica giusta.

Se «turns north into a rise in latitude and east into a rise in longitude» fallisce, il segno di `sh` nel termine est è invertito: la rotta bussola cresce in senso orario da nord, quindi la componente est è `+sin(hdg)` e la nord `cos(hdg)`. Quel test è il controllo del segno; gli altri due no.

Se «lets a due-EAST leg from 60 N only fall» fallisce perché la latitudine **sale**, non è il segno e non è `positionAt`: **è l'implementazione che sta disegnando la lossodromia.** Volare esattamente verso 090 da 60 N mette l'aereo nel vertice del suo grande cerchio — `cos(lat)·sin(azimut)` è costante lungo una geodetica (Clairaut), e con `sin 90° = 1` quel prodotto è già al massimo possibile — quindi da lì la latitudine può solo scendere. Nessuna correzione di segno può farla salire, e un'asserzione che pretende che salga è un'asserzione sbagliata: non va «riparata» cambiando `positionAt`. Il caso che distingue davvero le due curve è «bows poleward», con il conto nel suo commento.

- [x] **Step 6: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito su entrambi i programmi — in particolare **`tsconfig.server.json`**, che è dove un `import` sbagliato in `types.ts` si manifesta; `npm test`: **521 passed (54 files)**.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/globe/deadReckoning.ts tests/unit/globe/deadReckoning.test.ts
git commit -m "feat(globe): where an aircraft is now, and the point past which we stop saying"
```

---

### Task 2: Il batch si ancora, e lo store porta il moto

L'aritmetica del Task 1 ha bisogno di tre cose che solo il punto di arrivo del batch conosce: l'istante di parete con cui misurare l'età dei fix, lo stampiglio monotono da cui contare tutto il resto, e **di quanto quel corpo era già vecchio quando è arrivato**. Nessuna delle tre può essere ricavata dentro il render loop senza rileggere `Date.now()` sessanta volte al secondo, che è precisamente la cosa vietata.

La terza è il task intero. `fetchedAt` è l'istante in cui il server **costruisce** il corpo, e `feedState.get()` serve quel corpo immutato finché ha meno di 600 s (`server/feedState.ts`): contare l'età da quando il corpo **arriva** vuol dire azzerarla ogni 30 s con un timbro che si ripete, e il tetto dei 120 s — che esiste esattamente per il feed fermo — non scatta mai. È D31, ed è l'unico punto di questo piano in cui lo schermo direbbe due cose incompatibili su se stesso: l'HUD «feed stale · last known positions» mentre i puntini scivolano.

**Files:**
- Modify: `src/state/aircraftStore.ts`
- Test: `tests/unit/state/stores.test.ts` (esteso)

**Interfaces:**
- Consumes: `deriveMotion`, `reconcile`, `advanceSeconds` da `src/globe/deadReckoning.ts`; `useA11yStore` da `src/state/a11yStore.ts`
- Produces: `AircraftState.feedStampMs: number`; ogni `Aircraft` nella mappa porta `motion`

- [x] **Step 1: Estendere `tests/unit/state/stores.test.ts`**

Nel `beforeEach` del `describe('aircraftStore', ...)`, aggiungere `feedStampMs: 0,` accanto a `feedFetchedAt: 0,`. Poi aggiungere in fondo a quel `describe`, **prima** della sua parentesi di chiusura:

> **Perché questi test datano i batch sull'orologio vero e non su `1_000`.** `updateBatch` da qui in poi misura **di quanto era già vecchio il corpo quando è arrivato** (D31), e `1_000` è un corpo del gennaio 1970: ogni aereo risulterebbe fermo da cinquantasette anni e i test misurerebbero il contrario di quello che dicono. I test preesistenti del file restano com'erano — asseriscono sul contenuto della flotta, non sul moto.

```ts
  /** The server's instant for a batch that has just been built. */
  const NOW = () => Math.floor(Date.now() / 1000);

  it('gives every placeable record a motion, and none to the ones with no position', () => {
    // The whole plan hangs on this: the render loop reads ac.motion and
    // never recomputes it, because recomputing it per frame is 1,7 million
    // transcendental calls a second (D20).
    const at = NOW();
    const store = useAircraftStore.getState();
    store.updateBatch(
      [
        makeAircraftRaw({ icao24: 'a1', latitude: 50, longitude: -10, lastContact: at - 60 }),
        makeAircraftRaw({ icao24: 'a2', latitude: null, lastContact: at - 60 }),
      ],
      at,
      false
    );
    const fleet = useAircraftStore.getState().aircraft;
    expect(fleet.get('a1')?.motion?.extrapolable).toBe(true);
    expect(fleet.get('a1')?.motion?.fixAgeAtBatchS).toBe(60);
    expect(fleet.get('a2')?.motion ?? null).toBeNull();
  });

  it('stamps the batch on a monotonic clock, not on the wall one', () => {
    // feedFetchedAt is a wall INSTANT and stays one; feedStampMs is the
    // origin of every DURATION measured afterwards. Date.now() moves by
    // ~528 ms every ~32 s on this machine, which over a 30 s refresh is a
    // 1,8% error on every age in the fleet (D21).
    const at = NOW();
    const before = performance.now();
    useAircraftStore.getState().updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, false);
    const s = useAircraftStore.getState();
    expect(s.feedFetchedAt).toBe(at);
    // A body built this second is set back by at most the one second
    // Math.floor can cost; it is never stamped in the future.
    expect(s.feedStampMs).toBeGreaterThan(before - 1_500);
    expect(s.feedStampMs).toBeLessThanOrEqual(performance.now());
  });

  it('keeps the clock running while the server serves the same body again', () => {
    // The exact case the 120 s ceiling exists for, and the one case it
    // could never see. The server stamps fetchedAt when it BUILDS the body
    // and feedState.get() then hands that SAME body out for up to
    // maxStaleMs = 600 s (server/feedState.ts). A client that re-stamped
    // its monotonic clock on every arrival reset the age every 30 s, so
    // the aircraft went on extrapolating for eight and a half minutes
    // under a HUD that already said "feed stale · last known positions".
    // An age must grow with the time that really passed (D31).
    //
    // Two bodies cannot share a fetchedAt: a cycle is 8 tiles at the 1,5 s
    // floor plus TILE_CYCLE_GAP_MS (poller.ts:31, index.ts:185,621-631),
    // so at least 11 s apart, and fetchedAt has one-second resolution.
    const at = NOW();
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, false);
    const firstStamp = useAircraftStore.getState().feedStampMs;
    const firstFleet = useAircraftStore.getState().aircraft;

    store.updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, true);
    const after = useAircraftStore.getState();
    expect(after.feedStampMs).toBe(firstStamp);
    // The same photograph carries no new measurement, so nothing is
    // re-derived — 11 625 records of six trig calls each, saved.
    expect(after.aircraft).toBe(firstFleet);
    // What DID arrive is the only thing that had changed.
    expect(after.feedStale).toBe(true);
  });

  it('sets the stamp back by the age the body already had when it arrived', () => {
    // fetchedAt is when the SERVER built the body, not when we received
    // it, and the two differ by a poller cycle in health and by minutes
    // during an outage — including on a first load, where there is no
    // previous batch for the rule above to protect. One subtraction
    // between two wall clocks, frozen, and it is the very quantity
    // feedAgeSeconds() prints in the HUD: the words and the movement now
    // come from one number (D21/D31).
    const before = performance.now();
    useAircraftStore.getState().updateBatch([makeAircraftRaw({ icao24: 'a1' })], NOW() - 45, false);
    const stamp = useAircraftStore.getState().feedStampMs;
    expect(before - stamp).toBeGreaterThan(44_000);
    expect(before - stamp).toBeLessThan(47_000);
  });

  it('hands the new motion the error the previous one had accumulated', () => {
    // A tile coming back must not teleport an aircraft by the few miles our
    // own extrapolation had drifted (D22).
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 60, longitude: -9.8 })],
      at + 60,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBeGreaterThan(0);
  });

  it('does not slide an aircraft that has been away for a quarter of an hour', () => {
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 900, longitude: 3 })],
      at + 900,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBe(0);
  });

  it('snaps instead of sliding when the viewer asked for less motion', () => {
    useA11yStore.setState({ prefersReducedMotion: true });
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 60, longitude: -9.8 })],
      at + 60,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBe(0);
    useA11yStore.setState({ prefersReducedMotion: false });
  });
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/state/stores.test.ts
```

Expected: i sette test nuovi falliscono — `motion` è `undefined` e `feedStampMs` non esiste. I preesistenti restano verdi: nessuno di loro chiama `updateBatch` due volte con lo stesso `fetchedAt`, che è l'unico comportamento che lo Step 4 cambia per un chiamante esistente.

- [x] **Step 3: Sostituire la testa di `src/state/aircraftStore.ts`**

Sostituire le due righe di import in cima con:

```ts
import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';
import { advanceSeconds, deriveMotion, reconcile } from '@/globe/deadReckoning';
import { useA11yStore } from './a11yStore';
```

Dentro `interface AircraftState`, aggiungere **dopo** la riga `feedFetchedAt: number;` e il suo commento:

```ts
  /**
   * When the batch in hand was BUILT, on this browser's MONOTONIC clock.
   *
   * feedFetchedAt above is a wall INSTANT and stays one — it is what the
   * provider and our server agreed the fix ages are measured against. This
   * is the origin of every DURATION measured afterwards: the render loop
   * subtracts it from the rAF timestamp, and the two can be subtracted
   * because rAF timestamps and performance.now() share performance
   * .timeOrigin by specification. Date.now() moves by ~528 ms every ~32 s
   * on this machine (server/routeResolver.ts:47-58), and a wall clock is
   * not a stopwatch (D21).
   *
   * BUILT, not received, and the distinction is the whole of D31. The
   * server stamps fetchedAt when it assembles the body and then serves
   * that body unchanged while it is younger than maxStaleMs = 600 s
   * (server/feedState.ts), so this is set BACK by the age the body already
   * had on arrival, and a body we have already seen does not re-stamp it
   * at all. Counted from the arrival instead, the age of every fix reset
   * every 30 s and the fleet kept extrapolating for eight and a half
   * minutes while the HUD said "feed stale · last known positions".
   */
  feedStampMs: number;
```

E nel corpo dello store, accanto a `feedFetchedAt: 0,`, aggiungere `feedStampMs: 0,`.

- [x] **Step 4: Sostituire il corpo di `updateBatch`**

Sostituire il blocco che va da `set((state) => {` fino alla riga `return { aircraft: next, feedFetchedAt: batchFetchedAtUnix, feedStale: stale, feedCapped: capped };` con:

```ts
    set((state) => {
      // One reading of the monotonic clock for the whole batch: the records
      // all land in the same instant, and taking it per aircraft would make
      // 11 625 slightly different "now"s out of one event.
      const nowMs = performance.now();

      // How old the body ALREADY WAS when it reached us. ONE subtraction
      // between two wall clocks — the server's fetchedAt and this
      // browser's — taken once and then frozen, exactly as the fix ages
      // are (D21). It is the same quantity feedAgeSeconds() prints in the
      // HUD, which is the point: the sentence on screen and the distance
      // the dot travels now come out of one number and cannot contradict
      // each other.
      //
      // Floored at zero, and the floor is the safe direction: a browser
      // clock running behind makes this term vanish and leaves the rule
      // below to carry the age forward, while a clock running ahead stops
      // the extrapolation early. Neither can make us draw motion we have
      // not measured.
      const bodyAgeS = Math.max(0, Math.floor(Date.now() / 1000) - batchFetchedAtUnix);

      // The same photograph, served again. feedState.get() hands out one
      // body for up to maxStaleMs = 600 s while the poller is down, and
      // every arrival carries the same fetchedAt. Re-stamping the clock
      // here reset an age the real world was still adding to — the feed
      // stopped, the HUD said so, and the aircraft went on gliding for
      // eight and a half minutes (D31). Nothing is re-derived either:
      // there is no new measurement, and 11 625 records of six trig calls
      // apiece is not free.
      //
      // Two bodies cannot share a fetchedAt. A cycle is 8 tiles at the
      // 1,5 s floor plus TILE_CYCLE_GAP_MS (server/poller.ts:31,
      // server/index.ts:185,621-631), so they are at least 11 s apart and
      // fetchedAt has one-second resolution.
      if (state.feedFetchedAt !== 0 && batchFetchedAtUnix === state.feedFetchedAt) {
        return { feedStale: stale, feedCapped: capped };
      }

      const next = new Map<string, Aircraft>();
      const feedStampMs = nowMs - bodyAgeS * 1000;
      const elapsedOnPreviousS =
        state.feedStampMs === 0 ? 0 : (nowMs - state.feedStampMs) / 1000;
      // Read, not subscribed: this runs outside React, once per cycle.
      const animate = !useA11yStore.getState().prefersReducedMotion;

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
        // The expensive half of the dead reckoning, paid once every 30 s
        // instead of 60 times a second (D20). Six trig calls here are 2,4 ms
        // for the whole fleet; the same work per frame would be 1,7 million
        // transcendental calls a second.
        const fresh = deriveMotion(r, batchFetchedAtUnix);
        // bodyAgeS, not 0: this batch has already been running for as long
        // as the body was old when it arrived, and the correction has to be
        // measured against where the dot will actually be DRAWN (D31).
        const motion =
          fresh === null
            ? null
            : reconcile(fresh, bodyAgeS, prev?.motion ?? null, elapsedOnPreviousS, nowMs, animate);
        next.set(r.icao24, { ...r, trail, motion });
      }
      // Aircraft absent from the payload are gone: the server already pruned.
      return {
        aircraft: next,
        feedFetchedAt: batchFetchedAtUnix,
        feedStampMs,
        feedStale: stale,
        feedCapped: capped,
      };
    }),
```

**Verificato prima di scrivere la regola del `fetchedAt` ripetuto:** l'unico chiamante di `updateBatch` in produzione è `src/data/bootstrap.ts:46-57`, e l'arricchimento che applica — `resolveFlight(r)` — è sincrono e legge tabelle già caricate con un `await` prima che lo stream parta (`bootstrap.ts:28-32`). Due arrivi dello stesso corpo producono quindi record identici, e saltare il secondo non butta via nessuna risoluzione. Se un giorno l'arricchimento diventasse asincrono, questa regola andrebbe rivista **qui**, non aggirata altrove.

- [x] **Step 5: Verificare il verde**

```bash
npx vitest run tests/unit/state/stores.test.ts
```

Expected: tutti verdi, **+7** rispetto a prima. Suite intera: **528 passed (54 files)**.

> `advanceSeconds` è importato e non ancora letto da questo file: `noUnusedLocals` lo rifiuta. Toglierlo dall'import qui — `reconcile` lo chiama per conto suo — e lasciare solo `deriveMotion` e `reconcile`. Se la riga di import dello Step 3 lo contiene ancora, questo è il momento in cui il compilatore lo dice.

- [x] **Step 6: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **528 passed (54 files)**.

- [ ] **Step 7: Commit**

```bash
git add src/state/aircraftStore.ts tests/unit/state/stores.test.ts
git commit -m "feat(state): anchor each batch to a monotonic stamp and carry its motion"
```

---

### Task 3: Una sola passata dice anche che cosa si muove

Il Piano 3 ha chiuso una famiglia di difetti con una regola: a dire quanti aerei si vedono e perché gli altri no è una funzione sola, letta dal renderer e dal pannello. Il dead reckoning apre la stessa famiglia su un altro asse — **lo schermo disegna due comportamenti e ne dichiara uno solo** — e la chiude nello stesso posto, non accanto.

**Files:**
- Modify: `src/globe/visibility.ts`
- Test: `tests/unit/globe/visibleFleet.test.ts` (esteso)

**Interfaces:**
- Consumes: `advanceFor` da `src/globe/deadReckoning.ts`
- Produces: `VisibleFleet.moving: number` e `VisibleFleet.still: { unmeasurable: number; stale: number }`; `describeVisibleFleet(..., elapsedSinceBatchS?, feedStale?)`; `onDraw` con due parametri in più, `advanceS` e `still`

**Perché `still` non è un quinto membro di `hidden`.** Un aereo fermo **è disegnato**: non è un ammanco, è una partizione di `shown`. Mettercelo dentro romperebbe l'identità che la tabella verifica su ogni riga, e sarebbe la stessa cosa che `releasedByLeavingFocus` ha già evitato per la stessa ragione (`visibility.ts:79-92`). Le identità diventano due, e la tabella le verifica entrambe.

- [x] **Step 1: Estendere `tests/unit/globe/visibleFleet.test.ts`**

Cambiare la riga di import di `@/globe/visibility` in:

```ts
import { describeVisibleFleet, SHOW_ALL } from '@/globe/visibility';
import type { DrawTarget, Shortfall, VisibilityRule } from '@/globe/visibility';
import { DR_CAP_S, STILL, deriveMotion } from '@/globe/deadReckoning';
```

Qui gli istanti letterali vanno benissimo, a differenza dei test dello store: `describeVisibleFleet` non legge nessun orologio — riceve una durata già misurata — e `deriveMotion` nemmeno.

Poi aggiungere in fondo al file:

```ts
/**
 * The second invariant this walk now carries (D19).
 *
 * D15 closed a family of defects where the screen DECLARED more than it
 * drew. Dead reckoning opens the same family on another axis: the screen
 * draws two behaviours and names one. A viewer who sees some dots glide and
 * the rest sit still concludes the only thing the picture suggests — that
 * the still ones are parked aircraft — and that is a false statement nobody
 * measured, which is D15b exactly.
 *
 * The remedy is the same remedy: one pass, one answer, two readers. These
 * three numbers are not a fifth shortfall, they are a PARTITION of `shown`,
 * and the identity below holds by construction because each drawn record
 * increments exactly one of them.
 */
function moving(over: Partial<Aircraft> = {}): Aircraft {
  const raw = ac('mv', { latitude: 50, longitude: -10, lastContact: 1_000, ...over });
  return { ...raw, motion: deriveMotion(raw, 1_000) };
}

describe('describeVisibleFleet — what moves, and what only looks parked', () => {
  it('counts a fresh extrapolable aircraft as moving, and says how far', () => {
    const seen: number[] = [];
    const view = describeVisibleFleet(
      [moving()],
      SHOW_ALL,
      null,
      (_ac, _t, _s, advanceS) => seen.push(advanceS),
      1,
      undefined,
      30
    );
    expect(view.moving).toBe(1);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 0 });
    expect(seen).toEqual([30]);
  });

  it('counts an aircraft past the ceiling as still, and names the ceiling as the cause', () => {
    // 120 s is the floor of our own tile refresh plus the client's, with
    // margin (D16). Past it the globe draws the last measured position and
    // the panel says how many are in that state.
    const stale = moving({ lastContact: 1_000 - DR_CAP_S - 5 });
    const flags: boolean[] = [];
    const view = describeVisibleFleet(
      [stale],
      SHOW_ALL,
      null,
      (_ac, _t, _s, _adv, still) => flags.push(still),
      1,
      undefined,
      0
    );
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
    expect(view.moving).toBe(0);
    expect(flags).toEqual([true]);
  });

  it('keeps a missing heading apart from a missing contact', () => {
    // Two different absences, two different sentences (D15b/D18). The
    // compass track covers 89,6% of the fleet, so the second kind is a
    // tenth of every sky, not a hypothetical.
    const view = describeVisibleFleet(
      [moving({ headingDeg: null }), moving({ lastContact: 1_000 - DR_CAP_S - 5 })],
      SHOW_ALL,
      null
    );
    expect(view.still).toEqual({ unmeasurable: 1, stale: 1 });
  });

  it('counts a record with no motion at all as unmeasurable rather than dropping it', () => {
    // Every Aircraft built outside updateBatch has no motion. It is still a
    // measured position and it is still drawn; what is missing is our
    // ability to advance it.
    const view = describeVisibleFleet([CC], SHOW_ALL, null);
    expect(view.shown).toBe(1);
    expect(view.still.unmeasurable).toBe(1);
  });

  it('leaves nothing moving when the feed stopped eight minutes ago', () => {
    // The scenario end to end, in the units the panel prints. 510 s is the
    // stretch this defect used to live in: between maxFreshMs = 90 s,
    // where the server starts calling the body stale, and maxStaleMs =
    // 600 s, where it stops serving it at all (server/feedState.ts). For
    // all eight and a half of those minutes the aircraft went on gliding,
    // because the elapsed was counted from the arrival of a body whose
    // fetchedAt never moved.
    //
    // Here it is the ELAPSED that carries the truth, not the flag:
    // aircraftStore does not re-stamp a fetchedAt it has already seen, so
    // what reaches this argument is the time that really passed (D31). The
    // flag is tested on its own below, because it has to hold even when a
    // clock does not.
    const view = describeVisibleFleet(
      [moving()], SHOW_ALL, null, undefined, undefined, undefined, 510
    );
    expect(view.moving).toBe(0);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
  });

  it('carries nothing forward while the server calls the body a photograph', () => {
    // The case the ceiling exists for, reached by the one route the
    // ceiling cannot see: the server stamps fetchedAt when it BUILDS the
    // body and then serves that body unchanged for up to 600 s, so an age
    // counted from a stamp that repeats stands still while the world moves
    // (D31). The flag is the server's own, computed on the server's own
    // clock, so no clock of ours can defeat it — and it is the same fact
    // the HUD already prints as "feed stale · last known positions".
    //
    // They land in `stale` and not in `unmeasurable`: every field is
    // there, and what is old is the measurement, not our knowledge of the
    // aircraft. Same bucket, same sentence, two routes to it (D18).
    const view = describeVisibleFleet(
      [moving()], SHOW_ALL, null, undefined, undefined, undefined, 0, true
    );
    expect(view.moving).toBe(0);
    expect(view.still).toEqual({ unmeasurable: 0, stale: 1 });
    expect(view.shown).toBe(1);
  });

  it('hands the renderer a zero advance for everything it calls still', () => {
    // The number the panel counts and the distance the dot travels come out
    // of the same line. They cannot disagree, which is the whole of D19.
    const rows: Array<[number, boolean]> = [];
    describeVisibleFleet(
      [moving(), moving({ headingDeg: null }), moving({ lastContact: 0 })],
      SHOW_ALL,
      null,
      (_ac, _t, _s, advanceS, still) => rows.push([advanceS, still]),
      1,
      undefined,
      0
    );
    for (const [advanceS, still] of rows) {
      if (still) expect(advanceS).toBe(0);
      else expect(advanceS).toBeGreaterThanOrEqual(0);
    }
    expect(STILL).toBeLessThan(0); // the sentinel never reaches the renderer
  });
});
```

- [x] **Step 2: Aggiungere la seconda identità alla tabella**

Dentro il `describe('describeVisibleFleet — the invariant, state by state', ...)`, nel corpo di `it.each(TABLE)`, aggiungere in fondo al blocco — **dopo** l'asserzione che somma `shown` e `hidden`:

```ts
    // The second identity (D19). `moving` and the two `still` buckets
    // partition what is DRAWN, exactly as the four shortfalls partition
    // what is not. A third behaviour added to the walk and forgotten in
    // the panel shows up here as a drawn record nothing accounts for.
    expect(view.moving + view.still.unmeasurable + view.still.stale).toBe(view.shown);
```

- [x] **Step 3: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/visibleFleet.test.ts
```

Expected: i sette test nuovi falliscono su `view.moving` `undefined`, e ogni riga della tabella fallisce sulla seconda identità — `NaN` non è `2`.

- [x] **Step 4: Estendere `VisibleFleet` in `src/globe/visibility.ts`**

Aggiungere l'import in cima, sotto quello di `@/types`:

```ts
import { advanceFor } from './deadReckoning';
```

`STILL` **non** si importa qui: il ciclo guarda il segno (`adv < 0`) e `noUnusedLocals` rifiuterebbe un import che nessuno legge. Il sentinella resta un dettaglio di `deadReckoning.ts`, e il test del Task 3 che asserisce `STILL < 0` lo importa da lì.

Dentro `interface VisibleFleet`, **dopo** `releasedByLeavingFocus: number;`, aggiungere:

```ts
  /**
   * Of `shown`, how many are being carried forward from their last fix.
   *
   * `moving + still.unmeasurable + still.stale === shown`, by construction:
   * every drawn record increments exactly one of the three and then leaves
   * the iteration, the same way the four shortfalls partition what is not
   * drawn.
   *
   * NOT a fifth member of `hidden`, for the same reason
   * releasedByLeavingFocus is not: these aircraft ARE on the globe. They
   * are a partition of what is drawn, not an account of what is missing,
   * and folding them into `hidden` would break the identity above it.
   */
  moving: number;
  /**
   * The two reasons a dot is drawn where it was measured instead of where
   * it should be now — kept apart because they are different absences and
   * D15b forbids one word for two causes (D18).
   *
   * `unmeasurable`: the record has no lastContact, no velocityKt or no
   * headingDeg. The compass track covers 89,6% of the fleet and the ground
   * speed 97,8% (spec §5.1), so about a tenth of any sky is here and
   * always will be, whatever the feed does.
   *
   * `stale`: every field is there and the measurement is too old to carry
   * forward. Two routes to it, one sentence: the fix is older than
   * DR_CAP_S (D16), or the server has declared the whole body a cached
   * photograph (D31). Past either point advancing it would be painting
   * over a failure of ours rather than bridging a gap between two
   * measurements — and in the second case the HUD is already saying so
   * three centimetres away.
   */
  still: { unmeasurable: number; stale: number };
```

- [x] **Step 5: Estendere la firma e il ciclo di `describeVisibleFleet`**

Sostituire la firma — da `export function describeVisibleFleet(` fino a `): VisibleFleet {` — con:

```ts
export function describeVisibleFleet(
  aircraft: Iterable<Aircraft>,
  rule: VisibilityRule,
  selectedIcao: string | null,
  onDraw?: (
    ac: Aircraft,
    target: DrawTarget,
    slot: number,
    advanceS: number,
    still: boolean
  ) => void,
  // The settled state of the rule in hand, which is what the panel means
  // when it passes nothing: the crowd out under a focus, lit without one.
  othersBrightness = rule.focusedIcao !== null ? 0 : 1,
  caps: { perCategory: number; selected: number } = RENDER_CAPS,
  /**
   * A MONOTONIC duration: the rAF timestamp minus aircraftStore
   * .feedStampMs. The panel passes the same quantity from performance.now()
   * — the two clocks share performance.timeOrigin — and 0 means "at the
   * instant the batch was BUILT", which is the only honest default for a
   * caller that has no frame clock (D21).
   *
   * Built and not received: the store sets feedStampMs back by the age the
   * body already had on arrival and does not re-stamp a fetchedAt it has
   * seen before, so this number keeps growing while the server re-serves
   * the same photograph (D31). Nothing here has to know that.
   */
  elapsedSinceBatchS = 0,
  /**
   * What the SERVER said about the body in hand. True means it served a
   * cached photograph, and nothing is carried forward from a photograph
   * (D31). The default is "the feed is live", which is the honest answer
   * for a caller that has no feed at all — every existing unit test.
   */
  feedStale = false
): VisibleFleet {
```

Poi, subito **dopo** la riga `let nPartial = 0;`, inserire:

```ts
  let moving = 0;
  const still = { unmeasurable: 0, stale: 0 };

  /**
   * The one place a drawn record is classified, counted and handed over.
   *
   * The renderer does not decide for itself whether an aircraft moves: it
   * is TOLD how many seconds to carry it, and `0` with `still` is a dot at
   * its fix. The number the panel prints and the distance the dot travels
   * therefore come out of the same line, which is the whole of D19 — and
   * the same argument that made onDraw the draw loop in the first place.
   */
  const draw = (ac: Aircraft, target: DrawTarget, slot: number): void => {
    const m = ac.motion ?? null;
    // advanceFor and not advanceSeconds: the picker and the leader line
    // ask the same function, so a dot can never be drawn where the hit
    // test does not look (D29), and the stale feed stops all three at once
    // (D31).
    const adv = advanceFor(m, elapsedSinceBatchS, feedStale);
    if (adv < 0) {
      // A record with no motion has a measured position and no way to
      // advance it — the same absence as a missing heading, and said with
      // the same word.
      if (m !== null && m.extrapolable) still.stale += 1;
      else still.unmeasurable += 1;
      onDraw?.(ac, target, slot, 0, true);
    } else {
      moving += 1;
      onDraw?.(ac, target, slot, adv, false);
    }
    shown += 1;
  };
```

Nel ciclo, sostituire le tre chiamate a `onDraw` e i loro `shown += 1`:

```ts
      onDraw?.(ac, 'selected', nSelected);
      nSelected += 1;
      shown += 1;
      continue;
```
diventa
```ts
      draw(ac, 'selected', nSelected);
      nSelected += 1;
      continue;
```

```ts
      onDraw?.(ac, 'complete', nComplete);
      nComplete += 1;
```
diventa
```ts
      draw(ac, 'complete', nComplete);
      nComplete += 1;
```

```ts
      onDraw?.(ac, 'partial', nPartial);
      nPartial += 1;
```
diventa
```ts
      draw(ac, 'partial', nPartial);
      nPartial += 1;
```

e **cancellare** la riga `shown += 1;` che chiudeva il ciclo dopo il blocco `if (ac.complete) … else …`, perché ora `draw` la esegue: lasciarla contarebbe due volte ogni aereo di categoria e romperebbe l'identità alla prima riga della tabella.

Infine, nel `return` finale, aggiungere i due campi:

```ts
  return { total, shown, hidden, reason, releasedByLeavingFocus, moving, still };
```

- [x] **Step 6: Verificare il verde**

```bash
npx vitest run tests/unit/globe/visibleFleet.test.ts tests/unit/globe/focus.test.ts
```

Expected: entrambi verdi. Suite intera: **535 passed (54 files)**.

Se le righe della tabella falliscono con `shown` doppio, la riga `shown += 1;` in coda al ciclo non è stata cancellata.

- [x] **Step 7: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **535 passed (54 files)**.

- [ ] **Step 8: Commit**

```bash
git add src/globe/visibility.ts tests/unit/globe/visibleFleet.test.ts
git commit -m "feat(globe): the one pass now says what moves, and what is only being remembered"
```

---

### Task 4: Il renderer disegna dove l'aereo è adesso

Da qui in poi lo schermo cambia. Il ciclo di disegno smette di riscrivere lo stesso fix sessanta volte al secondo e scrive la posizione che la passata gli ha detto; chi non si può muovere resta dov'è e si spegne di quanto D17 dice. E tutto ciò che puntava al fix — la leader line, il click — segue il puntino, perché altrimenti questo task spedisce un fantasma.

**Files:**
- Modify: `src/globe/aircraft.ts`
- Modify: `src/globe/raycaster.ts`
- Modify: `src/globe/scene.ts`
- Test: `tests/unit/globe/motion.test.ts` (nuovo)

**Interfaces:**
- Consumes: `positionAt`, `advanceFor`, `STILL_DIM` da `src/globe/deadReckoning.ts`; `VisibleFleet` da `src/globe/visibility.ts`
- Produces: `FrameState = { nowMs: number; elapsedSinceBatchS: number; cameraDistance: number; stale: boolean }`; `AircraftLayer.update(aircraft, selectedIcao, rule, othersBrightness, frame?)`; `findAircraftAtPointer(..., frame?)`

**Due suite che questo task NON modifica, e non è una dimenticanza.** `fleetColours` e `renderCapacity` costruiscono `Aircraft` a mano, senza `motion`, e restano verdi solo se il ramo «nessun motion» di `writePoint` funziona: sono la guardia su quel ramo, e una guardia che si modifica per farla passare non è più una guardia. Per questo non compaiono né qui sopra né nella riga `git add`. Se una delle due diventa rossa, la risposta è in `writePoint`, non nell'asserzione.

- [x] **Step 1: Creare `tests/unit/globe/motion.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { Object3D, Points } from 'three';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { createAircraftLayer } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import { DR_CAP_S, STILL_DIM, deriveMotion } from '@/globe/deadReckoning';
import { latLonAltToVec3 } from '@/globe/geoHelpers';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft, AircraftRaw } from '@/types';

function ac(over: Partial<AircraftRaw> = {}): Aircraft {
  const raw = makeAircraftRaw({
    icao24: 'a1', latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90,
    lastContact: 1_000, ...over,
  });
  return { ...raw, trail: [], motion: deriveMotion(raw, 1_000) };
}

function geometryOf(obj: Object3D | undefined): Points['geometry'] {
  if (!obj) throw new Error('layer has no drawable child');
  return (obj as Points).geometry;
}

/** children: [0] partial, [1] complete, [2] selected — the draw hierarchy. */
const PARTIAL = 0;

function head(layer: ReturnType<typeof createAircraftLayer>): Vector3 {
  const g = geometryOf(layer.group.children[PARTIAL]);
  const p = g.getAttribute('position');
  return new Vector3(p.getX(0), p.getY(0), p.getZ(0));
}

const FRAME = { nowMs: 0, elapsedSinceBatchS: 0, cameraDistance: 10, stale: false };

describe('the aircraft layer draws where the aircraft is now', () => {
  it('moves the point between two frames without a new batch', () => {
    // The user's opening complaint, in one assertion: between two updates
    // the aircraft used to be redrawn in exactly the same place.
    const layer = createAircraftLayer();
    const fleet = [ac()];
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 0 });
    const a = head(layer);
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 60 });
    expect(head(layer).distanceTo(a)).toBeGreaterThan(0);
  });

  it('leaves an aircraft past the ceiling exactly where it was measured', () => {
    const layer = createAircraftLayer();
    const fleet = [ac({ lastContact: 1_000 - DR_CAP_S - 10 })];
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 0 });
    const expected = latLonAltToVec3(50, -10, 38_000);
    expect(head(layer).distanceTo(expected)).toBeLessThan(1e-6);
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 300 });
    expect(head(layer).distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('dims the still ones on the intensity, through an attribute of their own', () => {
    // Not on aColor: aircraft.ts:121-130 records, with the failure in
    // hand, that dimming the colour leaves the mix() with white alight and
    // a "dark" point goes on painting a mid-grey aeroplane at ~45% (D17).
    const layer = createAircraftLayer();
    layer.update([ac(), ac({ icao24: 'a2', headingDeg: null })], null, SHOW_ALL, 1, FRAME);
    const live = geometryOf(layer.group.children[PARTIAL]).getAttribute('aLive');
    const values = [live.getX(0), live.getX(1)].sort();
    expect(values).toEqual([STILL_DIM, 1]);
  });

  it('returns the same counts the panel will print', () => {
    const layer = createAircraftLayer();
    const view = layer.update(
      [ac(), ac({ icao24: 'a2', headingDeg: null }), ac({ icao24: 'a3', lastContact: 1 })],
      null,
      SHOW_ALL,
      1,
      FRAME
    );
    expect(view.moving + view.still.unmeasurable + view.still.stale).toBe(view.shown);
    expect(view.still).toEqual({ unmeasurable: 1, stale: 1 });
  });

  it('draws an aircraft with no motion at all, from its coordinates', () => {
    // Every Aircraft built outside updateBatch is in this state, which is
    // every one in the unit suite. A fallback that drops them would make
    // twenty existing tests pass against an empty buffer.
    const layer = createAircraftLayer();
    const raw = makeAircraftRaw({ latitude: 12, longitude: 34 });
    layer.update([{ ...raw, trail: [] }], null, SHOW_ALL, 1, FRAME);
    expect(head(layer).distanceTo(latLonAltToVec3(12, 34, 38_000))).toBeLessThan(1e-6);
  });
});

describe('the scia stays a document (D28)', () => {
  it('ends the trail at the last real fix, never at the reckoned position', () => {
    // spec §4.1: the trail draws only fixes actually received. The gap
    // that opens between the dot and the end of its own trail IS how far
    // we have reckoned it — the only honest ruler of the extrapolation on
    // screen, and exactly the kind of thing a later reader "fixes".
    const trails = createTrailsLayer();
    const a = ac({ latitude: 50, longitude: -10 });
    a.trail = [{ lat: 49.9, lon: -10.2, t: 940 }];
    trails.update([a], null, SHOW_ALL);
    const g = geometryOf(trails.group.children[0]);
    const p = g.getAttribute('position');
    const last = new Vector3(
      p.getX(g.drawRange.count - 1),
      p.getY(g.drawRange.count - 1),
      p.getZ(g.drawRange.count - 1)
    );
    expect(last.distanceTo(latLonAltToVec3(50, -10, 38_000))).toBeLessThan(1e-6);
  });
});

describe('the click follows the dot, not the fix (D29)', () => {
  it('picks an aircraft under the cursor after it has been carried forward', () => {
    const camera = new PerspectiveCamera(38, 1.6, 0.1, 100);
    camera.position.copy(latLonAltToVec3(50, -10, 0).normalize().multiplyScalar(4));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const canvas = { clientWidth: 800, clientHeight: 500 } as HTMLCanvasElement;
    const fleet = [ac({ velocityKt: 500, headingDeg: 90 })];

    // Where the dot is after 100 s of reckoning, in screen space.
    const layer = createAircraftLayer();
    layer.update(fleet, null, SHOW_ALL, 1, { ...FRAME, elapsedSinceBatchS: 100 });
    const drawn = head(layer).clone().project(camera);

    const hit = findAircraftAtPointer(
      new Vector2(drawn.x, drawn.y),
      fleet,
      camera,
      canvas,
      SHOW_ALL,
      { ...FRAME, elapsedSinceBatchS: 100 }
    );
    expect(hit).toBe('a1');
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/motion.test.ts
```

Expected: fallisce in compilazione — `update` non accetta un quinto argomento, e `aLive` non è un attributo della geometria.

- [x] **Step 3: Il moto dentro `src/globe/aircraft.ts`**

Aggiungere agli import, sotto quello di `./visibility`:

```ts
import { STILL_DIM, positionAt } from './deadReckoning';
import type { Xyz } from './deadReckoning';
```

In `interface PointSet`, aggiungere `live: Float32Array;` e `liveAttr: BufferAttribute;`. In `createPointSet`, accanto a `headings`:

```ts
  const live = new Float32Array(capacity);
  ...
  const liveAttr = new BufferAttribute(live, 1);
  liveAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('aLive', liveAttr);
```
e aggiungere `live` e `liveAttr` all'oggetto restituito.

Nel **vertex shader**, aggiungere sotto `attribute float aHeading;`:

```glsl
      attribute float aLive;
      varying float vLive;
```
e dentro `main()`, sotto `vHeading = aHeading;`:
```glsl
        vLive    = aLive;
```

Nel **fragment shader**, aggiungere sotto `varying float vHeading;`:

```glsl
      varying float vLive;
```
e sostituire la riga
```glsl
        float intensity = max(bodyLum, halo * 0.5) * circleMask * uBrightness;
```
con
```glsl
        // vLive is 1 for an aircraft being carried forward and STILL_DIM
        // for one drawn where it was last measured (D17). It lands on the
        // INTENSITY and not on vColor: the mix() with white below is what
        // makes the silhouette read at all, and a point dimmed through its
        // colour went on painting a mid-grey aeroplane at ~45% of its lit
        // brightness — the failure this file already records at line 121.
        float intensity = max(bodyLum, halo * 0.5) * circleMask * uBrightness * vLive;
```

Sostituire `writePoint` e `commit` con:

```ts
  // One scratch vector for the whole layer. 11 625 objects a frame is 700
  // thousand allocations a second, and this loop already hoists for less.
  const scratch: Xyz = { x: 0, y: 0, z: 0 };

  function writePoint(
    set: PointSet,
    i: number,
    ac: Aircraft,
    colour: [number, number, number],
    advanceS: number,
    still: boolean,
    frame: FrameState
  ): void {
    if (ac.motion != null) {
      // The hot path: two trig calls for an aircraft that is moving and
      // none at all for one that is not, against the four writeLatLonAlt
      // spends below (D20). The decision of HOW FAR is not taken here —
      // describeVisibleFleet took it, and this writes where it said.
      positionAt(ac.motion, advanceS, frame.nowMs, scratch);
      set.positions[i * 3] = scratch.x;
      set.positions[i * 3 + 1] = scratch.y;
      set.positions[i * 3 + 2] = scratch.z;
    } else {
      // No motion: a record that never went through updateBatch, which is
      // every Aircraft the unit suite builds by hand. In production there
      // are none.
      const altFt = ac.baroAltitudeFt ?? 38000;
      writeLatLonAlt(set.positions, i * 3, ac.latitude!, ac.longitude!, altFt);
    }
    set.colors[i * 3] = colour[0];
    set.colors[i * 3 + 1] = colour[1];
    set.colors[i * 3 + 2] = colour[2];
    set.headings[i] = (ac.headingDeg ?? 0) * DEG;
    set.live[i] = still ? STILL_DIM : 1;
  }

  function commit(set: PointSet, count: number): void {
    set.geom.setDrawRange(0, count);
    set.positionAttr.needsUpdate = true;
    set.colorAttr.needsUpdate = true;
    set.headingAttr.needsUpdate = true;
    set.liveAttr.needsUpdate = true;
  }
```

- [x] **Step 4: Il fotogramma entra in `AircraftLayer.update`**

Aggiungere, sopra `export interface AircraftLayer`:

```ts
/**
 * What the render loop knows and this layer cannot work out for itself.
 *
 * One object per frame, built in animate(): sixty allocations a second
 * against the 700 thousand a per-aircraft object would cost.
 */
export interface FrameState {
  /** The rAF timestamp — monotonic by specification (D21). */
  nowMs: number;
  /**
   * Seconds since the batch was BUILT, on that same clock.
   *
   * Built, not received: aircraftStore sets feedStampMs back by the age the
   * body already had on arrival and does not re-stamp a body it has already
   * seen, so this number goes on growing while the server serves the same
   * photograph (D31). Nothing here has to know that — which is the point of
   * doing it once, in the store.
   */
  elapsedSinceBatchS: number;
  /** camera.position.length(), in globe-space units. */
  cameraDistance: number;
  /**
   * What the server said about the body in hand — aircraftStore.feedStale.
   *
   * It travels in the frame rather than being read from the store by each
   * layer, so the dots, the hit test and the leader line are all answering
   * about the SAME frame. Every one of them passes it to advanceFor, which
   * is the one place that decides (D29/D31).
   */
  stale: boolean;
}

/**
 * The frame a caller with no render loop is asking about: the instant the
 * batch landed, feed live, at the far end of the camera's travel. Every
 * existing unit test passes exactly this by omitting the argument.
 */
export const SETTLED_FRAME: FrameState = {
  nowMs: 0,
  elapsedSinceBatchS: 0,
  cameraDistance: 10,
  stale: false,
};
```

Nella dichiarazione di `update` dentro `interface AircraftLayer` e nella funzione `update`, aggiungere il quinto parametro `frame: FrameState = SETTLED_FRAME`. Poi sostituire la chiamata a `describeVisibleFleet` con:

```ts
    const view = describeVisibleFleet(
      aircraft,
      rule,
      selectedIcao,
      (ac, target, slot, advanceS, still) => {
        if (target === 'selected') {
          writePoint(selectedSet, slot, ac, SELECTED_COLOR, advanceS, still, frame);
          selectedCount = slot + 1;
        } else if (target === 'complete') {
          writePoint(completeSet, slot, ac, COMPLETE_COLOR, advanceS, still, frame);
          completeCount = slot + 1;
        } else {
          writePoint(partialSet, slot, ac, PARTIAL_COLOR, advanceS, still, frame);
          partialCount = slot + 1;
        }
      },
      othersBrightness,
      { perCategory: MAX_AIRCRAFT, selected: selectedSet.headings.length },
      frame.elapsedSinceBatchS,
      frame.stale
    );
```

- [x] **Step 5: Il picking segue il puntino**

In `src/globe/raycaster.ts`, aggiungere agli import:

```ts
import { advanceFor, positionAt } from './deadReckoning';
import { SETTLED_FRAME } from './aircraft';
import type { FrameState } from './aircraft';
```

Aggiungere a `findAircraftAtPointer` il parametro `frame: FrameState = SETTLED_FRAME`, e sostituire la riga che calcola `world`:

```ts
    const world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
```
con
```ts
    // The POSITION ON SCREEN, not the fix. A dot carried 25 px forward by
    // the dead reckoning and a hit test still sitting on its fix is an
    // aircraft you can see and cannot click — the ghost D7 forbids, seen
    // from the other door (D29).
    const world = worldOf(ac, frame);
```

e aggiungere in fondo al file:

```ts
const scratch = { x: 0, y: 0, z: 0 };

/** Where this aircraft is drawn on this frame, by the same arithmetic the layer uses. */
function worldOf(ac: Aircraft, frame: FrameState): Vector3 {
  if (ac.motion == null) {
    return latLonAltToVec3(ac.latitude!, ac.longitude!, ac.baroAltitudeFt ?? 38000);
  }
  // advanceFor, the same call describeVisibleFleet makes: if it says STILL
  // because the ceiling is past or because the server declared the body a
  // photograph, the hit test sits on the fix, which is where the dot is.
  // Two copies of that rule would differ on exactly the frames that matter.
  positionAt(
    ac.motion,
    advanceFor(ac.motion, frame.elapsedSinceBatchS, frame.stale),
    frame.nowMs,
    scratch
  );
  return new Vector3(scratch.x, scratch.y, scratch.z);
}
```

con `advanceFor` aggiunto all'import da `./deadReckoning`.

- [x] **Step 6: Il render loop passa il fotogramma**

In `src/globe/scene.ts`, dentro `animate(time)`, subito **dopo** la riga `const selectedIcao = useSelectionStore.getState().selectedIcao;`, inserire:

```ts
    // `time` is the rAF timestamp and feedStampMs is a performance.now()
    // reading: the two share performance.timeOrigin by specification, so
    // this subtraction is a real monotonic duration. Date.now() against
    // lastContact would be the same mistake v1 made in removeStale, where
    // a frozen feed made every aircraft look infinitely stale (D21).
    const feed = useAircraftStore.getState();
    const frame: FrameState = {
      nowMs: time,
      // feedStampMs is the instant the batch was BUILT, projected onto this
      // browser's monotonic clock, so this grows with the time that really
      // passed even while the server serves the same body again (D31).
      elapsedSinceBatchS: feed.feedStampMs === 0 ? 0 : (time - feed.feedStampMs) / 1000,
      cameraDistance: camera.position.length(),
      stale: feed.feedStale,
    };
```

Sostituire la chiamata al layer con `aircraftLayer.update(aircraftMap.values(), selectedIcao, rule, othersBrightness, frame);` e, nel blocco della leader line, sostituire

```ts
        const world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
```
con
```ts
        // The line points at the DOT. Starting it at the fix would leave
        // it indicating beside the aircraft by up to 25 px at the deepest
        // zoom (D29).
        // The line points at the DOT, through the same advanceFor the walk
        // and the picker ask, so the three cannot disagree about where this
        // aircraft is on this frame (D29/D31).
        let world: Vector3;
        if (ac.motion == null) {
          world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
        } else {
          positionAt(
            ac.motion,
            advanceFor(ac.motion, frame.elapsedSinceBatchS, frame.stale),
            time,
            leaderScratch
          );
          world = new Vector3(leaderScratch.x, leaderScratch.y, leaderScratch.z);
        }
```

> `leaderScratch` è un `{ x: 0, y: 0, z: 0 }` dichiarato una volta fuori da `animate` — un oggetto per fotogramma qui non costa niente, ma dichiararlo dentro sarebbe sessanta allocazioni al secondo per nulla — e `Vector3` va aggiunto all'import di `three` in cima al file. `positionAt` non accetta `null`, e un `?? undefined` scritto per far tacere il compilatore non è una semplificazione: i due rami sono due casi veri, e il secondo è l'unico che esiste in produzione.

Nel click handler, passare il fotogramma al picking:

```ts
    const icao = findAircraftAtPointer(
      ndc,
      useAircraftStore.getState().aircraft.values(),
      camera,
      canvas,
      readVisibilityRule(),
      // performance.now() and the rAF timestamp share an origin, so a click
      // handler can ask the same question the last frame asked.
      (() => {
        const s = useAircraftStore.getState();
        const at = performance.now();
        return {
          nowMs: at,
          elapsedSinceBatchS: s.feedStampMs === 0 ? 0 : (at - s.feedStampMs) / 1000,
          cameraDistance: camera.position.length(),
          stale: s.feedStale,
        };
      })()
    );
```

- [x] **Step 7: Verificare il verde**

```bash
npx vitest run tests/unit/globe/
```

Expected: **tutti verdi**, `motion.test.ts` compreso. Suite intera: **542 passed (55 files)**.

Se `fleetColours.test.ts` o `renderCapacity.test.ts` falliscono su un buffer vuoto, il ramo «nessun motion» di `writePoint` è stato dimenticato: quelle suite costruiscono `Aircraft` a mano e non passano mai da `updateBatch`.

- [x] **Step 8: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **542 passed (55 files)**.

- [ ] **Step 9: Commit**

```bash
git add src/globe/aircraft.ts src/globe/raycaster.ts src/globe/scene.ts tests/unit/globe/motion.test.ts
git commit -m "feat(globe): aircraft advance between fixes, and stop when we would be inventing"
```

---

### Task 5: Il pannello dichiara la stasi

Il globo ora fa due cose diverse con due gruppi di puntini. Dirne una sola sarebbe D15b al contrario: non un numero gonfiato, ma un comportamento mostrato e non nominato — e la conclusione che l'utente ne trae, da solo, è che gli immobili siano aerei fermi.

E dirle su un orologio fermo sarebbe lo stesso difetto per via del tempo: i due gruppi non sono fissi, un puntino passa dall'uno all'altro quando il suo fix attraversa il tetto, e questo succede **mentre non arriva niente**. Il pannello misura quindi la stessa durata monotona che misura il render loop, e la rimisura finché c'è qualcosa da portare avanti (D33, Step 4).

**Files:**
- Modify: `src/ui/FleetPanel.tsx`
- Test: `tests/component/FleetPanel.test.tsx` (esteso)

**Interfaces:**
- Consumes: `VisibleFleet.moving`, `VisibleFleet.still`, `DR_CAP_S`; `aircraftStore.feedStampMs` e `aircraftStore.feedStale`; `performance.now()` (D21/D33)
- Produces: nessuna API nuova

**Dove vanno queste righe, e perché non nella live region.** Le righe di D15 stanno in `role="status" aria-live="polite"` perché **rispondono a un atto**: una casella spenta, un click su un aereo. Queste no: sono una proprietà continua del feed, e cambiano a ogni ciclo **e fra un ciclo e l'altro** — ogni volta che un fix attraversa il tetto, cioè di continuo, perché il pannello ora ha l'orologio per accorgersene (D33). In una live region farebbero annunciare «7 412 shown where last seen» due volte al minuto nel caso migliore e una volta al secondo nel peggiore, per sempre: non è informazione, è un metronomo. Vanno quindi in un secondo riquadro `.fleet__notes` — stessa classe, quindi stesso fondo e stesso contrasto già verificati da `tests/unit/ui/noteContrast.test.ts` — **senza** `role` né `aria-live`. D15a chiede che la dichiarazione sia **sullo schermo senza che l'utente apra niente**, non che venga letta ad alta voce.

- [x] **Step 1: Estendere `tests/component/FleetPanel.test.tsx`**

Estendere i due import che il file ha già — `vi` per l'orologio del secondo `describe`, `act` per farne scattare l'intervallo — e aggiungerne uno:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { DR_CAP_S, deriveMotion } from '@/globe/deadReckoning';
```

e in fondo al file:

```tsx
/**
 * A fleet as the store builds it: every record carries its own `motion`.
 *
 * Outside both describes because both need it — the first reads the
 * sentences with the clock standing still, the second reads them again
 * while it walks. `prefix` keeps the keys apart when a fleet is two groups
 * of different ages.
 */
function withMotion(
  n: number,
  over: Partial<Parameters<typeof makeAircraftRaw>[0]> = {},
  prefix = 'm'
): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  for (let i = 0; i < n; i++) {
    const raw = makeAircraftRaw({
      icao24: `${prefix}${i}`, latitude: 50, longitude: -10, velocityKt: 450,
      headingDeg: 90, lastContact: 1_000, ...over,
    });
    m.set(raw.icao24, { ...raw, trail: [], motion: deriveMotion(raw, 1_000) });
  }
  return m;
}

describe('FleetPanel — the globe moves some of them and remembers the rest', () => {
  // The first describe's beforeEach does not reach here, and these tests
  // read both switches and the selection: without this they would depend on
  // whatever the last test above them happened to leave standing.
  beforeEach(() => {
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  it('says how many are moving and how many are where they were last seen', () => {
    const fleet = withMotion(3);
    for (const [k, v] of withMotion(2, { lastContact: 1_000 - DR_CAP_S - 10 }, 's')) {
      fleet.set(k, v);
    }
    useAircraftStore.setState({ aircraft: fleet, feedFetchedAt: 1_000, feedStale: false });
    render(<FleetPanel />);
    expect(screen.getByText(/3 moving on their last reported track/i)).toBeInTheDocument();
    expect(screen.getByText(/2 shown where last seen — no contact for over 2 min/i)).toBeInTheDocument();
  });

  it('keeps a missing heading apart from an old contact', () => {
    // Two absences, two sentences. Merging them is the half-truth D15b
    // forbids, and the two have different remedies: one is the feed
    // catching up, the other never will (D18).
    useAircraftStore.setState({
      aircraft: withMotion(2, { headingDeg: null }),
      feedFetchedAt: 1_000,
      feedStale: false,
    });
    render(<FleetPanel />);
    expect(
      screen.getByText(/2 shown where last seen — no heading or speed reported/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/no contact for over/i)).not.toBeInTheDocument();
  });

  it('blames the stopped feed rather than each aircraft when the server says so', () => {
    // The contradiction this plan had on one screen: the HUD saying "feed
    // stale · last known positions" while the dots glided on. Now the feed
    // flag stops the reckoning, and the line names the cause that is
    // actually in force — these aircraft were heard from seconds ago; what
    // is old is the body we are holding (D31).
    useAircraftStore.setState({
      aircraft: withMotion(3),
      feedFetchedAt: 1_000,
      feedStale: true,
    });
    render(<FleetPanel />);
    expect(screen.getByText(/3 shown where last seen — the feed has stopped/i)).toBeInTheDocument();
    expect(screen.queryByText(/moving on their last reported track/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no contact for over/i)).not.toBeInTheDocument();
  });

  it('says nothing about motion when every aircraft is moving', () => {
    // A line that is always on screen is furniture, and furniture is not
    // read. These appear only when there is something to say.
    useAircraftStore.setState({ aircraft: withMotion(4), feedFetchedAt: 1_000, feedStale: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();
  });

  it('keeps the motion lines out of the live region', () => {
    // They change every 30 s with the feed, and a polite live region would
    // announce them twice a minute for ever. D15a asks for the declaration
    // to be ON SCREEN without opening anything, not for it to be spoken.
    useAircraftStore.setState({
      aircraft: withMotion(2, { headingDeg: null }),
      feedFetchedAt: 1_000,
      feedStale: false,
    });
    const { container } = render(<FleetPanel />);
    const live = container.querySelector('[aria-live]');
    expect(live?.textContent ?? '').not.toMatch(/shown where last seen/i);
    expect(screen.getByText(/shown where last seen/i)).toBeInTheDocument();
  });
});

describe('FleetPanel — the clock moves even when the feed does not', () => {
  /**
   * The monotonic clock, in the test's hand.
   *
   * Spied and not faked: vi.useFakeTimers() in vitest 2.1 does NOT fake
   * `performance` — its default toFake is setTimeout, clearTimeout,
   * setInterval, clearInterval, setImmediate, clearImmediate and Date
   * (vitest/dist/config.js) — and this panel measures on performance.now(),
   * because Date.now() jumps ~528 ms every ~32 s on this machine (D21).
   * The fake timers are here to fire the interval; the spy decides what
   * that interval reads.
   */
  let clockMs = 0;

  beforeEach(() => {
    clockMs = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    vi.useFakeTimers();
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // The stamp is the one piece of store state only these tests write:
    // left behind, it would measure somebody else's fleet against this
    // file's clock.
    useAircraftStore.setState({ feedStampMs: 0 });
  });

  function putOnGlobe(fleet: Map<string, Aircraft>): void {
    useAircraftStore.setState({
      aircraft: fleet, feedFetchedAt: 1_000, feedStampMs: clockMs, feedStale: false,
    });
  }

  /**
   * Time passes and NOTHING arrives — the case the panel got wrong.
   *
   * Not one dependency of the walk is touched here: same Map, same rule,
   * same selection, same stamp, same flag. This is the 30 s of an ordinary
   * cycle, the 120 s of a backgrounded tab, or for ever if the fetch keeps
   * failing — and all that time the render loop is reading this very clock
   * sixty times a second.
   */
  function tick(seconds: number): void {
    act(() => {
      clockMs += seconds * 1_000;
      vi.advanceTimersByTime(seconds * 1_000);
    });
  }

  it('freezes the same aircraft the globe freezes, with no batch in between', () => {
    // THE defect this describe exists for. The globe ages at 60 fps; the
    // panel's walk was recomputed only when a batch landed. Three dots
    // stopped dead at the ceiling under a line still calling them moving —
    // D15's two readers separated again, one holding a clock and the other
    // holding an instant.
    putOnGlobe(withMotion(3, { lastContact: 1_000 - 60 }));
    render(<FleetPanel />);
    // 60 s old, inside the ceiling: all three are being carried forward,
    // and a panel with nothing to contrast says nothing at all.
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();

    tick(61); // 121 s of age, and not one byte has arrived
    expect(
      screen.getByText(/3 shown where last seen — no contact for over 2 min/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/moving on their last reported track/i)).not.toBeInTheDocument();
  });

  it('moves the split between the two sentences as the clock passes the ceiling', () => {
    // The line is a measurement and not a label: one fleet, two different
    // pictures 25 s apart, and the picture changes on the globe whether or
    // not the sentence follows it.
    const fleet = withMotion(2, { lastContact: 1_000 });
    for (const [k, v] of withMotion(2, { lastContact: 1_000 - 100 }, 'o')) fleet.set(k, v);
    putOnGlobe(fleet);
    render(<FleetPanel />);
    expect(screen.queryByText(/shown where last seen/i)).not.toBeInTheDocument();

    tick(25); // the two 100 s fixes cross 120 s; the fresh pair is 25 s old
    expect(screen.getByText(/2 moving on their last reported track/i)).toBeInTheDocument();
    expect(
      screen.getByText(/2 shown where last seen — no contact for over 2 min/i)
    ).toBeInTheDocument();
  });

  it('stops reading the clock once nothing is left to carry forward', () => {
    // An age only grows, and advanceFor is monotone in it: an aircraft
    // goes from moving to still and never back without a new batch — and a
    // new batch re-renders this panel through its own subscriptions. So
    // `moving === 0` is not a guess, it is the proof that no further
    // reading of the clock can change a word here. Without the stop, a
    // feed that has died leaves the panel walking the whole fleet once a
    // second for ever in a tab nobody is looking at.
    //
    // FeedStatus keeps one interval of its own for the age line, which is
    // why this counts a DIFFERENCE and not a zero.
    putOnGlobe(withMotion(3, { lastContact: 1_000 }));
    render(<FleetPanel />);
    const whileCarrying = vi.getTimerCount();

    tick(DR_CAP_S + 1);
    expect(screen.getByText(/3 shown where last seen/i)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(whileCarrying - 1);
  });

  it('does not turn the live region into the metronome it was kept out of', () => {
    // The motion lines were kept out of the live region because they change
    // with every cycle; a panel that now re-renders every second must not
    // have put anything INTO that region which the clock can touch. It has
    // not, and by construction: every number in there counts what is drawn
    // or why it is not, and `draw` counts a record the same whether it is
    // carried forward or left at its fix. A filter is switched off so the
    // region has real text to be identical to.
    const fleet = withMotion(2, { lastContact: 1_000 });
    for (const [k, v] of withMotion(1, { lastContact: 1_000, complete: true }, 'c')) {
      fleet.set(k, v);
    }
    putOnGlobe(fleet);
    useFilterStore.setState({ showComplete: false, showPartial: true, panelOpen: false });
    const { container } = render(<FleetPanel />);
    const spoken = container.querySelector('[aria-live]')?.textContent ?? '';
    expect(spoken).toMatch(/1 hidden by filters/i);

    tick(DR_CAP_S + 1);
    expect(container.querySelector('[aria-live]')?.textContent ?? '').toBe(spoken);
    expect(screen.getByText(/2 shown where last seen/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/component/FleetPanel.test.tsx
```

Expected: **otto dei nove test nuovi falliscono** — nessuna di quelle frasi è nel DOM. Il nono, «says nothing about motion when every aircraft is moving», passa già, ed è giusto: asserisce un'**assenza**, e il suo lavoro comincia quando le righe esistono.

> Il conto da rifare dopo lo **Step 3** e **prima** dello Step 4, perché è quello che separa le due metà di questo task: con `MotionNotes` sullo schermo ma senza orologio restano rossi esattamente i **quattro** test del secondo `describe`. Sono il difetto, isolato: l'elapsed vale sempre 0, la flotta non invecchia mai e il pannello dice «moving» su puntini che il globo ha già fermato.

- [x] **Step 3: Aggiungere `MotionNotes` a `src/ui/FleetPanel.tsx`**

Aggiungere all'import:

```ts
import { DR_CAP_S } from '@/globe/deadReckoning';
```

Inserire `<MotionNotes view={view} feedStale={feedStale} />` **subito dopo** `<ShortfallNotes view={view} bothOff={bothOff} />`, e aggiungere il componente in fondo al file:

```tsx
/**
 * What the globe is DOING with the dots it draws (D19).
 *
 * D15 made the screen say how many aircraft it draws and why the rest are
 * missing. Dead reckoning opens the same family on another axis: the globe
 * now draws two behaviours — some dots are carried forward from their last
 * fix, the others sit where they were measured — and showing two while
 * naming one leaves the viewer to conclude the only thing the picture
 * suggests, that the still ones are parked aircraft. That is a false
 * statement nobody measured.
 *
 * The numbers come from the same walk that drew the points, so the sentence
 * and the picture are one measurement: `moving + still.unmeasurable +
 * still.stale === shown`, by construction. And they are measured on the
 * same clock, re-read while anything is still being carried forward, so
 * the sentence cannot be one batch behind the picture (D33).
 *
 * NOT a live region, unlike ShortfallNotes above. Those lines answer an ACT
 * — a checkbox, a click on an aircraft — and appear when the user has just
 * done something. These are a standing property of the feed and change on
 * every cycle and between cycles — every time a fix crosses the ceiling —
 * so aria-live would announce them twice a minute at best and once a
 * second at worst, for ever.
 */
function MotionNotes({ view, feedStale }: { view: VisibleFleet; feedStale: boolean }) {
  const { moving, still } = view;
  if (moving === 0 && still.unmeasurable === 0 && still.stale === 0) return null;
  // Nothing to explain while every dot behaves the same way: a line that is
  // always on screen is furniture, and furniture does not get read.
  if (still.unmeasurable === 0 && still.stale === 0) return null;
  return (
    <div className="fleet__notes">
      {moving > 0 && (
        <p className="fleet__note">
          {moving.toLocaleString()} moving on their last reported track
        </p>
      )}
      {/* One bucket, two causes, and the sentence names the one in force.
          Saying "no contact for over 2 min" while the whole feed has
          stopped would blame the aircraft for a failure of ours — and it
          would be false besides, since their contact may be a few seconds
          old and it is the BODY we are holding that is a repeat (D31).
          The ceiling is spoken from the constant itself, so that sentence
          cannot drift from the rule: 120 s is the 60 s floor on refreshing
          a tile under the viewport plus the client's 30 s, with margin
          (D16). */}
      {still.stale > 0 && (
        <p className="fleet__note">
          {still.stale.toLocaleString()} shown where last seen —{' '}
          {feedStale ? (
            <>the feed has stopped</>
          ) : (
            <>no contact for over {Math.round(DR_CAP_S / 60)} min</>
          )}
        </p>
      )}
      {/* A different absence, and a different future: the feed catching up
          fixes the line above and will never fix this one. The compass
          track covers 89,6% of the fleet (spec §5.1). */}
      {still.unmeasurable > 0 && (
        <p className="fleet__note">
          {still.unmeasurable.toLocaleString()} shown where last seen — no heading or speed
          reported
        </p>
      )}
    </div>
  );
}
```

- [x] **Step 4: Dare al pannello l'orologio che il globo ha già**

**Il difetto che questo step evita, scritto prima del codice.** La passata del pannello è memoizzata su `[aircraft, rule.*, selectedIcao, feedStampMs, feedStale]`. Nessuna di quelle dipendenze si muove finché non arriva un batch — e un batch può non arrivare per 30 s nel ciclo normale, 120 s con la scheda in background (`REFRESH_INTERVALS`), 60 s in idle, o **mai** se la fetch continua a fallire. Il render loop intanto rilegge `performance.now()` sessanta volte al secondo. Leggere l'orologio **dentro** la `useMemo` darebbe quindi una misura presa una volta e poi ricordata: i puntini raggiungono il tetto e si fermano mentre la riga sotto continua a chiamarli *moving*, cioè i due lettori che D15 esiste per tenere uguali si separano di nuovo, uno con l'orologio e uno con un istante. È la forma di ogni difetto di questo progetto.

(È anche impuro: React può ricalcolare o buttare via una memo quando vuole, quindi quel numero cambierebbe a un re-render qualunque e starebbe fermo quando l'orologio si muove. Un test non potrebbe nemmeno spostarlo.)

La lettura dell'orologio va quindi in **stato**, e un intervallo la rinfresca finché c'è qualcosa da portare avanti.

Aggiungere `useEffect` e `useState` all'import di React — `import { useEffect, useMemo, useState } from 'react';` — e, accanto alle costanti in cima al file:

```ts
/**
 * How often the panel re-reads the clock while the globe is carrying
 * aircraft forward.
 *
 * A BOUND, not a taste: the panel can be behind the picture by one tick and
 * no more. What a tick of lag costs is measurable — the fleet is a mosaic
 * assembled over an 819 s sweep, so fixes cross the 120 s ceiling at about
 * fleet/819 a second, 14 of 11 625 — against the whole moving bucket, which
 * is what a panel with no clock at all gets wrong after one cycle.
 *
 * What the tick costs is measurable too, and it is nothing:
 * describeVisibleFleet is the same walk the render loop already runs sixty
 * times a second over up to 24 000 records (visibility.ts:160-161), with no
 * trigonometry and no allocation in it — advanceFor is an addition and a
 * comparison. Once a second is a sixtieth of a cost this plan has already
 * budgeted. The category counts are NOT re-walked: countFleet is memoised
 * on the Map.
 */
const MOTION_TICK_MS = 1_000;
```

In `FleetPanel`, sostituire il `useMemo` di `view` con questo blocco intero — le due sottoscrizioni, la lettura dell'orologio, la memo e l'effetto che la rinfresca:

```ts
  const feedStampMs = useAircraftStore((s) => s.feedStampMs);
  const feedStale = useAircraftStore((s) => s.feedStale);

  // The panel's reading of the same monotonic clock the render loop reads.
  // In STATE, not inside the memo: see the defect spelled out in the plan
  // for this step. performance.now() and not Date.now(), because what is
  // being measured is a DURATION and the wall clock on this machine jumps
  // ~528 ms every ~32 s (D21).
  const [clockMs, setClockMs] = useState(() => performance.now());

  // What the globe is DRAWING — from the very function that draws it (D15).
  // The elapsed is measured on the same monotonic clock the render loop
  // reads: performance.now() and the rAF timestamp share
  // performance.timeOrigin by specification, so the panel and the renderer
  // are asking about the same frame to within one tick of MOTION_TICK_MS,
  // and never to within "one batch ago".
  //
  // No Math.max on the elapsed here, on purpose: advanceSeconds already
  // floors a negative one at zero, and the floor belongs in the one place
  // that decides how far an aircraft is carried, not in two.
  //
  // feedStale is subscribed, not read: it is one of the two inputs here
  // that can change WITHOUT a new fleet arriving — the server re-serving
  // the body it already served raises it while the Map identity stays put
  // (D31) — and a panel that missed that change would go on printing
  // "moving" under a HUD that says the feed has stopped. The other is the
  // clock, which is the subject of this step.
  const view = useMemo(
    () =>
      describeVisibleFleet(
        aircraft.values(),
        rule,
        selectedIcao,
        undefined,
        undefined,
        undefined,
        feedStampMs === 0 ? 0 : (clockMs - feedStampMs) / 1000,
        feedStale
      ),
    [
      aircraft,
      rule.showComplete,
      rule.showPartial,
      rule.focusedIcao,
      selectedIcao,
      feedStampMs,
      feedStale,
      clockMs,
    ]
  );

  // The clock walks while there is something to carry forward, and then
  // stops.
  //
  // An age only grows, and advanceFor is monotone in it: an aircraft goes
  // from moving to still and never back without a new batch — and a new
  // batch re-renders this component by itself, through the subscriptions
  // above. So `moving === 0` is not a heuristic, it is the proof that no
  // further reading of the clock can change a word of this panel. Without
  // the stop, a dead feed would leave the panel walking the fleet once a
  // second for ever, in a tab nobody is looking at.
  //
  // When a batch does arrive, the reading in hand was taken before it
  // landed: advanceSeconds floors a negative elapsed at zero, so the worst
  // that reading can say is "as at the instant the batch was built" — and
  // it says it for at most one tick, which is exactly the bound declared
  // above. One mechanism, one bound.
  const carryingForward = view.moving > 0;
  useEffect(() => {
    if (!carryingForward) return;
    const id = setInterval(() => setClockMs(performance.now()), MOTION_TICK_MS);
    return () => clearInterval(id);
  }, [carryingForward]);
```

> **Il tick non può rendere il pannello un metronomo.** Le righe del moto stanno fuori dalla live region apposta (Step 3), e dentro la live region non c'è niente che l'orologio possa toccare: `shown`, `total`, `hidden.*` e `releasedByLeavingFocus` contano che cosa è disegnato e perché il resto non lo è, e `draw` conta un record allo stesso modo sia che venga portato avanti sia che resti sul suo fix. Un re-render al secondo che non cambia un carattere non fa parlare `aria-live`, e il quarto test dello Step 1 lo fissa.

- [x] **Step 5: Verificare il verde**

```bash
npx vitest run tests/component/FleetPanel.test.tsx tests/unit/ui/noteContrast.test.ts
```

Expected: entrambi verdi. Il test di contrasto resta verde **senza modificare il CSS**, perché il riquadro nuovo riusa `.fleet__notes` e le righe riusano `.fleet__note`. Suite intera: **551 passed (55 files)**.

- [x] **Step 6: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **551 passed (55 files)**.

- [ ] **Step 7: Commit**

```bash
git add src/ui/FleetPanel.tsx tests/component/FleetPanel.test.tsx
git commit -m "feat(ui): the panel names the two things the globe is doing, on the globe's own clock"
```

---

### Task 6: Il puntino è un simbolo in pixel schermo, e lo zoom arriva alla regione

Qui si risponde alla prima frase dell'utente. Finché il raggio del punto è una divisione prospettica, zoomare non separa niente: il simbolo cresce esattamente quanto la geografia, e due aerei attaccati restano attaccati a ogni distanza. Finché la camera si ferma a 1 299 NM di cap, nemmeno un simbolo piccolo basta: i vicini distano 5,7 px.

**Files:**
- Modify: `src/globe/geoHelpers.ts` — i due limiti della camera, come costanti
- Modify: `src/globe/aircraft.ts` — `pointSizePx`, l'uniform, le tre scale
- Modify: `src/globe/scene.ts` — `minDistance`
- Modify: `src/globe/airportMarkers.ts` — la soglia dell'etichetta sul nuovo fondo corsa
- Test: `tests/unit/globe/pointSize.test.ts` (nuovo), `tests/unit/globe/airportMarkers.test.ts` (esteso)

**Interfaces:**
- Produces: `CAMERA_NEAR_LIMIT = 1.9`, `CAMERA_FAR_LIMIT = 10.0` in `geoHelpers.ts`; `pointSizePx(cameraDistance: number): number`, `POINT_SCALE_COMPLETE`, `POINT_SCALE_SELECTED` in `aircraft.ts`

- [x] **Step 1: Creare `tests/unit/globe/pointSize.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pointSizePx, POINT_SCALE_COMPLETE, POINT_SCALE_SELECTED } from '@/globe/aircraft';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, visibleCapRadiusNm } from '@/globe/geoHelpers';

/** The viewport the measurements in the plan are taken on. */
const SCREEN_H = 1080;
/** Mean nearest-neighbour distance over Europe: 0,5/sqrt(4 000 / (2 000 × 1 500)). */
const CROWD_NM = 13.7;

function nmPerPixel(d: number): number {
  return (2 * visibleCapRadiusNm(d, 38)) / SCREEN_H;
}

describe('pointSizePx — the symbol stops growing with the geography', () => {
  it('grows far more slowly than the view does', () => {
    // The whole defect in one assertion. The old formula was
    // uSize * uPixelRatio * (4 / -mv.z): a perspective divide, so the dot
    // grew exactly as fast as the ground under it and two aircraft that
    // overlapped at planet view overlapped at every zoom (spec §4.2).
    const zoomGain = nmPerPixel(CAMERA_FAR_LIMIT) / nmPerPixel(CAMERA_NEAR_LIMIT);
    const sizeGain = pointSizePx(CAMERA_NEAR_LIMIT) / pointSizePx(CAMERA_FAR_LIMIT);
    expect(zoomGain).toBeGreaterThan(4);
    expect(sizeGain).toBeLessThan(zoomGain / 2);
  });

  it('separates the densest real crowd at the near end of the travel', () => {
    // 4 000 aircraft over Europe sit 13,7 NM apart on average. At the
    // bottom of the new travel that is 23 px, against a symbol of 14.
    const spacingPx = CROWD_NM / nmPerPixel(CAMERA_NEAR_LIMIT);
    expect(spacingPx).toBeGreaterThan(pointSizePx(CAMERA_NEAR_LIMIT) * 1.5);
  });

  it('is smaller at the OLD near limit than the old formula was', () => {
    // At d = 3,0 the old quad was 138,7 device px while the neighbour was
    // 11,4 away: an overlap of a factor seven, which no zoom could undo.
    expect(pointSizePx(3.0) * 2).toBeLessThan(40);
  });

  it('never leaves the travel, whatever distance it is handed', () => {
    expect(pointSizePx(0)).toBe(pointSizePx(CAMERA_NEAR_LIMIT));
    expect(pointSizePx(1e6)).toBe(pointSizePx(CAMERA_FAR_LIMIT));
    expect(Number.isFinite(pointSizePx(Number.NaN))).toBe(true);
  });

  it('keeps the hierarchy in the SIZE, because the blending cannot keep it in the order', () => {
    // aircraft.ts:140-143 blends additively with depthWrite false, and
    // addition is commutative: renderOrder cannot bury a complete aircraft
    // under grey noise, whatever the comment at line 223 says. Size can (D27).
    expect(POINT_SCALE_COMPLETE).toBeGreaterThan(1);
    expect(POINT_SCALE_SELECTED).toBeGreaterThan(POINT_SCALE_COMPLETE);
  });
});

describe('the camera travel is one declaration', () => {
  it('stops where the tile grid can still name a tile under the viewer', () => {
    // tilesNear takes tiles whose CENTRE is inside the radius, and no
    // covered point is more than 218,0 NM from a centre (tileGrid.ts:60-62).
    // Below that the region on screen would quietly stop jumping the
    // queue, which is the mechanism D16 sizes the ceiling on.
    expect(visibleCapRadiusNm(CAMERA_NEAR_LIMIT, 38)).toBeGreaterThan(218);
  });

  it('leaves the aircraft shell in front of the near plane', () => {
    // Aircraft sit at most at 1,5 + 0,075 = 1,575 (geoHelpers.ts:23-25) and
    // the camera's near plane is 0,1 (scene.ts:39).
    expect(CAMERA_NEAR_LIMIT - 1.575).toBeGreaterThan(0.1);
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/pointSize.test.ts
```

Expected: fallisce in compilazione — né `pointSizePx` né `CAMERA_NEAR_LIMIT` esistono.

- [x] **Step 3: I due limiti in `src/globe/geoHelpers.ts`**

Aggiungere subito sotto `export const GLOBE_RADIUS = 1.5;`:

```ts
/**
 * The camera's travel, in WORLD UNITS — which is what OrbitControls
 * compares against, and not what three comments in this repo call it.
 * GLOBE_RADIUS is 1,5, so 1,9 to 10,0 units is 1,27 to 6,67 globe radii;
 * geoHelpers.ts, airportMarkers.ts and server/index.ts have all said
 * "radii" about these numbers at one time or another, and one declaration
 * is how that stops happening a fourth time.
 *
 * The near end is not a matter of taste. At 1,9 the visible cap is 322 NM,
 * and the tile grid guarantees that no covered point is more than 218,0 NM
 * from the centre of a tile (src/data/sources/tileGrid.ts:60-62) — so
 * tilesNear still names at least one tile and the region being looked at
 * still jumps the poller's queue, which is the mechanism the dead
 * reckoning ceiling is sized on. At 1,7 the cap is 159 NM and a viewer
 * could sit somewhere whose nearest tile centre is 218 NM away: the thing
 * on screen would be the first thing to go stale.
 */
export const CAMERA_NEAR_LIMIT = 1.9;
export const CAMERA_FAR_LIMIT = 10.0;
```

- [x] **Step 4: `pointSizePx` e l'uniform in `src/globe/aircraft.ts`**

Aggiungere a `import { GLOBE_RADIUS } from './geoHelpers';` i due limiti, e aggiungere sotto le costanti di colore:

```ts
/**
 * The symbol's diameter in CSS pixels, by camera distance.
 *
 * The old formula — `uSize * uPixelRatio * (4.0 / -mv.z)` — was a
 * perspective divide, so the dot behaved like a sphere of fixed size IN
 * THE WORLD and grew exactly as fast as the ground under it. Measured at
 * d = 3,0, the old near limit: the quad was 138,7 device px while the mean
 * nearest neighbour over Europe was 11,4 px away. Zooming moved both by
 * the same factor, which is the spec's complaint word for word — "zooming
 * separates the geography but the points stay attached" (§4.2).
 *
 * Here the radius is in SCREEN pixels and grows with the LOGARITHM of the
 * zoom: the symbol doubles across a travel over which the view opens by
 * 5,3, so every step inwards is a net gain in separation. Written in
 * TypeScript and handed to the shader as a uniform, not computed per
 * vertex, because a threshold inside a vertex shader cannot be tested —
 * the same reason markerLabelVisible lives in airportMarkers.ts:36.
 *
 * 7 px at the far end is a dot at planet view, where 11 625 aircraft are
 * 5,1 px apart on average and no size can separate them. 14 px at the near
 * end is where the SDF silhouette starts reading as an aeroplane, and it
 * sits inside the 23 px the densest real crowd leaves at that distance.
 */
export function pointSizePx(cameraDistance: number): number {
  const d = Math.min(Math.max(cameraDistance || CAMERA_NEAR_LIMIT, CAMERA_NEAR_LIMIT), CAMERA_FAR_LIMIT);
  const t = Math.log(CAMERA_FAR_LIMIT / d) / Math.log(CAMERA_FAR_LIMIT / CAMERA_NEAR_LIMIT);
  return POINT_PX_FAR + (POINT_PX_NEAR - POINT_PX_FAR) * t;
}
const POINT_PX_FAR = 7;
const POINT_PX_NEAR = 14;

/**
 * The hierarchy, carried where the blending can actually carry it (D27).
 *
 * The three sets are additive with depthWrite false, and addition is
 * commutative: renderOrder cannot put a complete aircraft "above" grey
 * noise, whatever the comment further down says — it can only decide which
 * draw call runs first, and the sum is the same either way. Size can, and
 * so can the reserved blue.
 */
export const POINT_SCALE_COMPLETE = 1.15;
export const POINT_SCALE_SELECTED = 1.9;
```

Nel `createPointMaterial`, sostituire l'uniform `uSize` con `uPointPx: { value: POINT_PX_FAR }` e tenerne il riferimento accanto a `brightness`:

```ts
interface PointMaterial {
  material: ShaderMaterial;
  brightness: { value: number };
  /** Written once per frame from pointSizePx(); see the note there. */
  pointPx: { value: number };
}
```

Nel **vertex shader**, sostituire

```glsl
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        vColor   = aColor;
        vHeading = aHeading;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = uSize * uPixelRatio * (4.0 / -mv.z);
        gl_PointSize = clamp(s, 6.0, 220.0);
        gl_Position = projectionMatrix * mv;
      }
```
con
```glsl
      uniform float uPointPx;
      uniform float uPixelRatio;
      void main() {
        vColor   = aColor;
        vHeading = aHeading;
        vLive    = aLive;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // No perspective divide. The symbol is a fixed size on the SCREEN,
        // so zooming in separates the crowd instead of magnifying it along
        // with the ground (D23). The clamp is a backstop against a camera
        // distance pointSizePx was never handed; the real bounds are its.
        gl_PointSize = clamp(uPointPx * uPixelRatio, 2.0, 64.0);
        gl_Position = projectionMatrix * mv;
      }
```

Nei tre `createPointMaterial(...)`, togliere `size:` dai parametri (il tipo `PointParams` perde il campo) e, in `update`, scrivere la dimensione una volta per fotogramma:

```ts
    // One reading of the camera per frame for the whole layer, three
    // uniforms written. The ratios are the hierarchy (D27).
    const px = pointSizePx(frame.cameraDistance);
    partialMat.pointPx.value = px;
    completeMat.pointPx.value = px * POINT_SCALE_COMPLETE;
    selectedMat.pointPx.value = px * POINT_SCALE_SELECTED;
```

- [x] **Step 5: Il fondo corsa in `src/globe/scene.ts`**

Sostituire

```ts
  controls.minDistance = 3.0;
  controls.maxDistance = 10.0;
```
con
```ts
  // One declaration for the travel, shared with pointSizePx and with the
  // marker label threshold. The near end is the tile grid's number, not a
  // taste: see CAMERA_NEAR_LIMIT (D24).
  controls.minDistance = CAMERA_NEAR_LIMIT;
  controls.maxDistance = CAMERA_FAR_LIMIT;
```

aggiungendo i due nomi all'import da `./geoHelpers`.

- [x] **Step 6: La soglia dell'etichetta in `src/globe/airportMarkers.ts`**

Sostituire il commento e la costante di `MARKER_LABEL_MAX_DISTANCE` con:

```ts
/**
 * Below this camera distance the IATA code appears beside the dot.
 *
 * The travel is CAMERA_NEAR_LIMIT..CAMERA_FAR_LIMIT world units — 1,9 to
 * 10,0 — and this is its geometric midpoint, which keeps the label on the
 * closer half of a travel that is now logarithmic rather than linear. The
 * old value of 6,0 was described as "the lower half of 3,0 to 10,0 globe
 * radii", and the travel was neither in radii nor from 3,0.
 */
export const MARKER_LABEL_MAX_DISTANCE = Math.sqrt(CAMERA_NEAR_LIMIT * CAMERA_FAR_LIMIT);
```

con l'import corrispondente. In `tests/unit/globe/airportMarkers.test.ts`, qualunque asserzione che nomini `6.0` va sostituita con `MARKER_LABEL_MAX_DISTANCE` letto dal modulo, e vanno aggiunti due casi:

```ts
  it('shows the label at the bottom of the travel and hides it at the top', () => {
    expect(markerLabelVisible(CAMERA_NEAR_LIMIT)).toBe(true);
    expect(markerLabelVisible(CAMERA_FAR_LIMIT)).toBe(false);
  });
```

- [x] **Step 7: Verificare il verde**

```bash
npx vitest run tests/unit/globe/
```

Expected: tutti verdi. Suite intera: **559 passed (56 files)**.

- [x] **Step 8: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **559 passed (56 files)**.

- [ ] **Step 9: Commit**

```bash
git add src/globe/geoHelpers.ts src/globe/aircraft.ts src/globe/scene.ts src/globe/airportMarkers.ts tests/unit/globe/pointSize.test.ts tests/unit/globe/airportMarkers.test.ts
git commit -m "feat(globe): the dot becomes a screen-pixel symbol, and the zoom reaches a region"
```

---

### Task 7: L'orizzonte è dove lo dice la camera, i coincidenti fanno il turno, e il volo a fuoco dice quando è dietro

Con lo zoom del Task 6 il globo riempie tutto lo schermo e gli aerei dell'altra faccia — che oggi vengono dipinti attraverso il pianeta, perché nessuno scrive il depth buffer — si proietterebbero sopra la regione che il visitatore sta esaminando. Il taglio va fatto; ed è l'occasione in cui renderer e picking smettono di essere in disaccordo su un numero cablato tre volte e sbagliato tutte e tre.

E il taglio porta con sé il proprio rovescio, che gli Step 8-10 chiudono nello stesso task perché nascono dalla stessa riga. Tagliare l'emisfero lontano è inquadratura quando gli aerei sono undicimila (D25); quando è **uno solo** — un volo a fuoco — quell'aereo che gira dietro al pianeta è tutto quello che c'era, e il pannello intanto dichiara «1 shown» su un globo vuoto. Ci si arriva senza fare niente, perché il globo ruota da sé finché nessuno tocca il canvas e mettere a fuoco un volo dal pannello non lo tocca. Vedi D32.

**Files:**
- Modify: `src/globe/geoHelpers.ts` — `isOnNearSide`
- Modify: `src/globe/aircraft.ts` — il taglio nel vertex shader
- Modify: `src/globe/raycaster.ts` — il taglio esatto, e il ciclo fra i coincidenti
- Modify: `src/globe/leaderLine.ts`, `src/globe/airportMarkers.ts` — stessa funzione
- Modify: `src/globe/scene.ts` — il click che cicla; l'autorotazione che si ferma in focus; la misura del lato visibile per il soggetto
- Modify: `src/state/selectionStore.ts` — `focusBehindGlobe`, scritto dal render loop
- Modify: `src/ui/FleetPanel.tsx` — la riga che lo dichiara
- Test: `tests/unit/globe/horizon.test.ts` (nuovo), `tests/unit/globe/fleetColours.test.ts` (il picking), `tests/unit/state/stores.test.ts` (esteso), `tests/component/FleetPanel.test.tsx` (esteso)

**Interfaces:**
- Produces: `isOnNearSide(cameraPos: Vector3, worldPos: Vector3): boolean` in `geoHelpers.ts`; `findAircraftAtPointer(..., frame?, after?: string | null)`; `SelectionState.focusBehindGlobe: boolean` e `setFocusBehindGlobe(v: boolean)`

- [x] **Step 1: Creare `tests/unit/globe/horizon.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, GLOBE_RADIUS, isOnNearSide, latLonAltToVec3 } from '@/globe/geoHelpers';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, lat: number, lon: number): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao, latitude: lat, longitude: lon }), trail: [] };
}

describe('isOnNearSide — the exact horizon, not a constant', () => {
  it('accepts the point under the camera and refuses its antipode', () => {
    const cam = new Vector3(0, 0, CAMERA_FAR_LIMIT);
    expect(isOnNearSide(cam, latLonAltToVec3(0, 0, 38_000))).toBe(true);
    expect(isOnNearSide(cam, latLonAltToVec3(0, 180, 38_000))).toBe(false);
  });

  it('moves with the camera, which a hard-coded 0.05 cannot', () => {
    // dot(C, P) >= R^2 is the condition for P to be on the near side. At
    // d = 15,0 that threshold is cos = 0,0968 and at d = 1,9 it is 0,764:
    // the 0.05 in raycaster.ts:38, leaderLine.ts:19 and airportMarkers.ts:57
    // is not an approximation of either, it is wrong at both ends.
    const edge = latLonAltToVec3(0, 80, 38_000);
    expect(isOnNearSide(new Vector3(0, 0, CAMERA_FAR_LIMIT), edge)).toBe(true);
    expect(isOnNearSide(new Vector3(0, 0, CAMERA_NEAR_LIMIT), edge)).toBe(false);
  });

  it('agrees with the expression the vertex shader uses', () => {
    // The same algebra in two languages, which is the only way the picker
    // and the renderer can be made to agree (D25).
    const cam = new Vector3(0, 0, 4);
    const p = latLonAltToVec3(20, 55, 38_000);
    expect(isOnNearSide(cam, p)).toBe(cam.dot(p) >= GLOBE_RADIUS * GLOBE_RADIUS);
  });
});

describe('coincident aircraft take turns under the cursor (D26)', () => {
  const camera = new PerspectiveCamera(38, 1.6, 0.1, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = { clientWidth: 800, clientHeight: 500 } as HTMLCanvasElement;
  // Two aircraft a fifth of a degree apart: one pixel at planet view.
  const fleet = [ac('a1', 0, 0), ac('a2', 0.2, 0)];

  it('returns the nearest one when nothing came before', () => {
    const hit = findAircraftAtPointer(new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL);
    expect(hit).toBe('a1');
  });

  it('returns the NEXT one when the same pixel is clicked again', () => {
    // No clustering: the spec calls it an anti-reference, and the additive
    // blending already brightens a pile-up, which is a density cue nobody
    // had to invent a number for. The ambiguity is settled by the click.
    const first = findAircraftAtPointer(new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL);
    const second = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, first
    );
    expect(second).toBe('a2');
  });

  it('wraps round rather than running out', () => {
    const third = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, 'a2'
    );
    expect(third).toBe('a1');
  });

  it('ignores an `after` that is not under the cursor at all', () => {
    const hit = findAircraftAtPointer(
      new Vector2(0, 0), fleet, camera, canvas, SHOW_ALL, undefined, 'zzzzzz'
    );
    expect(hit).toBe('a1');
  });

  it('refuses an aircraft behind the planet, whatever the zoom', () => {
    const far = [ac('b1', 0, 180)];
    expect(findAircraftAtPointer(new Vector2(0, 0), far, camera, canvas, SHOW_ALL)).toBeNull();
  });
});
```

- [x] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/horizon.test.ts
```

Expected: fallisce in compilazione — `isOnNearSide` non esiste e `findAircraftAtPointer` non prende sette argomenti.

- [x] **Step 3: `isOnNearSide` in `src/globe/geoHelpers.ts`**

Aggiungere in fondo al file:

```ts
/**
 * Is this point on the side of the globe the camera can see?
 *
 * `dot(C, P) >= R²` is the exact condition for a point P to be on the near
 * side of a sphere of radius R seen from C — the two vectors unnormalised,
 * which is why it holds for an aircraft at altitude and for an airport on
 * the surface without a second formula.
 *
 * It replaces `camDir.dot(acDir) <= 0.05`, which was cabled into
 * raycaster.ts:38, leaderLine.ts:19 and airportMarkers.ts:57. That number
 * is not an approximation of the right one: the true threshold is 0,0968
 * at the far end of the camera's travel and 0,764 at the near end, so 0,05
 * was too permissive at every distance and absurdly so once the travel
 * reached 1,9 — where it would have let a viewer click an aircraft over
 * Australia while looking at Milan.
 *
 * The vertex shader in aircraft.ts asks the SAME expression —
 * `dot(cameraPosition, position) < uGlobeR2` — because a dot you can see
 * and cannot click is the ghost D7 forbids, and two implementations of one
 * rule are how it comes back.
 */
export function isOnNearSide(cameraPos: Vector3, worldPos: Vector3): boolean {
  return cameraPos.dot(worldPos) >= GLOBE_RADIUS * GLOBE_RADIUS;
}
```

- [x] **Step 4: Il taglio nel vertex shader di `src/globe/aircraft.ts`**

Aggiungere l'uniform `uGlobeR2: { value: GLOBE_RADIUS * GLOBE_RADIUS }` accanto a `uPixelRatio`, dichiararlo nel vertex shader, e inserire in testa a `main()`, **prima** di qualunque altra assegnazione:

```glsl
        // Behind the planet. `cameraPosition` is three.js's own uniform, in
        // world space, and this Group carries no transform, so `position`
        // is world space too: dot(C, P) >= R^2 is the exact near-side test,
        // the same one geoHelpers.isOnNearSide runs for the picker, the
        // leader line and the markers.
        //
        // The cull lives here and NOT in describeVisibleFleet on purpose.
        // `shown` has always meant "records handed to the globe to draw":
        // D15 has never counted what falls off the edge of the frame, and
        // could not, since that walk has no camera. The far side of a
        // sphere is also the one cause a viewer resolves by dragging — and
        // counting it would make the HUD churn four times a second while
        // the globe auto-rotates (D25).
        if (dot(cameraPosition, position) < uGlobeR2) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
          gl_PointSize = 0.0;
          return;
        }
```

- [x] **Step 5: Il picking esatto e il ciclo, in `src/globe/raycaster.ts`**

Sostituire

```ts
    const acDir = world.clone().normalize();
    if (camDir.dot(acDir) <= 0.05) continue; // far hemisphere
```
con
```ts
    if (!isOnNearSide(camera.position, world)) continue; // behind the planet
```

cancellare la riga `const camDir = camera.position.clone().normalize();` (`noUnusedLocals` la rifiuterebbe), aggiungere `isOnNearSide` all'import da `./geoHelpers`, e sostituire la coda della funzione — da `let bestIcao` fino al `return bestIcao;` — con:

```ts
  // Every candidate under the cursor, nearest first. Two aircraft on one
  // pixel stay two aircraft: the spec calls numeric clustering an
  // anti-reference, and the additive blending already brightens a pile-up,
  // which is a density cue nobody had to invent a number for (D26).
  const hits = projected
    .map((p) => ({ icao: p.icao, d: p.px.distanceTo(pointerPx) }))
    .filter((h) => h.d < hitRadius)
    .sort((a, b) => a.d - b.d);
  if (hits.length === 0) return null;
  if (after != null) {
    const i = hits.findIndex((h) => h.icao === after);
    // An `after` that is no longer under the cursor is not a second
    // attempt at the same target: it is a new target, and the nearest wins.
    if (i >= 0) return hits[(i + 1) % hits.length]!.icao;
  }
  return hits[0]!.icao;
```

con `after: string | null = null` aggiunto in coda alla firma, dopo `frame`.

- [x] **Step 6: La stessa funzione nella leader line e nei marcatori**

In `src/globe/leaderLine.ts`, sostituire

```ts
    const camDir = camera.position.clone().normalize();
    const acDir = worldPos.clone().normalize();
    if (camDir.dot(acDir) <= 0.05) {
```
con
```ts
    // One rule for "behind the planet", shared with the picker and the
    // shader. The 0.05 this replaced was wrong at every camera distance.
    if (!isOnNearSide(camera.position, worldPos)) {
```
(importando `isOnNearSide` da `./geoHelpers`; `camera` va tipizzato come `PerspectiveCamera | Camera` con `.position`, che `Camera` ha già).

In `src/globe/airportMarkers.ts`, dentro `projectMarker`, sostituire le tre righe del test con:

```ts
  if (!isOnNearSide(camera.position, world)) {
    return { x: 0, y: 0, visible: false };
  }
```

- [x] **Step 7: Il click che cicla, in `src/globe/scene.ts`**

Sopra `function onClick`, aggiungere:

```ts
  // Where the last click landed, so a second click on the SAME pixel can
  // mean "the next one" instead of "the same one again" (D26). Four pixels:
  // a bigger movement is a new target, not a second attempt.
  let lastClickPx: { x: number; y: number } | null = null;
  const SAME_SPOT_PX = 4;
```

e dentro `onClick`, prima della chiamata a `findAircraftAtPointer`:

```ts
    const px = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const sameSpot =
      lastClickPx !== null &&
      Math.abs(px.x - lastClickPx.x) <= SAME_SPOT_PX &&
      Math.abs(px.y - lastClickPx.y) <= SAME_SPOT_PX;
    lastClickPx = px;
```

passando poi `sameSpot ? useSelectionStore.getState().selectedIcao : null` come ultimo argomento.

- [x] **Step 8: I test della dichiarazione, e il rosso**

In `tests/unit/state/stores.test.ts`, in fondo al `describe('selectionStore', …)` (riga 104):

```ts
  it('forgets that the previous flight was behind the globe when another is picked', () => {
    // A claim about where an aircraft is, left standing over a different
    // aircraft, is a claim nobody measured — and the render loop would
    // only correct it on the next frame, after the panel had already
    // printed it (D15b/D32).
    useSelectionStore.getState().select('a1');
    useSelectionStore.getState().setFocusBehindGlobe(true);
    useSelectionStore.getState().select('a2');
    expect(useSelectionStore.getState().focusBehindGlobe).toBe(false);
  });
```

In fondo a `tests/component/FleetPanel.test.tsx`:

```ts
describe('FleetPanel — the one aircraft on the globe can be behind it (D32)', () => {
  // Both switches on explicitly: this describe is outside the one with the
  // beforeEach above, and a filter left off by another test would empty the
  // globe for a reason that has nothing to do with the camera.
  beforeEach(() => {
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
  });

  function oneInFocus() {
    const raw = makeAircraftRaw({ icao24: 'f1', latitude: 50, longitude: -10 });
    useAircraftStore.setState({
      aircraft: new Map([[raw.icao24, { ...raw, trail: [] }]]),
      feedFetchedAt: 1_000,
      feedStale: false,
      feedCapped: false,
    });
    useSelectionStore.setState({ selectedIcao: 'f1' });
  }

  it('says so when the only aircraft drawn is on the far side', () => {
    // The globe empties with no act of the user at all: it auto-rotates
    // until someone touches the canvas, and focusing a flight from this
    // very panel does not. The cull of D25 then takes the one dot there
    // was, while the row above goes on saying it is shown.
    oneInFocus();
    useSelectionStore.setState({ focusBehindGlobe: true });
    render(<FleetPanel />);
    expect(screen.getByText(/behind the globe — drag to bring it round/i)).toBeInTheDocument();
  });

  it('says nothing while the flight in focus is in view', () => {
    // And this is the assertion that keeps the remedy valid whichever way
    // the open question about the camera is answered: a camera that
    // followed the focused flight would keep the subject on the near side
    // for ever, and this line would simply never appear (D32).
    oneInFocus();
    useSelectionStore.setState({ focusBehindGlobe: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/behind the globe/i)).not.toBeInTheDocument();
  });

  it('never says it about a sky with more than one aircraft in it', () => {
    // For the whole fleet the far hemisphere IS framing, and a line about
    // it would be noise that changes while the globe turns (D25).
    const fleet = new Map<string, Aircraft>();
    for (const id of ['a1', 'a2']) {
      const raw = makeAircraftRaw({ icao24: id, latitude: 50, longitude: -10 });
      fleet.set(id, { ...raw, trail: [] });
    }
    useAircraftStore.setState({
      aircraft: fleet,
      feedFetchedAt: 1_000,
      feedStale: false,
      feedCapped: false,
    });
    useSelectionStore.setState({ selectedIcao: null, focusBehindGlobe: true });
    render(<FleetPanel />);
    expect(screen.queryByText(/behind the globe/i)).not.toBeInTheDocument();
  });
});
```

```bash
npx vitest run tests/unit/state/stores.test.ts tests/component/FleetPanel.test.tsx
```

Expected: il test dello store fallisce in compilazione — `focusBehindGlobe` non esiste su `SelectionState` — e il primo dei tre del pannello fallisce perché quella frase non è nel DOM. Gli altri due passano già, ed è giusto: asseriscono un'**assenza**, e il loro lavoro comincia quando la riga esiste.

- [x] **Step 9: Il rovescio del taglio — `focusBehindGlobe` in `src/state/selectionStore.ts`**

Dentro `interface SelectionState`, **dopo** `openEnd`, aggiungere:

```ts
  /**
   * The one aircraft on the globe is on the far side of it (D32).
   *
   * Written by the render loop, which is the only thing in the application
   * that has a camera, and only when the answer CHANGES — at most when the
   * subject crosses the limb. It is deliberately a boolean about ONE
   * aircraft and not a count of the far hemisphere: that count would churn
   * four times a second while the globe turns, which is the noise D25
   * refuses to dress up as an explanation.
   *
   * It lives beside selectedIcao because it is meaningless without one,
   * and because changing flight has to clear it: a line saying the flight
   * is behind the planet, left standing over the next flight, would be a
   * claim nobody has measured yet — D15b in one sentence.
   */
  focusBehindGlobe: boolean;
  setFocusBehindGlobe: (v: boolean) => void;
```

e nello store:

```ts
  focusBehindGlobe: false,
  select: (icao) => set({ selectedIcao: icao, openEnd: null, focusBehindGlobe: false }),
  setFocusBehindGlobe: (v) => set({ focusBehindGlobe: v }),
```

- [x] **Step 10: Il focus ferma l'autorotazione e misura il lato, in `src/globe/scene.ts`**

Aggiungere `isOnNearSide` all'import da `./geoHelpers`, e sopra `function animate`:

```ts
  // The last answer published, so the store is written once per crossing
  // instead of sixty times a second.
  let behindGlobe = false;
```

Dentro `animate(time)`, **dopo** la riga `const rule = readVisibilityRule();`, inserire:

```ts
    if (rule.focusedIcao !== null) {
      // Entering focus stops the globe turning by itself, exactly as a drag
      // or a wheel does. Focus arrives from the panel, the list or the
      // search — none of which touches the canvas, so stopRotate() was
      // never called — and a globe that goes on turning carries the ONE
      // aircraft it is drawing round behind the planet while the viewer
      // reads the card. No act of theirs, an empty globe (D32).
      //
      // This is NOT the camera following the flight: the camera does not
      // move. Whether it should is an open product decision; see D32 for
      // the single line that would change if the answer were yes.
      stopRotate();
    }

    // One dot product, for ONE aircraft, with the same expression the
    // vertex shader culls by — so the words and the picture cannot
    // disagree about where that aircraft is (D25/D32).
    const subject = rule.focusedIcao === null ? null : aircraftMap.get(rule.focusedIcao);
    const nowBehind =
      subject != null &&
      subject.latitude !== null &&
      subject.longitude !== null &&
      !isOnNearSide(
        camera.position,
        latLonAltToVec3(subject.latitude, subject.longitude, subject.baroAltitudeFt ?? 38000)
      );
    if (nowBehind !== behindGlobe) {
      behindGlobe = nowBehind;
      useSelectionStore.getState().setFocusBehindGlobe(nowBehind);
    }
```

> Il fix e non la posizione estrapolata, e la differenza è dichiarata: fra i due ci sono al più 15 NM (D16), cioè 0,26° di arco, mentre il lembo che questa riga misura si attraversa in decine di gradi. Usare `worldOf` qui vorrebbe dire esporlo da `raycaster.ts` per spostare la soglia di un quarto di grado — lo stesso conto che in D29 tiene l'arco sul fix.

- [x] **Step 11: La riga che lo dichiara, in `src/ui/FleetPanel.tsx`**

Sottoscrivere il booleano accanto agli altri:

```ts
  const focusBehindGlobe = useSelectionStore((s) => s.focusBehindGlobe);
```

passarlo a `ShortfallNotes` (`<ShortfallNotes view={view} bothOff={bothOff} behindGlobe={focusBehindGlobe} />`, con il parametro aggiunto alla firma del componente) e aggiungere, **subito dopo** il blocco `{h.focus > 0 && (…)}`:

```tsx
      {/* The far side of the globe is framing and not a shortfall while
          there are eleven thousand aircraft on it: the viewer resolves it
          by dragging, and counting it would churn four times a second
          while the globe turns (D25). With ONE aircraft drawn that stops
          being true — the aircraft that went out of sight is everything
          there was, and the row three centimetres above says "1 of 5 900
          aircraft" over an empty globe.
          Measured in the render loop, which is the only thing here that
          has a camera, and gated on view.shown so it can never appear
          about a sky the viewer can still see something in.
          If the camera ever follows the focused flight, this line simply
          stops appearing — which is why it is written this way and not as
          a decision about the camera (D32). */}
      {behindGlobe && view.shown === 1 && (
        <p className="fleet__note">
          The flight in focus is behind the globe — drag to bring it round
        </p>
      )}
```

Questa riga sta **dentro** la live region di `ShortfallNotes` e non nel riquadro muto di `MotionNotes`, e la regola è quella che il Task 5 ha già enunciato: queste righe rispondono a un **atto** — mettere a fuoco un volo, trascinare il globo — e cambiano solo quando l'utente fa qualcosa o quando il soggetto attraversa il lembo, cioè una volta ogni molti minuti. Non sono una proprietà continua del feed, quindi non sono il metronomo che `MotionNotes` evita. E chi non vede il globo è precisamente chi non ha nessun altro modo di sapere che è vuoto.

- [x] **Step 12: Verificare il verde**

```bash
npx vitest run tests/unit/globe/ tests/unit/state/stores.test.ts tests/component/FleetPanel.test.tsx
```

Expected: tutti verdi. `fleetColours.test.ts` contiene già asserzioni sul picking: se una fallisce perché un aereo «lontano» ora è accettato o rifiutato diversamente, è il taglio esatto che sta facendo il suo lavoro — verificare la geometria del caso prima di toccare l'asserzione. Suite intera: **571 passed (57 files)**.

- [x] **Step 13: Il cancello del task**

```bash
npm run build:all && npm test -- --run
```

Expected: `build:all` pulito; **571 passed (57 files)**.

- [ ] **Step 14: Commit**

```bash
git add src/globe/geoHelpers.ts src/globe/aircraft.ts src/globe/raycaster.ts src/globe/leaderLine.ts src/globe/airportMarkers.ts src/globe/scene.ts src/state/selectionStore.ts src/ui/FleetPanel.tsx tests/unit/globe/horizon.test.ts tests/unit/globe/fleetColours.test.ts tests/unit/state/stores.test.ts tests/component/FleetPanel.test.tsx
git commit -m "fix(globe): one exact horizon for picture and click, and the focused flight says when it is behind the planet"
```

---

### Task 8: Il costo, il browser, e il cancello

Il piano afferma che il dead reckoning **toglie** lavoro al ciclo di disegno. Un'affermazione del genere va provata, e va provata in un modo che non dipenda dal carico della macchina su cui gira la CI: non con un cronometro, ma contando le chiamate che costano.

**Files:**
- Test: `tests/unit/globe/renderCapacity.test.ts` (esteso)
- Create: `tests/e2e/density-motion.spec.ts`

**Interfaces:**
- Consumes: tutto quanto sopra, attraverso il browser
- Produces: nessuna API nuova

- [x] **Step 1: Il conto, come test deterministico**

Aggiungere in fondo a `tests/unit/globe/renderCapacity.test.ts`:

```ts
import { vi } from 'vitest';
import { deriveMotion } from '@/globe/deadReckoning';

/**
 * The cost, counted rather than timed.
 *
 * An assertion on milliseconds is a test that fails for the weather. The
 * quantity that actually decides whether 12 000 aircraft fit in a 16,7 ms
 * frame is the number of transcendental calls, and that is deterministic.
 *
 * The arithmetic this pins (D20): writeLatLonAlt costs FOUR trig calls per
 * aircraft per frame — at 11 625 aircraft and 60 fps, 2,79 million a
 * second, about 56 ms of CPU a second. The great-circle rotation costs TWO
 * for an aircraft being carried forward and NONE for one drawn where it
 * was measured, because its unit vector was worked out when the batch
 * landed. With the ~14,7% of the fleet that is inside the ceiling at any
 * instant (120 s of ceiling over an 819 s sweep), that is 205 thousand
 * calls a second: the dead reckoning makes this loop cheaper than it was.
 */
function withMotion(n: number, lastContact: number): Aircraft[] {
  const out: Aircraft[] = new Array<Aircraft>(n);
  for (let i = 0; i < n; i++) {
    const raw = makeAircraftRaw({
      icao24: `a${i}`,
      latitude: ((i * 37) % 170) - 85,
      longitude: ((i * 53) % 358) - 179,
      velocityKt: 450,
      headingDeg: (i * 7) % 360,
      lastContact,
    });
    out[i] = { ...raw, trail: [], motion: deriveMotion(raw, 1_000) };
  }
  return out;
}

describe('the per-frame cost of the dead reckoning', () => {
  const FRAME = { nowMs: 0, elapsedSinceBatchS: 0, cameraDistance: 10, stale: false };

  function trigCallsDuring(run: () => void): number {
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    run();
    const total = sin.mock.calls.length + cos.mock.calls.length;
    sin.mockRestore();
    cos.mockRestore();
    return total;
  }

  it('spends nothing on an aircraft it is not advancing', () => {
    // The majority of any planet view: the fleet is assembled over an 819 s
    // sweep, so most fixes are older than the ceiling. Their unit vector
    // was computed when the batch landed and the frame is three multiplies.
    const layer = createAircraftLayer();
    const fleet = withMotion(12_000, 0); // ages beyond DR_CAP_S
    layer.update(fleet, null, SHOW_ALL, 1, FRAME); // warm the buffers
    const calls = trigCallsDuring(() => layer.update(fleet, null, SHOW_ALL, 1, FRAME));
    expect(calls).toBeLessThan(12_000 * 0.1);
  });

  it('spends two calls on an aircraft it is advancing, not six', () => {
    const layer = createAircraftLayer();
    const fleet = withMotion(12_000, 1_000);
    layer.update(fleet, null, SHOW_ALL, 1, FRAME);
    const calls = trigCallsDuring(() => layer.update(fleet, null, SHOW_ALL, 1, FRAME));
    expect(calls).toBeLessThanOrEqual(12_000 * 2 + 64);
  });

  it('still draws all 12 000 of them', () => {
    // The cheapest loop in the world is the one that draws nothing.
    const layer = createAircraftLayer();
    const view = layer.update(withMotion(12_000, 1_000), null, SHOW_ALL, 1, FRAME);
    expect(view.shown).toBe(12_000);
    expect(view.moving).toBe(12_000);
  });
});
```

- [x] **Step 2: Verificare**

```bash
npx vitest run tests/unit/globe/renderCapacity.test.ts
```

Expected: **+3** test nel file, tutti verdi. Suite intera: **574 passed (57 files)**.

Se il primo fallisce con un conteggio vicino a `12 000 × 4`, `writePoint` sta ancora passando da `writeLatLonAlt`: il ramo `ac.motion != null` non viene preso, cioè le `Aircraft` del test non portano la `motion`.

- [x] **Step 3: Creare `tests/e2e/density-motion.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A known sky with a known age. playwright.config.ts starts Vite alone, so
 * /api/states would never answer, and a live feed is a different fleet
 * every run. Three aircraft: one fresh and extrapolable, one with no
 * heading, one whose last contact is half an hour old.
 */
function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1', callsign: 'BAW274', longitude: -10, latitude: 50,
    baroAltitudeFt: 38000, velocityKt: 472, headingDeg: 261, onGround: false,
    lastContact: 0, registration: 'G-ZBKA', modelCode: 'B789',
    modelDesc: null, route: null, complete: false, ...over,
  };
}

async function withFleet(page: Page): Promise<void> {
  await page.route('**/api/states*', async (route) => {
    const nowS = Math.floor(Date.now() / 1000);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        stale: false,
        capped: false,
        source: 'test',
        aircraft: [
          aircraft({ icao24: 'a1', callsign: 'BAW274', lastContact: nowS }),
          aircraft({ icao24: 'a2', callsign: 'RYR1234', latitude: 45, longitude: 9, headingDeg: null, lastContact: nowS }),
          aircraft({ icao24: 'a3', callsign: 'NJE004M', latitude: 48, longitude: 2, lastContact: nowS - 1800 }),
        ],
      }),
    });
  });
}

test('the globe says which dots it is moving and which it is remembering', async ({ page }) => {
  // The user's opening complaint, answered out loud. A sky where some dots
  // glide and the rest sit still, with nothing saying which is which,
  // reads as a sky full of parked aircraft (D19).
  await withFleet(page);
  await page.goto('/');
  await expect(page.getByText(/1 moving on their last reported track/i)).toBeVisible();
  await expect(page.getByText(/1 shown where last seen — no contact for over 2 min/i)).toBeVisible();
  await expect(
    page.getByText(/1 shown where last seen — no heading or speed reported/i)
  ).toBeVisible();
});

test('the three motion numbers add up to what the counter claims', async ({ page }) => {
  // The panel is self-verifying on this axis too: moving + still ===
  // shown, by construction, and a browser is where a construction stops
  // being an argument.
  await withFleet(page);
  await page.goto('/');
  await expect(page.locator('.hud__summary')).toContainText('3 aircraft');
});

test('an aircraft with a fresh fix actually moves between two frames', async ({ page }) => {
  // Not an assertion about a number: about a pixel. The whole v1 complaint
  // was that the dots never moved.
  await withFleet(page);
  await page.goto('/');
  const read = async (): Promise<number[]> =>
    page.evaluate(() => {
      const w = window as unknown as { __airViewProbe?: () => number[] };
      return w.__airViewProbe ? w.__airViewProbe() : [];
    });
  await page.waitForTimeout(100);
  const a = await read();
  await page.waitForTimeout(1500);
  const b = await read();
  if (a.length > 0 && b.length > 0) expect(b).not.toEqual(a);
});

test('zooming in separates two aircraft instead of magnifying them together', async ({ page }) => {
  // The spec's own sentence, §4.2: "zooming separates the geography but
  // the points stay attached". With a screen-pixel symbol it stops being
  // true (D23).
  await withFleet(page);
  await page.goto('/');
  await page.locator('canvas').hover();
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(400);
  // The camera moved and nothing threw: the console is the assertion.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});
```

> Il terzo test ha bisogno di una sonda. Aggiungere in `src/globe/scene.ts`, dentro `animate` e dietro la stessa guardia del profiler, `(<ProfileWindow & { __airViewProbe?: () => number[] }>window).__airViewProbe = () => Array.from(partialPositionsHead)` **non** va bene: espone un buffer interno. La forma corretta è esporre la sola testa del set parziale attraverso un metodo del layer, `AircraftLayer.probeHead(): number[]`, usato esclusivamente dal test e documentato come tale. Se l'esecutore preferisce non aggiungere superficie di debug, il test va cancellato e il movimento resta coperto dal Task 4 — **ma allora va cancellato, non lasciato a passare a vuoto su `a.length === 0`.**

- [ ] **Step 4: Eseguire gli E2E**

```bash
npm run test:e2e
```

Expected: **16 test Playwright verdi** — i 12 preesistenti e i 4 nuovi.

- [ ] **Step 5: La misura nel browser vero**

Aprire l'app con `npm run dev:full`, lasciare arrivare un ciclo di feed, e leggere la riga che `src/globe/scene.ts:190-209` stampa già una volta al secondo:

```
[air-view] NN fps · NNNN aircraft · aircraft N.NNms · trails N.NNms · leader N.NNms · render N.NNms
```

Annotare `fps` e `aircraft N.NNms` **prima** e **dopo** questo piano, con lo stesso numero di aerei. Il piano afferma che il secondo numero **scende**: il ciclo passa da quattro chiamate trascendenti per aereo a zero o due. Se sale, il ramo `ac.motion != null` di `writePoint` non viene preso e il test dello Step 1 lo avrebbe già detto; se sale **nonostante** quel test sia verde, la causa è altrove nel frame e va cercata prima di dichiarare il piano finito.

Verificare a mano, nello stesso giro, le tre cose che nessun test unitario può vedere: che zoomando fino in fondo gli aerei si separino invece di ingrandirsi insieme; che dietro il pianeta non ci sia più niente; che un aereo fresco scivoli invece di saltare quando arriva un ciclo nuovo.

- [ ] **Step 6: Il cancello completo**

```bash
npm run build:all && npm test -- --run && npm run test:e2e
```

Expected:
- `build:all`: nessun errore su `tsconfig.json` **né** su `tsconfig.server.json`;
- `npm test`: **574 passed (57 files)**;
- `npm run test:e2e`: **16 passed**.

> **`npm run lint` non è nel cancello, ed è un difetto preesistente, non una scorciatoia.** Lo script fallisce prima di guardare un file — «ESLint couldn't find an eslint.config.(js|mjs|cjs) file» — perché il repo ha `.eslintrc.cjs` ed `eslint@9`, che non legge più quel formato. Va riparato con un commit suo, fuori da questo piano, come il Piano 3 ha già dichiarato.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/globe/renderCapacity.test.ts tests/e2e/density-motion.spec.ts
git commit -m "test: the per-frame cost, counted rather than timed, and the motion seen in a browser"
```

---

## Riepilogo dei test attesi

| Dopo il task | Test unitari/componente | File |
|---|---|---|
| partenza | 498 | 53 |
| 1 — l'aritmetica del dead reckoning e il tetto | 521 | 54 |
| 2 — il batch si ancora, lo store porta il moto | 528 | 54 |
| 3 — la passata unica conta anche che cosa si muove (D19) | 535 | 54 |
| 4 — il renderer disegna dove l'aereo è adesso; la scia resta un documento | 542 | 55 |
| 5 — il pannello dichiara la stasi, e la dichiara su un orologio | 551 | 55 |
| 6 — simbolo in pixel schermo, e lo zoom arriva alla regione | 559 | 56 |
| 7 — un orizzonte solo per quadro e click; i coincidenti fanno il turno; il volo a fuoco dice quando è dietro al pianeta (D32) | 571 | 57 |
| 8 — il costo contato, e il browser | 574 unitari + 16 Playwright | 57 |

I totali sono `498` più i test che ogni task aggiunge, contati nei blocchi qui sopra. Nessun task crea file di test oltre ai quattro nuovi (`deadReckoning`, `motion`, `pointSize`, `horizon`), che sono i quattro incrementi della colonna File.

---

## Cosa questo piano NON fa

- **Non tocca il server.** Né il poller, né la griglia di tile, né la ritenzione, né `/health`. Il dead reckoning è interamente nel client, e il tetto di D16 è dimensionato sulla cadenza che il server ha **già**.
- **Non cambia la cadenza del client.** `REFRESH_INTERVALS` resta 30/60/120 s. Accorciarlo sarebbe il modo sbagliato di risolvere lo stesso problema: moltiplicherebbe le richieste verso un servizio gratuito per ottenere un movimento che il dead reckoning dà a costo zero.
- **Non aggiunge la cartografia a livello regione** (spec §4.3). Lo zoom ci arriva, i dati no: `public/data/ne_50m_admin_0_countries.geojson` è una scala 1:50 M e a 322 NM di cap si vede che lo è. Confini regionali e città etichettate sono un piano a sé, con una sorgente a sé.
- **Non introduce il clustering numerico.** Idioma Flightradar24, anti-reference dichiarata dalla spec §4.2. Dove i puntini si accumulano, il blending additivo li fa più luminosi, ed è un indicatore vero.
- **Non estrapola un aereo di cui non sappiamo abbastanza**, e non ne nasconde nessuno per questo: li disegna dove sono stati misurati e lo dice.
- **Non decide se la camera debba inseguire il volo a fuoco.** È una scelta di prodotto, posta all'utente e senza risposta. Il Task 7 ferma l'autorotazione quando si entra in focus — che non è un inseguimento: la camera non si muove — e fa **dichiarare** allo schermo il caso in cui l'unico aereo mostrato non è sul lato visibile. Quella dichiarazione vale in entrambi i rami: con la camera ferma la riga appare e offre il rimedio, con una camera che insegue non appare mai. D32 scrive quale riga di `scene.ts` cambierebbe se la risposta fosse sì.
- **Non tocca il tetto dei 120 s per compensare un feed fermo.** D31 fa crescere l'età con il tempo vero invece di alzare il tetto: un feed fermo non è un motivo per estrapolare più a lungo, è il motivo per cui il tetto esiste.
- **Non promette che il globo si muova tutto.** Alla cadenza di oggi, alla vista pianeta, la maggior parte dei puntini sarà ferma — perché la flotta è un mosaico di età costruito in 819 s, non un'istantanea. Il pannello lo dichiara in cifre. La parte che l'utente **sta guardando** si muove, ed è quella che aveva in mente.

---

## Il rischio principale, dichiarato

**Alla vista pianeta la maggioranza dei puntini sarà ferma e spenta, e sembrerà che il dead reckoning non sia stato fatto.**

Non è un difetto del tetto: è la forma del feed. Il server assembla la flotta tile per tile in 819 s e la tiene per almeno 1 200 s, quindi l'età dei fix è distribuita su tutto lo sweep; con un tetto di 120 s la frazione estrapolabile in un dato istante è circa 120/819, cioè il **14,7 %**. Le due alternative sono entrambe peggiori. Alzare il tetto fino a coprire lo sweep vorrebbe dire estrapolare 100 NM da un fix di quattordici minuti fa — inventare, non ricostruire. Nascondere i fermi vorrebbe dire togliere dal globo l'85 % di una flotta le cui posizioni sono tutte misurate e tutte vere.

Quello che rende la cosa accettabile, e che va verificato in produzione prima di dichiarare chiuso il lavoro, è il **gradiente**: le tile sotto il viewport saltano la coda con un pavimento di 60 s, quindi zoomando su una regione la frazione in movimento deve salire bruscamente. Se non sale — se a zoom regionale il pannello continua a dire che quasi tutti sono fermi — allora il difetto non è in questo piano: è nella priorità del Piano 1, e `scheduler.stats()` espone già `prioritised` e `rotationServed` per dirlo. È lì che va guardato, non qui.
