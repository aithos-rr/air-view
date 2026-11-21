# Air View v2 — Piano 3: pannello, focus, ricerca

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'utente i cinque comandi che ha chiesto — il pannello a tendina con il totale, le due categorie filtrabili in modo indipendente, il focus su un volo con la sua rotta azzurra e i marcatori D e A, la scheda dell'aeroporto, la ricerca per numero di volo — senza che nessuno di essi mostri un valore che non abbiamo misurato, e senza che nessuno dichiari più di quanto disegna (D15).

**Architecture:** Tre modi di nascondere aerei (filtro di categoria, focus su uno, isolamento da ricerca) si riducono a **una sola regola pura** in `src/globe/visibility.ts`, consumata dal renderer, dalle scie e dal picking, così che non possano divergere. Sopra quella regola, **una sola funzione** dice quanti aerei si vedono e perché gli altri no — `describeVisibleFleet` — e la leggono sia il ciclo di disegno sia il pannello: le due cifre non possono smentirsi perché sono la stessa cifra. La rotta è una geodetica vera campionata per slerp, e i marcatori D/A non sono ancorati in CSS: sono riproiettati dalla loro posizione geografica a ogni frame, con lo stesso meccanismo che oggi tiene attaccata la leader line.

**Spec:** `docs/superpowers/specs/2026-09-14-air-view-v2-design.md`

**Predecessore:** `docs/superpowers/plans/2026-11-16-air-view-v2-tiled-feed.md` (Piano 1b), mergiato su `main` e in produzione. Questo piano non ne corregge niente: ne consuma le interfacce.

---

## 1. Cosa esiste già — letto nel repo il 2026-11-21

Verificato su `main`, 281 test verdi in 32 file, `npm run build:all` pulito su entrambi i programmi.

| Cosa | Dove | Stato |
|---|---|---|
| `complete: boolean` su ogni record | `src/types.ts:25`, calcolato da `isComplete()` in `src/data/completeness.ts:11` e marcato lato server in `server/enrich.ts:59` | **arriva già al client e nessuno lo guarda** |
| `route: FlightRouteLite \| null` | `src/types.ts:24` — `originIata`, `originName`, `destinationIata`, `destinationName`, `airlineName` | presente, usato solo dalla `FlightCard` come testo |
| Coordinate degli aeroporti | `public/data/airports.json`, 4 563 record con `lat`/`lon`/`icao`/`city`/`timezone`; letto da `src/data/airportLookup.ts:9` | c'è, e nessuno ci disegna niente |
| Colore degli aerei | `src/globe/aircraft.ts:15-16`: `CRUISING_COLOR` caldo e `SELECTED_COLOR` azzurro | **non esiste il grigio dei parziali**: oggi completi e incompleti sono dipinti identici |
| HUD | `src/ui/HudCounter.tsx`, `role="status"`, mostra il totale e le parole di guasto (`feed stale`, `partial world`, `last update N min ago`) | esiste, non si apre |
| Pannello destro | `src/ui/SidePanel.tsx` + `FlightCard` + `AircraftList` | esiste, è il dettaglio del volo |
| Selezione | `src/state/selectionStore.ts`, click gestito in `src/globe/scene.ts:80-99` | seleziona, ma **non nasconde nessun altro aereo** |
| Proiezione 3D → schermo | `src/globe/leaderLine.ts:24-28` | il precedente da riusare per i marcatori |
| Risposta del server | `/api/states` in `server/index.ts:420`; `registerHealthRoute` in `healthRoute.ts` è la forma da imitare per un nuovo endpoint | nessun endpoint per una singola rotta |

Il punto da cui parte tutto il piano: **il dato della completezza attraversa già l'intera catena e muore inguardato nel client**. Nessun task qui sotto deve reinventarlo.

---

## 2. I numeri veri da cui parte il disegno

Misurati in produzione il 2026-11-21, non stimati.

```
flotta servita per richiesta     2 000 – 6 000 aerei
payload                          0,84 MB grezzo · 0,12 MB gzip
aerei COMPLETI                   3,5 %
copertura campi tecnici          99 %
copertura rotte                  4,7 % della flotta, +~920/ora, sopravvive ai riavvii
tetto del renderer               24 000 aerei, oltre i quali scarta in silenzio
```

E misurati sui file del repo lo stesso giorno, perché il disegno dei marcatori ci poggia sopra:

```
server/data/route-cache.json          4 594 record, 4 243 con rotta  (seed committato)
server/data/route-cache.runtime.json 10 304 record, 8 374 con rotta  (appreso in produzione)
endpoint di rotta da mappare          8 486
codici IATA assenti da airports.json  13  (ADS APC BBX BLM FOK FRU JCI MEV MSC MVY OXC SUA TNT)
rotte con almeno un estremo non mappabile  17 su 4 243 = 0,4 %
codici IATA di compagnia ambigui      17 su 834  (VY → FOS|VLG, G3 → CIX|GLO|SEH, ZB → BUB|MON)
```

**Le due conseguenze che il disegno deve digerire.**

1. **Il 3,5 % cambia che cosa È la checkbox.** Una casella che nasconde il 45 % è un filtro; una che ne nasconde il 96,5 % è un interruttore che svuota il globo. Il Task 3 la tratta come la seconda cosa — vedi la decisione D5.
2. **Lo 0,4 % di rotte senza coordinate non è un caso teorico.** 17 rotte vere, oggi, hanno un IATA che la nostra tabella aeroporti non conosce. Il piano non può disegnare un arco per quelle, e non può nemmeno fingere che la rotta non esista: il nome dell'aeroporto ce l'abbiamo (viene da adsbdb), la posizione no. Vedi D11.

---

## 3. Decisioni di disegno prese qui, con la ragione

Il task richiedeva di deciderle, non di lasciarle aperte.

**D1 — Il pannello è l'HUD che si apre; non nasce un secondo contatore.**
La spec §6.1 dice «Chiuso di default su una riga, il contatore già esistente». L'HUD vive a `top/left: 32px` (`src/ui/styles.css:90-101`) e mostra già il totale. Un pannello nuovo altrove significherebbe due numeri sullo schermo che possono divergere: esattamente il difetto che la spec chiama «il pannello è autoverificante». Quindi `HudCounter` si **scinde**: le parole di guasto restano in una live region (`role="status"`), il totale diventa il bottone di apertura (`aria-expanded`/`aria-controls`) di `FleetPanel`. Motivo della scissione, e non del semplice annidamento: un `<button>` dentro una `aria-live` fa ri-annunciare la propria etichetta a ogni cambio di conteggio, e il conteggio cambia a ogni ciclo di feed.

**D2 — L'etichetta è una sola, `aircraft`, e non cambia col contesto.**
La spec §6.1 prevedeva `IN VOLO` alla vista pianeta e `IN VISTA` su una regione, perché presupponeva un fetch camera-driven che filtra il payload. Il Piano 1 ha costruito altro: `server/index.ts:326` serve `fleet.snapshot(MAX_PAYLOAD_AIRCRAFT)`, cioè **tutta la flotta accumulata**, e i parametri `lat`/`lon`/`radius` servono solo a dare priorità alle tile (`server/index.ts:441`). Il numero non è mai «in vista». Scrivere `IN VISTA` sarebbe un valore plausibile al posto di uno vero, che è la regola che questo progetto non infrange.

**D3 — Le stringhe dell'interfaccia restano in inglese.**
Ogni stringa esistente lo è (`Route unknown`, `Last seen`, `Filter callsign…`, `feed stale`). I mockup della spec sono in italiano perché la spec è in italiano. Mescolare le due lingue nella stessa finestra è un difetto visibile.

**D4 — La checkbox dei parziali è rossa e trasparente, come l'ha chiesta l'utente; quella dei completi porta il colore degli aerei che governa.**
La spec §7.1 voleva entrambe grigie («il controllo ha il colore della cosa controllata»). L'utente ha chiesto esplicitamente «una checkbox rossa trasparente per deselezionare gli aerei con dati incompleti»: la sua richiesta vince. Il principio della spec sopravvive sull'altra riga, dove la casella dei completi è del caldo `#ffe6c4` degli aerei completi. La coppia si legge «caldo = quello che tieni, rosso = quello che togli». Il rosso **non compare mai sul globo**, solo su questo controllo, quindi la regola dell'accento unico (`#2997ff` riservato a selezione e arco) resta intatta.

**D5 — A 3,5 % di completi, spegnere i parziali lascia ~200 aerei su ~5 900, e il pannello lo dichiara.**
Non cambio la funzione che l'utente ha chiesto, e non introduco una soglia che gliela nega: deselezionare «Partial data» deve nascondere i parziali, punto. Ma un globo quasi vuoto senza spiegazione è indistinguibile da un guasto, ed è il guasto che questo progetto ha già pagato una volta. Quindi il pannello porta due righe derivate, sempre vere perché calcolate dalla flotta in mano:
- `5 705 hidden by filters` quando qualcosa è nascosto (e `No aircraft shown — both filters are off` quando sono spente entrambe). Queste due spiegano il **globo**, quindi vivono **fuori** dalla tendina e restano sullo schermo anche a pannello chiuso — vedi D14, che è anche il motivo per cui la riga chiusa dice «200 of 5 900 aircraft» invece di «5 900 aircraft»;
- `5 612 of these lack only a route`, cioè quanti dei parziali lo sono **soltanto** perché manca la rotta. Con i campi tecnici al 99 % è quasi la totalità, e quella riga trasforma «è rotto» in «la cache delle rotte si sta riempiendo». Questa spiega la scomposizione in categorie, che esiste solo a tendina aperta, e resta lì dentro.
La crescita (~920/ora) **non** finisce sullo schermo: è una misura di oggi che diventerebbe una bugia domani. Sta nel commento del codice, dove documenta la scelta.

**D6 — Il focus è la selezione, non un quarto stato.**
`selectionStore.selectedIcao` esiste già, il click sul globo lo imposta (`scene.ts:93`) e il click sul vuoto lo azzera (`scene.ts:96`). «Cliccando un aereo tutti gli altri spariscono» è una *conseguenza* della selezione, non un modo nuovo. Aggiungere un `focusStore` significherebbe due verità sullo stesso fatto.

**D7 — Le tre forme di nascondere si compongono con una regola sola: l'atto più specifico vince.**
```
isAircraftVisible(ac, rule):
  se rule.focusedIcao !== null  →  visibile SOLO se è lui
  altrimenti                    →  ac.complete ? rule.showComplete : rule.showPartial
```
Il focus **scavalca** il filtro: se spegni i parziali e poi cerchi o clicchi un volo grigio, quel volo si vede. Un atto su un singolo aereo è più specifico di una regola di categoria, e il contrario sarebbe la sorpresa («ho cercato il mio volo e non è successo niente»). Uscendo dal focus i filtri sono esattamente come li avevi lasciati. La ricerca non è un terzo modo: il suo esito 1 **è** una selezione (spec §6.3), quindi riusa il focus. Il suo esito 2 non nasconde niente, aggiunge un arco senza aereo.
La stessa funzione governa il **picking**: durante il focus solo l'aereo a fuoco è cliccabile, perché un aereo invisibile che risponde al click è un fantasma, e il click altrove esce dal focus — che è già l'uscita prevista dalla spec §6.2.

**D8 — La geodetica si campiona per slerp fra i due vettori unitari, non per interpolazione lineare di lat/lon.**
`latLonToVec3` (`src/globe/geoHelpers.ts:10`) dà già i vettori; `slerp` fra due punti sulla sfera **è** il grande cerchio, per definizione. L'alternativa che `src/globe/continents.ts:68` usa per le coste — interpolare lat/lon linearmente — è accettabile su segmenti di 2° ma su un JFK→LHR disegnerebbe la lossodromia, una linea che nessun aereo vola: la bugia geometrica che la spec §6.2 vieta. Numero di campioni proporzionale alla lunghezza dell'arco, minimo 24, massimo 256: un arco corto non merita 256 vertici e uno polare non è leggibile con 24. Il caso antipodale (due aeroporti esattamente opposti) non ha grande cerchio unico: non esiste in pratica fra aeroporti reali, ma il codice lo riconosce e non disegna, invece di produrre `NaN`.

**D9 — I marcatori D/A sono DOM riproiettato ogni frame, non sprite 3D.**
«Si aggiornano con lo zoom» non si risolve ancorando qualcosa: si risolve **non ancorando niente**. A ogni frame la posizione geografica vera dell'aeroporto viene proiettata con `project(camera)` e scritta come `transform: translate3d(...)`. Zoom, rotazione e resize diventano corretti per costruzione, perché non esiste uno stato da aggiornare. È lo stesso meccanismo di `src/globe/leaderLine.ts:24-28`, già in produzione.
DOM e non `Points`, per tre ragioni concrete: il marcatore deve essere **cliccabile** (la richiesta 4), deve essere **raggiungibile da tastiera** (axe gira sulla home in `tests/e2e/a11y.spec.ts`), e deve portare **testo** — la lettera D/A e l'etichetta IATA — che in uno shader costerebbe un atlante di glifi. L'emisfero lontano si nasconde con lo stesso test di `leaderLine.ts:19` e `raycaster.ts:30` (`camDir.dot(acDir) <= 0.05`).
L'etichetta IATA accanto al pallino compare sotto una soglia di zoom (spec §6.2), espressa come funzione pura `markerLabelVisible(cameraDistance)` perché una soglia dentro il render loop non si può testare. `OrbitControls` tiene la camera fra 3,0 e 10,0 raggi (`scene.ts:45-46`): la soglia è 6,0, cioè la metà alta della corsa.

**D10 — Aeroporto noto ma terminal ignoto: la riga del terminal non si disegna. Mai un trattino.**
`FlightRouteLite` non ha un campo terminal e **non glielo aggiungo**: sarebbe un `null` su ogni record di un payload che pesa 0,84 MB, per modellare un dato che nessuna sorgente gratuita espone (spec §2, non-obiettivi). Il tipo di UI `AirportInfo` ha invece `terminal: string | null`, la scheda rende quella riga **solo** se è non-null, e un test lo prova in entrambe le direzioni. In produzione quella riga non comparirà mai, ed è l'esito corretto: l'alternativa è scrivere «Terminal —», che suggerisce un terminal che non abbiamo, o «Terminal 2», che è Aalborg→Aarhus in un'altra forma.

**D11 — Estremo senza coordinate: nessun arco, nessun marcatore, e la scheda lo dice.**
Misurato sopra: 17 rotte su 4 243 (0,4 %) hanno un IATA che `airports.json` non conosce. Per quelle sappiamo il **nome** dell'aeroporto (lo manda adsbdb in `originName`/`destinationName`) ma non dove sia. Il focus funziona lo stesso, la `FlightCard` mostra `FRU → IST` con i nomi veri, e al posto dell'arco compare `Airport position unknown`. Non si stima una coordinata da un nome.
**Un estremo mancante toglie l'arco, non l'altro estremo.** «Nessun marcatore» nel titolo di questa decisione valeva per la rotta intera, ed è stato letto come «nessuno dei due», che è una perdita gratuita: se l'origine la sappiamo collocare, il suo pallino D si disegna. Un arco ha bisogno di due punti; un pallino di uno. Il Task 7 lo costruisce così e la riga che nomina l'aeroporto assente lo spiega — altrimenti lo schermo mostrerebbe meno di quanto sa, che è D15a.

**D12 — Quattro esiti della ricerca — i tre della spec più «non ho potuto chiedere» — e `Esc` ha una scala di priorità sola.**
Gli esiti della spec §6.3 sono tre: nel feed → focus; non nel feed ma noto al nostro server → arco con D e A senza aereo, più «position unavailable — outside ADS-B coverage»; ignoto → lo dice e il globo non si tocca. Ne serve un **quarto**, che la spec non poteva prevedere perché non parla del volo ma di noi: **«non ho potuto chiedere»**. Un 500, un timeout o un server spento non sono prove sull'esistenza di un volo, e farli arrivare come esito 3 significa stampare «No flight by that number» a proposito di un volo che nessuno ha mai cercato davvero — è D15b nella sua forma più pura. `fetchRoute` distingue quindi `res.ok === false` da `known: false`, e `run` dà la precedenza al «non lo so» sul «non esiste». L'esito 2 è servito da un nuovo `GET /api/route/:callsign` che risponde **solo dalla cache in memoria** e non interroga mai adsbdb al volo: 1 190 lookup a 4,8 req/s si sono guadagnati un ban di 300 s (`server/routeResolver.ts:110-120`), e una barra di ricerca è esattamente il modo di produrre raffiche. Il callsign ignoto viene però *accodato* alla pompa lenta, così la seconda ricerca della stessa cosa può riuscire.
Quanto a `Esc`: oggi lo gestisce solo `SidePanel.tsx:14-20`. Con pannello, focus, ricerca e scheda aeroporto aperti, quattro listener sullo stesso tasto sono quattro sorprese. Un solo listener in `AppShell`, una sola scala in `src/state/escape.ts`: scheda aeroporto → ricerca → focus → pannello flotta → pannello destro. Si spegne una cosa per pressione, la più interna per prima.

**D13 — Il focus si concede solo a un aereo che si può DISEGNARE. Negli altri casi finisce, e la selezione resta a dirlo.**
Il focus nasconde tutti gli altri: è una promessa che l'unico rimasto sia sul globo. Ci sono **due** modi ordinari perché quella promessa sia falsa, e sono lo stesso difetto visto da due porte.
- **L'aereo esce dal payload.** Il server pota la flotta a ogni ciclo e `updateBatch` sostituisce la `Map` in blocco (`src/state/aircraftStore.ts`): l'aereo a fuoco **può sparire fra due frame**, ed è un fatto ordinario, non un caso di laboratorio. Lasciato così, `isAircraftVisible` con quel `focusedIcao` non combacia con nessun record e **nasconde tutti gli altri**: globo completamente vuoto. Nello stesso istante `SidePanel` cade su `mode === 'flight' && selectedAircraft` con `selectedAircraft === null` e non rende né la `FlightCard` né il `PanelToggle`: pannello vuoto.
- **L'aereo c'è, ma non sappiamo dove sia.** `latitude` e `longitude` sono `null` quando il provider non le manda, e gli adattatori lo fanno di proposito: `src/data/sources/adsbLol.ts:30-31` scrive `latitude: typeof ac.lat === 'number' ? ac.lat : null`, e `tests/unit/data/sources/adsbLol.test.ts` lo vincola nel test «maps every missing optional field to null». Il renderer scarta quei record **prima** di guardare chi è selezionato (`src/globe/aircraft.ts`, il `continue` sulle coordinate apre il ciclo), e così fanno le scie e il picking. Un aereo simile non è cliccabile sul globo, ma è raggiungibile lo stesso: `src/ui/AircraftList.tsx:20` elenca tutto ciò che ha un callsign, posizione o no, e la ricerca del Task 8 cerca per callsign. Metterlo a fuoco nasconderebbe l'intera flotta per disegnare **nessuno**: globo vuoto, nessuna spiegazione — lo stesso guasto della v1, raggiunto per un'altra strada.
Il rimedio è lo stesso in entrambi i casi, ed è in due metà, perché il difetto ha due metà.
- **Il focus finisce.** `readVisibilityRule()` dichiara focus solo per un icao che la flotta porta ancora **e** che `isFocusable()` sa collocare. Il cielo resta pieno, o torna pieno **nello stesso fotogramma**: `createFocusFade` vede `focusedIcao` tornare a `null` e restituisce subito `1`. Il rientro non è in dissolvenza, ed è una scelta, non una semplificazione — una dissolvenza *in entrata* sul ritorno significa 2-4 fotogrammi in cui `rule.focusedIcao` è già `null`, il pannello dichiara l'intera flotta e il renderer moltiplica ogni punto per ~0: globo nero, nessuna riga che lo spieghi. E qui l'utente non ha premuto niente — l'aereo l'ha potato il server — quindi non ha nemmeno un atto proprio a cui attribuire il buio. Il perché sta in D15, «L'unica divergenza ammessa».
- **La selezione sopravvive, e il pannello parla.** Azzerarla qui riempirebbe il globo *senza una parola*, che è la stessa colpa vista dall'altro lato. L'icao24 resta selezionato e `SidePanel` dice che cosa è successo: **«Contact lost»** con il codice e il motivo quando la flotta non lo porta più; la scheda del volo con la riga **«Position unknown — not shown on the globe»** quando il volo c'è ma la sua posizione no. In entrambi i casi l'utente chiude quando vuole, con `Esc` o con la ✕.
Da qui la regola strutturale che il Task 4 scrive e tre test presidiano: **`SidePanel` non rende mai una scatola vuota, e non lascia mai il globo in disaccordo con quello che la scheda nomina, in silenzio.** Se è in `flight` senza aereo selezionato mostra il `PanelToggle`; se ha un icao selezionato che la flotta non ha più, mostra la scheda del contatto perso; se l'aereo c'è ma senza coordinate, lo dichiara sotto la scheda. E poiché la scheda del volo esiste *solo* per il volo selezionato, il primo gradino di `Esc` li disfa insieme: sono un atto solo, non due.

**D14 — Il conteggio dice quanti se ne vedono, e la riga che lo spiega non sta dentro la tendina.**
Le due righe derivate di D5 — «N hidden by filters» e «No aircraft shown — both filters are off» — spiegano **il globo**, non la tendina. Il globo è sempre sullo schermo; la tendina no. Dentro `{open && …}` quelle righe sparirebbero alla chiusura del pannello mentre il filtro resta acceso, e sparirebbero in particolare premendo `Esc`, cioè il tasto con cui l'utente chiude le cose: la spiegazione se ne andrebbe **esattamente nel momento** in cui sta cercando di capire perché il cielo sia vuoto. Il presidio contro il globo muto verrebbe nascosto dal controllo costruito per fornirlo. Quelle due righe stanno quindi **fuori** dalla tendina, montate finché il filtro è attivo.
Spostarle non basta, perché il numero sulla riga chiusa continuerebbe a dire «5 900 aircraft» con 200 aerei sullo schermo: due affermazioni che si contraddicono a tre millimetri l'una dall'altra. Quando un filtro nasconde qualcosa, la riga chiusa diventa **«200 of 5 900 aircraft»** — quanti se ne vedono, su quanti ce ne sono — e la nota sotto dice **chi** ha preso gli altri. Il conteggio risponde «quanti», la nota risponde «perché»: una delle due da sola è ancora una mezza verità. Senza filtri attivi la riga resta esattamente «5 900 aircraft», che è ciò che vede chi non ha toccato niente e ciò che `tests/e2e/happy-path.spec.ts:8` asserisce con `/\d+ aircraft/`.
La terza riga, «N of the partial ones lack only a route», **resta dentro** la tendina: non spiega il globo, spiega la scomposizione in due categorie, che esiste solo quando la tendina è aperta.
Questa decisione aveva due eccezioni dichiarate — il focus, e i record senza coordinate — ed **erano sbagliate entrambe**. La prima si reggeva sul presupposto che «la scheda del volo a fuoco è sullo schermo», che la ✕ della scheda rende falso in un click. La seconda rimandava la riparazione a «una misura che oggi non abbiamo», e il meccanismo di D15 quella misura la produce nella stessa passata, gratis. D15 le chiude tutte e due: il conteggio di questa riga non è più `complete + partial` filtrato a mano, è `shown`, cioè quanti puntini il globo sta davvero disegnando.

**D15 — Lo schermo non dichiara mai più di quanto disegna, né una causa — né una promessa — che non ha misurato. A dire «quanti se ne vedono e perché» è una funzione sola, letta sia dal renderer sia dal pannello.**

Tre giri di verifica su questo piano hanno trovato dieci difetti della **stessa famiglia** — lo schermo mostra meno di quanto dichiara, o afferma qualcosa di falso, e l'utente non ha modo di accorgersene — e ogni giro ne riparava alcuni mentre il successivo ne trovava altri. L'ultimo è nato dalla *motivazione* di D14. Una famiglia che ricompare a ogni riparazione non si chiude con un'altra pezza: le mancava una regola.

Un quarto giro ha provato a rompere l'aritmetica di questo meccanismo e non ci è riuscito: l'identità regge, e il numero del pannello è lo stesso `for` del renderer. Ha trovato altre **tre** violazioni lo stesso, e tutte e tre sul **bordo** del meccanismo, non dentro — la dissolvenza che mente in uscita, una promessa stampata senza misura, una riga che nomina un arco che un'altra parte dello schermo si è presa. Da qui le tre aggiunte che seguono: una direzione sola si anima, una promessa si misura come una causa, e di chi sia l'arco lo dice una funzione sola. Un meccanismo corretto non protegge i suoi confini da solo; i confini vanno nominati.

**L'invariante, in due metà, perché il difetto ne ha due.**
- **(a) Nessun numero senza il suo resto.** Ogni volta che il globo disegna meno puntini di quanti record la flotta ne contenga, lo schermo porta — *senza che l'utente apra niente* — **quanti** ne sta disegnando **e** per quale **causa**. Qualunque essa sia: filtro, focus, ricerca, coordinate mancanti, tetto del renderer, o una che oggi non abbiamo immaginato.
- **(b) Nessuna causa che non abbiamo misurato — e nessuna promessa che non abbiamo misurato.** Un'assenza che non siamo riusciti a verificare non si racconta come un'assenza verificata. Se non abbiamo potuto chiedere, lo schermo dice che non ha potuto chiedere; e se a mancare è la posizione dell'**aeroporto**, non dice che manca quella dell'**aereo**. Vale identico per ciò che lo schermo **promette**, perché una promessa è un'affermazione sul fotogramma dopo: «Esc shows them again» è una previsione, e una previsione si misura come si misura una causa — nella stessa passata, non a intuito. Con entrambi i filtri spenti quella riga era falsa: il focus era l'unica cosa che faceva passare un aereo, quindi `Esc` ne rimostrava **zero** e lasciava il globo vuoto. `describeVisibleFleet` misura quindi anche quello — `releasedByLeavingFocus`, quanti dei nascosti dal focus i filtri lascerebbero passare — e la nota dice quel numero invece della promessa comoda.

**Il meccanismo, perché una regola senza meccanismo è un buon proposito.** `describeVisibleFleet(aircraft, rule, selectedIcao, onDraw?, othersBrightness?, caps?)` in `src/globe/visibility.ts` percorre la flotta **una volta** e risponde `{ total, shown, hidden: { filtered, focus, noPosition, rendererFull }, reason, releasedByLeavingFocus }`. L'identità `shown + filtered + focus + noPosition + rendererFull === total` è vera **per costruzione**, perché ogni record del ciclo incrementa esattamente un contatore e poi fa `continue`. La stessa passata, quando riceve `onDraw`, **è** il ciclo di disegno di `AircraftLayer.update`: il renderer non decide più da sé chi disegnare — lo chiede a questa funzione e scrive dove lei gli dice. Il pannello chiama la stessa funzione senza `onDraw` e stampa `shown` e `hidden`. Le due cifre non possono divergere perché sono la stessa cifra, prodotta dallo stesso `for`.
Non è un secondo predicato accanto a `isAircraftVisible`: questa funzione **chiama** quello, e il suo contributo è dare un **nome** alla clausola che ha detto di no. Un predicato nuovo qui sarebbe esattamente la divergenza che D7 esiste per impedire.

**L'unica divergenza ammessa, dichiarata — e una sola direzione si può animare.** Nei ~300 ms dell'**entrata** nel focus il renderer passa la luminosità viva e il pannello passa lo stato a regime. Per quel tratto il globo mostra **più** di quanto il pannello dichiari, e converge entro `FOCUS_FADE_MS`: è la direzione innocua — un numero che diventa vero mentre l'occhio lo raggiunge — ed è l'unico scarto che il test a tabella concede.

Questa riga diceva «in una sola direzione — il globo mostra PIÙ di quanto il pannello dichiari, mai meno», ed **era falsa all'uscita**. `createFocusFade` animava anche il ritorno: `sample` vedeva `focusedIcao` tornare `null`, faceva ripartire il cronometro (`changedAtMs = nowMs`) e restituiva `fadeAmount(0) = 0`. Nei primi 2-4 fotogrammi dopo la fine di un focus `rule.focusedIcao` è già `null` — quindi `describeVisibleFleet` conta l'intera flotta in `shown`, `reason` è `null` e `ShortfallNotes` non stampa niente — mentre `AircraftLayer.update` scrive ogni punto moltiplicato per ~0. Il globo mostrava **meno**, in silenzio: esattamente la direzione che l'invariante vieta, prodotta dalla sola animazione che l'invariante tollerava. Ci si arriva con `Esc`, con la ✕, con il click sul vuoto, e **senza alcun atto dell'utente** quando il server pota l'aereo a fuoco (D13) — il caso in cui un globo nero non ha nemmeno un gesto a cui essere attribuito.

Da qui la regola che rende la riga vera invece di affermarla: **si anima solo la direzione innocua.** Uscire dal focus non è una transizione verso qualcosa di nuovo, è il ritorno allo stato che il pannello già dichiara, e un ritorno non ha niente da far aspettare all'occhio: `createFocusFade.sample` restituisce `1` ogni volta che `focusedIcao` è `null`, qualunque cosa dica il cronometro (Task 4, Step 3). Il presidio sta dove le due macchine si toccano — `tests/unit/globe/focus.test.ts`, `describe('the fade and the count, at the frame where they meet')` — che campiona la dissolvenza e interroga `describeVisibleFleet` **sullo stesso fotogramma**: nessuno dei due test, da solo, può vedere il fotogramma che sta fra loro.

**Il test è una TABELLA, non un elenco di casi.** `tests/unit/globe/visibleFleet.test.ts` enumera le combinazioni di filtro (4), focus (nessuno, su un completo, su un parziale) e dati mancanti (un record per ciascuna delle quattro forme) e verifica su **ogni** riga quattro affermazioni insieme: la somma torna, `shown` è esattamente il numero di record passati a `onDraw`, nessuna assenza resta senza nome, e `releasedByLeavingFocus` dice quanti ne tornerebbero davvero. Le ultime righe della tabella non sono stati a regime ma **bordi**: i fotogrammi in cui il renderer passa una luminosità viva e il pannello non ne passa nessuna, compreso quello **dopo** la fine di un focus. È lì che le violazioni sopravvissute alla verifica dell'aritmetica sono state trovate — non nel meccanismo, ma dove il meccanismo confina con un altro — e una tabella che enumera solo gli stati a regime è una tabella che guarda dall'altra parte. Una tabella è ciò che impedisce alla famiglia di tornare — uno stato nuovo si aggiunge come una riga, non si scopre al giro di verifica dopo — e una riga di quella tabella (filtri entrambi spenti **e** un volo a fuoco) è già un difetto che la sola aritmetica di D14 produceva: «No aircraft shown» scritto sopra un globo che ne disegna uno.

**Che cosa l'invariante NON governa, per non farlo rileggere ogni volta.** Riguarda ciò che lo schermo **dichiara**. Le scie, l'arco e i marcatori non dichiarano numeri: disegnano, e per loro basta il predicato condiviso del Task 1 — se divergessero da quello si vedrebbe un arco senza il suo aereo, che è un difetto di un'altra famiglia. **Una riga che parla dell'arco, però, dichiara**, e ricade qui dentro in pieno: «BA999 · position unavailable — outside ADS-B coverage» nomina una rotta, e se quella rotta non è più sul globo la riga sta dichiarando ciò che lo schermo non disegna. È la porta da cui la terza violazione è entrata — l'invariante guardava il disegno e non le parole accanto — e la chiude il Task 8, Step 18: a rispondere «di chi è l'arco» è **una funzione sola**, `arcSubject`, letta dal renderer e dalla riga. Il picking usa lo stesso predicato e un aereo invisibile non risponde al click (Task 2). Il passaggio dell'invariante sul resto dello schermo è stato fatto, e queste sono le superfici guardate e lasciate come sono, con la ragione: `AircraftList` non dichiara nessun conteggio e mostra anche gli aerei spenti dal filtro, il che è coerente con D7 perché sceglierne uno lo riporta sul globo; `feedStale` e `feedCapped` sono già dichiarati in `FeedStatus` dal Piano 1; l'esito 1 della ricerca su un aereo senza posizione è già coperto da D13 e dalla riga «Position unknown — not shown on the globe».

**Il corollario sull'atto, non solo sul numero.** La ✕ della scheda del volo, `Esc`, e il pulsante di pulizia della ricerca sono **lo stesso atto**: lasciare il volo. Scritto tre volte diverge, ed è così che è nato il difetto della ✕ che spegne la spiegazione lasciando acceso il focus. Esiste quindi `leaveFlight()` in `src/state/flightFocus.ts` — azzera selezione, scheda del volo e scheda dell'aeroporto **insieme** — e i tre call site chiamano quella. Nessuno dei tre può più sfilare metà dello stato, perché nessuno dei tre sa più come si fa.

---

## 4. Global Constraints

- **Nessun dato inventato.** Un campo sconosciuto è `null` e l'interfaccia tace. È la regola che la v1 ha infranto mostrando Aalborg→Aarhus per ogni volo BA.
- **Le durate si misurano con un orologio monotono.** `Date.now()` su questa macchina salta di ~528 ms ogni ~32 s (`server/routeResolver.ts:47-58`). Le due durate di questo piano — la dissolvenza del focus e il debounce della ricerca — usano il timestamp di `requestAnimationFrame` e `performance.now()`, che sono monotoni per specifica. `Date.now()` compare solo dove si rende un **istante**, mai una durata.
- **Due programmi TypeScript.** `tsconfig.json` (`Bundler`) compila il client: alias `@/`, niente estensioni. `tsconfig.server.json` (`NodeNext`) compila il server: **percorsi relativi con suffisso `.js`, mai `@/`**. `src/data/completeness.ts` e `src/types.ts` sono nella lista `include` di entrambi (`tsconfig.server.json:14`): chi li tocca segue le regole più severe. `server/routeQuery.ts` è un file di server e importa `./routeResolver.js`.
- **`npm run build` non type-checka il server.** Verificare sempre con `npm run build:all`.
- **Nessuna richiesta di rete verso adsbdb, adsb.lol o adsb.fi** durante l'esecuzione di questo piano. Nessun task ne ha bisogno: il server risponde dalla cache, i test usano `fetch` finto.
- **Mai `git add -A` né `git add .`.** Questo working tree ha percorsi non tracciati e non ignorati — `.agents/`, `.claude/`, `mockups/`, `skills-lock.json`. Ogni commit elenca i propri file uno per uno.
- **Mai `git push`, `git checkout main`, `git merge` verso main.** Il deploy è una decisione dell'utente.
- Messaggi di commit in inglese. Commenti in inglese, e un commento dice **perché**, citando la misura o il guasto, mai cosa fa la riga sotto.

**Stato di partenza del gate:** `npm test -- --run` → **281 passed (32 files)**. Ogni task qui sotto dichiara il numero atteso dopo di sé.

---

### Task 1: Una sola regola di visibilità, e la decomposizione dei parziali

Prima di disegnare qualsiasi cosa, il piano fissa il posto unico dove si decide chi si vede. Tre modi di nascondere aerei scritti in tre punti diversi divergono: il renderer nasconderebbe un aereo che il picking continua a selezionare, e il conteggio del pannello non corrisponderebbe a quello che c'è sullo schermo.

**Files:**
- Modify: `src/data/completeness.ts` — estrae `isCompleteExceptRoute`, su cui poggia la riga «lack only a route» del pannello
- Create: `src/state/filterStore.ts`
- Create: `src/globe/visibility.ts`
- Test: `tests/unit/data/completeness.test.ts` (esteso), `tests/unit/state/filterStore.test.ts`, `tests/unit/globe/visibility.test.ts`, `tests/unit/globe/visibleFleet.test.ts`

**Interfaces:**
- Consumes: `AircraftRaw`, `Aircraft` da `src/types.ts`; `isComplete` già esistente
- Produces: `isCompleteExceptRoute(ac: AircraftRaw): boolean`; `useFilterStore` con `{ showComplete: boolean; showPartial: boolean; panelOpen: boolean; toggleComplete(): void; togglePartial(): void; setPanelOpen(v): void }`; `countFleet(aircraft: Iterable<Aircraft>): FleetCounts` con `FleetCounts = { total; complete; partial; routeOnly }`; `VisibilityRule = { showComplete; showPartial; focusedIcao: string | null }`; `isAircraftVisible(ac, rule): boolean`; `isFocusable(ac: Aircraft): boolean`; `SHOW_ALL: VisibilityRule`; **`Shortfall`, `DrawTarget`, `VisibleFleet`, `RENDER_CAPS`, `describeVisibleFleet(aircraft, rule, selectedIcao, onDraw?, othersBrightness?, caps?): VisibleFleet`** — il meccanismo dell'invariante D15

**Perché `isCompleteExceptRoute` e non un booleano in più sul record.** Il server marca già `complete` e il client lo riceve. Un secondo flag sul filo costerebbe byte su 2 000-6 000 record per un numero che il client sa calcolare da sé in un giro di `for`. E il refactor è a comportamento invariato: `isComplete` diventa `ac.route !== null && isCompleteExceptRoute(ac)`, che è letteralmente la sua definizione attuale riordinata, quindi i 10 test esistenti restano la rete di sicurezza.

- [ ] **Step 1: Estendere `tests/unit/data/completeness.test.ts`**

Aggiungere in fondo al file, **dopo** la chiusura del `describe('isComplete', ...)` esistente, e cambiare la riga di import `import { isComplete } from '@/data/completeness';` in:

```ts
import { isComplete, isCompleteExceptRoute } from '@/data/completeness';
```

Poi, in fondo al file:

```ts
describe('isCompleteExceptRoute', () => {
  // The panel needs to say how many grey aircraft are grey ONLY because the
  // route cache has not reached them yet. Measured 2026-11-21: technical
  // fields cover 99% of the fleet while routes cover 4.7%, so this number is
  // very nearly the whole grey population — and saying so turns "the globe
  // looks broken" into "the cache is still filling".
  it('accepts an aircraft that has every technical field but no route', () => {
    expect(isCompleteExceptRoute(complete({ route: null }))).toBe(true);
  });
  it('still rejects a missing technical field', () => {
    expect(isCompleteExceptRoute(complete({ route: null, registration: null }))).toBe(false);
  });
  it('agrees with isComplete once a route is present', () => {
    expect(isCompleteExceptRoute(complete())).toBe(isComplete(complete()));
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/data/completeness.test.ts
```

Expected: fallisce in fase di import — `isCompleteExceptRoute is not a function` o l'errore di TypeScript equivalente. Nessun test di quel file passa.

- [ ] **Step 3: Sostituire `src/data/completeness.ts`**

Sostituire l'intero contenuto del file con:

```ts
import type { AircraftRaw } from '../types.js';

/**
 * Everything "complete" requires EXCEPT the route.
 *
 * Split out because the user's panel reports the two halves separately.
 * Measured in production on 2026-11-21: the technical fields cover 99% of
 * the fleet, the routes 4.7%, so 3.5% of aircraft are complete. Knowing how
 * many greys lack ONLY a route is the difference between a panel that looks
 * broken and one that explains itself.
 *
 * Altitude is exempt on the ground, where a null baro altitude is correct
 * rather than missing.
 */
export function isCompleteExceptRoute(ac: AircraftRaw): boolean {
  if (ac.callsign === null) return false;
  if (ac.latitude === null || ac.longitude === null) return false;
  if (ac.registration === null) return false;
  if (ac.modelCode === null) return false;
  if (ac.velocityKt === null) return false;
  if (ac.headingDeg === null) return false;
  if (!ac.onGround && ac.baroAltitudeFt === null) return false;
  return true;
}

/**
 * An aircraft is "complete" when we can show its full card AND draw its
 * route. The colour predicts the interaction: only a complete aircraft can
 * put D and A on the globe, which is what makes the filter meaningful.
 */
export function isComplete(ac: AircraftRaw): boolean {
  return ac.route !== null && isCompleteExceptRoute(ac);
}
```

- [ ] **Step 4: Verificare il verde**

```bash
npx vitest run tests/unit/data/completeness.test.ts
```

Expected: **13 passed** nel file (10 preesistenti + 3 nuovi). Suite intera: 284.

- [ ] **Step 5: Creare `tests/unit/state/filterStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useFilterStore, countFleet } from '@/state/filterStore';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

// Note for the executor: the beforeEach below resets panelOpen too.

const ROUTE = {
  originIata: 'JFK',
  originName: 'John F Kennedy International Airport',
  destinationIata: 'MIA',
  destinationName: 'Miami International Airport',
  airlineName: 'American Airlines',
};

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('filterStore', () => {
  beforeEach(() =>
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false })
  );

  it('shows both categories before the user touches anything', () => {
    // A visitor who never opens the panel must see the sky the previous
    // version showed them. A filter that defaults to ON is a filter nobody
    // asked for.
    const s = useFilterStore.getState();
    expect(s.showComplete).toBe(true);
    expect(s.showPartial).toBe(true);
  });

  it('toggles the two categories INDEPENDENTLY', () => {
    useFilterStore.getState().togglePartial();
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(true);
    useFilterStore.getState().toggleComplete();
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(false);
  });

  it('allows both to be off — that is the user asking for an empty globe', () => {
    useFilterStore.getState().togglePartial();
    useFilterStore.getState().toggleComplete();
    const s = useFilterStore.getState();
    expect(s.showComplete || s.showPartial).toBe(false);
  });

  it('keeps the drop-down shut until asked, and keeps that fact in the store', () => {
    // Not component state: the Esc ladder of Task 4 has to know whether this
    // panel is open, and a useState inside a component is unreadable from a
    // window keydown handler.
    expect(useFilterStore.getState().panelOpen).toBe(false);
    useFilterStore.getState().setPanelOpen(true);
    expect(useFilterStore.getState().panelOpen).toBe(true);
  });
});

describe('countFleet', () => {
  it('splits the fleet so the two numbers always add up to the total', () => {
    // The spec calls the panel self-verifying: complete + partial IS total,
    // at every cycle, or one of the three numbers is lying.
    const fleet = [
      ac({ icao24: 'a1', complete: true, route: ROUTE }),
      ac({ icao24: 'a2', complete: false }),
      ac({ icao24: 'a3', complete: false }),
    ];
    const c = countFleet(fleet);
    expect(c.total).toBe(3);
    expect(c.complete).toBe(1);
    expect(c.partial).toBe(2);
    expect(c.complete + c.partial).toBe(c.total);
  });

  it('counts the greys that lack ONLY a route', () => {
    const fleet = [
      ac({ icao24: 'a1', complete: false, route: null }),
      ac({ icao24: 'a2', complete: false, route: null, registration: null }),
    ];
    expect(countFleet(fleet).routeOnly).toBe(1);
  });

  it('never counts a complete aircraft among the route-only greys', () => {
    const fleet = [ac({ icao24: 'a1', complete: true, route: ROUTE })];
    const c = countFleet(fleet);
    expect(c.routeOnly).toBe(0);
    expect(c.partial).toBe(0);
  });

  it('reads the server flag and does not recompute completeness', () => {
    // isComplete() runs server-side in enrich.ts and the answer travels in
    // the payload. Recomputing it here would be a second authority on the
    // same fact, free to disagree with the colour the globe is drawing.
    const fleet = [ac({ icao24: 'a1', complete: true, route: null })];
    expect(countFleet(fleet).complete).toBe(1);
  });
});
```

- [ ] **Step 6: Verificare il rosso**

```bash
npx vitest run tests/unit/state/filterStore.test.ts
```

Expected: il file non si carica, `Failed to resolve import "@/state/filterStore"`. Zero test passati.

- [ ] **Step 7: Creare `src/state/filterStore.ts`**

```ts
import { create } from 'zustand';
import type { Aircraft } from '@/types';
import { isCompleteExceptRoute } from '@/data/completeness';

export interface FleetCounts {
  total: number;
  complete: number;
  partial: number;
  /**
   * Of the partial ones, how many are partial ONLY because no route is known.
   * Measured 2026-11-21: routes cover 4.7% of the fleet and technical fields
   * 99%, so this is very nearly the whole grey population — and a panel that
   * says so reads as "still filling" instead of "broken".
   */
  routeOnly: number;
}

interface FilterState {
  showComplete: boolean;
  showPartial: boolean;
  /**
   * Whether the drop-down is down. In the store rather than in the component
   * because the single Esc handler has to read it from outside React.
   */
  panelOpen: boolean;
  toggleComplete: () => void;
  togglePartial: () => void;
  setPanelOpen: (v: boolean) => void;
}

/**
 * Both categories start visible: a visitor who never opens the panel must
 * see the sky the previous version showed them.
 */
export const useFilterStore = create<FilterState>((set) => ({
  showComplete: true,
  showPartial: true,
  panelOpen: false,
  toggleComplete: () => set((s) => ({ showComplete: !s.showComplete })),
  togglePartial: () => set((s) => ({ showPartial: !s.showPartial })),
  setPanelOpen: (v) => set({ panelOpen: v }),
}));

/**
 * One pass over the fleet for every number the panel shows.
 *
 * `complete` is READ from the record, never recomputed: the server decided
 * it in enrich.ts and the globe is painting that same flag. A second
 * authority here could disagree with the colours on screen.
 */
export function countFleet(aircraft: Iterable<Aircraft>): FleetCounts {
  let total = 0;
  let complete = 0;
  let routeOnly = 0;
  for (const ac of aircraft) {
    total += 1;
    if (ac.complete) {
      complete += 1;
      continue;
    }
    if (ac.route === null && isCompleteExceptRoute(ac)) routeOnly += 1;
  }
  return { total, complete, partial: total - complete, routeOnly };
}
```

- [ ] **Step 8: Verificare il verde**

```bash
npx vitest run tests/unit/state/filterStore.test.ts
```

Expected: **8 passed**. Suite intera: 292.

- [ ] **Step 9: Creare `tests/unit/globe/visibility.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isAircraftVisible, isFocusable, SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('isAircraftVisible', () => {
  it('hides the greys when the partial box is off', () => {
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(true);
  });

  it('hides the completes when the complete box is off — the two are independent', () => {
    const rule = { showComplete: false, showPartial: true, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(true);
  });

  it('shows nothing at all when both boxes are off', () => {
    const rule = { showComplete: false, showPartial: false, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(false);
  });

  it('under focus shows the focused aircraft and nothing else', () => {
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    expect(isAircraftVisible(ac({ icao24: 'a1' }), rule)).toBe(true);
    expect(isAircraftVisible(ac({ icao24: 'a2' }), rule)).toBe(false);
  });

  it('lets focus OVERRIDE a filter that would have hidden the focused flight', () => {
    // The user switched the greys off, then searched for a grey flight. The
    // specific act wins over the category rule: the alternative is a search
    // that silently does nothing, which reads as a broken search box.
    const rule = { showComplete: true, showPartial: false, focusedIcao: 'a1' };
    expect(isAircraftVisible(ac({ icao24: 'a1', complete: false }), rule)).toBe(true);
  });

  it('SHOW_ALL hides nothing, whatever the aircraft is', () => {
    expect(isAircraftVisible(ac({ complete: false }), SHOW_ALL)).toBe(true);
    expect(isAircraftVisible(ac({ complete: true }), SHOW_ALL)).toBe(true);
  });
});

describe('isFocusable', () => {
  // Focus hides every OTHER aircraft, so it is a promise that the one left
  // is on the globe. Granting it to an aircraft nobody can place hides the
  // whole fleet and draws nobody: an empty globe with nothing on screen to
  // explain it — the v1 failure this plan builds three guards against.

  it('accepts an aircraft we know the position of', () => {
    expect(isFocusable(ac({ latitude: 50, longitude: -10 }))).toBe(true);
  });

  it('refuses one whose latitude the provider never sent', () => {
    // Not hypothetical: the adapters write null on purpose —
    // src/data/sources/adsbLol.ts:30-31 — and
    // tests/unit/data/sources/adsbLol.test.ts pins it in "maps every
    // missing optional field to null".
    expect(isFocusable(ac({ latitude: null, longitude: -10 }))).toBe(false);
  });

  it('refuses one whose longitude is missing', () => {
    expect(isFocusable(ac({ latitude: 50, longitude: null }))).toBe(false);
  });

  it('refuses one carrying neither coordinate', () => {
    expect(isFocusable(ac({ latitude: null, longitude: null }))).toBe(false);
  });
});
```

- [ ] **Step 10: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/visibility.test.ts
```

Expected: `Failed to resolve import "@/globe/visibility"`. Zero test passati.

- [ ] **Step 11: Creare `src/globe/visibility.ts`**

```ts
import type { Aircraft } from '@/types';

export interface VisibilityRule {
  showComplete: boolean;
  showPartial: boolean;
  /** Non-null means focus: one aircraft chosen by hand, everything else gone. */
  focusedIcao: string | null;
}

/**
 * Every hiding rule in the application, in one function.
 *
 * Three features hide aircraft — the category filter, focus on one flight,
 * and the search isolating a flight — and written in three places they would
 * drift: the renderer would hide an aircraft the picker still selects, and
 * the panel's count would disagree with what is on screen. The layers, the
 * trails and the raycaster all ask THIS.
 *
 * Focus beats the filter on purpose. Switching the greys off and then
 * searching for a grey flight must show that flight: an act aimed at one
 * aircraft is more specific than a rule about a category, and the opposite
 * reads as a search box that does nothing.
 */
export function isAircraftVisible(ac: Aircraft, rule: VisibilityRule): boolean {
  if (rule.focusedIcao !== null) return ac.icao24 === rule.focusedIcao;
  return ac.complete ? rule.showComplete : rule.showPartial;
}

/**
 * Can this aircraft be the SUBJECT of a focus?
 *
 * Focus hides every other aircraft, so it is a promise that the one left is
 * on the globe. An aircraft without coordinates is not: the renderer drops
 * a record with a null latitude or longitude BEFORE it looks at who is
 * selected, and so do the trails and the picker. Focusing it would hide the
 * whole fleet to draw nobody — an empty globe, with nothing on screen to
 * say why (D13).
 *
 * Null coordinates are deliberate, not a corruption: the adapters write
 * null when the provider sent no position (src/data/sources/adsbLol.ts:
 * 30-31), rather than inventing one. Such an aircraft cannot be clicked on
 * the globe, but it IS reachable — AircraftList lists everything with a
 * callsign and the search looks up callsigns — so this is a door that is
 * open today, not a defensive hypothetical.
 */
export function isFocusable(ac: Aircraft): boolean {
  return ac.latitude !== null && ac.longitude !== null;
}

/**
 * The rule that hides nothing.
 *
 * Exists so tests and any future caller state "no filtering" explicitly
 * instead of omitting an argument. A default parameter meaning "show
 * everything" would be a second place where the rule lives, which is the
 * drift this module exists to prevent.
 */
export const SHOW_ALL: VisibilityRule = {
  showComplete: true,
  showPartial: true,
  focusedIcao: null,
};
```

- [ ] **Step 12: Creare `tests/unit/globe/visibleFleet.test.ts` — la TABELLA degli stati (D15)**

Questo è il test che impedisce alla famiglia di difetti di tornare. Non elenca casi: enumera stati, e su ognuno verifica le tre affermazioni dell'invariante insieme.

```ts
import { describe, it, expect } from 'vitest';
import { describeVisibleFleet, SHOW_ALL } from '@/globe/visibility';
import type { DrawTarget, Shortfall, VisibilityRule } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao }), trail: [], ...over };
}

/**
 * One record of each shape the real fleet contains. Two of the four cannot
 * be drawn at all: latitude and longitude are null whenever the provider
 * sent no position, and the adapters write null on purpose rather than
 * invent one (src/data/sources/adsbLol.ts:30-31). Those two are in
 * aircraft.size, in the panel's total, and nowhere on the globe — which is
 * precisely the half-truth D15 exists to forbid.
 */
const CC = ac('cc', { complete: true });                 // complete, placeable
const PP = ac('pp', { complete: false });                // partial, placeable
const CN = ac('cn', { complete: true, latitude: null }); // complete, nowhere
const PN = ac('pn', { complete: false, longitude: null }); // partial, nowhere
const FLEET = [CC, PP, CN, PN];

function rule(
  showComplete: boolean,
  showPartial: boolean,
  focusedIcao: string | null
): VisibilityRule {
  return { showComplete, showPartial, focusedIcao };
}

interface Row {
  name: string;
  rule: VisibilityRule;
  selected: string | null;
  /**
   * What the RENDERER hands over on this frame. Left out, the walk takes
   * the settled value of the rule — which is exactly what the panel hands
   * over — so a row without it is the state as the two readers agree on
   * it, and a row with it is the frame where they do not.
   */
  brightness?: number;
  shown: number;
  hidden: Partial<Record<Shortfall, number>>;
  /** How many of hidden.focus the filters would give back (D15b). */
  released: number;
}

/**
 * Every combination of the two category switches with every form of focus —
 * at the settled brightness, and at the brightnesses only the renderer ever
 * passes. A state that is not here is a state nobody has thought about,
 * which is how all ten defects of this family were born; adding one is
 * adding a row.
 *
 * What this table does NOT reach: whose ARC is on the globe. That is not a
 * fact about this walk, so no row here could be wrong about it — and it is
 * enumerated where it belongs, in tests/unit/state/sceneView.test.ts
 * ('arcSubject — whose route the globe is drawing'), because the same
 * failure reached the screen through that door too: a line naming a route
 * the globe had stopped drawing. Said out loud here so the next reader does
 * not take this table for the whole screen.
 */
const TABLE: Row[] = [
  { name: 'nothing touched', rule: rule(true, true, null), selected: null,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  { name: 'greys off', rule: rule(true, false, null), selected: null,
    shown: 1, hidden: { filtered: 1, noPosition: 2 }, released: 0 },
  { name: 'completes off', rule: rule(false, true, null), selected: null,
    shown: 1, hidden: { filtered: 1, noPosition: 2 }, released: 0 },
  { name: 'both filters off', rule: rule(false, false, null), selected: null,
    shown: 0, hidden: { filtered: 2, noPosition: 2 }, released: 0 },
  { name: 'focus on a complete', rule: rule(true, true, 'cc'), selected: 'cc',
    shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  { name: 'focus on a grey', rule: rule(true, true, 'pp'), selected: 'pp',
    shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  { name: 'focus on a grey the filter had switched off', rule: rule(true, false, 'pp'),
    selected: 'pp', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 1 },
  // The row that was a live defect before D15: the old panel computed its
  // count as (showComplete ? complete : 0) + (showPartial ? partial : 0),
  // which is 0 here — so it wrote "No aircraft shown — both filters are
  // off" over a globe that is drawing one.
  //
  // It is also the row where the PROMISE was false: `released` is 0, so
  // "Esc shows them again" was offering a sky Esc could not give — ending
  // the focus leaves the filters exactly as they were, and they are both
  // off (D15b).
  { name: 'both filters off AND one flight in focus', rule: rule(false, false, 'cc'),
    selected: 'cc', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 0 },
  // ...and the same promise is false without the globe going empty at all:
  // leaving this focus gives back nobody (the greys are switched off) while
  // CC, deselected, stays on screen because completes are on. "Esc empties
  // the globe" would be as wrong as "Esc shows them again"; only the
  // measured number is right in both.
  { name: 'focus on a complete, greys already off', rule: rule(true, false, 'cc'),
    selected: 'cc', shown: 1, hidden: { focus: 1, noPosition: 2 }, released: 0 },

  // The BORDER rows: here the renderer passes a live brightness that the
  // panel never passes. The arithmetic above was proved sound and the
  // invariant was broken here anyway, so these are rows and not an
  // afterthought.
  { name: 'the frame a focus starts, before the fade has moved',
    rule: rule(true, true, 'cc'), selected: 'cc', brightness: 1,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  { name: 'halfway into the fade — the one divergence D15 admits',
    rule: rule(true, true, 'cc'), selected: 'cc', brightness: 0.5,
    shown: 2, hidden: { noPosition: 2 }, released: 0 },
  // The frames after a focus ENDS. rule.focusedIcao is already null, so
  // every placeable record is counted as shown — and the fade used to hand
  // the renderer ~0 here and draw none of them: the globe showing LESS
  // than the panel declared, in the one direction the invariant forbids.
  // createFocusFade now returns 1 whenever focusedIcao is null, and 1 is
  // the only brightness this state can be asked about.
  { name: 'the frames after a focus has ended', rule: rule(true, true, null),
    selected: null, brightness: 1, shown: 2, hidden: { noPosition: 2 }, released: 0 },
];

describe('describeVisibleFleet — the invariant, state by state', () => {
  it.each(TABLE)('$name', (row) => {
    const drawn: Array<{ icao: string; target: DrawTarget; slot: number }> = [];
    const view = describeVisibleFleet(
      FLEET,
      row.rule,
      row.selected,
      (a, target, slot) => drawn.push({ icao: a.icao24, target, slot }),
      row.brightness
    );

    // (a) the number the panel prints IS the number the renderer drew.
    // Not "agrees with": the same call produced both.
    expect(view.shown).toBe(row.shown);
    expect(drawn).toHaveLength(view.shown);

    // Nothing falls off the books: every record is either a dot or a named
    // absence. This identity is what makes a silent `continue` impossible.
    const named =
      view.hidden.filtered + view.hidden.focus + view.hidden.noPosition + view.hidden.rendererFull;
    expect(view.shown + named).toBe(view.total);
    expect(view.total).toBe(FLEET.length);

    // ...and it is the RIGHT cause, not merely some cause. A count that is
    // correct under the wrong heading is half of defect (b).
    expect(view.hidden).toEqual({
      filtered: 0, focus: 0, noPosition: 0, rendererFull: 0, ...row.hidden,
    });

    // There is always something to say when anything is missing, and never
    // a reason invented when nothing is.
    expect(view.reason === null).toBe(view.shown === view.total);

    // ...and the PROMISE is measured too: how many of the focus-hidden the
    // filters would let through once the focus ended. The note offers Esc
    // on the strength of this number, and on the rows where it is 0 the
    // old unconditional offer was a sentence the next frame refuted.
    expect(view.releasedByLeavingFocus).toBe(row.released);
  });

  it('declares the aircraft the renderer had no room for, instead of dropping them', () => {
    // The 24 000 ceiling discards by a bare `continue` — no log, no flag —
    // while the HUD keeps reporting aircraft.size; the header of
    // tests/unit/globe/renderCapacity.test.ts has named that failure since
    // Piano 1. Under D15 the ceiling cannot be silent: it has a counter.
    const view = describeVisibleFleet(
      [CC, PP, ac('p2'), ac('p3')], SHOW_ALL, null, undefined, undefined,
      { perCategory: 1, selected: 8 }
    );
    expect(view.shown).toBe(2);
    expect(view.hidden.rendererFull).toBe(2);
    expect(view.reason).toBe('rendererFull');
  });

  it('keeps the dimming crowd in the count while the fade is still running', () => {
    // The one divergence D15 allows. Mid-fade the globe shows MORE than the
    // panel declares, never less, and converges within FOCUS_FADE_MS: a
    // number the eye catches up with, not one it is misled by.
    const mid = describeVisibleFleet(FLEET, rule(true, true, 'cc'), 'cc', undefined, 0.5);
    const settled = describeVisibleFleet(FLEET, rule(true, true, 'cc'), 'cc', undefined, 0);
    expect(mid.shown).toBe(2);
    expect(mid.hidden.focus).toBe(0);
    expect(settled.shown).toBe(1);
    expect(settled.hidden.focus).toBe(1);
    expect(mid.shown).toBeGreaterThanOrEqual(settled.shown);
  });

  it('counts only the aircraft a filter would NOT catch on the way back', () => {
    // Half and half: ending this focus gives the completes back and leaves
    // the greys hidden, so "Esc shows them again" is false, "Esc shows 1 of
    // them again" is true, and only a measurement can tell them apart. The
    // panel prints the number; it does not promise the comfortable case.
    const fleet = [CC, ac('c2', { complete: true }), PP];
    const view = describeVisibleFleet(fleet, rule(true, false, 'cc'), 'cc');
    expect(view.hidden.focus).toBe(2);
    expect(view.releasedByLeavingFocus).toBe(1);
  });

  it('says nothing at all when the whole fleet is on the globe', () => {
    const view = describeVisibleFleet([CC, PP], SHOW_ALL, null);
    expect(view.shown).toBe(2);
    expect(view.reason).toBeNull();
    expect(view.hidden).toEqual({ filtered: 0, focus: 0, noPosition: 0, rendererFull: 0 });
  });
});
```

- [ ] **Step 13: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/visibleFleet.test.ts
```

Expected: `describeVisibleFleet is not a function` — il modulo esiste (Step 11) ma non esporta ancora niente di tutto questo. Zero test passati.

- [ ] **Step 14: Aggiungere il meccanismo a `src/globe/visibility.ts`**

Aggiungere in fondo al file, **sotto** `SHOW_ALL`:

```ts
/** Why a record in the fleet is not a dot on the globe. */
export type Shortfall = 'filtered' | 'focus' | 'noPosition' | 'rendererFull';

/** Which point set a drawn aircraft belongs to. */
export type DrawTarget = 'selected' | 'complete' | 'partial';

export interface VisibleFleet {
  /** Records in the fleet — what the HUD has counted since v1. */
  total: number;
  /** Dots on the globe. The panel prints THIS, never a derived number. */
  shown: number;
  /** total - shown, split by cause. The four always account for all of it. */
  hidden: Record<Shortfall, number>;
  /** The cause behind the largest share of the hidden, or null when none is. */
  reason: Shortfall | null;
  /**
   * How many of `hidden.focus` the filters would let through once the
   * focus ended — the MEASUREMENT behind the promise the panel is about to
   * make, not a guess at it. "Esc shows them again" was printed
   * unconditionally, and with both switches off it was false: the focus
   * was the only thing putting an aircraft on the globe, so Esc gave back
   * nobody and emptied the sky instead. A promise is a claim about the
   * next frame, and D15b forbids a claim nobody measured as firmly as it
   * forbids an unmeasured cause.
   *
   * NOT a fifth member of `hidden`: those records are already counted
   * under `focus`, and a fifth key would break the identity above.
   */
  releasedByLeavingFocus: number;
}

/**
 * MAX_PAYLOAD_AIRCRAFT in server/index.ts is 24 000, so neither category can
 * exceed it today; the cap is here to be DECLARED rather than hit silently
 * the day the payload grows, which is how v1's 18 000 ceiling emptied the
 * globe without a word.
 */
export const RENDER_CAPS = { perCategory: 24000, selected: 8 } as const;

/** Below this an additive point contributes nothing a screen can show. */
const INVISIBLE = 0.004;

const SHORTFALL_ORDER: readonly Shortfall[] = [
  'filtered', 'focus', 'noPosition', 'rendererFull',
];

/**
 * How many aircraft the globe is drawing, and the name of every reason the
 * rest are not. One pass, one answer, two readers (D15).
 *
 * The renderer passes `onDraw` and this walk IS its draw loop: it no longer
 * decides for itself who gets a point, it writes where this function says.
 * The panel calls the same function without `onDraw` and prints `shown` and
 * `hidden`. The two figures cannot disagree because they are one figure,
 * produced by one `for`. Three rounds of review found ten defects where a
 * screen showed less than it claimed; every one of them was two pieces of
 * code answering the same question apart.
 *
 * This is NOT a second predicate beside isAircraftVisible: it CALLS that
 * one, and its whole contribution is naming which clause said no. A rule
 * invented here would be the drift the module exists to prevent.
 *
 * `shown + hidden.filtered + hidden.focus + hidden.noPosition +
 * hidden.rendererFull === total` holds by construction — every record
 * increments exactly one counter and then leaves the iteration — so a
 * future `continue` cannot be added silently: it would break the identity
 * the table test asserts on every state.
 *
 * @param othersBrightness the live fade of Task 4 for the renderer. The
 *   panel passes nothing and gets the SETTLED value of the rule in hand —
 *   0 under a focus, 1 without one — because it has no render loop to read
 *   a fade from. That sentinel is DERIVED rather than fixed at 0 on
 *   purpose: a literal 0 meant both "settled" and "invisible", and the
 *   collision of those two meanings is where the exit fade hid. Entering
 *   focus the globe shows MORE than the panel declares for ~300 ms and
 *   converges within FOCUS_FADE_MS; LEAVING it there is no gap at all,
 *   because createFocusFade returns 1 the instant focusedIcao is null
 *   (Task 4, Step 3). A brightness below INVISIBLE therefore reaches this
 *   function only while a focus is in force, which is the contract the
 *   branch below depends on.
 */
export function describeVisibleFleet(
  aircraft: Iterable<Aircraft>,
  rule: VisibilityRule,
  selectedIcao: string | null,
  onDraw?: (ac: Aircraft, target: DrawTarget, slot: number) => void,
  // The settled state of the rule in hand, which is what the panel means
  // when it passes nothing: the crowd out under a focus, lit without one.
  othersBrightness = rule.focusedIcao !== null ? 0 : 1,
  caps: { perCategory: number; selected: number } = RENDER_CAPS
): VisibleFleet {
  const hidden: Record<Shortfall, number> = {
    filtered: 0, focus: 0, noPosition: 0, rendererFull: 0,
  };
  let releasedByLeavingFocus = 0;
  // Hoisted: the loop runs over up to 24 000 records at 60fps, and a fresh
  // object per aircraft would be 1,4 million allocations a second.
  const categoryRule: VisibilityRule = { ...rule, focusedIcao: null };
  let total = 0;
  let shown = 0;
  let nSelected = 0;
  let nComplete = 0;
  let nPartial = 0;

  for (const ac of aircraft) {
    total += 1;

    // First, before anything about selection: a record with no coordinates
    // is not drawable by anybody. This is the count D14 once deferred for
    // want of a measurement — and here the measurement is free.
    if (ac.latitude === null || ac.longitude === null) {
      hidden.noPosition += 1;
      continue;
    }

    // The subject of the view is drawn whatever the filters say: an act
    // aimed at one aircraft is more specific than a rule about a category
    // (D7). It is counted in `shown` for the same reason — it is on screen.
    if (ac.icao24 === selectedIcao) {
      if (nSelected >= caps.selected) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'selected', nSelected);
      nSelected += 1;
      shown += 1;
      continue;
    }

    // Under focus everyone else leaves by fading, so they are still on
    // screen — and still counted — until the fade has actually finished.
    if (rule.focusedIcao !== null && othersBrightness <= INVISIBLE) {
      hidden.focus += 1;
      // What ending the focus would actually hand back, measured in the
      // same pass and for the same reason as every other number here: the
      // panel offers Esc as the way to these aircraft, and an offer is a
      // claim about the next frame. With both switches off this stays 0,
      // and the note says so instead of promising a sky Esc cannot give.
      if (isAircraftVisible(ac, categoryRule)) releasedByLeavingFocus += 1;
      continue;
    }

    // The filter keeps applying mid-fade: an aircraft the user had already
    // switched off must not reappear because a focus started.
    if (!isAircraftVisible(ac, categoryRule)) {
      hidden.filtered += 1;
      continue;
    }

    if (ac.complete) {
      if (nComplete >= caps.perCategory) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'complete', nComplete);
      nComplete += 1;
    } else {
      if (nPartial >= caps.perCategory) {
        hidden.rendererFull += 1;
        continue;
      }
      onDraw?.(ac, 'partial', nPartial);
      nPartial += 1;
    }
    shown += 1;
  }

  let reason: Shortfall | null = null;
  for (const k of SHORTFALL_ORDER) {
    if (hidden[k] > 0 && (reason === null || hidden[k] > hidden[reason])) reason = k;
  }
  return { total, shown, hidden, reason, releasedByLeavingFocus };
}
```

- [ ] **Step 15: Verificare il verde e l'intera suite**

```bash
npx vitest run tests/unit/globe/visibility.test.ts tests/unit/globe/visibleFleet.test.ts
npm run build:all && npm test -- --run
```

Expected: 10 passed in `visibility.test.ts` (6 su `isAircraftVisible`, 4 su `isFocusable`), **16 passed** in `visibleFleet.test.ts` (12 righe di tabella — 9 a regime e 3 sul bordo della dissolvenza — più tetto del renderer, divergenza ammessa, rientro parziale dal focus e flotta intera); build pulita su entrambi i programmi; **318 passed (35 files)**.

- [ ] **Step 16: Commit**

```bash
git add src/data/completeness.ts src/state/filterStore.ts src/globe/visibility.ts \
        tests/unit/data/completeness.test.ts tests/unit/state/filterStore.test.ts \
        tests/unit/globe/visibility.test.ts tests/unit/globe/visibleFleet.test.ts
git commit -m "feat(state): one rule for who is visible, and one answer for how many"
```

---

### Task 2: Il colore dichiara la completezza, e il picking obbedisce alla stessa regola

Oggi `src/globe/aircraft.ts:15` dipinge **ogni** aereo di `#ffe6c4`: il flag `complete` arriva dal server e il globo lo ignora. Finché resta così, la checkbox dell'utente spegnerebbe punti indistinguibili da quelli che restano.

**Files:**
- Modify: `src/globe/aircraft.ts` — terzo point set, colore dei parziali, ordine di disegno, `VisibilityRule`
- Modify: `src/globe/trails.ts` — le scie seguono la stessa regola
- Modify: `src/globe/raycaster.ts` — un aereo invisibile non si clicca
- Modify: `src/globe/scene.ts` — passa la regola al picking e ai due layer
- Create: `src/state/sceneView.ts` — la lettura imperativa degli store, per il codice che gira fuori da React
- Modify: `tests/unit/globe/renderCapacity.test.ts` — i tre call site della firma cambiata
- Test: `tests/unit/globe/fleetColours.test.ts`, `tests/unit/state/sceneView.test.ts`

**Interfaces:**
- Consumes: `VisibilityRule`, `isAircraftVisible`, `isFocusable`, `SHOW_ALL`, `describeVisibleFleet` dal Task 1
- Produces: `AircraftLayer.update(aircraft, selectedIcao, rule, othersBrightness): VisibleFleet`; `TrailsLayer.update(aircraft, selectedIcao, rule)`; `findAircraftAtPointer(ndc, aircraft, camera, canvas, rule)`; `PARTIAL_COLOR` e `COMPLETE_COLOR` esportati per i test e per la CSS del pannello; `readVisibilityRule(): VisibilityRule` in `src/state/sceneView.ts`

**Il quarto argomento, `othersBrightness`, serve al Task 4.** Lo introduco qui per non toccare due volte la stessa firma: vale `1` finché il Task 4 non lo anima, e il predicato puro resta l'autorità su *chi* si vede. La dissolvenza è la coda visiva dell'animazione, non una seconda regola — e infatti il picking non la consulta.

**`readVisibilityRule()` concede il focus solo a chi si può disegnare (D13).** Il ciclo di `describeVisibleFleet` che `update` ora consuma si apre con il controllo delle coordinate, **prima** del ramo del selezionato: un aereo senza coordinate non viene disegnato nemmeno quando è lui il soggetto — e da D15 quel record non sparisce in silenzio, finisce in `hidden.noPosition`. Dichiarare focus su quell'icao nasconderebbe tutti gli altri per non disegnare nessuno — globo vuoto, nessuna spiegazione. E `latitude` può essere `null` per costruzione (`src/data/sources/adsbLol.ts:30-31`, vincolato dal test «maps every missing optional field to null»), mentre `src/ui/AircraftList.tsx:20` elenca ogni aereo che abbia un callsign, posizione o no: basta un click sulla lista. Quindi il focus passa da `isFocusable()`, esattamente come passa dall'appartenenza alla flotta, e la selezione sopravvive perché il pannello la trasformi in una parola (Task 4).

**Tre point set invece di due, e l'ordine conta.** La spec §4.2 chiede «selezionato sopra tutto, poi i completi, poi gli incompleti»: con `AdditiveBlending` e 5 900 punti, un completo sepolto sotto il rumore grigio è informazione persa. I figli del gruppo restano nell'ordine `[parziali, completi, selezionato]` **apposta**: `tests/unit/globe/renderCapacity.test.ts:44` legge `layer.group.children[0]` e costruisce una flotta di `makeAircraftRaw()`, che ha `complete: false`, quindi continua a misurare esattamente il set che intende misurare. Costo in memoria del set in più: 24 000 × 7 float × 4 B ≈ 0,67 MB, che porta il totale dei punti a ~1,34 MB. Trascurabile, e misurato contro il tetto del server (`MAX_PAYLOAD_AIRCRAFT = 24 000`), non contro uno snapshot.

- [ ] **Step 1: Creare `tests/unit/globe/fleetColours.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { Object3D, Points } from 'three';
import { PerspectiveCamera, Vector2 } from 'three';
import { createAircraftLayer, COMPLETE_COLOR, PARTIAL_COLOR } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

function geometryOf(obj: Object3D | undefined): Points['geometry'] {
  if (!obj) throw new Error('layer has no drawable child');
  return (obj as Points).geometry;
}

/** children: [0] partial, [1] complete, [2] selected — the draw hierarchy. */
const PARTIAL = 0;
const COMPLETE = 1;
const SELECTED = 2;

describe('aircraft layer — the colour declares the data', () => {
  it('paints complete and partial aircraft differently', () => {
    // The server has been sending `complete` since Piano 1 and the globe
    // painted every aircraft #ffe6c4 regardless. A filter over two colours
    // nobody can tell apart is not a filter.
    expect(COMPLETE_COLOR).not.toEqual(PARTIAL_COLOR);
  });

  it('puts the greys in the bottom layer and the completes above them', () => {
    const layer = createAircraftLayer();
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      SHOW_ALL,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });

  it('draws the selected aircraft in its own set, above both', () => {
    const layer = createAircraftLayer();
    layer.update([ac({ icao24: 'a1', complete: true })], 'a1', SHOW_ALL, 1);
    expect(geometryOf(layer.group.children[SELECTED]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
  });

  it('draws nothing grey once the partial box is off', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      rule,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(0);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });

  it('draws nothing warm once the complete box is off', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: false, showPartial: true, focusedIcao: null };
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      rule,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
  });

  it('under focus draws the focused aircraft and nobody else', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    layer.update(
      [ac({ icao24: 'a1', complete: true }), ac({ icao24: 'a2', complete: true })],
      'a1',
      rule,
      0
    );
    expect(geometryOf(layer.group.children[SELECTED]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(0);
  });

  it('keeps drawing the others, dimmed, while the fade is still running', () => {
    // Mid-transition the others are still on screen at reduced brightness.
    // Skipping them the moment focus starts would make them vanish in one
    // frame — outside the 200-400ms editorial window of DESIGN.md.
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    layer.update(
      [ac({ icao24: 'a1', complete: true }), ac({ icao24: 'a2', complete: true })],
      'a1',
      rule,
      0.5
    );
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });
});

describe('trails layer — a hidden aircraft leaves no trail', () => {
  it('drops the trails of the aircraft the filter hides', () => {
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    const layer = createTrailsLayer();
    const grey = ac({
      icao24: 'a1',
      complete: false,
      trail: [{ lat: 1, lon: 1, t: 1 }, { lat: 2, lon: 2, t: 2 }],
    });
    layer.update([grey], null, rule);
    expect(geometryOf(layer.group.children[0]).drawRange.count).toBe(0);
  });

  it('keeps the trail of an aircraft the rule shows', () => {
    const layer = createTrailsLayer();
    const warm = ac({
      icao24: 'a1',
      complete: true,
      trail: [{ lat: 1, lon: 1, t: 1 }, { lat: 2, lon: 2, t: 2 }],
    });
    layer.update([warm], null, SHOW_ALL);
    expect(geometryOf(layer.group.children[0]).drawRange.count).toBeGreaterThan(0);
  });
});

describe('picking — an invisible aircraft does not answer a click', () => {
  function camera(): PerspectiveCamera {
    const c = new PerspectiveCamera(38, 800 / 600, 0.1, 100);
    c.position.set(0, 0, 4.6);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  }
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const centre = new Vector2(0, 0); // NDC centre, i.e. lat 0 / lon 0 on screen

  it('picks the aircraft under the pointer when the rule shows it', () => {
    const fleet = [ac({ icao24: 'a1', latitude: 0, longitude: 0, complete: true })];
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, SHOW_ALL)).toBe('a1');
  });

  it('refuses to pick one the filter has hidden', () => {
    // Without this the user switches the greys off, clicks the empty space
    // where one used to be, and a card opens for an aircraft that is not
    // on the screen.
    const fleet = [ac({ icao24: 'a1', latitude: 0, longitude: 0, complete: false })];
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, rule)).toBeNull();
  });

  it('under focus lets a click on another aircraft fall through to the exit', () => {
    // The others are invisible, so they are not pickable, so the click
    // misses everything and scene.ts calls select(null) — which IS the
    // "click on empty space" exit of spec §6.2, obtained for free.
    const fleet = [
      ac({ icao24: 'a1', latitude: 30, longitude: 30, complete: true }),
      ac({ icao24: 'a2', latitude: 0, longitude: 0, complete: true }),
    ];
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, rule)).toBeNull();
  });
});

describe('the layer reports exactly what it put in the buffers (D15)', () => {
  it('matches its VisibleFleet to the vertices it actually drew, in every state', () => {
    // The table in tests/unit/globe/visibleFleet.test.ts proves the walk is
    // self-consistent. THIS proves the walk is what the GPU receives: the
    // number the panel will print, compared against the three draw ranges
    // the renderer committed. If a future edit teaches this file to skip an
    // aircraft on its own again, the two stop matching here.
    const fleet = [
      ac({ icao24: 'cc', complete: true }),
      ac({ icao24: 'pp', complete: false }),
      ac({ icao24: 'cn', complete: true, latitude: null }),
      ac({ icao24: 'pn', complete: false, longitude: null }),
    ];
    const states: Array<[VisibilityRule, string | null]> = [
      [{ showComplete: true, showPartial: true, focusedIcao: null }, null],
      [{ showComplete: true, showPartial: false, focusedIcao: null }, null],
      [{ showComplete: false, showPartial: true, focusedIcao: null }, null],
      [{ showComplete: false, showPartial: false, focusedIcao: null }, null],
      [{ showComplete: true, showPartial: true, focusedIcao: 'cc' }, 'cc'],
      [{ showComplete: false, showPartial: false, focusedIcao: 'cc' }, 'cc'],
      [{ showComplete: true, showPartial: false, focusedIcao: 'pp' }, 'pp'],
    ];

    for (const [rule, selected] of states) {
      const layer = createAircraftLayer();
      // The SETTLED brightness of each state — 0 under a focus, 1 without
      // one — which is exactly what the panel passes when it passes
      // nothing. A flat 0 here would be a frame the fade never produces:
      // with no focus in force the crowd is never dark, because the return
      // from a focus is not animated (D15, Task 4 Step 3).
      const view = layer.update(fleet, selected, rule, rule.focusedIcao !== null ? 0 : 1);
      const drawn =
        geometryOf(layer.group.children[PARTIAL]).drawRange.count +
        geometryOf(layer.group.children[COMPLETE]).drawRange.count +
        geometryOf(layer.group.children[SELECTED]).drawRange.count;
      // Compared as an object so a failure names the state that broke.
      expect({ rule, drawn }).toEqual({ rule, drawn: view.shown });
    }
  });
});
```

> Aggiungere `import type { VisibilityRule } from '@/globe/visibility';` agli import di questo file.

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/fleetColours.test.ts
```

Expected: fallisce all'import — `COMPLETE_COLOR`/`PARTIAL_COLOR` non esistono e `update` non accetta quattro argomenti. Zero test passati.

- [ ] **Step 3: Sostituire il blocco dei colori in `src/globe/aircraft.ts`**

Sostituire le due righe

```ts
const CRUISING_COLOR: [number, number, number] = [1.0, 0.902, 0.769]; // #ffe6c4
const SELECTED_COLOR: [number, number, number] = [0.16, 0.59, 1.0]; // sky-leaning Action Blue
```

con

```ts
/** #ffe6c4, the warm white of PRODUCT.md §3. Unchanged since v1. */
export const COMPLETE_COLOR: [number, number, number] = [1.0, 0.902, 0.769];
/**
 * #8a93a0, cold and desaturated so it recedes.
 *
 * Until now every aircraft was painted COMPLETE_COLOR, including the 96.5%
 * the server marks `complete: false`: the flag crossed the whole chain and
 * died unread here. The colour predicts the interaction — only a complete
 * aircraft can put D and A on the globe — so a user learns the rule at the
 * first click.
 */
export const PARTIAL_COLOR: [number, number, number] = [0.541, 0.576, 0.627];
const SELECTED_COLOR: [number, number, number] = [0.16, 0.59, 1.0]; // sky-leaning Action Blue
```

- [ ] **Step 4: Sostituire la dichiarazione di `MAX_AIRCRAFT` in `src/globe/aircraft.ts`**

Sostituire la riga `const MAX_AIRCRAFT = 24000;` (riga 26, sotto il commento sul tetto del server, che resta) con:

```ts
const MAX_AIRCRAFT = 24000;
// Two full-size sets, not one: either category can be the whole fleet. Today
// it is the partial one — 96.5% of the aircraft, measured 2026-11-21 — but a
// route cache that keeps filling at ~920 flights/hour will move that number,
// and a set sized on today's ratio would start dropping aircraft silently
// exactly as the 18 000 ceiling of v1 did. 24 000 × 7 floats × 4 B ≈ 0,67 MB
// each.
```

- [ ] **Step 5: Sostituire il corpo di `createAircraftLayer` in `src/globe/aircraft.ts`**

Sostituire tutto dalla riga `export interface AircraftLayer {` fino alla fine del file con:

```ts
export interface AircraftLayer {
  group: Group;
  /**
   * @param rule who is visible at all — the single authority, shared with
   *   the trails and the raycaster.
   * @param othersBrightness the fade applied to every aircraft that is not
   *   the selected one. 1 outside focus, 0 once the fade into focus has
   *   finished, and 1 again on the FIRST frame after the focus ends — the
   *   return is not animated, because a fade-in hands this loop ~0 while
   *   the panel is already declaring a full sky (D15, Task 4 Step 3). It is
   *   the visual TAIL of the animation, never a second visibility rule: the
   *   picker — the authority on who can be clicked — does not consult it.
   * @returns what this call actually drew, and the named reason for every
   *   record it did not. Returned rather than recomputed by the caller
   *   because it is the SAME walk (D15); the panel asks the same function
   *   the same question and therefore gets the same number.
   */
  update: (
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule,
    othersBrightness: number
  ) => VisibleFleet;
}

export function createAircraftLayer(): AircraftLayer {
  const group = new Group();

  // Draw order IS the hierarchy (spec §4.2): partial at the bottom, complete
  // above them, selected above everything. With additive blending and
  // thousands of points, a complete aircraft buried under grey noise is
  // information lost at exactly the density where it matters most.
  const partialSet = createPointSet(MAX_AIRCRAFT);
  const partialMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const partialPts = new Points(partialSet.geom, partialMat);
  partialPts.renderOrder = 2;
  partialPts.frustumCulled = false;
  group.add(partialPts);

  const completeSet = createPointSet(MAX_AIRCRAFT);
  const completeMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const completePts = new Points(completeSet.geom, completeMat);
  completePts.renderOrder = 3;
  completePts.frustumCulled = false;
  group.add(completePts);

  const selectedSet = createPointSet(8); // at most a handful selected (v1 = exactly 1)
  const selectedMat = createPointMaterial({
    size: 56,
    coreLum: 2.0,
    haloFalloff: 1.35,
    haloWidth: 6.5,
  });
  const selectedPts = new Points(selectedSet.geom, selectedMat);
  selectedPts.renderOrder = 4;
  selectedPts.frustumCulled = false;
  group.add(selectedPts);

  function writePoint(
    set: PointSet,
    i: number,
    ac: Aircraft,
    colour: [number, number, number],
    brightness: number
  ): void {
    const altFt = ac.baroAltitudeFt ?? 38000;
    writeLatLonAlt(set.positions, i * 3, ac.latitude!, ac.longitude!, altFt);
    set.colors[i * 3] = colour[0] * brightness;
    set.colors[i * 3 + 1] = colour[1] * brightness;
    set.colors[i * 3 + 2] = colour[2] * brightness;
    set.headings[i] = (ac.headingDeg ?? 0) * DEG;
  }

  function commit(set: PointSet, count: number): void {
    set.geom.setDrawRange(0, count);
    set.positionAttr.needsUpdate = true;
    set.colorAttr.needsUpdate = true;
    set.headingAttr.needsUpdate = true;
  }

  function update(
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule,
    othersBrightness: number
  ): VisibleFleet {
    let partialCount = 0;
    let completeCount = 0;
    let selectedCount = 0;

    // This loop no longer decides WHO is drawn — it only writes where the
    // decision says. Every rule about visibility, the fade and the ceilings
    // lives in describeVisibleFleet, which the panel calls with the same
    // arguments minus this callback. That is the whole of D15: the number
    // on screen and the number in the panel are produced by one walk, so
    // they cannot be two different answers to the same question.
    const view = describeVisibleFleet(
      aircraft,
      rule,
      selectedIcao,
      (ac, target, slot) => {
        if (target === 'selected') {
          writePoint(selectedSet, slot, ac, SELECTED_COLOR, 1);
          selectedCount = slot + 1;
        } else if (target === 'complete') {
          writePoint(completeSet, slot, ac, COMPLETE_COLOR, othersBrightness);
          completeCount = slot + 1;
        } else {
          writePoint(partialSet, slot, ac, PARTIAL_COLOR, othersBrightness);
          partialCount = slot + 1;
        }
      },
      othersBrightness,
      { perCategory: MAX_AIRCRAFT, selected: selectedSet.headings.length }
    );

    commit(partialSet, partialCount);
    commit(completeSet, completeCount);
    commit(selectedSet, selectedCount);
    return view;
  }

  return { group, update };
}
```

Aggiungere in cima al file, dopo `import { GLOBE_RADIUS } from './geoHelpers';`:

```ts
import { describeVisibleFleet } from './visibility';
import type { VisibilityRule, VisibleFleet } from './visibility';
```

> `isAircraftVisible` non viene più importato qui: lo chiama `describeVisibleFleet` per conto di questo file. Due import della stessa regola sarebbero due posti da cui chiamarla, cioè l'inizio della divergenza.

- [ ] **Step 6: Far seguire la stessa regola alle scie in `src/globe/trails.ts`**

Aggiungere in cima, dopo `import { GLOBE_RADIUS } from './geoHelpers';`:

```ts
import { isAircraftVisible } from './visibility';
import type { VisibilityRule } from './visibility';
```

Sostituire la dichiarazione dell'interfaccia

```ts
export interface TrailsLayer {
  group: Group;
  update: (aircraft: Iterable<Aircraft>, selectedIcao: string | null) => void;
}
```

con

```ts
export interface TrailsLayer {
  group: Group;
  /** Same `rule` the point layer obeys: a hidden aircraft leaves no trail. */
  update: (
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule
  ) => void;
}
```

Sostituire la riga di firma

```ts
  function update(aircraft: Iterable<Aircraft>, selectedIcao: string | null): void {
```

con

```ts
  function update(
    aircraft: Iterable<Aircraft>,
    selectedIcao: string | null,
    rule: VisibilityRule
  ): void {
```

e la riga

```ts
      if (ac.latitude === null || ac.longitude === null) continue;
```

con

```ts
      if (ac.latitude === null || ac.longitude === null) continue;
      // A trail without its aircraft is a scratch on the globe that nothing
      // explains. The selected aircraft keeps its trail even in focus,
      // because the rule says it is the one thing visible.
      if (!isAircraftVisible(ac, rule)) continue;
```

- [ ] **Step 7: Far obbedire il picking in `src/globe/raycaster.ts`**

Aggiungere l'import dopo `import { latLonAltToVec3 } from './geoHelpers';`:

```ts
import { isAircraftVisible } from './visibility';
import type { VisibilityRule } from './visibility';
```

Sostituire la firma

```ts
export function findAircraftAtPointer(
  pointerNDC: Vector2,
  aircraft: Iterable<Aircraft>,
  camera: Camera,
  canvas: HTMLCanvasElement
): string | null {
```

con

```ts
export function findAircraftAtPointer(
  pointerNDC: Vector2,
  aircraft: Iterable<Aircraft>,
  camera: Camera,
  canvas: HTMLCanvasElement,
  rule: VisibilityRule
): string | null {
```

e la riga

```ts
    if (ac.latitude === null || ac.longitude === null) continue;
```

con

```ts
    if (ac.latitude === null || ac.longitude === null) continue;
    // An aircraft nobody can see must not answer a click. Under focus that
    // leaves only the focused flight pickable, so a click anywhere else
    // falls through to select(null) — which is the Esc-or-empty-space exit
    // the spec §6.2 describes, obtained for free.
    if (!isAircraftVisible(ac, rule)) continue;
```

- [ ] **Step 8: Aggiornare i tre call site di `tests/unit/globe/renderCapacity.test.ts`**

Aggiungere l'import in cima, dopo `import { createTrailsLayer } from '@/globe/trails';`:

```ts
import { SHOW_ALL } from '@/globe/visibility';
```

Sostituire, nell'ordine in cui compaiono:

```ts
    layer.update(fleet(20_000), null);
```
→
```ts
    layer.update(fleet(20_000), null, SHOW_ALL, 1);
```

```ts
    layer.update(fleet(24_000), null);
```
→
```ts
    layer.update(fleet(24_000), null, SHOW_ALL, 1);
```

```ts
    layer.update(fleet(24_000, 5), null);
```
→
```ts
    layer.update(fleet(24_000, 5), null, SHOW_ALL);
```

(L'ultimo è il layer delle scie, che prende tre argomenti e non quattro.)

- [ ] **Step 9: Collegare la scena**

In `src/globe/scene.ts`, aggiungere agli import, dopo `import { useA11yStore } from '@/state/a11yStore';`:

```ts
import { readVisibilityRule } from '@/state/sceneView';
```

> `src/state/sceneView.ts` non esiste ancora: lo creano gli Step 10-11, qui sotto, perché serve sia alla scena sia al Task 4.

Sostituire, nel gestore del click,

```ts
    const icao = findAircraftAtPointer(
      ndc,
      useAircraftStore.getState().aircraft.values(),
      camera,
      canvas
    );
```

con

```ts
    const icao = findAircraftAtPointer(
      ndc,
      useAircraftStore.getState().aircraft.values(),
      camera,
      canvas,
      readVisibilityRule()
    );
```

e, nel render loop,

```ts
    const tAC = performance.now();
    aircraftLayer.update(aircraftMap.values(), selectedIcao);
    const tTr = performance.now();
    trailsLayer.update(aircraftMap.values(), selectedIcao);
    const tLd = performance.now();
```

con

```ts
    const rule = readVisibilityRule();
    const tAC = performance.now();
    aircraftLayer.update(aircraftMap.values(), selectedIcao, rule, 1);
    const tTr = performance.now();
    trailsLayer.update(aircraftMap.values(), selectedIcao, rule);
    const tLd = performance.now();
```

> Il quarto argomento è `1` fisso: il Task 4 lo sostituisce con la dissolvenza. Scriverlo già qui evita di toccare due volte la stessa riga.

- [ ] **Step 10: Creare `tests/unit/state/sceneView.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readVisibilityRule } from '@/state/sceneView';
import { useAircraftStore } from '@/state/aircraftStore';
import { useFilterStore } from '@/state/filterStore';
import { useSelectionStore } from '@/state/selectionStore';
import { isAircraftVisible } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao }), trail: [], ...over };
}

describe('readVisibilityRule', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: new Map([
        ['a1', ac('a1')],
        ['a2', ac('a2')],
      ]),
    });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    useSelectionStore.setState({ selectedIcao: null });
  });

  it('reports no focus when nothing is selected', () => {
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('focuses the selected aircraft while the fleet still carries it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBe('a1');
  });

  it('drops the focus when the payload stops carrying that aircraft', () => {
    // The server prunes the fleet every cycle and updateBatch replaces the
    // Map wholesale, so this is ordinary operation, not a thought
    // experiment. Left alone, isAircraftVisible matches NOBODY and the
    // globe goes completely empty — the v1 failure, reachable by waiting.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map([['a2', ac('a2')]]) });
    const rule = readVisibilityRule();
    expect(rule.focusedIcao).toBeNull();
    expect(isAircraftVisible(ac('a2'), rule)).toBe(true);
  });

  it('keeps the selection itself, so the panel can say what happened', () => {
    // Clearing it here would refill the globe with no word of explanation,
    // which is the same failure read from the other side. D13: the focus
    // ends, the selection stays, SidePanel declares it.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    readVisibilityRule();
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });

  it('refuses focus to an aircraft the fleet carries but cannot PLACE', () => {
    // latitude is null whenever the provider sent no position
    // (src/data/sources/adsbLol.ts:30-31, asserted in
    // tests/unit/data/sources/adsbLol.test.ts), and AircraftList offers
    // every aircraft with a callsign, position or not. The renderer drops
    // such a record before it looks at the selection, so a focus on it
    // would hide the entire fleet to draw NOBODY: an empty globe, with
    // nothing on screen to explain it (D13).
    useAircraftStore.setState({
      aircraft: new Map([
        ['a1', ac('a1', { latitude: null })],
        ['a2', ac('a2')],
      ]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const rule = readVisibilityRule();
    expect(rule.focusedIcao).toBeNull();
    expect(isAircraftVisible(ac('a2'), rule)).toBe(true);
    // ...and the selection survives, so SidePanel can say why the globe
    // did not change when the user chose that flight.
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });

  it('refuses it for a missing longitude too', () => {
    useAircraftStore.setState({
      aircraft: new Map([['a1', ac('a1', { longitude: null })]]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('refuses it when both coordinates are missing', () => {
    useAircraftStore.setState({
      aircraft: new Map([['a1', ac('a1', { latitude: null, longitude: null })]]),
    });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readVisibilityRule().focusedIcao).toBeNull();
  });

  it('passes the two category switches through untouched', () => {
    useFilterStore.setState({ showComplete: false, showPartial: true });
    const rule = readVisibilityRule();
    expect(rule.showComplete).toBe(false);
    expect(rule.showPartial).toBe(true);
  });
});
```

```bash
npx vitest run tests/unit/state/sceneView.test.ts
```

Expected: `Failed to resolve import "@/state/sceneView"`. Zero test passati.

- [ ] **Step 11: Creare `src/state/sceneView.ts`**

```ts
import { useAircraftStore } from './aircraftStore';
import { useFilterStore } from './filterStore';
import { useSelectionStore } from './selectionStore';
import { isFocusable } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';

/**
 * The stores, read imperatively, for the code that runs outside React.
 *
 * scene.ts already talks to the stores this way — `useSelectionStore
 * .getState().select(icao)` from a DOM click handler — because the render
 * loop runs at 60fps and must not re-render anything. Keeping the reads in
 * one module means the pure rule in globe/visibility.ts stays testable
 * without importing a single store.
 *
 * Focus IS selection: there is no fourth state. The click handler already
 * sets selectedIcao and clearing it on empty space is already the exit.
 */
export function readVisibilityRule(): VisibilityRule {
  const f = useFilterStore.getState();
  const selected = useSelectionStore.getState().selectedIcao;
  // Focus is a claim about something that is ON the globe, so it is granted
  // only to an aircraft the fleet still carries AND that we can place.
  //
  // Both halves are ordinary operation, not hypotheses. The server prunes
  // every cycle and updateBatch replaces the Map wholesale, so the focused
  // aircraft can leave the payload between two frames. And latitude or
  // longitude is null whenever the provider sent no position (the adapters
  // write null rather than invent one — src/data/sources/adsbLol.ts:30-31)
  // while AircraftList offers every aircraft that has a callsign, position
  // or not. In either case keeping the icao here would hide the whole fleet
  // and draw nobody — a completely empty globe, which is the v1 failure in
  // a new costume.
  //
  // The SELECTION is deliberately NOT cleared (D13): leaving the sky as it
  // was without a word is the same failure seen from the other side.
  // SidePanel turns the surviving selection into "Contact lost" or into
  // "Position unknown", and says why.
  const focused =
    selected === null ? null : useAircraftStore.getState().aircraft.get(selected) ?? null;
  const focusedIcao = focused !== null && isFocusable(focused) ? focused.icao24 : null;
  return {
    showComplete: f.showComplete,
    showPartial: f.showPartial,
    focusedIcao,
  };
}
```

- [ ] **Step 12: Verificare il verde e l'intera suite**

```bash
npx vitest run tests/unit/globe/fleetColours.test.ts tests/unit/globe/renderCapacity.test.ts \
               tests/unit/state/sceneView.test.ts
npm run build:all && npm test -- --run
```

Expected: 13 passed in `fleetColours.test.ts` (7 sul layer dei punti, 2 sulle scie, 3 sul picking, 1 sull'accordo fra `VisibleFleet` e i draw range), 3 passed in `renderCapacity.test.ts`, 8 passed in `sceneView.test.ts` (5 sulla flotta e sui filtri, 3 sull'aereo che non si può collocare); build pulita; **339 passed (37 files)**.

- [ ] **Step 13: Commit**

```bash
git add src/globe/aircraft.ts src/globe/trails.ts src/globe/raycaster.ts \
        src/globe/scene.ts src/state/sceneView.ts \
        tests/unit/globe/fleetColours.test.ts tests/unit/globe/renderCapacity.test.ts \
        tests/unit/state/sceneView.test.ts
git commit -m "feat(globe): the completeness flag finally reaches the pixels"
```

---

### Task 3: Il pannello a tendina, e le due categorie indipendenti

La prima cosa che l'utente ha chiesto. Il contatore esistente diventa la riga chiusa; aperto, mostra le due categorie con il proprio conteggio e la propria casella.

**Files:**
- Rename: `src/ui/HudCounter.tsx` → `src/ui/FeedStatus.tsx`; `tests/component/HudCounter.test.tsx` → `tests/component/FeedStatus.test.tsx`
- Modify: `src/ui/FeedStatus.tsx` (il totale se ne va: lo mostra il bottone), `tests/component/HudFreshness.test.tsx` (solo l'import e il titolo del `describe`)
- Create: `src/ui/FleetPanel.tsx`
- Modify: `src/ui/styles.css`, `src/ui/AppShell.tsx`
- Test: `tests/component/FleetPanel.test.tsx`

**Interfaces:**
- Consumes: `countFleet`, `useFilterStore`, **`describeVisibleFleet`** dal Task 1; `readVisibilityRule` dal Task 2; `useAircraftStore`, `useSelectionStore` dal Piano 1
- Produces: `<FleetPanel />`, che sostituisce `<HudCounter />` in `AppShell`; `<FeedStatus />`, la sola live region

**Il pannello non fa aritmetica sul conteggio: chiede a chi disegna (D15).** La prima stesura calcolava `shown` come `(showComplete ? complete : 0) + (showPartial ? partial : 0)`, che è una seconda autorità sullo stesso fatto e non sapeva niente del focus, dei record senza coordinate né del tetto del renderer. Tre esempi di quella ignoranza erano difetti veri: «5 900 aircraft» con un volo solo a fuoco, «No aircraft shown» sopra un globo che ne disegna uno, e i record senza posizione contati fra i puntini. Adesso il numero viene da `describeVisibleFleet`, la stessa funzione con cui `AircraftLayer.update` riempie i buffer.

**Perché la scissione e non un bottone annidato nell'HUD.** `src/ui/HudCounter.tsx:44` è un `<div role="status" aria-live="polite" aria-atomic="true">`. Metterci dentro il bottone di apertura significa far rileggere l'etichetta del bottone a ogni cambio di conteggio, e il conteggio cambia a ogni ciclo di feed. Dopo la scissione il bottone porta il numero visibile e `FeedStatus` resta la live region con le parole di guasto — e l'annuncio a soglia 100 che `HudCounter.tsx:34-39` già implementa, che resta dov'è perché è un annuncio, non un'etichetta.

**Il bottone continua a dire «N aircraft».** `tests/e2e/happy-path.spec.ts:8` asserisce `.hud` contiene `/\d+ aircraft/`. La classe `.hud` resta sul contenitore e il testo resta quello: un rename che rompe l'E2E sarebbe un rename che cambia il prodotto di nascosto. Con un filtro acceso la riga diventa «200 of 5 900 aircraft» (D14) — che quel `/\d+ aircraft/` continua a soddisfare, ed è l'unico caso in cui il testo cambia: chi non tocca niente legge la stessa riga di prima.

**Le righe che spiegano il globo non stanno dentro la tendina (D14).** «N hidden by filters» e «No aircraft shown — both filters are off» parlano di ciò che si vede sul globo, che è sempre sullo schermo; la tendina no, e `Esc` la chiude. Vivono quindi accanto al contatore, fuori da `{open && …}`, e restano montate finché il filtro è attivo. Dentro la tendina resta solo la riga «N of the partial ones lack only a route», che spiega la scomposizione in categorie e non il globo.

- [ ] **Step 1: Rinominare, senza toccare altro**

```bash
git mv src/ui/HudCounter.tsx src/ui/FeedStatus.tsx
git mv tests/component/HudCounter.test.tsx tests/component/FeedStatus.test.tsx
```

In `src/ui/FeedStatus.tsx` sostituire `export function HudCounter() {` con `export function FeedStatus() {`.

In `tests/component/FeedStatus.test.tsx` sostituire

```tsx
import { HudCounter } from '@/ui/HudCounter';
```
con
```tsx
import { FeedStatus } from '@/ui/FeedStatus';
```

e le due occorrenze di `render(<HudCounter />);` con `render(<FeedStatus />);`, e `describe('HudCounter', () => {` con `describe('FeedStatus', () => {`.

In `tests/component/HudFreshness.test.tsx` fare le stesse tre sostituzioni: l'import (riga 3), le tre occorrenze di `render(<HudCounter />);` e il titolo `describe('HudCounter — freshness the client can see for itself', () => {` → `describe('FeedStatus — freshness the client can see for itself', () => {`.

```bash
npm test -- --run
```

Expected: **339 passed**, invariato. Un rename che cambia un numero di test è un rename che ha cambiato il comportamento.

- [ ] **Step 2: Togliere il totale da `src/ui/FeedStatus.tsx`, e cedergli anche la classe `.hud`**

Sostituire

```tsx
    <div className="hud" role="status" aria-live="polite" aria-atomic="true">
      <span aria-hidden="true">{count.toLocaleString()} aircraft</span>
      <span className="sr-only">{announceCount.toLocaleString()} aircraft</span>
```

con

```tsx
    <div className="hud__feed" role="status" aria-live="polite" aria-atomic="true">
      {/* The visible number moved to the FleetPanel button, which is also
          the disclosure control: one number on screen, not two that can
          disagree. The screen-reader announcement stays here, because this
          is the live region and an announcement is not a label — and the
          .hud class went with the number, because the box is the panel now
          and two nested nodes with that class is one ambiguous selector.

          "in the feed", not "aircraft": this number is aircraft.size and
          it does not move when a filter, a focus or a missing coordinate
          takes aircraft off the globe. Announced bare it would say
          "5 900 aircraft" into the ear of someone looking at 200 — the
          family of D15 reaching the one user who cannot check the picture
          against the words. The panel's own live region (FleetPanel) is
          what announces how many are drawn and why. */}
      <span className="sr-only">{announceCount.toLocaleString()} aircraft in the feed</span>
```

`count` resta letto dallo store: lo consuma l'effetto della soglia a 100 (`HudCounter.tsx:34-39`, ora in `FeedStatus.tsx`). Nessun'altra riga cambia.

**Perché la classe se ne va con il numero.** Lo Step 5 fa rendere a `FleetPanel` un `<div className="hud">` con `<FeedStatus />` dentro. Se la classe restasse anche qui, sullo schermo ci sarebbero **due nodi `.hud` annidati**, entrambi `position: fixed` a `top/left: 32px` (`src/ui/styles.css:90-101`): due scatole impilate nello stesso angolo. E `tests/e2e/happy-path.spec.ts:6` fa `page.locator('.hud')` — Playwright lavora in strict mode, un selettore che trova due elementi **è un errore**, non una scelta del primo, quindi `toBeVisible()` fallirebbe con «strict mode violation: resolved to 2 elements». La classe appartiene alla scatola; la scatola adesso è il pannello. Questo componente resta la live region, che è il suo unico mestiere.

- [ ] **Step 3: Creare `tests/component/FleetPanel.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FleetPanel } from '@/ui/FleetPanel';
import { useAircraftStore } from '@/state/aircraftStore';
import { useFilterStore } from '@/state/filterStore';
import { useSelectionStore } from '@/state/selectionStore';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const ROUTE = {
  originIata: 'JFK',
  originName: 'John F Kennedy International Airport',
  destinationIata: 'MIA',
  destinationName: 'Miami International Airport',
  airlineName: 'American Airlines',
};

/**
 * A fleet shaped like the real one, measured 2026-11-21: 3,5% complete.
 * 200 complete and 5 700 partial is the panel the user will actually meet
 * for days, and a panel designed on an even split would be designed for a
 * sky that does not exist.
 */
function fleet(complete: number, partial: number, routeOnly = partial): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  for (let i = 0; i < complete; i++) {
    m.set(`c${i}`, {
      ...makeAircraftRaw({ icao24: `c${i}`, route: ROUTE, complete: true }),
      trail: [],
    });
  }
  for (let i = 0; i < partial; i++) {
    // Past routeOnly the aircraft is also missing a technical field, so it
    // does not count as "lacks only a route".
    const over = i < routeOnly ? {} : { registration: null };
    m.set(`p${i}`, {
      ...makeAircraftRaw({ icao24: `p${i}`, route: null, complete: false, ...over }),
      trail: [],
    });
  }
  return m;
}

describe('FleetPanel', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: fleet(200, 5_700),
      feedFetchedAt: Math.floor(Date.now() / 1000),
      feedStale: false,
      feedCapped: false,
      fetchStatus: 'idle',
    });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    // The panel's count comes from readVisibilityRule, which reads the
    // selection: a leftover selection from another test would be a focus.
    useSelectionStore.setState({ selectedIcao: null });
  });
  afterEach(cleanup);

  it('shows the total on the closed row', () => {
    // The separator is whatever toLocaleString() produces on the machine
    // running the suite — a comma here, a full stop on an Italian locale.
    // Asserting one of them would make the suite fail by geography.
    render(<FleetPanel />);
    expect(screen.getByRole('button', { name: /5[.,]900 aircraft/i })).toBeInTheDocument();
  });

  it('starts shut, with no filter controls on screen', () => {
    render(<FleetPanel />);
    expect(screen.getByRole('button', { name: /aircraft/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('opens on click and gives each category its own count', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(screen.getByRole('checkbox', { name: /full route/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /partial data/i })).toBeInTheDocument();
    expect(screen.getByTestId('count-complete')).toHaveTextContent(/^200$/);
    expect(screen.getByTestId('count-partial')).toHaveTextContent(/^5[.,]700$/);
  });

  it('keeps the two counts adding up to the total — the panel verifies itself', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    const digits = (id: string): number =>
      Number(screen.getByTestId(id).textContent?.replace(/[^0-9]/g, ''));
    const complete = digits('count-complete');
    const partial = digits('count-partial');
    const total = digits('count-total');
    expect(complete + partial).toBe(total);
  });

  it('switches the two categories INDEPENDENTLY', () => {
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /partial data/i }));
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(true);
    expect(screen.getByRole('checkbox', { name: /full route/i })).toBeChecked();
  });

  it('declares how many aircraft the filter is hiding', () => {
    // At 3,5% complete, switching the greys off removes 5 700 of 5 900. An
    // almost empty globe with no explanation is indistinguishable from the
    // v1 outage, and this application has already paid for that confusion
    // once.
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /partial data/i }));
    expect(screen.getByText(/5[.,]700 hidden by filters/i)).toBeInTheDocument();
  });

  it('says so when both filters are off instead of leaving an unexplained void', () => {
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: true });
    render(<FleetPanel />);
    expect(screen.getByText(/both filters are off/i)).toBeInTheDocument();
  });

  it('explains why so few are complete: they lack only a route', () => {
    // Technical fields cover 99% of the fleet, routes 4,7%. Saying how many
    // greys are grey for that one reason turns "broken" into "still filling".
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(
      screen.getByText(/5[.,]700 of the partial ones lack only a route/i)
    ).toBeInTheDocument();
  });

  it('does not claim a route-only shortfall that is not there', () => {
    useAircraftStore.setState({ aircraft: fleet(200, 5_700, 0) });
    render(<FleetPanel />);
    fireEvent.click(screen.getByRole('button', { name: /aircraft/i }));
    expect(screen.queryByText(/lack only a route/i)).toBeNull();
  });

  it('KEEPS the hidden-by-filters line on screen once the drawer is shut', () => {
    // The drawer closes; the filter does not. Inside {open && …} the only
    // words explaining a near-empty globe were folded away by the same
    // click that put them there — and by Esc, the key a user presses to
    // close things, which took the explanation away at exactly the moment
    // they were trying to understand what had happened (D14).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull(); // the drawer really is shut
    expect(screen.getByText(/5[.,]700 hidden by filters/i)).toBeInTheDocument();
  });

  it('stops the shut row claiming aircraft the filter is hiding', () => {
    // "5 900 aircraft" over a globe carrying 200 is a number that is true
    // about the fleet and false about the screen. It says both (D14).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(
      screen.getByRole('button', { name: /200 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
  });

  it('says the globe was emptied on purpose even with the drawer shut', () => {
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/both filters are off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /0 of 5[.,]900 aircraft/i })).toBeInTheDocument();
  });

  it('keeps the feed warnings beside the counter', () => {
    // The stale flag crossed four layers in Piano 1 to reach the screen.
    // A panel that replaces the HUD and drops it would undo all of it.
    useAircraftStore.setState({ feedStale: true });
    render(<FleetPanel />);
    expect(screen.getByText(/feed stale/i)).toBeInTheDocument();
  });

  it('counts the one flight a focus leaves, and names what the focus took', () => {
    // D14 exempted focus on the grounds that "the focused flight's card is
    // on screen". The card has a ✕: one click and the globe is still
    // showing 1 aircraft of 5 900 with nothing on screen saying so. That
    // is how the tenth defect of this family was born (D15).
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(
      screen.getByRole('button', { name: /1 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/5[.,]899 hidden while one flight is in focus/i)
    ).toBeInTheDocument();
  });

  it('never calls the globe empty while a focused flight is on it', () => {
    // Both switches off AND a flight in focus. The old arithmetic —
    // (showComplete ? complete : 0) + (showPartial ? partial : 0) — gave 0
    // and printed "No aircraft shown" over a globe drawing one. It is a row
    // of the state table, and it was a real defect before there was a table.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.queryByText(/both filters are off/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: /1 of 5[.,]900 aircraft/i })
    ).toBeInTheDocument();
  });

  it('promises only what leaving the focus would actually give back', () => {
    // Both switches off AND a flight in focus — row 8 of the state table.
    // "Esc shows them again" was printed unconditionally, and here it was
    // a promise the next frame breaks: Esc ends the focus, the filters are
    // still off, and the globe goes from one aircraft to none. D15b is
    // about causes nobody measured; a promise nobody measured is the same
    // sentence pointing forwards.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    useFilterStore.setState({ showComplete: false, showPartial: false, panelOpen: false });
    render(<FleetPanel />);
    expect(screen.getByText(/so Esc brings none of them back/i)).toBeInTheDocument();
    expect(screen.queryByText(/Esc shows them again/i)).toBeNull();
  });

  it('still offers Esc when Esc really does give the sky back', () => {
    // The typical case has to keep its short sentence: a line that hedges
    // when there is nothing to hedge about teaches the reader to skip it.
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(screen.getByText(/Esc shows them again/i)).toBeInTheDocument();
  });

  it('declares the records that are in the feed but nowhere on the globe', () => {
    // latitude is null whenever the provider sent no position, and the
    // adapters write null rather than invent one. Such a record is inside
    // aircraft.size and has never been a dot. D14 put this off "for want of
    // a measurement"; the walk of D15 measures it in the same pass.
    const m = fleet(200, 5_700);
    m.set('x1', { ...makeAircraftRaw({ icao24: 'x1', latitude: null }), trail: [] });
    useAircraftStore.setState({ aircraft: m });
    render(<FleetPanel />);
    expect(screen.getByText(/1 without a position/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /5[.,]900 of 5[.,]901 aircraft/i })
    ).toBeInTheDocument();
  });

  it('KEEPS the focus explanation on screen with the drawer shut', () => {
    // Same reason as the filter line, and the same key: the drawer closes,
    // the focus does not, and Esc is what closes the drawer (D14).
    useSelectionStore.setState({ selectedIcao: 'c0' });
    render(<FleetPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/hidden while one flight is in focus/i)).toBeInTheDocument();
  });

  it('speaks the shortfall as well as showing it', () => {
    // Before this the only thing announced was the feed total, which does
    // not move when a filter empties the globe: someone who cannot see the
    // picture heard "5 900 aircraft" over a sky holding 200, with the two
    // lines that explain it sitting silently in the page (D15a).
    useFilterStore.setState({ showComplete: true, showPartial: false, panelOpen: false });
    const { container } = render(<FleetPanel />);
    const live = container.querySelector('.fleet__notes[role="status"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toMatch(/200 of 5[.,]900 aircraft shown/i);
    expect(live?.textContent).toMatch(/5[.,]700 hidden by filters/i);
  });

  it('keeps that live region on the page while nothing is hidden, so it can speak later', () => {
    // A live region inserted at the same instant as its text is announced
    // unreliably: it has to already be there when the news arrives.
    const { container } = render(<FleetPanel />);
    expect(container.querySelector('.fleet__notes[role="status"]')).not.toBeNull();
    expect(container.querySelector('.fleet__notes')?.textContent).toBe('');
  });

  it('leaves exactly ONE element carrying the .hud class', () => {
    // This panel IS the .hud box and FeedStatus renders inside it. If both
    // kept the class there would be two nested nodes with it, each
    // position: fixed at the same 32px corner, and page.locator('.hud') in
    // tests/e2e/happy-path.spec.ts:6 would resolve to two elements —
    // a strict-mode violation in Playwright, not a pick-the-first. Cheaper
    // to catch here than in a browser run that is not in this task's gate.
    const { container } = render(<FleetPanel />);
    expect(container.querySelectorAll('.hud')).toHaveLength(1);
    // ...and the live region is still inside it, warnings and all.
    expect(container.querySelector('.hud [role="status"]')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Verificare il rosso**

```bash
npx vitest run tests/component/FleetPanel.test.tsx
```

Expected: `Failed to resolve import "@/ui/FleetPanel"`. Zero test passati.

- [ ] **Step 5: Creare `src/ui/FleetPanel.tsx`**

```tsx
import { useMemo } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useFilterStore, countFleet } from '@/state/filterStore';
import { describeVisibleFleet } from '@/globe/visibility';
import type { VisibleFleet } from '@/globe/visibility';
import { readVisibilityRule } from '@/state/sceneView';
import { FeedStatus } from './FeedStatus';

/**
 * The counter the HUD already showed, with a drawer under it.
 *
 * Closed it is one line, which is what spec §6.1 asks for and what the globe
 * can afford. Open it is the only place in the product where the two
 * populations are named, counted and switched.
 *
 * The label is a plain "aircraft" and does not change with the zoom. The
 * spec imagined "IN VOLO" at planet view and "IN VISTA" over a region, for
 * a camera-driven payload that Piano 1 did not build: server/index.ts:326
 * serves the WHOLE accumulated fleet and the camera only reprioritises
 * tiles. "In view" would be a plausible word for a number that does not
 * mean it.
 *
 * What the closed row says is governed by D14: the number stops at the
 * total only while the whole fleet is on the globe. The moment a filter
 * hides something it reads "200 of 5 900 aircraft", and the line that
 * names the cause lives OUTSIDE the drawer — a drawer closes, a filter
 * does not.
 */
export function FleetPanel() {
  const aircraft = useAircraftStore((s) => s.aircraft);
  const open = useFilterStore((s) => s.panelOpen);
  const setOpen = useFilterStore((s) => s.setPanelOpen);
  const showComplete = useFilterStore((s) => s.showComplete);
  const showPartial = useFilterStore((s) => s.showPartial);
  const toggleComplete = useFilterStore((s) => s.toggleComplete);
  const togglePartial = useFilterStore((s) => s.togglePartial);

  // One pass over up to 6 000 records, recomputed only when the Map
  // identity changes — updateBatch replaces it wholesale once per cycle.
  const counts = useMemo(() => countFleet(aircraft.values()), [aircraft]);

  // Read, not subscribed: `aircraft`, the two switches above and
  // `selectedIcao` are already subscriptions, so everything that can change
  // this answer has already re-rendered the component.
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);
  const rule = readVisibilityRule();

  // What the globe is DRAWING — from the very function that draws it (D15).
  // Never derived from the category counts: that arithmetic knew nothing
  // about focus, about records with no coordinates, or about the renderer's
  // ceiling, and so it wrote sentences the picture contradicted.
  const view = useMemo(
    () => describeVisibleFleet(aircraft.values(), rule, selectedIcao),
    [aircraft, rule.showComplete, rule.showPartial, rule.focusedIcao, selectedIcao]
  );
  const bothOff = !showComplete && !showPartial;

  return (
    <div className="hud">
      <button
        type="button"
        className="hud__summary"
        aria-expanded={open}
        aria-controls="fleet-filters"
        onClick={() => setOpen(!open)}
      >
        {/* While the whole fleet is on the globe this reads exactly
            "5 900 aircraft", which is what a visitor who touched nothing
            sees and what tests/e2e/happy-path.spec.ts:8 matches. The
            moment ANYTHING hides an aircraft — a filter, a focus, a
            missing coordinate, the renderer's ceiling — the row would
            otherwise claim aircraft that are not on the globe, so it says
            both numbers instead (D14/D15). count-total is view.total, the
            same walk's count of the records, which the self-verifying test
            adds the two category counts up against: two walkers, one
            answer, or one of them is lying. */}
        <span className="hud__count">
          {view.shown < view.total && <>{view.shown.toLocaleString()} of </>}
          <span data-testid="count-total">{view.total.toLocaleString()}</span> aircraft
        </span>
        <span className="hud__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      <FeedStatus />

      {/* OUTSIDE the drawer, on purpose (D14). These lines explain the
          globe, and the globe is always on screen; the drawer is not.
          Folded inside {open && …} they would vanish on closing the panel
          while the cause stayed in force — and vanish in particular on Esc,
          the key a user presses to close things, which means the
          explanation would disappear at exactly the moment they were trying
          to find out why the sky is empty. */}
      <ShortfallNotes view={view} bothOff={bothOff} />

      {open && (
        <div id="fleet-filters" className="fleet">
          <FilterRow
            kind="complete"
            label="Full route"
            testid="count-complete"
            count={counts.complete}
            checked={showComplete}
            onChange={toggleComplete}
          />
          <FilterRow
            kind="partial"
            label="Partial data"
            testid="count-partial"
            count={counts.partial}
            checked={showPartial}
            onChange={togglePartial}
          />

          {/* This third line stays INSIDE the drawer: it does not explain
              the globe, it explains the split into two categories, which
              exists only while the drawer is open.
              Measured 2026-11-21: technical fields cover 99% of the fleet,
              routes 4,7%, and the route cache grows ~920 flights/hour. That
              growth rate is deliberately NOT on screen — it is true today
              and would be a lie next month. The count is recomputed from
              the fleet in hand, so it cannot go stale. */}
          {counts.routeOnly > 0 && (
            <p className="fleet__note">
              {counts.routeOnly.toLocaleString()} of the partial ones lack only a route
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One line per cause, for EVERY cause that has a count (D15a).
 *
 * Not "the main reason": two can hold at once — a filter switched off and a
 * flight in focus — and naming one while the other is also hiding aircraft
 * is the same half-truth in a smaller size. The lines are derived from the
 * walk, so a cause that is added to describeVisibleFleet and forgotten here
 * shows up as a shortfall the row counts and nothing explains, which is
 * what the invariant test fails on.
 */
function ShortfallNotes({ view, bothOff }: { view: VisibleFleet; bothOff: boolean }) {
  const h = view.hidden;
  // Gated on what is DRAWN, never on the switches. With both switches off
  // and a flight in focus the globe IS drawing that flight, and "No
  // aircraft shown" would be a sentence the picture contradicts three
  // millimetres away.
  const emptiedOnPurpose = bothOff && view.shown === 0;
  return (
    // A live region, because these lines appear in answer to an act — a
    // checkbox, a click on an aircraft — and a user who cannot see the
    // globe has nothing else to compare the count against. Without it the
    // only thing spoken aloud is the feed total, which is the one number
    // that does NOT change when the globe empties (D15a).
    <div className="fleet__notes" role="status" aria-live="polite">
      {view.shown < view.total && (
        <span className="sr-only">
          {view.shown.toLocaleString()} of {view.total.toLocaleString()} aircraft shown
        </span>
      )}
      {emptiedOnPurpose && (
        <p className="fleet__note">No aircraft shown — both filters are off</p>
      )}
      {h.filtered > 0 && !emptiedOnPurpose && (
        <p className="fleet__note">{h.filtered.toLocaleString()} hidden by filters</p>
      )}
      {/* The second half of this line is MEASURED, never assumed. "Esc
          shows them again" is a claim about the next frame, and with both
          switches off it was false: the focus was the only thing putting
          an aircraft on the globe, so Esc handed back nobody and emptied
          the sky instead. The walk counts how many the filters would let
          through, and the sentence follows the count (D15b). The offer
          names Esc rather than the ✕ because Esc is the one door always
          under the hand; the ladder of D12 reaches the focus once whatever
          the user opened on top of it is closed. */}
      {h.focus > 0 && (
        <p className="fleet__note">
          {h.focus.toLocaleString()} hidden while one flight is in focus
          {view.releasedByLeavingFocus === h.focus && <> — Esc shows them again</>}
          {view.releasedByLeavingFocus > 0 && view.releasedByLeavingFocus < h.focus && (
            <>
              {' '}— Esc shows {view.releasedByLeavingFocus.toLocaleString()} of them again;
              the filters hide the rest
            </>
          )}
          {view.releasedByLeavingFocus === 0 && (
            <> — the filters hide them too, so Esc brings none of them back</>
          )}
        </p>
      )}
      {/* Records the feed carries without a position. The adapters write
          null rather than invent a coordinate, so these are in
          aircraft.size and have never been dots. D14 deferred this count
          "for want of a measurement"; the walk measures it for free. */}
      {h.noPosition > 0 && (
        <p className="fleet__note">
          {h.noPosition.toLocaleString()} without a position — in the feed, not on the globe
        </p>
      )}
      {h.rendererFull > 0 && (
        <p className="fleet__note">
          {h.rendererFull.toLocaleString()} beyond what the globe can draw at once
        </p>
      )}
    </div>
  );
}

interface FilterRowProps {
  kind: 'complete' | 'partial';
  label: string;
  testid: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}

/**
 * A real <input type="checkbox"> inside a <label>, not a styled div.
 *
 * axe runs over this surface in tests/e2e/a11y.spec.ts, and the keyboard
 * behaviour of a checkbox is not worth reimplementing.
 */
function FilterRow({ kind, label, testid, count, checked, onChange }: FilterRowProps) {
  return (
    <label className="fleet__row">
      <input
        type="checkbox"
        className="fleet__box"
        data-kind={kind}
        checked={checked}
        onChange={onChange}
      />
      <span className="fleet__label">{label}</span>
      <span className="fleet__count" data-testid={testid}>
        {count.toLocaleString()}
      </span>
    </label>
  );
}
```

- [ ] **Step 6: Verificare il verde**

```bash
npx vitest run tests/component/FleetPanel.test.tsx
```

Expected: **22 passed**. Suite intera: 361.

- [ ] **Step 7: Aggiungere lo stile in `src/ui/styles.css`**

Sostituire il blocco

```css
.hud__status {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.55;
  letter-spacing: -0.12px;
  margin-left: var(--space-xs);
}
```

con

```css
.hud__status {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.55;
  letter-spacing: -0.12px;
  margin-left: var(--space-xs);
}

/* Fleet panel — the HUD counter with a drawer under it */
.hud__summary {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.hud__chevron { font-size: 10px; opacity: 0.5; }

/* The live region, demoted from .hud to a row inside it. Exactly one
   element carries .hud now: two would stack at the same fixed corner, and
   page.locator('.hud') in tests/e2e/happy-path.spec.ts:6 would resolve to
   two nodes, which Playwright's strict mode rejects outright. */
.hud__feed { font-size: 12px; }
.hud__feed .hud__status { margin-left: 0; }

.fleet {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  width: 248px;
  background: rgba(39, 39, 41, 0.78);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-md);
}
.fleet__row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xxs) 0;
  cursor: pointer;
}
.fleet__label { flex: 1; font-size: 13px; font-weight: 400; }
.fleet__count { font-size: 13px; font-variant-numeric: tabular-nums; opacity: 0.8; }
/* Used in two places on purpose: inside the drawer for the route-only
   line, and directly under the counter for the two lines that explain the
   globe, which must survive the drawer closing (D14). The max-width is
   what the drawer gives it there — without it, a note outside the drawer
   would stretch the fixed .hud box to the width of its own sentence. */
.fleet__note {
  margin-top: var(--space-xs);
  max-width: 248px;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.5;
  letter-spacing: -0.1px;
}

/* The control carries the colour of what it controls (spec §7.1) — except
   that the user asked for the partial-data box to be red and translucent,
   and red says "remove" where the aircraft grey would only have said
   "these". Red appears ONLY here, never on the globe, so Action Blue keeps
   its single meaning. */
.fleet__box {
  appearance: none;
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  border: 1px solid transparent;
  position: relative;
  flex: none;
}
.fleet__box[data-kind="complete"] {
  border-color: rgba(255, 230, 196, 0.65);
  background: rgba(255, 230, 196, 0.10);
}
.fleet__box[data-kind="complete"]:checked { background: rgba(255, 230, 196, 0.45); }
.fleet__box[data-kind="partial"] {
  border-color: rgba(255, 69, 58, 0.80);
  background: rgba(255, 69, 58, 0.12);
}
.fleet__box[data-kind="partial"]:checked { background: rgba(255, 69, 58, 0.45); }
.fleet__box:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid rgba(0, 0, 0, 0.75);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
```

- [ ] **Step 8: Montare il pannello in `src/ui/AppShell.tsx`**

Sostituire

```tsx
import { HudCounter } from './HudCounter';
```
con
```tsx
import { FleetPanel } from './FleetPanel';
```

e

```tsx
      <HudCounter />
```
con
```tsx
      <FleetPanel />
```

- [ ] **Step 9: Verificare build, suite e browser**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, **361 passed (38 files)**.

Verifica a occhio, che nessun test può fare: `npm run dev:full`, aprire la pagina, cliccare il contatore, spegnere **Partial data**. Il globo deve quasi svuotarsi — è l'esito giusto al 3,5 % — e il pannello deve dire quanti aerei ha nascosto. Poi **richiudere la tendina**: la riga «N hidden by filters» deve restare, e il contatore deve leggere «200 of 5 900 aircraft». Se chiudendo la tendina sullo schermo resta un globo quasi vuoto accanto a una riga che dice l'intera flotta, lo Step 5 è incompleto.

- [ ] **Step 10: Commit**

```bash
# I due `git mv` dello Step 1 hanno già messo in stage la sparizione di
# HudCounter.tsx e HudCounter.test.tsx: non vanno elencati qui, perché un
# `git add` su un percorso che non esiste più fallisce con "pathspec did
# not match". Verificare con `git status` che la coppia compaia come R.
git add src/ui/FeedStatus.tsx src/ui/FleetPanel.tsx src/ui/AppShell.tsx src/ui/styles.css \
        tests/component/FeedStatus.test.tsx tests/component/FleetPanel.test.tsx \
        tests/component/HudFreshness.test.tsx
git commit -m "feat(ui): the counter opens, and the two populations get a switch each"
```

---

### Task 4: Focus — gli altri si dissolvono, e `Esc` ha una scala sola

Il predicato del Task 1 nasconde già tutto tranne l'aereo a fuoco; qui si aggiunge la dissolvenza di ~300 ms che la spec §6.2 chiede, e si mette ordine sul tasto `Esc` prima che quattro funzioni se lo contendano.

**Files:**
- Create: `src/globe/focus.ts`, `src/state/flightFocus.ts`, `src/state/escape.ts`
- Modify: `src/globe/scene.ts` (la dissolvenza entra nel render loop), `src/ui/SidePanel.tsx` (cede il listener, non rende mai una scatola vuota, dichiara l'aereo che non si può collocare, e le sue ✕ lasciano il volo per intero), `src/ui/AppShell.tsx` (lo prende), `src/ui/styles.css` (una regola: `.panel__note`)
- Test: `tests/unit/globe/focus.test.ts`, `tests/unit/state/flightFocus.test.ts`, `tests/unit/state/escape.test.ts`, `tests/component/SidePanel.test.tsx`

**Interfaces:**
- Consumes: `VisibilityRule` dal Task 1; `describeVisibleFleet` dal Task 1 — solo nel test che campiona dissolvenza e conteggio sullo **stesso** fotogramma, che è il confine su cui l'invariante si rompeva; `useA11yStore.prefersReducedMotion` dalla v1
- Produces: `FOCUS_FADE_MS`; `fadeAmount(elapsedMs, reducedMotion): number`; `createFocusFade(): { sample(focusedIcao, nowMs, reducedMotion): number }`; **`leaveFlight(): void`**; `handleEscape(): boolean`

**Lasciare il volo è UN atto, e quindi è una funzione sola (D15).** La ✕ della scheda, `Esc` e — dal Task 8 — il pulsante di pulizia della ricerca fanno la stessa cosa, e scritta tre volte è già divergita: la ✕ di oggi chiama il solo `close()` del `panelStore`, che fa `set({ mode: 'closed' })` senza toccare `selectedIcao`. Esito: il focus resta acceso, il globo continua a disegnare 1 aereo su 5 900, **e la spiegazione se n'è andata con la scheda**. Non è un difetto della ✕, è un difetto di un atto scritto a pezzi. `leaveFlight()` in `src/state/flightFocus.ts` lo scrive una volta — selezione, scheda del volo e (dal Task 7) scheda dell'aeroporto, insieme — e i tre call site chiamano quella.

**Si dissolve l'entrata, non l'uscita.** Entrando nel focus il pannello cala subito al conteggio a regime — l'aereo a fuoco e basta — e il globo impiega 300 ms a raggiungerlo: il numero diventa vero mentre l'occhio lo insegue, ed è la sola divergenza che D15 ammette. Uscendo, la stessa animazione al contrario ha il segno sbagliato — `rule.focusedIcao` è già `null`, il pannello dichiara l'intera flotta, e per 2-4 fotogrammi il renderer moltiplica ogni punto per ~0: globo nero sotto una riga che dice «5 900 aircraft», senza nota, perché `shown === total` e `reason` è `null`. Uscire non è una transizione verso qualcosa di nuovo: è tornare allo stato che il pannello dichiara già, e non c'è niente da far aspettare all'occhio. `sample` restituisce quindi `1` ogni volta che `focusedIcao` è `null`. Lo si raggiunge con `Esc`, con la ✕, con il click sul vuoto e **senza alcun atto dell'utente** quando il server pota l'aereo a fuoco (D13).

**L'orologio della dissolvenza è quello di `requestAnimationFrame`.** `animate(time)` (`src/globe/scene.ts:125`) riceve già un timestamp monotono per specifica. `Date.now()` qui produrrebbe, sulla misura di questa macchina (~528 ms di salto ogni ~32 s, `server/routeResolver.ts:47-58`), una dissolvenza che a volte finisce prima di cominciare. Una durata non si misura con un orologio da parete.

**E il pannello destro impara a non essere mai vuoto, né muto.** Il focus può finire in due modi che il Task 2 ha reso ordinari: l'utente esce, oppure l'aereo esce dal payload (D13). In entrambi i casi `SidePanel` si trova con `mode === 'flight'` e nessun aereo selezionato, e oggi quel caso non rende **niente**: né la `FlightCard`, né il `PanelToggle`. Una scatola vuota accanto a un globo che si è appena riempito è lo schermo che cambia senza dire perché. Gli Step 13-17 lo chiudono, e la scala di `Esc` qui sotto tratta il volo e la sua scheda come **un atto solo**, perché la scheda esiste soltanto per il volo selezionato.

C'è un terzo caso, la seconda metà di D13: **l'aereo è nella flotta ma non sappiamo dove sia.** `readVisibilityRule()` (Task 2) non gli concede il focus, quindi il globo non cambia: scegliendo quel volo dalla lista — o trovandolo con la ricerca del Task 8 — l'utente vede una scheda comparire e il cielo restare identico. Senza una parola è un click che sembra non aver fatto niente. La scheda lo dichiara: **«Position unknown — not shown on the globe»**. È una riga del pannello, non un campo della scheda, e sta accanto al ramo «Contact lost» perché è la stessa regola: *il pannello non lascia mai il globo in disaccordo con ciò che nomina, in silenzio*.

**`Esc` ha un solo listener.** Oggi è in `src/ui/SidePanel.tsx:14-20` e chiude il pannello destro. Con pannello flotta, focus, ricerca e scheda aeroporto si arriverebbe a quattro listener sullo stesso tasto, tutti attivi insieme: premere `Esc` chiuderebbe quattro cose in una volta. Un listener in `AppShell`, una scala in `src/state/escape.ts`, **una cosa chiusa per pressione, la più interna per prima**. I Task 6 e 7 aggiungono i propri gradini a quella scala, ognuno con il proprio test.

- [ ] **Step 1: Creare `tests/unit/globe/focus.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { FOCUS_FADE_MS, fadeAmount, createFocusFade } from '@/globe/focus';
import { describeVisibleFleet } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

describe('focus fade', () => {
  it('lasts inside the 200-400ms editorial window of DESIGN.md', () => {
    expect(FOCUS_FADE_MS).toBeGreaterThanOrEqual(200);
    expect(FOCUS_FADE_MS).toBeLessThanOrEqual(400);
  });

  it('runs from nothing to everything across that window', () => {
    expect(fadeAmount(0, false)).toBe(0);
    expect(fadeAmount(FOCUS_FADE_MS, false)).toBe(1);
    expect(fadeAmount(FOCUS_FADE_MS * 2, false)).toBe(1);
  });

  it('never leaves [0,1], not even if the clock runs backwards', () => {
    // rAF timestamps are monotonic by specification, but a tab restored from
    // the background hands back a first frame whose delta is meaningless.
    // Clamping is cheaper than trusting it.
    expect(fadeAmount(-5_000, false)).toBe(0);
    expect(fadeAmount(5_000, false)).toBe(1);
  });

  it('jumps straight to the end under prefers-reduced-motion', () => {
    expect(fadeAmount(0, true)).toBe(1);
    expect(fadeAmount(10, true)).toBe(1);
  });

  it('dims the others as focus starts and puts them out by the end', () => {
    const fade = createFocusFade();
    expect(fade.sample(null, 1_000, false)).toBe(1); // nothing focused: full sky
    expect(fade.sample('a1', 1_000, false)).toBe(1); // the instant of the click
    expect(fade.sample('a1', 1_000 + FOCUS_FADE_MS / 2, false)).toBeLessThan(1);
    expect(fade.sample('a1', 1_000 + FOCUS_FADE_MS, false)).toBe(0);
  });

  it('puts the sky back on the FIRST frame after focus ends, not over 300ms', () => {
    // This used to ramp 0 -> 1, and the ramp was a lie in the one direction
    // D15 forbids: from its first frame rule.focusedIcao is already null,
    // so describeVisibleFleet counts the whole fleet as shown, `reason` is
    // null, the notes print nothing — and every point is written at ~0. The
    // panel declared 5 900 aircraft over a black globe. Esc, the card's ✕,
    // a click on empty space and the server pruning the focused aircraft
    // (D13 — no act of the user at all) every one of them arrives here.
    const fade = createFocusFade();
    fade.sample('a1', 0, false);
    fade.sample('a1', FOCUS_FADE_MS, false); // settled: the crowd is out
    expect(fade.sample(null, FOCUS_FADE_MS, false)).toBe(1);
    expect(fade.sample(null, FOCUS_FADE_MS + 16, false)).toBe(1);
    expect(fade.sample(null, FOCUS_FADE_MS * 2, false)).toBe(1);
  });

  it('opens on a FULL sky, whatever the clock reads on the first frame', () => {
    // "Nothing is focused" is not a transition from anything: it is the
    // state the application mounts in. A fade that starts counting on its
    // first sample hands the renderer brightness 0 for ~300 ms, which draws
    // nothing at all, at every start-up — the empty globe of v1, produced by
    // the very animation that exists to avoid a hard cut. Three different
    // first frames, because the bug was invisible at nowMs = 0 only by luck.
    expect(createFocusFade().sample(null, 0, false)).toBe(1);
    expect(createFocusFade().sample(null, 1_763_700_000_000, false)).toBe(1);
    expect(createFocusFade().sample(null, 0, true)).toBe(1);
  });
});

/**
 * The arithmetic of D15 was taken apart on its own and held. The violations
 * that survived it were all on its BORDER: frames where two mechanisms,
 * each correct, hand over to one another and neither one's test is looking.
 * These sample the fade and ask describeVisibleFleet the same question on
 * the same frame, which is the only place the answer can be seen.
 */
describe('the fade and the count, at the frame where they meet', () => {
  const FLEET: Aircraft[] = [
    { ...makeAircraftRaw({ icao24: 'cc', complete: true }), trail: [] },
    { ...makeAircraftRaw({ icao24: 'pp', complete: false }), trail: [] },
    { ...makeAircraftRaw({ icao24: 'np', latitude: null }), trail: [] },
  ];
  const ruleFor = (focusedIcao: string | null): VisibilityRule => ({
    showComplete: true,
    showPartial: true,
    focusedIcao,
  });

  it('hands the renderer full brightness on every frame the panel calls a full sky', () => {
    const fade = createFocusFade();
    fade.sample('cc', 0, false);
    fade.sample('cc', FOCUS_FADE_MS, false); // settled inside the focus

    // The focus ends. From this frame readVisibilityRule reports none, so
    // the panel declares every placeable record SHOWN — and the brightness
    // the renderer multiplies those same records by is the whole of the
    // invariant on this frame. At ~0 they are counted and invisible, which
    // is the half-truth D15 exists to forbid, pointing the forbidden way.
    const declared = describeVisibleFleet(FLEET, ruleFor(null), null);
    expect(declared.shown).toBe(2);
    for (const dt of [0, 16, 33, 50, 150, FOCUS_FADE_MS - 1]) {
      expect(fade.sample(null, FOCUS_FADE_MS + dt, false)).toBe(1);
    }
  });

  it('keeps the one divergence D15 admits pointing the way it admits', () => {
    // Entering focus the globe shows MORE than the panel declares: the
    // crowd is still dimming while the count has already dropped. A number
    // the eye catches up with, and the only gap the invariant allows.
    const fade = createFocusFade();
    fade.sample('cc', 0, false);
    const mid = fade.sample('cc', FOCUS_FADE_MS / 2, false);
    expect(mid).toBeGreaterThan(0);

    const drawn: string[] = [];
    const rendered = describeVisibleFleet(
      FLEET,
      ruleFor('cc'),
      'cc',
      (a) => drawn.push(a.icao24),
      mid
    );
    const declared = describeVisibleFleet(FLEET, ruleFor('cc'), 'cc');
    expect(drawn).toHaveLength(rendered.shown);
    expect(rendered.shown).toBeGreaterThan(declared.shown);
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/focus.test.ts
```

Expected: `Failed to resolve import "@/globe/focus"`. Zero test passati.

- [ ] **Step 3: Creare `src/globe/focus.ts`**

```ts
/**
 * 300ms, inside the 200-400ms editorial window DESIGN.md sets for state
 * changes. Below 200 the others blink out and the eye reads a glitch;
 * above 400 the user waits for the globe to finish agreeing with them.
 */
export const FOCUS_FADE_MS = 300;

/**
 * How far through the transition we are, 0 at the start and 1 at the end.
 *
 * Clamped at both ends on purpose. rAF timestamps are monotonic by
 * specification, but the first frame after a tab comes back from the
 * background carries a delta that means nothing, and an unclamped
 * smoothstep would hand the renderer a negative brightness.
 */
export function fadeAmount(elapsedMs: number, reducedMotion: boolean): number {
  // prefers-reduced-motion asked for no animation, not for a faster one.
  if (reducedMotion) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= FOCUS_FADE_MS) return 1;
  const t = elapsedMs / FOCUS_FADE_MS;
  return t * t * (3 - 2 * t); // smoothstep: no velocity jump at either end
}

export interface FocusFade {
  /**
   * @param focusedIcao who the view is about, or null.
   * @param nowMs a MONOTONIC timestamp — the argument rAF already passes to
   *   animate(). Never Date.now(): measured on this machine it moves by
   *   ~528 ms every ~32 s, which here would end the fade before it starts.
   * @returns the brightness multiplier for the aircraft that are NOT the
   *   focused one: 0 once the fade INTO focus has finished, and 1 outside
   *   focus — immediately, on the first frame after one ends. Only the
   *   entry is animated; see createFocusFade for why the exit must not be.
   */
  sample(focusedIcao: string | null, nowMs: number, reducedMotion: boolean): number;
}

/**
 * The transition's only piece of state, kept out of the stores because it
 * changes every frame and nothing outside the render loop can use it.
 *
 * ONE direction is animated, and that is the invariant rather than a
 * shortcut. Entering focus the crowd dims from 1 to 0 while the panel has
 * already dropped to the settled count: for those ~300 ms the globe shows
 * MORE than the panel declares, which is the single divergence D15 admits.
 * Leaving focus is that same divergence with the sign flipped — and that
 * one is forbidden — so leaving focus is not animated at all.
 */
export function createFocusFade(): FocusFade {
  let currentIcao: string | null = null;
  /**
   * When the CURRENT focus began. Read only while one is in force, which
   * is why there is no "nothing has happened yet" value left to get wrong.
   * The first draft kept a changedAtMs that the very first sample set to
   * nowMs even with focusedIcao already null, then returned
   * fadeAmount(0) = 0: brightness zero for every aircraft while none was
   * focused, so the globe mounted EMPTY for ~300 ms, every time. Here
   * `focusedIcao === null` answers before this number is ever looked at,
   * so that state cannot be reached from any clock reading.
   */
  let focusStartedAtMs = 0;

  return {
    sample(focusedIcao, nowMs, reducedMotion) {
      if (focusedIcao !== currentIcao) {
        currentIcao = focusedIcao;
        focusStartedAtMs = nowMs;
      }
      // No focus, full sky, on THIS frame — never a ramp back up from 0.
      // A fade-IN is D15's admitted divergence pointing the forbidden way:
      // readVisibilityRule has already dropped the focus, so
      // describeVisibleFleet counts the whole fleet in `shown`, `reason` is
      // null and ShortfallNotes prints nothing, while AircraftLayer.update
      // multiplies every point by ~0 and the globe is blank. Two to four
      // frames of a screen showing LESS than it declares, with nothing on
      // it to say so — reached with Esc, with the card's ✕, with a click on
      // empty space, and with no act of the user at all when the server
      // prunes the focused aircraft (D13).
      if (focusedIcao === null) return 1;
      return 1 - fadeAmount(nowMs - focusStartedAtMs, reducedMotion);
    },
  };
}
```

- [ ] **Step 4: Verificare il verde**

```bash
npx vitest run tests/unit/globe/focus.test.ts
```

Expected: **9 passed**. Suite intera: 370.

- [ ] **Step 5: Creare `tests/unit/state/flightFocus.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { leaveFlight } from '@/state/flightFocus';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useFilterStore } from '@/state/filterStore';

describe('leaveFlight — one act, one function', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedIcao: null });
    usePanelStore.setState({ mode: 'closed' });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
  });

  it('releases the flight AND the card that exists only for it', () => {
    // Written apart, these two drifted. The card's ✕ called the panel's
    // close() alone — set({ mode: 'closed' }), nothing about the selection
    // — so readVisibilityRule went on granting focus, the globe went on
    // drawing 1 aircraft of 5 900, and the only words explaining that had
    // just been dismissed with the card (D15).
    useSelectionStore.setState({ selectedIcao: 'a1' });
    usePanelStore.setState({ mode: 'flight' });
    leaveFlight();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('leaves the aircraft list open, because the list is not the flight', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    usePanelStore.setState({ mode: 'list' });
    leaveFlight();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('list');
  });

  it('does not touch the fleet drawer, and a second call changes nothing', () => {
    // Idempotent on purpose: three surfaces call this, and two of them can
    // fire on the same gesture.
    useFilterStore.setState({ panelOpen: true });
    leaveFlight();
    leaveFlight();
    expect(useFilterStore.getState().panelOpen).toBe(true);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });
});
```

- [ ] **Step 6: Verificare il rosso**

```bash
npx vitest run tests/unit/state/flightFocus.test.ts
```

Expected: `Failed to resolve import "@/state/flightFocus"`. Zero test passati.

- [ ] **Step 7: Creare `src/state/flightFocus.ts`**

```ts
import { useSelectionStore } from './selectionStore';
import { usePanelStore } from './panelStore';

/**
 * Leave the flight: the selection and the card that exists only for it,
 * together — and, from Task 7, the airport card opened from it.
 *
 * Three surfaces end a focus — the card's ✕, Escape, and the search box's
 * clear button — and written three times they drifted. The ✕ called the
 * panel's close() alone: mode became 'closed', selectedIcao stayed set,
 * readVisibilityRule went on granting focus, and the globe went on drawing
 * one aircraft out of 5 900 while the only explanation on screen had just
 * been dismissed. That is the family of defects D15 ends, in its smallest
 * form: the picture shows less than the words claim, and nothing says so.
 *
 * Idempotent, because two surfaces can fire on one gesture.
 */
export function leaveFlight(): void {
  useSelectionStore.getState().select(null);
  // Not a second thing to close: the card exists only for the selected
  // flight, and a panel left in 'flight' mode with nothing selected renders
  // neither the card nor the toggle (D13). The aircraft list is a different
  // matter — it is not about this flight — so it stays as it was.
  if (usePanelStore.getState().mode === 'flight') usePanelStore.getState().close();
}
```

```bash
npx vitest run tests/unit/state/flightFocus.test.ts
```

Expected: **3 passed**. Suite intera: 373.

- [ ] **Step 8: Creare `tests/unit/state/escape.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { handleEscape } from '@/state/escape';
import { useSelectionStore } from '@/state/selectionStore';
import { useFilterStore } from '@/state/filterStore';
import { usePanelStore } from '@/state/panelStore';

describe('the Escape ladder', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedIcao: null });
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false });
    usePanelStore.setState({ mode: 'closed' });
  });

  it('leaves the flight first, and takes its card with it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'flight' });
    expect(handleEscape()).toBe(true);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    // The focus and the card opened for it are ONE act, undone together: a
    // panel still in 'flight' mode with nothing selected renders neither
    // the card nor the toggle — an empty box (D13).
    expect(usePanelStore.getState().mode).toBe('closed');
    // And exactly one act per press: the fleet drop-down has not moved.
    expect(useFilterStore.getState().panelOpen).toBe(true);
  });

  it('closes the fleet drop-down once nothing is focused', () => {
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'list' });
    expect(handleEscape()).toBe(true);
    expect(useFilterStore.getState().panelOpen).toBe(false);
    expect(usePanelStore.getState().mode).toBe('list');
  });

  it('closes the right-hand panel last', () => {
    usePanelStore.setState({ mode: 'list' });
    expect(handleEscape()).toBe(true);
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('says it consumed nothing when there is nothing to close', () => {
    // The return value is what lets AppShell leave preventDefault alone,
    // so a browser-level Escape — leaving full screen, stopping a load —
    // still works on a page where nothing of ours is open.
    expect(handleEscape()).toBe(false);
  });

  it('undoes one act per press, innermost first, then stops', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useFilterStore.setState({ panelOpen: true });
    usePanelStore.setState({ mode: 'flight' });

    expect(handleEscape()).toBe(true); // the flight, and the card it opened
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
    expect(useFilterStore.getState().panelOpen).toBe(true);

    expect(handleEscape()).toBe(true); // the fleet drop-down
    expect(useFilterStore.getState().panelOpen).toBe(false);

    expect(handleEscape()).toBe(false); // nothing of ours is open
  });
});
```

- [ ] **Step 9: Verificare il rosso**

```bash
npx vitest run tests/unit/state/escape.test.ts
```

Expected: `Failed to resolve import "@/state/escape"`. Zero test passati.

- [ ] **Step 10: Creare `src/state/escape.ts`**

```ts
import { useSelectionStore } from './selectionStore';
import { useFilterStore } from './filterStore';
import { usePanelStore } from './panelStore';
import { leaveFlight } from './flightFocus';

/**
 * One Escape, one thing closed, innermost first.
 *
 * Before this, Escape was owned by SidePanel.tsx and closed the right-hand
 * panel. With a fleet drop-down, a focus mode, a search box and an airport
 * card, four independent listeners on the same key would all fire on the
 * same press and undo four things at once — which reads as the application
 * losing its place rather than obeying.
 *
 * The rungs above focus are added by Task 7 (the airport card) and Task 8
 * (the search), each one more specific than what it sits on.
 *
 * @returns true when this consumed the key. AppShell calls preventDefault
 *   only then, so a page with nothing of ours open still lets the browser
 *   handle Escape.
 */
export function handleEscape(): boolean {
  if (useSelectionStore.getState().selectedIcao !== null) {
    // One press undoes one ACT, and choosing a flight was one act: the
    // selection and the card opened for it go together. Which is exactly
    // why this is leaveFlight() and not two lines written here — the ✕ of
    // the card wrote its own version of this and got it wrong (D15).
    leaveFlight();
    return true;
  }
  if (useFilterStore.getState().panelOpen) {
    useFilterStore.getState().setPanelOpen(false);
    return true;
  }
  if (usePanelStore.getState().mode !== 'closed') {
    usePanelStore.getState().close();
    return true;
  }
  return false;
}
```

- [ ] **Step 11: Togliere il listener da `src/ui/SidePanel.tsx`**

Sostituire

```tsx
import { forwardRef, useEffect } from 'react';
```
con
```tsx
import { forwardRef } from 'react';
```

e cancellare interamente il blocco

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
```

`close` resta usato dalle righe `onClose={close}` sotto: non va rimosso dalle selezioni dello store.

- [ ] **Step 12: Dare il listener a `src/ui/AppShell.tsx`**

Aggiungere agli import:

```tsx
import { handleEscape } from '@/state/escape';
```

e, **prima** dello `useEffect` che monta la scena, il nuovo effetto:

```tsx
  // The only Escape listener in the application. See state/escape.ts for the
  // order; it is here rather than in a panel because the key belongs to the
  // page, not to whichever component happens to be mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (handleEscape()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

- [ ] **Step 13: Creare `tests/component/SidePanel.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidePanel } from '@/ui/SidePanel';
import { useAircraftStore } from '@/state/aircraftStore';
import { usePanelStore } from '@/state/panelStore';
import { useSelectionStore } from '@/state/selectionStore';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(icao: string, over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw({ icao24: icao, callsign: 'BAW274' }), trail: [], ...over };
}

describe('SidePanel — never an empty box', () => {
  beforeEach(() => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1')]]) });
    usePanelStore.setState({ mode: 'flight' });
    useSelectionStore.setState({ selectedIcao: null });
  });
  afterEach(cleanup);

  it('shows the flight while the feed still carries it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    expect(screen.getByText('BAW274')).toBeInTheDocument();
  });

  it('gives the sky back when the card is dismissed, not just the card', () => {
    // The ✕ called the panel's close() alone: mode went to 'closed',
    // selectedIcao stayed set, readVisibilityRule went on granting focus.
    // The globe kept showing 1 aircraft of 5 900 and the only words about
    // it had just been dismissed — the whole family of defects in one
    // click (D15). Decision D14 had even leant on the opposite: "the
    // focused flight's card is on screen".
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('says contact was lost when the aircraft leaves the payload', () => {
    // The server prunes the fleet every cycle, so this arrives by waiting.
    // Before this branch the panel fell through every condition and
    // rendered nothing at all — no card, no toggle — beside a globe that
    // had just refilled itself, with not a word about what happened. That
    // is the v1 failure in miniature: the picture changes, nobody explains.
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    render(<SidePanel />);
    expect(screen.getByText(/contact lost/i)).toBeInTheDocument();
    // The record is gone, so the callsign is gone with it. The ICAO24 is
    // the one identifier we still hold, and nothing is reconstructed.
    expect(screen.getByText('A1')).toBeInTheDocument();
  });

  it('gives that card a way out that leaves nothing behind it', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useAircraftStore.setState({ aircraft: new Map() });
    render(<SidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    expect(usePanelStore.getState().mode).toBe('closed');
  });

  it('falls back to the toggle if it is ever asked to show no flight at all', () => {
    // Belt and braces for D13: whatever clears the selection without
    // closing the panel, the user is still left with a control to touch.
    render(<SidePanel />);
    expect(
      screen.getByRole('button', { name: /open aircraft list/i })
    ).toBeInTheDocument();
  });

  it('says the position is unknown when the fleet carries the flight but not its place', () => {
    // The other half of D13. latitude is null whenever the provider sent
    // no position — the adapters write null on purpose
    // (src/data/sources/adsbLol.ts:30-31) — and AircraftList offers every
    // aircraft that has a callsign, position or not. readVisibilityRule
    // refuses focus to it, so the globe does not change at all: without
    // this line the user has chosen a flight, watched nothing happen, and
    // has nowhere to read why.
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { latitude: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    render(<SidePanel />);
    expect(screen.getByText('BAW274')).toBeInTheDocument(); // the card is there
    expect(screen.getByText(/position unknown/i)).toBeInTheDocument();
  });

  it('says it for a missing longitude too, and not for a flight it can place', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { longitude: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const shown = render(<SidePanel />);
    expect(screen.getByText(/position unknown/i)).toBeInTheDocument();
    shown.unmount();

    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1')]]) });
    render(<SidePanel />);
    expect(screen.queryByText(/position unknown/i)).toBeNull();
  });
});
```

- [ ] **Step 14: Verificare il rosso**

```bash
npx vitest run tests/component/SidePanel.test.tsx
```

Expected: **1 passed, 6 failed**. Passa solo il primo: la `FlightCard` di oggi si rende. Falliscono i due del contatto perso (`Unable to find an element with the text: /contact lost/i`), quello del ripiego sul toggle (`Unable to find an accessible element with the role "button"`) e i due della posizione ignota (`Unable to find an element with the text: /position unknown/i`), perché oggi `src/ui/SidePanel.tsx:26-30` non ha nessun ramo per «`flight` senza aereo», nessuno per «aereo senza posizione», e l'`<aside>` resta semplicemente vuoto o muto. E fallisce quello della ✕ (`expected 'a1' to be null`), perché oggi quel bottone chiama `close()` e basta: il pannello si chiude, il focus resta acceso. Quei sei fallimenti **sono** il difetto, visto dal test.

- [ ] **Step 15: Dare a `src/ui/SidePanel.tsx` i rami che mancano, e la riga che il globo non può dire da solo**

Aggiungere agli import:

```tsx
import { leaveFlight } from '@/state/flightFocus';
```

Sostituire la riga della scheda del volo

```tsx
      {mode === 'flight' && selectedAircraft && (
        <FlightCard aircraft={selectedAircraft} onClose={close} />
      )}
```
con
```tsx
      {/* leaveFlight, not close: the panel's close() sets mode to 'closed'
          and says nothing about the selection, so the ✕ used to dismiss the
          card while the focus stayed on — globe still drawing 1 aircraft of
          5 900, and the explanation gone with the card (D15). The ✕, Escape
          and the search box's clear button are the same act and now call
          the same function. */}
      {mode === 'flight' && selectedAircraft && (
        <FlightCard aircraft={selectedAircraft} onClose={leaveFlight} />
      )}
```

Sostituire

```tsx
      {mode === 'list' && <AircraftList onClose={close} />}
      {mode === 'closed' && <PanelToggle />}
```
con
```tsx
      {/* In the fleet, but nobody knows where. latitude and longitude are
          null whenever the provider sent no position — the adapters write
          null on purpose (src/data/sources/adsbLol.ts:30-31) — and
          AircraftList offers every aircraft that has a callsign, position
          or not. readVisibilityRule refuses focus to such an aircraft
          (D13), so the globe does not change at all when it is chosen:
          without this line the user has picked a flight, seen nothing
          happen, and has nowhere to read why. It sits under the card
          rather than inside it because it is the PANEL speaking about the
          globe, which is the same job the Contact lost branch does. */}
      {mode === 'flight' &&
        selectedAircraft !== null &&
        (selectedAircraft.latitude === null || selectedAircraft.longitude === null) && (
          <p className="panel__note">Position unknown — not shown on the globe</p>
        )}
      {/* Selected, but the payload no longer carries it. The server prunes
          the fleet every cycle, so this arrives by waiting. Without this
          branch the panel renders NOTHING — no card, no toggle — next to a
          globe that has just refilled, and the screen changes with nobody
          saying why (D13). */}
      {mode === 'flight' && selectedIcao !== null && selectedAircraft === null && (
        <LostContact icao24={selectedIcao} onClose={leaveFlight} />
      )}
      {mode === 'list' && <AircraftList onClose={close} />}
      {/* 'flight' with nothing selected has no card to show, so it shows
          the way back in instead. This panel never renders an empty box. */}
      {(mode === 'closed' || (mode === 'flight' && selectedIcao === null)) && <PanelToggle />}
```

e aggiungere, in fondo al file, accanto a `PanelToggle`:

```tsx
interface LostContactProps {
  icao24: string;
  onClose: () => void;
}

/**
 * The flight left the feed while the user was looking at it.
 *
 * The record is gone and the callsign went with it: the one identifier
 * still in hand is the ICAO24 address that the click produced, so that is
 * what this shows. Nothing is reconstructed from memory and nothing is
 * estimated. The card exists to say that the screen changed and why — the
 * globe has already refilled by the time it appears (D13) — not to keep a
 * picture alive that we can no longer vouch for.
 */
function LostContact({ icao24, onClose }: LostContactProps) {
  return (
    <article aria-label="Contact lost">
      <header className="panel__header">
        <div className="panel__title-block">
          <h2 className="panel__callsign">Contact lost</h2>
          <span className="panel__operator">{icao24.toUpperCase()}</span>
        </div>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="route">No longer in the feed</div>
      <p className="panel__footer">
        The server prunes the fleet every cycle: this flight has landed, left
        ADS-B coverage, or stopped being reported. Everything else is on the
        globe again.
      </p>
    </article>
  );
}
```

`LostContact` non porta classi nuove: `panel__header`, `panel__title-block`, `panel__callsign`, `panel__operator`, `route` e `panel__footer` esistono già in `src/ui/styles.css`, e il bottone `aria-label="Close"` è già vestito dalla regola di riga 156. La riga della posizione ignota ne vuole invece una sua, perché `panel__footer` ha `margin-top: auto` (riga 174) e dentro la colonna flex del pannello finirebbe spinta in fondo, lontana dalla scheda che sta commentando.

- [ ] **Step 16: Aggiungere la regola della nota in `src/ui/styles.css`**

Sotto la riga `.panel__footer { … }` aggiungere:

```css
/* A line the PANEL says about the flight, not a field of the flight: why
   the globe is not showing what the card names. Deliberately quiet — it is
   a correction, not an alarm — and without the `margin-top: auto` of
   .panel__footer, which would push it to the bottom of the panel. */
.panel__note { font-size: 11px; opacity: 0.5; margin-top: var(--space-xs); }
```

- [ ] **Step 17: Verificare il verde**

```bash
npx vitest run tests/component/SidePanel.test.tsx
```

Expected: **7 passed**. Suite intera: 385.

- [ ] **Step 18: Collegare la dissolvenza in `src/globe/scene.ts`**

Aggiungere agli import:

```tsx
import { createFocusFade } from './focus';
```

Aggiungere, subito dopo `const leader = new LeaderLine(leaderSvg, () => canvas);`:

```ts
  const focusFade = createFocusFade();
```

Sostituire il blocco che lo Step 9 del Task 2 ha lasciato,

```ts
    const rule = readVisibilityRule();
    const tAC = performance.now();
    aircraftLayer.update(aircraftMap.values(), selectedIcao, rule, 1);
```

con

```ts
    const rule = readVisibilityRule();
    // `time` is the rAF timestamp: monotonic by specification. Date.now()
    // moves by ~528 ms every ~32 s on this machine, which would end a 300 ms
    // fade before it began.
    const othersBrightness = focusFade.sample(
      rule.focusedIcao,
      time,
      useA11yStore.getState().prefersReducedMotion
    );
    const tAC = performance.now();
    aircraftLayer.update(aircraftMap.values(), selectedIcao, rule, othersBrightness);
```

- [ ] **Step 19: Verificare build, suite e browser**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, **385 passed (42 files)**.

Verifica a occhio: `npm run dev:full`, cliccare un aereo. Gli altri devono sbiadire in ~0,3 s, non sparire di colpo — e il **primo** fotogramma dopo il caricamento deve mostrare il cielo pieno, non un globo vuoto che si riempie (è il difetto che lo Step 3 chiude). `Esc` deve riportare gli altri **nello stesso istante** — nessun lampo di globo nero che si riaccende in mezzo secondo — e chiudere la scheda del volo insieme; una seconda `Esc` chiude il pannello della flotta. **La ✕ della scheda deve fare esattamente quello che fa `Esc`**: il cielo torna pieno. Se chiudendo la scheda il globo resta con un aereo solo, lo Step 15 non è stato applicato e il difetto è di nuovo quello di D15 — lo schermo mostra meno di quanto dichiara, e l'unica riga che lo spiegava se n'è appena andata. Poi aprire la lista (`Aircraft`) e scegliere un volo: se capita su uno senza posizione, il globo **non** deve svuotarsi e la scheda deve dire «Position unknown». Non è un caso che si possa evocare a comando da un browser, ed è esattamente il motivo per cui a presidiarlo sono i test del Task 2 e dello Step 13, non questa riga.

- [ ] **Step 20: Commit**

```bash
git add src/globe/focus.ts src/globe/scene.ts src/state/flightFocus.ts src/state/escape.ts \
        src/ui/AppShell.tsx src/ui/SidePanel.tsx src/ui/styles.css \
        tests/unit/globe/focus.test.ts tests/unit/state/flightFocus.test.ts \
        tests/unit/state/escape.test.ts tests/component/SidePanel.test.tsx
git commit -m "feat(globe): clicking a flight empties the sky around it, and leaving it fills it back"
```

---

### Task 5: Gli estremi della rotta, risolti o dichiarati assenti

Prima di disegnare un arco bisogna sapere **dove** sono i suoi due capi, e cosa fare quando non lo sappiamo. Misurato il 2026-11-21 sulla cache committata: 13 codici IATA su 8 486 estremi non esistono in `public/data/airports.json`, e toccano 17 rotte su 4 243 — lo 0,4 %. Oggi quelle 17 rotte vengono mostrate come **«Route unknown»**, che è falso: la rotta la conosciamo, è la posizione dell'aeroporto a mancare.

**Files:**
- Create: `src/data/airportInfo.ts`
- Modify: `src/state/selectionStore.ts` — guadagna quale dei due capi ha la scheda aperta
- Modify: `src/ui/FlightCard.tsx` — legge la rotta dal campo autorevole invece che dalla tabella locale
- Modify: `src/ui/styles.css` — una riga di nota sotto la rotta
- Test: `tests/unit/data/airportInfo.test.ts`, `tests/component/FlightCard.test.tsx`, `tests/unit/state/stores.test.ts` (blocco `selectionStore` esteso)

**Interfaces:**
- Consumes: `FlightRouteLite` da `src/types.ts`; `lookupAirport`/`initAirports` da `src/data/airportLookup.ts`
- Produces: `RouteEnd = 'origin' | 'destination'`; `AirportInfo = { end; iata; name: string | null; icao: string | null; city: string | null; lat: number | null; lon: number | null; terminal: string | null }`; `airportInfoFor(end, route): AirportInfo`; `routeEnds(route)`; `isPlaceable(a): boolean`; `useSelectionStore` guadagna `openEnd: RouteEnd | null` e `openAirport(end)`

**Il nome dell'aeroporto viene da adsbdb, non dalla tabella locale.** `FlightRouteLite.originName` è ciò che adsbdb ha risposto **per quel volo**; la tabella bundled è un file OpenFlights generico. Quando i due nomi divergono vince quello che riguarda il volo in questione. La tabella serve per ciò che adsbdb non manda: ICAO, città e — l'unica cosa indispensabile — le coordinate.

**Il terminal è modellato e non sarà mai popolato, ed è l'esito corretto.** Non aggiungo un campo `terminal` a `FlightRouteLite`: sarebbe un `null` su ogni record di un payload da 0,84 MB per un dato che nessuna sorgente gratuita espone (spec §2). Il tipo di UI lo prevede, la scheda renderizza quella riga solo se è non-null, e in produzione non comparirà. L'alternativa è scrivere «Terminal —», che suggerisce un terminal che non abbiamo.

- [ ] **Step 1: Creare `tests/unit/data/airportInfo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { airportInfoFor, routeEnds, isPlaceable } from '@/data/airportInfo';
import { initAirports } from '@/data/airportLookup';
import type { FlightRouteLite } from '@/types';

const JFK = {
  iata: 'JFK',
  icao: 'KJFK',
  name: 'John F Kennedy International Airport',
  city: 'New York',
  country: 'US',
  lat: 40.639801,
  lon: -73.7789,
  timezone: 'America/New_York',
};

// FRU is one of the 13 IATA codes that the real route cache contains and
// public/data/airports.json does not (measured 2026-11-21: ADS APC BBX BLM
// FOK FRU JCI MEV MSC MVY OXC SUA TNT). It is left OUT of the table here on
// purpose: these are the 17 routes of 4 243 that cannot be drawn.
const ROUTE: FlightRouteLite = {
  originIata: 'JFK',
  originName: 'Kennedy',
  destinationIata: 'FRU',
  destinationName: 'Manas International Airport',
  airlineName: 'Somebody',
};

describe('airportInfoFor', () => {
  beforeEach(() => initAirports([JFK]));

  it('takes the name from adsbdb, which answered about THIS flight', () => {
    // The bundled table is a generic OpenFlights dump; the route record is
    // what the provider said about this callsign. When they disagree the
    // specific one wins.
    expect(airportInfoFor('origin', ROUTE).name).toBe('Kennedy');
  });

  it('fills code, city and coordinates from the bundled table', () => {
    const a = airportInfoFor('origin', ROUTE);
    expect(a.icao).toBe('KJFK');
    expect(a.city).toBe('New York');
    expect(a.lat).toBeCloseTo(40.6398, 3);
    expect(a.lon).toBeCloseTo(-73.7789, 3);
  });

  it('leaves every table field null for a code the table does not know', () => {
    // 13 such codes in the committed cache. Guessing a position from a name
    // is exactly the v1 failure in another costume.
    const a = airportInfoFor('destination', ROUTE);
    expect(a.name).toBe('Manas International Airport'); // adsbdb still told us
    expect(a.icao).toBeNull();
    expect(a.city).toBeNull();
    expect(a.lat).toBeNull();
    expect(a.lon).toBeNull();
  });

  it('never invents a terminal', () => {
    // No free source exposes terminals (spec §2). The field exists so the
    // card can render it IF one ever arrives, and it stays null.
    expect(airportInfoFor('origin', ROUTE).terminal).toBeNull();
    expect(airportInfoFor('destination', ROUTE).terminal).toBeNull();
  });

  it('falls back to the table name only when adsbdb sent an empty one', () => {
    const blank = { ...ROUTE, originName: '   ' };
    expect(airportInfoFor('origin', blank).name).toBe('John F Kennedy International Airport');
  });

  it('marks as placeable only what has both coordinates', () => {
    const ends = routeEnds(ROUTE);
    expect(ends.origin.end).toBe('origin');
    expect(ends.destination.end).toBe('destination');
    expect(isPlaceable(ends.origin)).toBe(true);
    expect(isPlaceable(ends.destination)).toBe(false);
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/data/airportInfo.test.ts
```

Expected: `Failed to resolve import "@/data/airportInfo"`. Zero test passati.

- [ ] **Step 3: Creare `src/data/airportInfo.ts`**

```ts
import type { FlightRouteLite } from '@/types';
import { lookupAirport } from './airportLookup';

export type RouteEnd = 'origin' | 'destination';

export interface AirportInfo {
  /** 'origin' draws D, 'destination' draws A. */
  end: RouteEnd;
  iata: string;
  /** adsbdb's name for this flight's airport; the table's only as a fallback. */
  name: string | null;
  icao: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  /**
   * Modelled, never populated.
   *
   * No free source exposes terminals (spec §2, non-goals). The card renders
   * this row only when it is non-null, so in production it never renders —
   * which is the right outcome. Writing "Terminal —" would suggest a
   * terminal we do not have, and writing a number would be Aalborg->Aarhus
   * wearing a different hat.
   */
  terminal: string | null;
}

/**
 * One end of a route, resolved as far as our data honestly goes.
 *
 * The name comes from the route record because adsbdb answered about THIS
 * callsign; the bundled OpenFlights table is generic and only supplies what
 * the provider does not send. Measured 2026-11-21: 13 IATA codes present in
 * the route cache are absent from that table, touching 17 of 4 243 routes.
 * For those every table-sourced field stays null and nothing is guessed.
 */
export function airportInfoFor(end: RouteEnd, route: FlightRouteLite): AirportInfo {
  const iata = end === 'origin' ? route.originIata : route.destinationIata;
  const sent = (end === 'origin' ? route.originName : route.destinationName).trim();
  const table = lookupAirport(iata);
  return {
    end,
    iata,
    name: sent !== '' ? sent : table?.name ?? null,
    icao: table?.icao ?? null,
    city: table?.city ?? null,
    lat: table?.lat ?? null,
    lon: table?.lon ?? null,
    terminal: null,
  };
}

export function routeEnds(route: FlightRouteLite): {
  origin: AirportInfo;
  destination: AirportInfo;
} {
  return {
    origin: airportInfoFor('origin', route),
    destination: airportInfoFor('destination', route),
  };
}

/** Can this end be put on the globe at all? No coordinates, no marker, no arc. */
export function isPlaceable(a: AirportInfo): boolean {
  return a.lat !== null && a.lon !== null;
}
```

- [ ] **Step 4: Verificare il verde**

```bash
npx vitest run tests/unit/data/airportInfo.test.ts
```

Expected: **6 passed**. Suite intera: 391.

- [ ] **Step 5: Estendere il blocco `selectionStore` di `tests/unit/state/stores.test.ts`**

Sostituire il blocco

```ts
describe('selectionStore', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIcao: null }));
  it('select sets selectedIcao', () => {
    useSelectionStore.getState().select('a1');
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });
  it('select(null) clears', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });
});
```

con

```ts
describe('selectionStore', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIcao: null, openEnd: null }));
  it('select sets selectedIcao', () => {
    useSelectionStore.getState().select('a1');
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });
  it('select(null) clears', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });
  it('opens one end of the route at a time', () => {
    useSelectionStore.getState().openAirport('origin');
    expect(useSelectionStore.getState().openEnd).toBe('origin');
    useSelectionStore.getState().openAirport('destination');
    expect(useSelectionStore.getState().openEnd).toBe('destination');
  });
  it('shuts the airport card when a different flight is selected', () => {
    // Otherwise the card for LHR stays on screen over the next flight's
    // route, labelled with an airport that has nothing to do with it.
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    useSelectionStore.getState().select('a2');
    expect(useSelectionStore.getState().openEnd).toBeNull();
  });
  it('shuts the airport card when focus ends', () => {
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'destination' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().openEnd).toBeNull();
  });
});
```

- [ ] **Step 6: Verificare il rosso**

```bash
npx vitest run tests/unit/state/stores.test.ts
```

Expected: i tre test nuovi falliscono — `openAirport is not a function` — e i due vecchi restano verdi.

- [ ] **Step 7: Sostituire `src/state/selectionStore.ts`**

```ts
import { create } from 'zustand';
import type { RouteEnd } from '@/data/airportInfo';

interface SelectionState {
  selectedIcao: string | null;
  /**
   * Which D/A marker has its card open, if any. It lives beside the
   * selection because it is meaningless without one, and because changing
   * flight has to close it: a card for LHR left floating over the next
   * flight's route would be labelled with an airport that flight never
   * touches.
   */
  openEnd: RouteEnd | null;
  select: (icao: string | null) => void;
  openAirport: (end: RouteEnd | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIcao: null,
  openEnd: null,
  select: (icao) => set({ selectedIcao: icao, openEnd: null }),
  openAirport: (end) => set({ openEnd: end }),
}));
```

- [ ] **Step 8: Creare `tests/component/FlightCard.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlightCard } from '@/ui/FlightCard';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const JFK = {
  iata: 'JFK', icao: 'KJFK', name: 'John F Kennedy International Airport',
  city: 'New York', country: 'US', lat: 40.639801, lon: -73.7789,
  timezone: 'America/New_York',
};
const MIA = {
  iata: 'MIA', icao: 'KMIA', name: 'Miami International Airport',
  city: 'Miami', country: 'US', lat: 25.79325, lon: -80.290556,
  timezone: 'America/New_York',
};

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('FlightCard', () => {
  beforeEach(() => initAirports([JFK, MIA]));
  afterEach(cleanup);

  it('shows the real route', () => {
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'MIA', destinationName: 'Miami',
        airlineName: 'American Airlines',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.getByText(/JFK\s*→\s*MIA/)).toBeInTheDocument();
  });

  it('still shows the route when the airport table does not know an endpoint', () => {
    // 13 IATA codes of the committed route cache are missing from
    // public/data/airports.json, touching 17 of 4 243 routes. Until now
    // those read "Route unknown", which is false: we know the route, we
    // just do not know where one of its ends is.
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'FRU', destinationName: 'Manas International Airport',
        airlineName: 'Somebody',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.getByText(/JFK\s*→\s*FRU/)).toBeInTheDocument();
    expect(screen.getByText(/airport position unknown/i)).toBeInTheDocument();
  });

  it('says the route is unknown when there is genuinely none, and draws no arrow', () => {
    render(<FlightCard aircraft={ac({ route: null })} onClose={() => {}} />);
    expect(screen.getByText(/route unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });
});
```

- [ ] **Step 9: Verificare il rosso**

```bash
npx vitest run tests/component/FlightCard.test.tsx
```

Expected: 2 passed, **1 failed** — il secondo test. Oggi `src/ui/FlightCard.tsx:31` decide con `r?.origin && r?.destination`, cioè con il risultato di `lookupAirport`, quindi per `FRU` cade sul ramo «Route unknown». È il difetto che questo step apre.

- [ ] **Step 10: Sostituire il blocco della rotta in `src/ui/FlightCard.tsx`**

Aggiungere agli import:

```tsx
import { routeEnds, isPlaceable } from '@/data/airportInfo';
```

Sostituire

```tsx
      {r?.origin && r?.destination ? (
        <>
          <div className="route">
            {r.origin.iata} → {r.destination.iata}
          </div>
          <div className="times">
            {originTime} · {destTime}
          </div>
        </>
      ) : (
        <div className="route">Route unknown</div>
      )}
```

con

```tsx
      {/* Decided on aircraft.route, the field the server fills from adsbdb,
          NOT on what lookupAirport() could find. 13 IATA codes of the route
          cache are missing from the bundled table and those flights used to
          read "Route unknown", which is false: the route is known, one of
          its airports has no coordinates here. */}
      {ends ? (
        <>
          <div className="route">
            {ends.origin.iata} → {ends.destination.iata}
          </div>
          {originTime && destTime && (
            <div className="times">
              {originTime} · {destTime}
            </div>
          )}
          {(!isPlaceable(ends.origin) || !isPlaceable(ends.destination)) && (
            <div className="route__note">Airport position unknown — no arc drawn</div>
          )}
        </>
      ) : (
        <div className="route">Route unknown</div>
      )}
```

e aggiungere, sopra `const lastSeen =`:

```tsx
  const ends = aircraft.route ? routeEnds(aircraft.route) : null;
```

- [ ] **Step 11: Aggiungere lo stile della nota in `src/ui/styles.css`**

Sotto la riga `.route { font-size: 17px; letter-spacing: -0.374px; margin-bottom: 4px; }` aggiungere:

```css
.route__note { font-size: 11px; opacity: 0.5; margin-bottom: 4px; }
```

- [ ] **Step 12: Verificare il verde e l'intera suite**

```bash
npx vitest run tests/component/FlightCard.test.tsx tests/unit/state/stores.test.ts
npm run build:all && npm test -- --run
```

Expected: 3 passed in `FlightCard.test.tsx`, 18 passed in `stores.test.ts` (15 preesistenti + 3); build pulita; **397 passed (44 files)**.

- [ ] **Step 13: Commit**

```bash
git add src/data/airportInfo.ts src/state/selectionStore.ts src/ui/FlightCard.tsx \
        src/ui/styles.css tests/unit/data/airportInfo.test.ts \
        tests/component/FlightCard.test.tsx tests/unit/state/stores.test.ts
git commit -m "fix(ui): a route whose airport we cannot place is still a route"
```

---

### Task 6: L'arco geodetico azzurro

Terza richiesta dell'utente: in focus compare la rotta del volo. Una geodetica vera, non una linea dritta su lat/lon.

**Files:**
- Create: `src/globe/routeArc.ts`
- Modify: `src/state/sceneView.ts` (la selezione diventa un arco disegnabile, o niente), `src/globe/scene.ts`
- Test: `tests/unit/globe/routeArc.test.ts`

**Interfaces:**
- Consumes: `latLonToVec3`, `vec3ToLatLon`, `GLOBE_RADIUS` da `src/globe/geoHelpers.ts`; `routeEnds` dal Task 5
- Produces: `GeoPointDeg = { lat: number; lon: number }`; `ARC_COLOR`; `MIN_ARC_SAMPLES`/`MAX_ARC_SAMPLES`; `greatCircleRad(a, b): number`; `arcSampleCount(omegaRad): number`; `geodesicPoints(a, b): Vector3[] | null`; `flownFraction(a, b, at): number`; `createRouteArcLayer(): RouteArcLayer` con `update(arc: DrawableArc | null)`; `DrawableArc = { origin; destination; aircraft: GeoPointDeg | null }`; `readDrawableArc(): DrawableArc | null` in `sceneView`

**Perché slerp e non l'interpolazione di lat/lon.** `src/globe/continents.ts:61-70` interpola linearmente lat e lon per le coste, e su segmenti di 2° va benissimo. Su JFK→LHR produrrebbe la lossodromia. Verificato numericamente il 2026-11-21: il punto medio del **grande cerchio** JFK→LHR sta a **52,21 °N**, cioè più a nord di entrambi gli aeroporti (40,64 e 51,47), mentre la media lineare delle due latitudini è 46,06 °N — più a sud di Londra. Sono due linee diverse di centinaia di chilometri, e chi conosce le rotte nordatlantiche vede la differenza. Lo slerp fra i due vettori unitari **è** il grande cerchio, per definizione, e `latLonToVec3` quei vettori li dà già.

**Il caso degenere non si aggira, si riconosce.** Due punti coincidenti e due punti antipodali non hanno un grande cerchio unico: lo slerp divide per `sin(ω)` che vale zero, e il risultato è `NaN` propagato in un buffer di posizioni, cioè geometria invisibile e nessun errore. `geodesicPoints` risponde `null` e il layer non disegna. Fra aeroporti reali non capita, ma un `NaN` silenzioso in un render loop è il genere di guasto che resta in produzione per mesi.

- [ ] **Step 1: Creare `tests/unit/globe/routeArc.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { LineSegments } from 'three';
import {
  ARC_COLOR,
  MIN_ARC_SAMPLES,
  MAX_ARC_SAMPLES,
  greatCircleRad,
  arcSampleCount,
  geodesicPoints,
  flownFraction,
  createRouteArcLayer,
} from '@/globe/routeArc';
import { GLOBE_RADIUS, vec3ToLatLon } from '@/globe/geoHelpers';

const JFK = { lat: 40.6398, lon: -73.7789 };
const LHR = { lat: 51.4706, lon: -0.461941 };
// The true great-circle midpoint, computed 2026-11-21. Note it is NORTH of
// both airports — a linear lat/lon interpolation lands at 46,06.
const MID = { lat: 52.215, lon: -41.307 };

function geometryOf(layer: ReturnType<typeof createRouteArcLayer>): LineSegments['geometry'] {
  const child = layer.group.children[0];
  if (!child) throw new Error('arc layer has no drawable child');
  return (child as LineSegments).geometry;
}

describe('geodesic arc', () => {
  it('uses the one accent colour reserved for selection', () => {
    expect(ARC_COLOR).toEqual([0.16, 0.59, 1.0]); // #2997ff
  });

  it('measures the angle at the centre of the Earth, and feeds it to the sampler', () => {
    // greatCircleRad is imported here because it is EXERCISED here. With
    // `noUnusedLocals: true` and `tests` inside the include list of
    // tsconfig.json, an import nobody reads is TS6133 — and `tsc --noEmit`
    // is the first half of `npm run build`, so a decorative import stops
    // the build gate of this task and of Tasks 7, 8 and 9 with it.
    // Computed 2026-11-21: JFK->LHR subtends 0,8695 rad = 49,82 deg =
    // 2 991 NM, and that angle is the only input the sampler has.
    expect(greatCircleRad(JFK, LHR)).toBeCloseTo(0.8695, 3);
    expect(greatCircleRad(JFK, { ...JFK })).toBeCloseTo(0, 6);
    expect(arcSampleCount(greatCircleRad(JFK, LHR))).toBe(71);
  });

  it('starts and ends exactly on the two airports', () => {
    const pts = geodesicPoints(JFK, LHR);
    expect(pts).not.toBeNull();
    const first = vec3ToLatLon(pts![0]!);
    const last = vec3ToLatLon(pts![pts!.length - 1]!);
    expect(first.lat).toBeCloseTo(JFK.lat, 4);
    expect(first.lon).toBeCloseTo(JFK.lon, 4);
    expect(last.lat).toBeCloseTo(LHR.lat, 4);
    expect(last.lon).toBeCloseTo(LHR.lon, 4);
  });

  it('bends NORTH of both airports — a great circle, not a rhumb line', () => {
    // The whole reason this module exists. Interpolating lat/lon linearly
    // would put the midpoint at 46,06 N, south of London; the real route
    // passes at 52,2 N. Drawing the straight one is a geometric lie
    // visible to anyone who knows the North Atlantic tracks.
    const pts = geodesicPoints(JFK, LHR)!;
    const mid = vec3ToLatLon(pts[Math.floor(pts.length / 2)]!);
    expect(mid.lat).toBeGreaterThan(LHR.lat);
    expect(mid.lat).toBeCloseTo(MID.lat, 0);
  });

  it('samples more densely the longer the arc, within its bounds', () => {
    const short = arcSampleCount(0.02);
    const long = arcSampleCount(Math.PI * 0.95);
    expect(short).toBe(MIN_ARC_SAMPLES);
    expect(long).toBeLessThanOrEqual(MAX_ARC_SAMPLES);
    expect(long).toBeGreaterThan(short);
  });

  it('refuses two coincident points instead of dividing by zero', () => {
    expect(geodesicPoints(JFK, { ...JFK })).toBeNull();
  });

  it('refuses antipodal points, which have no unique great circle', () => {
    // sin(omega) is 0 here too, and an unguarded slerp writes NaN into the
    // position buffer: invisible geometry and no error anywhere.
    expect(geodesicPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeNull();
  });

  it('floats the whole arc above the surface so it is never inside the globe', () => {
    for (const p of geodesicPoints(JFK, LHR)!) {
      expect(p.length()).toBeGreaterThan(GLOBE_RADIUS);
    }
  });

  it('measures how much of the route has been flown, and clamps outside it', () => {
    expect(flownFraction(JFK, LHR, JFK)).toBeCloseTo(0, 3);
    expect(flownFraction(JFK, LHR, LHR)).toBeCloseTo(1, 3);
    expect(flownFraction(JFK, LHR, MID)).toBeCloseTo(0.5, 1);
    // A diverted aircraft past its destination must not produce a fraction
    // above 1 and index past the end of the buffer.
    expect(flownFraction(JFK, LHR, { lat: 55, lon: 20 })).toBeLessThanOrEqual(1);
  });

  it('draws nothing at all when there is no route — the grey case', () => {
    // Spec §6.2: clicking a grey aircraft focuses it and says "Route
    // unknown". No arc, no estimate, no dashed guess.
    const layer = createRouteArcLayer();
    layer.update(null);
    expect(geometryOf(layer).drawRange.count).toBe(0);
  });

  it('draws the flown half dimmer than the half still ahead', () => {
    const layer = createRouteArcLayer();
    layer.update({ origin: JFK, destination: LHR, aircraft: MID });
    const geom = geometryOf(layer);
    const count = geom.drawRange.count;
    expect(count).toBeGreaterThan(0);
    const col = geom.getAttribute('color').array as Float32Array;
    expect(col[0]!).toBeLessThan(col[(count - 1) * 3]!);
  });

  it('draws one even arc when no aircraft sits on it', () => {
    // Search outcome 2: the flight is known to us but outside ADS-B
    // coverage. There is no aircraft, so there is no "already flown".
    const layer = createRouteArcLayer();
    layer.update({ origin: JFK, destination: LHR, aircraft: null });
    const geom = geometryOf(layer);
    const count = geom.drawRange.count;
    const col = geom.getAttribute('color').array as Float32Array;
    expect(col[0]!).toBeCloseTo(col[(count - 1) * 3]!, 5);
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/routeArc.test.ts
```

Expected: `Failed to resolve import "@/globe/routeArc"`. Zero test passati.

- [ ] **Step 3: Creare `src/globe/routeArc.ts`**

```ts
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sphere,
  Vector3,
} from 'three';
import { GLOBE_RADIUS, latLonToVec3 } from './geoHelpers';

export interface GeoPointDeg {
  lat: number;
  lon: number;
}

export interface DrawableArc {
  origin: GeoPointDeg;
  destination: GeoPointDeg;
  /** Where the aircraft is, or null when the flight is outside coverage. */
  aircraft: GeoPointDeg | null;
}

/** #2997ff — the single accent, shared with the selected aircraft. */
export const ARC_COLOR: [number, number, number] = [0.16, 0.59, 1.0];

/** Below this a short hop looks like a polyline; above it a polar route is wasted vertices. */
export const MIN_ARC_SAMPLES = 24;
export const MAX_ARC_SAMPLES = 256;

const FLOWN_BRIGHTNESS = 0.3;
const AHEAD_BRIGHTNESS = 1.0;

/** Just clear of the surface, and of the continent hairlines at R * 1.003. */
const ARC_BASE_OFFSET = 0.018;
/** How far the arc bows out at its apex, in proportion to its own length. */
const ARC_APEX_MIN = 0.012;
const ARC_APEX_RANGE = 0.055;

/** Angle at the centre of the Earth between two points, in radians. */
export function greatCircleRad(a: GeoPointDeg, b: GeoPointDeg): number {
  const va = latLonToVec3(a.lat, a.lon, 1).normalize();
  const vb = latLonToVec3(b.lat, b.lon, 1).normalize();
  return Math.acos(Math.min(1, Math.max(-1, va.dot(vb))));
}

export function arcSampleCount(omegaRad: number): number {
  const wanted = Math.round((omegaRad / Math.PI) * MAX_ARC_SAMPLES);
  return Math.min(MAX_ARC_SAMPLES, Math.max(MIN_ARC_SAMPLES, wanted));
}

/**
 * The great circle between two airports, sampled by slerp.
 *
 * Slerp between two unit vectors IS the great circle, by definition, and
 * geoHelpers already produces those vectors. The alternative — interpolating
 * lat and lon linearly, which continents.ts does for coastlines over 2°
 * segments — draws the rhumb line: measured on JFK->LHR it puts the
 * midpoint at 46,06 N instead of 52,21 N, south of London instead of north
 * of it. Real routes curve on the sphere and drawing them straight is a lie
 * anyone who knows the North Atlantic tracks can see.
 *
 * Returns null for coincident and antipodal pairs. Both make sin(omega)
 * zero, and an unguarded slerp would write NaN into a position buffer:
 * invisible geometry, no error, nobody notices for months.
 */
export function geodesicPoints(a: GeoPointDeg, b: GeoPointDeg): Vector3[] | null {
  const omega = greatCircleRad(a, b);
  if (!Number.isFinite(omega)) return null;
  if (omega < 1e-6 || omega > Math.PI - 1e-6) return null;

  const va = latLonToVec3(a.lat, a.lon, 1).normalize();
  const vb = latLonToVec3(b.lat, b.lon, 1).normalize();
  const sinOmega = Math.sin(omega);
  const samples = arcSampleCount(omega);
  const apex = ARC_APEX_MIN + ARC_APEX_RANGE * (omega / Math.PI);

  const out: Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const f1 = Math.sin((1 - t) * omega) / sinOmega;
    const f2 = Math.sin(t * omega) / sinOmega;
    const radius = GLOBE_RADIUS + ARC_BASE_OFFSET + apex * Math.sin(Math.PI * t);
    out.push(
      new Vector3(
        (va.x * f1 + vb.x * f2) * radius,
        (va.y * f1 + vb.y * f2) * radius,
        (va.z * f1 + vb.z * f2) * radius
      )
    );
  }
  return out;
}

/**
 * How much of the route is behind the aircraft, 0..1.
 *
 * Measured as travelled angle over total angle — a real distance, not a
 * guess. A diverted aircraft off the great circle still produces an honest
 * "how far along", and the clamp keeps a flight past its destination from
 * indexing off the end of the buffer.
 */
export function flownFraction(a: GeoPointDeg, b: GeoPointDeg, at: GeoPointDeg): number {
  const total = greatCircleRad(a, b);
  if (total < 1e-9) return 0;
  return Math.min(1, Math.max(0, greatCircleRad(a, at) / total));
}

export interface RouteArcLayer {
  group: Group;
  update: (arc: DrawableArc | null) => void;
}

/**
 * One arc at a time: focus is about one flight, and the search ghost
 * replaces it rather than adding to it.
 */
export function createRouteArcLayer(): RouteArcLayer {
  const maxVertices = (MAX_ARC_SAMPLES - 1) * 2;
  const positions = new Float32Array(maxVertices * 3);
  const colors = new Float32Array(maxVertices * 3);

  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('color', colorAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), GLOBE_RADIUS + 0.5);

  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Same choice the trails make: the arc of the one flight in focus is
    // readable through the globe rather than cut in half by it.
    depthTest: false,
  });

  const lines = new LineSegments(geom, mat);
  lines.renderOrder = 5; // above the aircraft: in focus it IS the subject
  lines.frustumCulled = false;

  const group = new Group();
  group.add(lines);

  function writeVertex(i: number, p: Vector3, brightness: number): void {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    colors[i * 3] = ARC_COLOR[0] * brightness;
    colors[i * 3 + 1] = ARC_COLOR[1] * brightness;
    colors[i * 3 + 2] = ARC_COLOR[2] * brightness;
  }

  function update(arc: DrawableArc | null): void {
    if (arc === null) {
      geom.setDrawRange(0, 0);
      return;
    }
    const pts = geodesicPoints(arc.origin, arc.destination);
    if (pts === null) {
      geom.setDrawRange(0, 0);
      return;
    }
    // No aircraft on the arc means nothing has been "already flown" that we
    // know of — the off-coverage case of spec §6.3.2. One even brightness.
    const flown =
      arc.aircraft === null ? 0 : flownFraction(arc.origin, arc.destination, arc.aircraft);

    let v = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const tA = i / (pts.length - 1);
      const tB = (i + 1) / (pts.length - 1);
      const brightA = arc.aircraft !== null && tA < flown ? FLOWN_BRIGHTNESS : AHEAD_BRIGHTNESS;
      const brightB = arc.aircraft !== null && tB < flown ? FLOWN_BRIGHTNESS : AHEAD_BRIGHTNESS;
      writeVertex(v++, pts[i]!, brightA);
      writeVertex(v++, pts[i + 1]!, brightB);
    }
    geom.setDrawRange(0, v);
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  return { group, update };
}
```

- [ ] **Step 4: Verificare il verde**

```bash
npx vitest run tests/unit/globe/routeArc.test.ts
```

Expected: **12 passed**. Suite intera: 409.

- [ ] **Step 5: Aggiungere `readDrawableArc` a `src/state/sceneView.ts`**

Aggiungere agli import del file:

```ts
import { useAircraftStore } from './aircraftStore';
import { routeEnds } from '@/data/airportInfo';
import type { DrawableArc } from '@/globe/routeArc';
```

e, in fondo:

```ts
/**
 * The arc the globe should be drawing, or nothing.
 *
 * Four separate reasons to draw nothing, and all four are honest outcomes
 * rather than failures: no flight in focus; a flight whose route adsbdb
 * does not know (the grey population — spec §6.2 shows "Route unknown" and
 * no arc); a route whose airport is missing from the bundled table (13
 * codes, 17 of 4 243 routes); and an aircraft the feed has dropped between
 * the click and this frame.
 */
export function readDrawableArc(): DrawableArc | null {
  const icao = useSelectionStore.getState().selectedIcao;
  if (icao === null) return null;
  const ac = useAircraftStore.getState().aircraft.get(icao);
  if (ac === undefined || ac.route === null) return null;
  const { origin, destination } = routeEnds(ac.route);
  if (origin.lat === null || origin.lon === null) return null;
  if (destination.lat === null || destination.lon === null) return null;
  return {
    origin: { lat: origin.lat, lon: origin.lon },
    destination: { lat: destination.lat, lon: destination.lon },
    aircraft:
      ac.latitude !== null && ac.longitude !== null
        ? { lat: ac.latitude, lon: ac.longitude }
        : null,
  };
}
```

- [ ] **Step 6: Montare il layer in `src/globe/scene.ts`**

Aggiungere agli import:

```ts
import { createRouteArcLayer } from './routeArc';
```

e completare l'import esistente da `sceneView`:

```ts
import { readVisibilityRule, readDrawableArc } from '@/state/sceneView';
```

Aggiungere, dopo `const trailsLayer = createTrailsLayer(); scene.add(trailsLayer.group);`:

```ts
  const arcLayer = createRouteArcLayer();
  scene.add(arcLayer.group);
```

e, nel render loop, subito dopo la riga `trailsLayer.update(aircraftMap.values(), selectedIcao, rule);`:

```ts
    arcLayer.update(readDrawableArc());
```

- [ ] **Step 7: Verificare build, suite e browser**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, **409 passed (45 files)**.

Verifica a occhio: `npm run dev:full`, cliccare un aereo **blu** (completo). Deve comparire un arco azzurro curvo, più tenue dietro l'aereo e più luminoso davanti. Cliccare un aereo **grigio**: focus sì, arco no, e la scheda dice «Route unknown». Se compare un arco su un grigio, lo Step 5 ha un difetto.

- [ ] **Step 8: Commit**

```bash
git add src/globe/routeArc.ts src/globe/scene.ts src/state/sceneView.ts \
        tests/unit/globe/routeArc.test.ts
git commit -m "feat(globe): the route as the aircraft actually flies it, or nothing"
```

---

### Task 7: I marcatori D e A, e la scheda dell'aeroporto

Quarta richiesta: due marcatori precisi sulla mappa che si aggiornano con lo zoom, e che cliccati dicono nome e terminal — **solo se presenti nei nostri dati**.

**Files:**
- Create: `src/globe/airportMarkers.ts`, `src/ui/AirportCard.tsx`
- Modify: `src/state/sceneView.ts` (`readDrawableArc` diventa `readFocusView`, che serve arco e marcatori con una risoluzione sola, e non butta via l'estremo che sa collocare), `src/globe/scene.ts`, `src/ui/AppShell.tsx` (il contenitore dei marcatori), `src/ui/SidePanel.tsx` (ospita la scheda), `src/state/escape.ts` (il gradino più interno), `src/state/flightFocus.ts` (`leaveFlight` si porta via anche la scheda dell'aeroporto), `src/ui/styles.css`
- Test: `tests/unit/globe/airportMarkers.test.ts`, `tests/component/AirportCard.test.tsx`, `tests/unit/state/sceneView.test.ts` (esteso), `tests/unit/state/escape.test.ts` (esteso), `tests/unit/state/flightFocus.test.ts` (esteso)

**Interfaces:**
- Consumes: `AirportInfo`, `RouteEnd` dal Task 5; `DrawableArc`, `GeoPointDeg` dal Task 6
- Produces: `MARKER_LABEL_MAX_DISTANCE`; `markerLabelVisible(cameraDistance): boolean`; `projectMarker(point, camera, width, height): { x; y; visible }`; `MarkerSpec = { end; letter: 'D' | 'A'; iata; lat; lon }`; `createAirportMarkers(container, onPick): { update(specs, camera, width, height): void; dispose(): void }`; `readFocusView(): FocusView | null` — con `arc: DrawableArc | null`, perché un estremo non collocabile toglie l'arco e non il marcatore dell'altro — e `markerSpecs(view): MarkerSpec[]` in `sceneView`; `<AirportCard />`

**Come restano ancorati mentre si zooma e si ruota: non lo sono.** Non c'è nessuna posizione da mantenere aggiornata. A ogni frame si prende la coordinata geografica vera dell'aeroporto, la si proietta con `project(camera)` e si scrive una `transform`. Zoom, rotazione, damping delle `OrbitControls` e resize della finestra diventano corretti per costruzione, perché non esiste uno stato che possa restare indietro. È lo stesso meccanismo di `src/globe/leaderLine.ts:24-28`, già in produzione, e lo stesso test di emisfero (`camDir.dot(acDir) <= 0.05`) che `leaderLine.ts:19` e `raycaster.ts:30` usano entrambi.

**DOM e non `Points`.** Il marcatore deve essere cliccabile, raggiungibile da tastiera — axe gira sulla home in `tests/e2e/a11y.spec.ts` — e deve portare del testo: la lettera D/A e il codice IATA. In uno shader il testo costerebbe un atlante di glifi; in DOM è un `<button>`.

**La scheda dell'aeroporto si apre nel pannello destro, non in un popover sul globo.** Tre ragioni concrete: il pannello è già l'unico posto del prodotto dove vive il dettaglio e la leader line ci punta già; un popover sopra un globo 3D deve schivare il marcatore a cui appartiene e restare comunque raggiungibile da tastiera; e aggiornare un nodo React a 60 fps per inseguire un marcatore è lavoro che il render loop non deve fare. Il marcatore porta `aria-expanded`, così il legame fra il bottone e la scheda è dichiarato invece che solo visivo.

**La soglia dell'etichetta è una funzione pura.** `OrbitControls` tiene la camera fra 3,0 e 10,0 raggi di globo (`src/globe/scene.ts:45-46`): sotto 6,0 — la metà bassa della corsa — accanto al pallino compare il codice IATA. Una soglia scritta dentro il render loop non si potrebbe testare, e questa è esattamente il genere di costante che qualcuno cambia per sbaglio.

- [ ] **Step 1: Creare `tests/unit/globe/airportMarkers.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import {
  MARKER_LABEL_MAX_DISTANCE,
  markerLabelVisible,
  projectMarker,
  createAirportMarkers,
} from '@/globe/airportMarkers';
import type { MarkerSpec } from '@/globe/airportMarkers';

function camera(distance = 4.6): PerspectiveCamera {
  const c = new PerspectiveCamera(38, 800 / 600, 0.1, 100);
  c.position.set(0, 0, distance);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const SPECS: MarkerSpec[] = [
  { end: 'origin', letter: 'D', iata: 'JFK', lat: 0, lon: 0 },
  { end: 'destination', letter: 'A', iata: 'LHR', lat: 0, lon: 180 },
];

describe('airport markers', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('puts the label threshold inside the zoom range the controls allow', () => {
    // OrbitControls in scene.ts hold the camera between 3,0 and 10,0 globe
    // radii. A threshold outside that is a constant that can never fire.
    expect(MARKER_LABEL_MAX_DISTANCE).toBeGreaterThan(3.0);
    expect(MARKER_LABEL_MAX_DISTANCE).toBeLessThan(10.0);
  });

  it('shows the IATA label only once the camera is close enough', () => {
    expect(markerLabelVisible(3.2)).toBe(true);
    expect(markerLabelVisible(9.8)).toBe(false);
  });

  it('projects a point under the camera to the centre of the screen', () => {
    const p = projectMarker({ lat: 0, lon: 0 }, camera(), 800, 600);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(400, 0);
    expect(p.y).toBeCloseTo(300, 0);
  });

  it('hides a point on the far side of the globe', () => {
    // Same dot test leaderLine.ts and raycaster.ts already use. Without it
    // the destination marker floats over the ocean on the near face while
    // the airport is behind the planet.
    expect(projectMarker({ lat: 0, lon: 180 }, camera(), 800, 600).visible).toBe(false);
  });

  it('draws one button per end, labelled D and A', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(SPECS, camera(), 800, 600);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(container.textContent).toContain('D');
    expect(container.textContent).toContain('A');
    expect(buttons[0]?.getAttribute('aria-label')).toMatch(/departure.*JFK/i);
    expect(buttons[1]?.getAttribute('aria-label')).toMatch(/arrival.*LHR/i);
  });

  it('reports which end was clicked', () => {
    const onPick = vi.fn();
    const markers = createAirportMarkers(container, onPick);
    markers.update(SPECS, camera(), 800, 600);
    container.querySelector<HTMLButtonElement>('button')?.click();
    expect(onPick).toHaveBeenCalledWith('origin');
  });

  it('clears both markers when nothing is in focus', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(SPECS, camera(), 800, 600);
    markers.update([], camera(), 800, 600);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/globe/airportMarkers.test.ts
```

Expected: `Failed to resolve import "@/globe/airportMarkers"`. Zero test passati.

- [ ] **Step 3: Creare `src/globe/airportMarkers.ts`**

```ts
import type { Camera } from 'three';
import { Vector3 } from 'three';
import { latLonToVec3 } from './geoHelpers';
import type { RouteEnd } from '@/data/airportInfo';

export interface MarkerSpec {
  end: RouteEnd;
  letter: 'D' | 'A';
  iata: string;
  lat: number;
  lon: number;
}

export interface MarkerPlacement {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Below this camera distance the IATA code appears beside the dot.
 *
 * OrbitControls hold the camera between 3,0 and 10,0 globe radii
 * (scene.ts:45-46), so 6,0 is the lower half of the travel: close enough
 * that two airports are far apart on screen and a label has room.
 */
export const MARKER_LABEL_MAX_DISTANCE = 6.0;

export function markerLabelVisible(cameraDistance: number): boolean {
  return cameraDistance <= MARKER_LABEL_MAX_DISTANCE;
}

/**
 * Where an airport is on screen, this frame.
 *
 * Nothing is anchored and nothing is cached: the geographic position is
 * projected afresh every frame, which is why zoom, rotation, damping and
 * window resizes are all correct without a single listener. leaderLine.ts
 * has done exactly this since v1.
 */
export function projectMarker(
  point: { lat: number; lon: number },
  camera: Camera,
  width: number,
  height: number
): MarkerPlacement {
  const world = latLonToVec3(point.lat, point.lon);
  // Far hemisphere: the same 0.05 cut-off leaderLine.ts and raycaster.ts
  // use. Without it a marker floats over the near face of the globe while
  // its airport is behind the planet.
  const camDir = camera.position.clone().normalize();
  if (camDir.dot(world.clone().normalize()) <= 0.05) {
    return { x: 0, y: 0, visible: false };
  }
  const p = new Vector3().copy(world).project(camera);
  return {
    x: ((p.x + 1) * width) / 2,
    y: ((1 - p.y) * height) / 2,
    visible: true,
  };
}

export interface AirportMarkers {
  update: (specs: MarkerSpec[], camera: Camera, width: number, height: number) => void;
  dispose: () => void;
}

const END_WORD: Record<RouteEnd, string> = {
  origin: 'Departure',
  destination: 'Arrival',
};

/**
 * Two DOM buttons over the canvas, moved by the render loop.
 *
 * DOM rather than a Points layer because a marker has to be clickable,
 * reachable with a keyboard — axe runs over this page — and has to carry
 * text, which in a shader would mean shipping a glyph atlas.
 */
export function createAirportMarkers(
  container: HTMLElement,
  onPick: (end: RouteEnd) => void
): AirportMarkers {
  const nodes = new Map<RouteEnd, HTMLButtonElement>();

  function nodeFor(spec: MarkerSpec): HTMLButtonElement {
    const existing = nodes.get(spec.end);
    if (existing) return existing;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'marker';
    btn.dataset.end = spec.end;
    btn.innerHTML =
      '<span class="marker__dot" aria-hidden="true"></span>' +
      '<span class="marker__label"></span>';
    btn.addEventListener('click', (e) => {
      // The canvas click handler selects and deselects aircraft; a click
      // that lands on a marker is about the marker.
      e.stopPropagation();
      onPick(spec.end);
    });
    container.appendChild(btn);
    nodes.set(spec.end, btn);
    return btn;
  }

  function update(specs: MarkerSpec[], camera: Camera, width: number, height: number): void {
    const wanted = new Set(specs.map((s) => s.end));
    for (const [end, node] of nodes) {
      if (!wanted.has(end)) {
        node.remove();
        nodes.delete(end);
      }
    }
    const showLabel = markerLabelVisible(camera.position.length());
    for (const spec of specs) {
      const node = nodeFor(spec);
      const at = projectMarker(spec, camera, width, height);
      if (!at.visible) {
        node.style.display = 'none';
        continue;
      }
      node.style.display = '';
      node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      node.setAttribute('aria-label', `${END_WORD[spec.end]} ${spec.iata}`);
      const dot = node.querySelector('.marker__dot');
      if (dot) dot.textContent = spec.letter;
      const label = node.querySelector<HTMLElement>('.marker__label');
      if (label) {
        label.textContent = spec.iata;
        label.style.display = showLabel ? '' : 'none';
      }
    }
  }

  return {
    update,
    dispose: () => {
      for (const node of nodes.values()) node.remove();
      nodes.clear();
    },
  };
}
```

- [ ] **Step 4: Verificare il verde**

```bash
npx vitest run tests/unit/globe/airportMarkers.test.ts
```

Expected: **7 passed**. Suite intera: 416.

- [ ] **Step 5: Creare `tests/component/AirportCard.test.tsx`**

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AirportCard } from '@/ui/AirportCard';
import type { AirportInfo } from '@/data/airportInfo';

const JFK: AirportInfo = {
  end: 'origin',
  iata: 'JFK',
  name: 'John F Kennedy International Airport',
  icao: 'KJFK',
  city: 'New York',
  lat: 40.6398,
  lon: -73.7789,
  terminal: null,
};

describe('AirportCard', () => {
  afterEach(cleanup);

  it('names the airport and says which end of the route it is', () => {
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    expect(screen.getByText(/John F Kennedy International Airport/)).toBeInTheDocument();
    expect(screen.getByText(/departure/i)).toBeInTheDocument();
  });

  it('shows both codes and the city when the table knows them', () => {
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    expect(screen.getByText(/JFK/)).toBeInTheDocument();
    expect(screen.getByText(/KJFK/)).toBeInTheDocument();
    expect(screen.getByText(/New York/)).toBeInTheDocument();
  });

  it('omits what it does not know instead of printing a placeholder', () => {
    // One of the 13 IATA codes the bundled table is missing. A dash in the
    // ICAO row would read as "this airport has no ICAO code".
    const unknown: AirportInfo = {
      ...JFK, end: 'destination', iata: 'FRU', name: 'Manas International Airport',
      icao: null, city: null, lat: null, lon: null,
    };
    render(<AirportCard airport={unknown} onClose={() => {}} />);
    expect(screen.getByText(/Manas International Airport/)).toBeInTheDocument();
    expect(screen.queryByText(/ICAO/i)).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('does NOT render a terminal row when no terminal is known', () => {
    // This is the production case, every time: no free source exposes
    // terminals (spec §2). "Terminal —" would suggest one we do not have
    // and a number would be Aalborg->Aarhus in another costume.
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    expect(screen.queryByText(/terminal/i)).toBeNull();
  });

  it('renders the terminal row when a terminal really is present', () => {
    // The branch is modelled and tested so it is ready, not dead. The spec
    // asks for exactly this: shown if present, never invented.
    render(<AirportCard airport={{ ...JFK, terminal: '4' }} onClose={() => {}} />);
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('calls back on close so the marker can drop its aria-expanded', () => {
    let closed = false;
    render(<AirportCard airport={JFK} onClose={() => { closed = true; }} />);
    screen.getByRole('button', { name: /close/i }).click();
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 6: Verificare il rosso**

```bash
npx vitest run tests/component/AirportCard.test.tsx
```

Expected: `Failed to resolve import "@/ui/AirportCard"`. Zero test passati.

- [ ] **Step 7: Creare `src/ui/AirportCard.tsx`**

```tsx
import type { AirportInfo } from '@/data/airportInfo';

interface AirportCardProps {
  airport: AirportInfo;
  onClose: () => void;
}

const END_WORD = { origin: 'Departure', destination: 'Arrival' } as const;

/**
 * What a D or A marker knows about its airport.
 *
 * Every row is conditional, and a missing value removes its row rather than
 * printing a dash: "ICAO —" reads as "this airport has no ICAO code", which
 * is a claim we have not earned. Measured 2026-11-21: 13 IATA codes in the
 * route cache are absent from public/data/airports.json, so the no-codes
 * case is real and not defensive.
 *
 * The terminal row never renders in production — no free source exposes
 * terminals (spec §2) — and that is the correct outcome, not a gap.
 */
export function AirportCard({ airport, onClose }: AirportCardProps) {
  return (
    <section className="airport" aria-label={`${END_WORD[airport.end]} airport`}>
      <header className="panel__header">
        <div className="panel__title-block">
          <span className="airport__end">{END_WORD[airport.end]}</span>
          <h3 className="airport__name">{airport.name ?? airport.iata}</h3>
        </div>
        <button onClick={onClose} aria-label="Close airport">
          ✕
        </button>
      </header>
      <dl className="fields">
        <Row label="IATA" value={airport.iata} />
        {airport.icao !== null && <Row label="ICAO" value={airport.icao} />}
        {airport.city !== null && <Row label="City" value={airport.city} />}
        {airport.terminal !== null && <Row label="Terminal" value={airport.terminal} />}
      </dl>
      {airport.lat === null && (
        <p className="route__note">Airport position unknown — not placed on the globe</p>
      )}
      <div className="divider" />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className="field__value">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 8: Verificare il verde**

```bash
npx vitest run tests/component/AirportCard.test.tsx
```

Expected: **6 passed**. Suite intera: 422.

- [ ] **Step 9: Estendere `tests/unit/state/sceneView.test.ts` — un estremo solo è comunque un estremo**

Aggiungere in fondo al file, dopo la chiusura di `describe('readVisibilityRule', …)`, e aggiungere agli import:

```ts
import { readFocusView, markerSpecs } from '@/state/sceneView';
import { initAirports } from '@/data/airportLookup';
import { usePanelStore } from '@/state/panelStore';
```

```ts
const LAS = {
  iata: 'LAS', icao: 'KLAS', name: 'Harry Reid International Airport',
  city: 'Las Vegas', country: 'US', lat: 36.084, lon: -115.1537,
  timezone: 'America/Los_Angeles',
};

// FRU is one of the 13 IATA codes present in the committed route cache and
// absent from public/data/airports.json (measured 2026-11-21). Leaving it
// out of the table here is not a contrivance: it is what the file is.
function route(destinationIata: string) {
  return {
    originIata: 'LAS', originName: 'Harry Reid International Airport',
    destinationIata, destinationName: 'Somewhere', airlineName: 'British Airways',
  };
}

describe('readFocusView — what we can place, we place', () => {
  beforeEach(() => {
    initAirports([LAS]);
    usePanelStore.setState({ mode: 'flight' });
  });

  it('plants both markers when both ends are in the table', () => {
    initAirports([LAS, { ...LAS, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', lat: 51.4775, lon: -0.4614 }]);
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('LHR') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const view = readFocusView();
    expect(view?.arc).not.toBeNull();
    expect(markerSpecs(view).map((m) => m.letter)).toEqual(['D', 'A']);
  });

  it('still plants the end it CAN place when the other has no coordinates', () => {
    // 17 routes of 4 243. The first draft returned null the moment either
    // end was unplaceable, which threw away the end we knew along with the
    // one we did not — and left the per-end tests in markerSpecs() as dead
    // branches, so nothing could catch it. One dot is less than two; it is
    // a great deal more than nothing (D15a).
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('FRU') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    const view = readFocusView();
    expect(view).not.toBeNull();
    const specs = markerSpecs(view);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.letter).toBe('D');
    expect(specs[0]?.iata).toBe('LAS');
  });

  it('draws NO arc with one end missing — a geodesic needs two points', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: route('FRU') })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readFocusView()?.arc).toBeNull();
  });

  it('returns nothing only for no flight and for no route', () => {
    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(readFocusView()).toBeNull(); // the grey population: "Route unknown"
    useSelectionStore.setState({ selectedIcao: null });
    expect(readFocusView()).toBeNull();
    expect(markerSpecs(null)).toEqual([]);
  });
});
```

```bash
npx vitest run tests/unit/state/sceneView.test.ts
```

Expected: **8 passed, 4 failed** — i quattro nuovi, perché `readFocusView` non esiste ancora. Lo Step 10 li rende verdi.

- [ ] **Step 10: Una risoluzione sola per arco e marcatori, in `src/state/sceneView.ts`**

Sostituire la funzione `readDrawableArc` creata dal Task 6 con:

```ts
export interface FocusView {
  /**
   * The geodesic, or null when one of the two ends has no coordinates.
   *
   * null here means "no ARC", never "no view": the end we CAN place still
   * gets its marker. An arc needs both ends; a dot needs one.
   */
  arc: DrawableArc | null;
  origin: AirportInfo;
  destination: AirportInfo;
}

/**
 * The two ends of the focused flight's route, and the arc between them when
 * there is one. Resolved once: the markers need exactly the resolution the
 * arc needed, and doing it twice per frame would be two places free to
 * disagree about where LHR is.
 *
 * Three honest reasons to return nothing AT ALL: no flight in focus; a
 * flight whose route adsbdb does not know (the grey population — spec §6.2
 * draws no arc and the card says "Route unknown"); and an aircraft the feed
 * dropped between the click and this frame.
 *
 * A missing airport position is NOT one of them. The first draft returned
 * null whenever either end lacked coordinates, which threw away the end we
 * knew along with the one we did not: the 17 routes of 4 243 whose IATA is
 * absent from airports.json got no marker at all — and that made the
 * per-end tests inside markerSpecs() dead branches, which is how a defect
 * hides from its own test. The user is told what we know (one dot, the
 * card's "Airport position unknown") instead of nothing at all (D15a).
 */
export function readFocusView(): FocusView | null {
  const icao = useSelectionStore.getState().selectedIcao;
  if (icao === null) return null;
  const ac = useAircraftStore.getState().aircraft.get(icao);
  if (ac === undefined || ac.route === null) return null;
  const { origin, destination } = routeEnds(ac.route);
  return { origin, destination, arc: buildArc(origin, destination, ac) };
}

/**
 * The geodesic, when both ends can be placed.
 *
 * Shared by the focused flight and by the search's ghost route (Task 8) so
 * the two cannot drift into two different ideas of when an arc is drawable.
 *
 * @param ac the aircraft flying it, or null when there is none — the
 *   search's outcome 2 is a route with nobody on it, so routeArc draws it
 *   at one even brightness rather than split into flown and to-fly.
 */
function buildArc(
  origin: AirportInfo,
  destination: AirportInfo,
  ac: Aircraft | null
): DrawableArc | null {
  if (origin.lat === null || origin.lon === null) return null;
  if (destination.lat === null || destination.lon === null) return null;
  return {
    origin: { lat: origin.lat, lon: origin.lon },
    destination: { lat: destination.lat, lon: destination.lon },
    aircraft:
      ac !== null && ac.latitude !== null && ac.longitude !== null
        ? { lat: ac.latitude, lon: ac.longitude }
        : null,
  };
}

/**
 * D for departure, A for arrival — the letters the user asked for.
 *
 * One end at a time, on purpose: a route with one placeable end gets one
 * marker. These two tests are live branches, not belt and braces — 17 of
 * 4 243 routes take them today.
 */
export function markerSpecs(view: FocusView | null): MarkerSpec[] {
  if (view === null) return [];
  const out: MarkerSpec[] = [];
  if (view.origin.lat !== null && view.origin.lon !== null) {
    out.push({
      end: 'origin', letter: 'D', iata: view.origin.iata,
      lat: view.origin.lat, lon: view.origin.lon,
    });
  }
  if (view.destination.lat !== null && view.destination.lon !== null) {
    out.push({
      end: 'destination', letter: 'A', iata: view.destination.iata,
      lat: view.destination.lat, lon: view.destination.lon,
    });
  }
  return out;
}

/** The AirportInfo behind whichever marker has its card open. */
export function readOpenAirport(): AirportInfo | null {
  const end = useSelectionStore.getState().openEnd;
  if (end === null) return null;
  const view = readFocusView();
  if (view === null) return null;
  return end === 'origin' ? view.origin : view.destination;
}
```

e aggiornare gli import del file:

```ts
import { routeEnds } from '@/data/airportInfo';
import type { AirportInfo } from '@/data/airportInfo';
import type { Aircraft } from '@/types';
import type { DrawableArc } from '@/globe/routeArc';
import type { MarkerSpec } from '@/globe/airportMarkers';
```

- [ ] **Step 11: Collegare scena, shell e pannello**

In `src/globe/scene.ts`:

- import: `import { readVisibilityRule, readDrawableArc } from '@/state/sceneView';` → `import { readVisibilityRule, readFocusView, markerSpecs } from '@/state/sceneView';`
- aggiungere `import { createAirportMarkers } from './airportMarkers';`
- la firma, che nel file sta su cinque righe (`src/globe/scene.ts:27-31`):

```ts
export function mountScene(
  canvas: HTMLCanvasElement,
  leaderSvg: SVGElement,
  panelEl: HTMLElement
): SceneHandle {
```

diventa:

```ts
export function mountScene(
  canvas: HTMLCanvasElement,
  leaderSvg: SVGElement,
  panelEl: HTMLElement,
  markersEl: HTMLElement
): SceneHandle {
```

- dopo `const arcLayer = createRouteArcLayer(); scene.add(arcLayer.group);` aggiungere:

```ts
  const markers = createAirportMarkers(markersEl, (end) => {
    useSelectionStore.getState().openAirport(end);
    usePanelStore.getState().open('flight');
  });
```

- sostituire `arcLayer.update(readDrawableArc());` con:

```ts
    const focusView = readFocusView();
    arcLayer.update(focusView?.arc ?? null);
    markers.update(markerSpecs(focusView), camera, canvas.clientWidth, canvas.clientHeight);
```

- in `dispose`, prima di `renderer.dispose();`, aggiungere `markers.dispose();`

In `src/ui/AppShell.tsx`:

- aggiungere il ref `const markersRef = useRef<HTMLDivElement>(null);` accanto agli altri;
- estendere la guardia: `if (!canvasRef.current || !leaderRef.current || !panelRef.current) return;` → `if (!canvasRef.current || !leaderRef.current || !panelRef.current || !markersRef.current) return;`
- la chiamata: `const handle = mountScene(canvasRef.current, leaderRef.current, panelRef.current);` → `const handle = mountScene(canvasRef.current, leaderRef.current, panelRef.current, markersRef.current);`
- nel JSX, dopo `<svg ref={leaderRef} className="app-leader" />`, aggiungere `<div ref={markersRef} className="app-markers" />`

In `src/ui/SidePanel.tsx`, inserire la scheda dell'aeroporto **sopra** quella del volo: subito prima della riga

```tsx
      {mode === 'flight' && selectedAircraft && (
        <FlightCard aircraft={selectedAircraft} onClose={leaveFlight} />
      )}
```

aggiungere

```tsx
      {/* The airport card sits above the flight, inside the panel that the
          leader line already points at, rather than in a popover that would
          have to dodge the very marker it belongs to and stay reachable
          with a keyboard.
          Its ✕ closes the airport only — it is a card INSIDE the focus, not
          the focus — which is why it calls openAirportEnd(null) and not
          leaveFlight(). Escape walks out in the same order. */}
      {mode === 'flight' && openAirport && (
        <AirportCard airport={openAirport} onClose={() => openAirportEnd(null)} />
      )}
```

aggiungendo gli import e le due selezioni:

```tsx
import { AirportCard } from './AirportCard';
import { readOpenAirport } from '@/state/sceneView';
```

```tsx
  const openEnd = useSelectionStore((s) => s.openEnd);
  const openAirportEnd = useSelectionStore((s) => s.openAirport);
  // Read on render, not subscribed: `aircraft` and `openEnd` above are
  // already subscriptions, so every change that could alter this answer
  // re-renders the component anyway.
  const openAirport = openEnd !== null ? readOpenAirport() : null;
```

- [ ] **Step 12: Aggiungere il gradino della scheda aeroporto alla scala di `Esc`**

In `tests/unit/state/escape.test.ts`, aggiungere `openEnd: null` al `beforeEach` (`useSelectionStore.setState({ selectedIcao: null, openEnd: null });`) e aggiungere un test:

```ts
  it('closes the airport card before leaving focus', () => {
    // The card is inside the focus: Escape walks out of the innermost thing
    // first, or one press would undo two steps of the user's navigation.
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    expect(handleEscape()).toBe(true);
    expect(useSelectionStore.getState().openEnd).toBeNull();
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });
```

In `src/state/escape.ts`, aggiungere **sopra** il blocco del focus:

```ts
  if (useSelectionStore.getState().openEnd !== null) {
    useSelectionStore.getState().openAirport(null);
    return true;
  }
```

E dare a `leaveFlight()` l'estremo aperto, perché ora esiste. In `tests/unit/state/flightFocus.test.ts` aggiungere `openEnd: null` ai due `setState` di `useSelectionStore` e il test:

```ts
  it('takes the airport card with the flight it was opened from', () => {
    // The airport card is reached only THROUGH a focused flight, so a
    // selection left behind would reopen a card the user never asked for
    // the next time they click an aircraft. One act, one function (D15).
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    usePanelStore.setState({ mode: 'flight' });
    leaveFlight();
    expect(useSelectionStore.getState().openEnd).toBeNull();
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });
```

e in `src/state/flightFocus.ts`, come prima riga del corpo di `leaveFlight`:

```ts
  // The airport card is reached only through a focused flight, so it never
  // outlives one: left set, it would reopen itself on the next selection.
  useSelectionStore.getState().openAirport(null);
```

- [ ] **Step 13: Aggiungere lo stile dei marcatori in `src/ui/styles.css`**

In fondo al file:

```css
/* D/A airport markers — positioned by the render loop, never by CSS */
.app-markers {
  position: fixed;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.marker {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
  color: var(--color-primary-on-dark);
  font-family: var(--font-stack);
}
.marker__dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(41, 151, 255, 0.9);
  background: rgba(41, 151, 255, 0.22);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.marker__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.airport__end {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.45;
}
.airport__name { font-size: 15px; font-weight: 600; }
```

- [ ] **Step 14: Verificare build, suite e browser**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, **428 passed (47 files)**.

Verifica a occhio: cliccare un aereo completo, poi zoomare e ruotare. I due marcatori devono restare incollati ai due aeroporti a ogni zoom e a ogni rotazione, sparire quando l'aeroporto passa dietro il globo, e mostrare il codice IATA solo da vicino. Cliccando D deve aprirsi la scheda — **senza riga Terminal**, che è l'esito corretto. Chiudendo poi la scheda del volo con la ✕, deve sparire anche quella dell'aeroporto: sono un atto solo.

- [ ] **Step 15: Commit**

```bash
git add src/globe/airportMarkers.ts src/globe/scene.ts src/state/sceneView.ts \
        src/state/escape.ts src/state/flightFocus.ts src/ui/AirportCard.tsx \
        src/ui/AppShell.tsx src/ui/SidePanel.tsx src/ui/styles.css \
        tests/unit/globe/airportMarkers.test.ts tests/component/AirportCard.test.tsx \
        tests/unit/state/sceneView.test.ts tests/unit/state/escape.test.ts \
        tests/unit/state/flightFocus.test.ts
git commit -m "feat(globe): D and A stay on their airports, and say only what we know"
```

---

### Task 8: La ricerca di un numero di volo, e i suoi quattro esiti

Quinta richiesta. La barra è sempre visibile — dietro una scorciatoia sarebbe invisibile a chi arriva da un link condiviso (spec §6.3).

**Files:**
- Modify: `src/data/airlineLookup.ts` — una seconda mappa, IATA → ICAO
- Create: `src/data/flightQuery.ts`, `src/data/routeClient.ts`, `src/state/searchStore.ts`, `src/ui/FlightSearch.tsx`
- Create: `server/routeQuery.ts`
- Modify: `server/index.ts` (registrazione dell'endpoint), `src/state/sceneView.ts` (l'arco fantasma), `src/state/escape.ts`, `src/ui/AppShell.tsx`, `src/ui/styles.css`
- Test: `tests/unit/data/flightQuery.test.ts`, `tests/unit/data/routeClient.test.ts`, `tests/unit/server/routeQuery.test.ts`, `tests/component/FlightSearch.test.tsx`, `tests/unit/state/escape.test.ts` (esteso), `tests/unit/state/sceneView.test.ts` (esteso — di chi è l'arco)

**Interfaces:**
- Consumes: `lookupAirlineIcaosByIata` (nuova); `FlightRouteLite`; `routeEnds` dal Task 5; `RouteResolver.get`/`enqueue` dal Piano 1
- Produces: `normalizeQuery(s): string`; `expandQuery(s): string[]`; **`RouteAnswer`** e `fetchRoute(callsign, signal?): Promise<RouteAnswer>` — tre risposte distinte, perché «non ho potuto chiedere» non è «non esiste»; `useSearchStore` con `{ query; outcome: SearchOutcome; setQuery; clear; run(input) }` e **quattro** esiti; `registerRouteQueryRoute(app, deps)`; `GET /api/route/:callsign`; **`ArcSubject`**, `arcSubject(selectedIcao, outcome): ArcSubject` e `readArcSubject()` in `src/state/sceneView.ts` — una sola autorità su di chi è l'arco, letta dal renderer e dalla riga che lo nomina

**Perché il server non interroga adsbdb al volo.** Misurato (`server/routeResolver.ts:110-120`): ~1 190 lookup a 4,8 req/s hanno prodotto `429 rate limited for 300 seconds`, e le richieste inviate **durante** la penalità la rinnovano. Una barra di ricerca è il modo perfetto per generare raffiche. L'endpoint risponde quindi **solo dalla cache in memoria** — 8 374 rotte note alla misura del 2026-11-21, in crescita di ~920/ora — e per un callsign che non conosce accoda il nome alla pompa lenta e risponde `known: false`. La seconda ricerca della stessa cosa può riuscire; la prima non manda mai nessuno in ban.

**La ricerca parte sull'invio, non sulla battitura.** Una ricerca a ogni carattere manderebbe cinque richieste per «BA274», ognuna delle quali accoda un callsign alla pompa. `onSubmit` elimina il problema alla radice, e con esso la necessità di un debounce — cioè di un'altra durata da misurare.

**Le due forme del callsign, e l'ambiguità reale.** adsbdb espone sia `BAW274` sia `BA274` e l'utente non sa quale gli serva (spec §6.3). Il feed porta la forma ICAO. La conversione passa dalla tabella `public/data/airlines.json`, 1 093 record: misurato il 2026-11-21, **834 codici IATA distinti, 17 dei quali mappano su più di un ICAO** (`VY` → `FOS`, `VLG`; `G3` → `CIX`, `GLO`, `SEH`; `ZB` → `BUB`, `MON`). Quindi `expandQuery` restituisce una **lista ordinata di candidati**, non uno, e a decidere è il feed: vince il primo candidato che esiste davvero. Il massimo misurato di candidati è 3, ed è anche il tetto di richieste per ricerca: nessuna query onesta viene troncata.

Le due letture non si sovrappongono mai, e vale la pena dirlo perché sembra il contrario: la forma ICAO richiede **tre lettere** seguite da una cifra, la forma IATA due caratteri seguiti da sole cifre. `BAW274` ha prefisso `BAW` (tre lettere) e la lettura IATA fallirebbe perché `W274` non è un numero; `VY1234` ha prefisso `VY1`, che non sono tre lettere, quindi resta solo la lettura IATA.

- [ ] **Step 1: Creare `tests/unit/data/flightQuery.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeQuery, expandQuery } from '@/data/flightQuery';
import { initAirlines } from '@/data/airlineLookup';

// Taken from public/data/airlines.json as it really is. VY and G3 are two of
// the 17 IATA codes measured 2026-11-21 that map to more than one ICAO.
const AIRLINES = [
  { icao: 'N/A', iata: '-', name: 'Unknown' },
  { icao: 'BAW', iata: 'BA', name: 'British Airways' },
  { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
  { icao: 'FOS', iata: 'VY', name: 'Formosa Airlines' },
  { icao: 'VLG', iata: 'VY', name: 'Vueling Airlines' },
];

describe('flight query', () => {
  beforeEach(() => initAirlines(AIRLINES));

  it('normalises spacing, hyphens and case', () => {
    expect(normalizeQuery(' ba-274 ')).toBe('BA274');
  });

  it('takes an ICAO callsign as itself', () => {
    expect(expandQuery('BAW274')).toEqual(['BAW274']);
  });

  it('expands the IATA form the way adsbdb spells it', () => {
    expect(expandQuery('BA274')).toEqual(['BAW274']);
  });

  it('offers every airline an ambiguous IATA code can mean', () => {
    // 17 of 834 IATA codes are shared. Picking one would silently search for
    // the wrong airline; the feed decides, not the table.
    expect(expandQuery('VY1234')).toEqual(['FOS1234', 'VLG1234']);
  });

  it('never reads a three-letter ICAO prefix as a two-letter IATA one', () => {
    // 'BAW274' as IATA would be 'BA' + 'W274', and W274 is not a number.
    // The two readings are disjoint, and this is the test that keeps them so.
    expect(expandQuery('BAW274')).not.toContain('BAWW274');
  });

  it('offers the unpadded number too when the query carries leading zeros', () => {
    // adsbdb spells it AA1006, never AA01006. A user copying from a boarding
    // pass may not.
    expect(expandQuery('AA0274')).toEqual(['AAL0274', 'AAL274']);
  });

  it('knows nothing about an airline the table does not list', () => {
    expect(expandQuery('ZZ100')).toEqual([]);
  });

  it('rejects something that is not a flight number at all', () => {
    expect(expandQuery('hello')).toEqual([]);
    expect(expandQuery('')).toEqual([]);
  });

  it('rejects a query too short to carry a flight number', () => {
    expect(expandQuery('B1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificare il rosso**

```bash
npx vitest run tests/unit/data/flightQuery.test.ts
```

Expected: `Failed to resolve import "@/data/flightQuery"`. Zero test passati.

- [ ] **Step 3: Aggiungere la mappa IATA → ICAO in `src/data/airlineLookup.ts`**

Sostituire

```ts
let airlineByIcao: Map<string, AirlineRecord> = new Map();

export function initAirlines(records: AirlineRecord[]): void {
  airlineByIcao = new Map(records.map((r) => [r.icao, r]));
}
```

con

```ts
let airlineByIcao: Map<string, AirlineRecord> = new Map();
let airlineIcaosByIata: Map<string, string[]> = new Map();

export function initAirlines(records: AirlineRecord[]): void {
  airlineByIcao = new Map(records.map((r) => [r.icao, r]));
  // A LIST per IATA code, not a record: measured on the bundled table
  // (1 093 rows, 834 distinct IATA codes) 17 codes belong to more than one
  // airline — VY is both Formosa and Vueling, G3 is three carriers. Keeping
  // one would silently search for the wrong airline's flight.
  airlineIcaosByIata = new Map();
  for (const r of records) {
    // 'N/A' / '-' are the table's placeholders for "unknown airline" and
    // would otherwise collect hundreds of ICAO codes under one key.
    if (!r.iata || r.iata === '-' || r.icao === 'N/A') continue;
    const list = airlineIcaosByIata.get(r.iata);
    if (list) list.push(r.icao);
    else airlineIcaosByIata.set(r.iata, [r.icao]);
  }
}

/** Every ICAO prefix an airline's IATA code can mean, in table order. */
export function lookupAirlineIcaosByIata(iata: string): string[] {
  return airlineIcaosByIata.get(iata.toUpperCase()) ?? [];
}
```

- [ ] **Step 4: Creare `src/data/flightQuery.ts`**

```ts
import { lookupAirlineIcaosByIata } from './airlineLookup';

/** Three letters then a digit: the ICAO callsign the feed actually carries. */
const ICAO_FORM = /^[A-Z]{3}[0-9][A-Z0-9]*$/;
/** Two characters then digits: the IATA flight number on a boarding pass. */
const IATA_FORM = /^([A-Z0-9]{2})([0-9]{1,4})([A-Z]?)$/;

export function normalizeQuery(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The ICAO callsigns a typed query could mean, best first.
 *
 * adsbdb exposes both spellings and the user does not know which one they
 * need (spec §6.3), while the feed carries only the ICAO one. The two
 * readings never overlap: ICAO needs THREE letters followed by a digit, so
 * 'BAW274' has only that reading, and 'VY1234' has prefix 'VY1' which is
 * not three letters, so it has only the IATA one.
 *
 * A list, because 17 of the 834 IATA codes in the bundled table belong to
 * more than one airline (measured 2026-11-21). The feed decides which is
 * meant — the table cannot.
 */
export function expandQuery(input: string): string[] {
  const q = normalizeQuery(input);
  if (q.length < 3) return [];
  if (ICAO_FORM.test(q)) return [q];

  const m = q.match(IATA_FORM);
  if (!m) return [];
  const airline = m[1] ?? '';
  const digits = m[2] ?? '';
  const suffix = m[3] ?? '';

  // adsbdb spells it AA1006, never AA01006, but a user copying from a
  // boarding pass may keep the padding. Offer both, padded first because
  // that is what they typed.
  const stripped = digits.replace(/^0+/, '');
  const numbers = stripped !== '' && stripped !== digits ? [digits, stripped] : [digits];

  const out: string[] = [];
  for (const icao of lookupAirlineIcaosByIata(airline)) {
    for (const n of numbers) out.push(`${icao}${n}${suffix}`);
  }
  return out;
}
```

- [ ] **Step 5: Verificare il verde**

```bash
npx vitest run tests/unit/data/flightQuery.test.ts
```

Expected: **9 passed**. Suite intera: 437.

- [ ] **Step 6: Creare `tests/unit/server/routeQuery.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerRouteQueryRoute } from '../../../server/routeQuery';
import type { FlightRoute } from '../../../server/routeResolver';

const BAW274: FlightRoute = {
  callsignIcao: 'BAW274',
  callsignIata: 'BA274',
  airlineName: 'British Airways',
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
};

function build(known: Record<string, FlightRoute> = {}): {
  app: ReturnType<typeof Fastify>;
  enqueued: string[];
} {
  const enqueued: string[] = [];
  const app = Fastify({ logger: false });
  registerRouteQueryRoute(app, {
    get: (cs) => known[cs] ?? null,
    enqueue: (cs) => enqueued.push(...cs),
  });
  return { app, enqueued };
}

describe('GET /api/route/:callsign', () => {
  it('answers a known callsign from the cache, in the client-facing shape', async () => {
    const { app } = build({ BAW274 });
    const res = await app.inject({ method: 'GET', url: '/api/route/BAW274' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      callsign: 'BAW274',
      known: true,
      route: {
        originIata: 'LAS',
        originName: 'McCarran International Airport',
        destinationIata: 'LHR',
        destinationName: 'London Heathrow Airport',
        airlineName: 'British Airways',
      },
    });
  });

  it('says it does not know, and invents nothing', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'GET', url: '/api/route/BAW999' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ callsign: 'BAW999', known: false, route: null });
  });

  it('hands the unknown callsign to the slow pump so a later search may win', async () => {
    const { app, enqueued } = build();
    await app.inject({ method: 'GET', url: '/api/route/BAW999' });
    expect(enqueued).toEqual(['BAW999']);
  });

  it('performs NO network call while answering', async () => {
    // Measured in routeResolver.ts: ~1 190 lookups at 4.8 req/s earned a
    // 300 s ban, and requests sent during the penalty renew it. A search box
    // wired straight to adsbdb is a ban generator.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { app } = build();
    await app.inject({ method: 'GET', url: '/api/route/BAW999' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('refuses a callsign that is not one', async () => {
    const { app, enqueued } = build();
    const res = await app.inject({ method: 'GET', url: '/api/route/hello' });
    expect(res.statusCode).toBe(400);
    expect(enqueued).toEqual([]);
  });
});
```

- [ ] **Step 7: Verificare il rosso**

```bash
npx vitest run tests/unit/server/routeQuery.test.ts
```

Expected: il file non si carica, `Cannot find module '../../../server/routeQuery'`. Zero test passati.

- [ ] **Step 8: Creare `server/routeQuery.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { FlightRoute } from './routeResolver.js';
import type { FlightRouteLite } from '../src/types.js';

export interface RouteQueryDeps {
  /** The resolver's in-memory cache. Never a lookup — see below. */
  get: (callsign: string) => FlightRoute | null;
  enqueue: (callsigns: string[]) => void;
}

/** Same shape the ICAO callsigns in the feed take: three letters, then digits. */
const CALLSIGN_RX = /^[A-Z]{3}[0-9][A-Z0-9]{0,4}$/;

/**
 * Answers "do we know where this flight goes?" without ever asking adsbdb.
 *
 * This is search outcome 2 of spec §6.3: a flight nobody can see because it
 * is outside ADS-B coverage, whose route we nevertheless know — 8 374 of
 * them in the runtime cache, measured 2026-11-21, growing ~920/hour.
 *
 * It answers from the cache and NOTHING else. Measured in routeResolver.ts:
 * ~1 190 lookups at 4.8 req/s produced `429 rate limited for 300 seconds`,
 * and requests sent during the penalty renew it. A search box wired to a
 * live lookup would hand a visitor the ability to ban the whole site. An
 * unknown callsign is instead handed to the slow pump, so the same search
 * tomorrow can succeed.
 *
 * A factory, like registerHealthRoute, because server/index.ts boots
 * Fastify on import and nothing written inside it is reachable from a test.
 */
export function registerRouteQueryRoute(app: FastifyInstance, deps: RouteQueryDeps): void {
  app.get<{ Params: { callsign: string } }>('/api/route/:callsign', async (req, reply) => {
    const callsign = req.params.callsign.toUpperCase();
    if (!CALLSIGN_RX.test(callsign)) {
      return reply.code(400).send({ error: 'not an ICAO flight callsign' });
    }
    const route = deps.get(callsign);
    if (route === null) {
      deps.enqueue([callsign]);
      return reply.send({ callsign, known: false, route: null });
    }
    // The five client-facing fields, the same ones enrich.ts attaches to an
    // aircraft record. The two callsign spellings stay server-side.
    const lite: FlightRouteLite = {
      originIata: route.originIata,
      originName: route.originName,
      destinationIata: route.destinationIata,
      destinationName: route.destinationName,
      airlineName: route.airlineName,
    };
    return reply.send({ callsign, known: true, route: lite });
  });
}
```

- [ ] **Step 9: Registrare l'endpoint in `server/index.ts`**

Aggiungere l'import accanto a quello di `registerHealthRoute` (riga 64):

```ts
import { registerRouteQueryRoute } from './routeQuery.js';
```

e, subito **dopo** la chiusura della chiamata `registerHealthRoute(...)` — cioè dopo le righe

```ts
  routes: () => routes.stats(),
  aircraft: () => ({ total: lastTotalCount, complete: lastCompleteCount }),
});
```

aggiungere:

```ts
// Search outcome 2: the flight is not in the sky we can see, but we know
// where it goes. Served from the resolver's memory only — see routeQuery.ts
// for why a live lookup here would be a ban waiting to happen.
registerRouteQueryRoute(app, {
  get: (callsign) => routes.get(callsign),
  enqueue: (callsigns) => routes.enqueue(callsigns),
});
```

- [ ] **Step 10: Verificare il verde**

```bash
npx vitest run tests/unit/server/routeQuery.test.ts
npm run build:all
```

Expected: **5 passed**; build pulita su entrambi i programmi — in particolare `tsconfig.server.json`, che non accetta l'alias `@/` e pretende i suffissi `.js`. Suite intera: 442.

- [ ] **Step 11: Creare `tests/component/FlightSearch.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { FlightSearch } from '@/ui/FlightSearch';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useSearchStore } from '@/state/searchStore';
import { usePanelStore } from '@/state/panelStore';
import { initAirlines } from '@/data/airlineLookup';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const AIRLINES = [
  { icao: 'BAW', iata: 'BA', name: 'British Airways' },
  { icao: 'AAL', iata: 'AA', name: 'American Airlines' },
];

const LAS = {
  iata: 'LAS', icao: 'KLAS', name: 'Harry Reid International Airport',
  city: 'Las Vegas', country: 'US', lat: 36.084, lon: -115.1537,
  timezone: 'America/Los_Angeles',
};

const ROUTE = {
  originIata: 'LAS',
  originName: 'McCarran International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function fleet(...callsigns: string[]): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  callsigns.forEach((cs, i) =>
    m.set(`a${i}`, { ...makeAircraftRaw({ icao24: `a${i}`, callsign: cs }), trail: [] })
  );
  return m;
}

function answer(route: unknown): Response {
  return {
    ok: true,
    json: async () => ({ callsign: 'X', known: route !== null, route }),
  } as unknown as Response;
}

function submit(value: string): void {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
  fireEvent.submit(screen.getByRole('search'));
}

describe('FlightSearch — the four outcomes', () => {
  beforeEach(() => {
    initAirlines(AIRLINES);
    // Empty on purpose: the airport table is module state, and a test that
    // fills it must not decide what the next one sees.
    initAirports([]);
    useAircraftStore.setState({ aircraft: fleet('BAW274', 'AAL1006') });
    useSelectionStore.setState({ selectedIcao: null, openEnd: null });
    useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });
    usePanelStore.setState({ mode: 'closed' });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('1 — a flight in the feed goes into focus', async () => {
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
  });

  it('1 — and opens the flight card, like every other way of selecting', async () => {
    // Focus without the card is a globe emptied around an aircraft the user
    // cannot read: the search appears to do nothing but delete the sky.
    // scene.ts and AircraftList both pair select() with open('flight'); so
    // does this, or tests/e2e/panel-focus-search.spec.ts never finds
    // .panel__callsign after searching a flight that is right there.
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(usePanelStore.getState().mode).toBe('flight'));
  });

  it('1 — the IATA spelling finds the ICAO callsign the feed carries', async () => {
    render(<FlightSearch />);
    submit('BA274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
  });

  it('2 — a flight we know but cannot see draws its route and says why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/outside ADS-B coverage/i)).toBeInTheDocument()
    );
    expect(useSearchStore.getState().outcome.kind).toBe('offCoverage');
  });

  it('2 — and selects no aircraft, because there is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('offCoverage'));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('2 — names the AIRPORT when it is the airport we cannot place', async () => {
    // The line above is about the aircraft. With an endpoint missing from
    // airports.json the globe drew nothing at all while that line went on
    // talking about the aircraft, so the user read "position unavailable"
    // with no way to learn the silence belonged to the airport (D15b).
    // LHR is left out of the table here; 13 real IATA codes are.
    initAirports([LAS]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/LHR position unknown — no arc drawn/i)).toBeInTheDocument()
    );
  });

  it('2 — lets go of a flight still in focus, so the arc it promises is the one drawn', async () => {
    // readFocusView draws the ghost route only while nothing is selected.
    // A flight focused by an earlier click would swallow the arc this
    // outcome promises, and the line would read "position unavailable"
    // over somebody else's route (D15a).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    useSelectionStore.setState({ selectedIcao: 'a0' });
    usePanelStore.setState({ mode: 'flight' });
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('offCoverage'));
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('2 — stops naming the route once a selection has taken the arc', async () => {
    // The order `run` cannot fix: the click comes AFTER the search. Nothing
    // clears the outcome when the user selects an aircraft, and
    // readFocusView gives the arc to the selection — so BA999's route left
    // the globe, replaced by the selected flight's or by nothing at all
    // when that flight has no route (95,3% of the fleet), while this line
    // went on announcing it. The words outlived the picture (D15a).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(ROUTE)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() =>
      expect(screen.getByText(/outside ADS-B coverage/i)).toBeInTheDocument()
    );
    act(() => {
      useSelectionStore.getState().select('a0');
    });
    expect(
      screen.getByText(/route not drawn while another flight is selected/i)
    ).toBeInTheDocument();
  });

  it('3 — an unknown flight is said to be unknown, and the globe is left alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null)));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });

  it('4 — a broken server is not a verdict about the flight', async () => {
    // The purest member of the family: `if (!res.ok) return null` plus
    // `.catch(() => null)` turned a 500 into "No flight by that number".
    // The screen was not showing less than it claimed — it was stating a
    // fact it had never been able to check (D15b).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    ));
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(screen.getByText(/could not check/i)).toBeInTheDocument());
    expect(screen.queryByText(/no flight by that number/i)).toBeNull();
    expect(useSearchStore.getState().outcome.kind).toBe('unreachable');
  });

  it('4 — and a dead server leaves the globe exactly as it was', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    useSelectionStore.setState({ selectedIcao: 'a0' });
    render(<FlightSearch />);
    submit('BA999');
    await waitFor(() => expect(useSearchStore.getState().outcome.kind).toBe('unreachable'));
    expect(useSelectionStore.getState().selectedIcao).toBe('a0');
  });

  it('never reaches the network for something that is not a flight number', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<FlightSearch />);
    submit('hello');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });

  it('asks the server at most once per candidate, and there are at most three', async () => {
    // The measured maximum of ICAO codes behind one IATA code is 3 (G3).
    // The cap is that maximum, so no honest query is truncated and no query
    // can turn into a burst.
    const f = vi.fn().mockResolvedValue(answer(null));
    vi.stubGlobal('fetch', f);
    render(<FlightSearch />);
    submit('AA999');
    await waitFor(() => expect(screen.getByText(/no flight/i)).toBeInTheDocument());
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('clearing the box puts the globe back as it was', async () => {
    render(<FlightSearch />);
    submit('BAW274');
    await waitFor(() => expect(useSelectionStore.getState().selectedIcao).toBe('a0'));
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(useSearchStore.getState().outcome.kind).toBe('idle');
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
    // ...and the card the search opened goes with it, instead of staying
    // mounted over an aircraft that is no longer selected.
    expect(usePanelStore.getState().mode).toBe('closed');
  });
});
```

- [ ] **Step 12: Verificare il rosso**

```bash
npx vitest run tests/component/FlightSearch.test.tsx
```

Expected: `Failed to resolve import "@/ui/FlightSearch"`. Zero test passati.

- [ ] **Step 13: Creare `tests/unit/data/routeClient.test.ts`**

Il difetto che questo file chiude è la forma più pura della famiglia (D15b): **un guasto diventa un'affermazione sul volo**. `if (!res.ok) return null` e `.catch(() => null)` fanno sì che un 500, un timeout o un server spento producano «No flight by that number» — lo schermo dichiara di aver verificato una cosa che non ha potuto nemmeno chiedere.

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchRoute } from '@/data/routeClient';
import type { FlightRouteLite } from '@/types';

const ROUTE: FlightRouteLite = {
  originIata: 'LAS',
  originName: 'Harry Reid International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchRoute — three answers, and never the wrong one', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands back the route the server knows', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', known: true, route: ROUTE })
    ));
    return expect(fetchRoute('BAW999')).resolves.toEqual({ status: 'known', route: ROUTE });
  });

  it('reports UNKNOWN only when the server actually said so', () => {
    // known: false is a measured answer: the resolver looked in 8 374
    // cached routes and did not find this callsign. That is the only
    // thing allowed to become "No flight by that number".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      response({ callsign: 'BAW999', known: false, route: null })
    ));
    return expect(fetchRoute('BAW999')).resolves.toEqual({ status: 'unknown' });
  });

  it('reports that it could not ASK when the server answers 500', () => {
    // The defect in its purest form: an outage used to return null, which
    // the store read as "unknown flight", which the screen printed as a
    // statement about the world. res.ok === false and known === false are
    // different facts and must not share a return value (D15b).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false, 500)));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('reports the same when a 400 comes back, because that is not a verdict either', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false, 400)));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('reports the same when the request never completes at all', () => {
    // A dead server, a dropped connection, the dev server not running:
    // fetch rejects, and a rejection is not evidence about the flight.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });

  it('does not treat a body it cannot read as an answer', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); },
    } as unknown as Response));
    return expect(fetchRoute('BAW999')).resolves.toMatchObject({ status: 'unreachable' });
  });
});
```

- [ ] **Step 14: Verificare il rosso**

```bash
npx vitest run tests/unit/data/routeClient.test.ts
```

Expected: `Failed to resolve import "@/data/routeClient"`. Zero test passati.

- [ ] **Step 15: Creare `src/data/routeClient.ts`**

```ts
import type { FlightRouteLite } from '@/types';

/**
 * Three answers, because there are three facts — and the third is not a
 * fact about the flight.
 *
 * `unknown` means the server looked: it holds 8 374 routes and this
 * callsign is not among them. `unreachable` means we never got to ask, or
 * could not read what came back. Collapsing the two into `null` is how a
 * 500, a timeout or a stopped server became the sentence "No flight by
 * that number" — the screen claiming to have checked something it could
 * not even ask about (D15b).
 */
export type RouteAnswer =
  | { status: 'known'; route: FlightRouteLite }
  | { status: 'unknown' }
  | { status: 'unreachable'; detail: string };

/**
 * Asks our own server whether it knows this flight's route.
 *
 * Our server, never adsbdb: the endpoint answers from memory and enqueues
 * what it does not know, which is the only way a search box can exist
 * without handing visitors a way to get the site rate-limited.
 *
 * Every failure is caught HERE and named, rather than thrown for a caller
 * to flatten. The caller that flattened it is exactly how this went wrong.
 */
export async function fetchRoute(
  callsign: string,
  signal?: AbortSignal
): Promise<RouteAnswer> {
  let res: Response;
  try {
    res = await fetch(`/api/route/${encodeURIComponent(callsign)}`, { signal });
  } catch (err) {
    return { status: 'unreachable', detail: String(err) };
  }
  // A refusal is not a verdict: 400 and 500 alike say the question did not
  // get an answer, not that the flight does not exist.
  if (!res.ok) return { status: 'unreachable', detail: `server answered ${res.status}` };
  try {
    const data = (await res.json()) as { known?: boolean; route?: FlightRouteLite | null };
    const route = data.route ?? null;
    return route === null ? { status: 'unknown' } : { status: 'known', route };
  } catch (err) {
    return { status: 'unreachable', detail: String(err) };
  }
}
```

```bash
npx vitest run tests/unit/data/routeClient.test.ts
```

Expected: **6 passed**. Suite intera: 448.

- [ ] **Step 16: Creare `src/state/searchStore.ts`**

```ts
import { create } from 'zustand';
import type { FlightRouteLite } from '@/types';
import { expandQuery } from '@/data/flightQuery';
import { fetchRoute } from '@/data/routeClient';
import { useAircraftStore } from './aircraftStore';
import { useSelectionStore } from './selectionStore';
import { usePanelStore } from './panelStore';
import { leaveFlight } from './flightFocus';

/**
 * The outcomes of spec §6.3 as shapes rather than a string plus optional
 * fields: a state that cannot represent "unknown flight with a route
 * attached" cannot show one.
 *
 * There are FOUR, not the three the spec listed. `unreachable` is the one
 * the spec did not think of, because it is not an outcome about the
 * flight: it is an outcome about us. Without it a 500, a timeout or a
 * stopped server all arrive as `unknown` and the screen says "No flight by
 * that number" about a flight nobody asked about — D15b, in its purest
 * form.
 */
export type SearchOutcome =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'focused'; callsign: string }
  | { kind: 'offCoverage'; callsign: string; route: FlightRouteLite }
  | { kind: 'unknown'; query: string }
  | { kind: 'unreachable'; query: string; detail: string };

/**
 * At most three requests per search. Measured on the bundled airline table:
 * the largest number of ICAO codes behind one IATA code is 3 (G3 — City
 * Connexion, Gol, Sky Express), so this truncates no honest query while
 * making a burst impossible.
 */
const MAX_CANDIDATES = 3;

interface SearchState {
  query: string;
  outcome: SearchOutcome;
  setQuery: (q: string) => void;
  clear: () => void;
  run: (input: string) => Promise<void>;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  outcome: { kind: 'idle' },

  setQuery: (query) => set({ query }),

  clear: () => {
    // Clearing the box undoes what the search did, including the focus it
    // may have entered: a globe focused on a flight whose name is no longer
    // written anywhere would be a state with no way back. The card goes
    // with it, because the card exists only for that flight — and all of
    // that is leaveFlight(), the single place this act is written (D15).
    leaveFlight();
    set({ query: '', outcome: { kind: 'idle' } });
  },

  run: async (input) => {
    const candidates = expandQuery(input).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) {
      set({ outcome: { kind: 'unknown', query: input } });
      return;
    }
    set({ outcome: { kind: 'searching' } });

    // Outcome 1: in the feed. The fleet decides which candidate was meant,
    // which is the only authority that can — 17 IATA codes are shared.
    const fleet = useAircraftStore.getState().aircraft;
    for (const callsign of candidates) {
      for (const ac of fleet.values()) {
        if (ac.callsign === callsign) {
          useSelectionStore.getState().select(ac.icao24);
          // select() ALONE empties the sky around an aircraft and then
          // names nothing: no flight card, no callsign, no route. Every
          // other way of choosing an aircraft in this codebase pairs the
          // two — src/globe/scene.ts:92-94 for the click on the globe,
          // src/ui/AircraftList.tsx:26-29 for the list — and the search is
          // not allowed to be the one that differs. Task 9 asserts
          // .panel__callsign right after this very search.
          usePanelStore.getState().open('flight');
          set({ outcome: { kind: 'focused', callsign } });
          return;
        }
      }
    }

    // Outcome 2: not in the sky we can see, but known to us. Our server
    // answers from memory; it never asks adsbdb while a user waits.
    //
    // No `.catch(() => null)` here any more. That one expression turned
    // every outage into the sentence "No flight by that number": the store
    // claimed to have checked something it had not been able to ask about
    // (D15b). fetchRoute now NAMES its three answers and this loop keeps
    // them apart.
    let couldNotAsk: string | null = null;
    for (const callsign of candidates) {
      const answer = await fetchRoute(callsign);
      if (answer.status === 'known') {
        // Let go of any flight still in focus BEFORE promising an arc.
        // readFocusView draws the ghost route only while nothing is
        // selected, so a flight focused by an earlier click would swallow
        // the arc this outcome promises, and the line would read "position
        // unavailable" over somebody else's route (D15a).
        leaveFlight();
        set({ outcome: { kind: 'offCoverage', callsign, route: answer.route } });
        return;
      }
      if (answer.status === 'unreachable') couldNotAsk = answer.detail;
    }

    // Outcome 4 comes BEFORE outcome 3, and that order is the whole point:
    // "we could not ask" outranks "it does not exist", because one of them
    // is a measurement and the other is an excuse for not having one.
    if (couldNotAsk !== null) {
      set({ outcome: { kind: 'unreachable', query: input, detail: couldNotAsk } });
      return;
    }

    // Outcome 3: every candidate came back with a measured `known: false`.
    set({ outcome: { kind: 'unknown', query: input } });
  },
}));
```

- [ ] **Step 17: Estendere `tests/unit/state/sceneView.test.ts` — di chi è l'arco**

Aggiungere agli import `arcSubject` (accanto a `readFocusView`, già importato dal Task 7) e `import { useSearchStore } from '@/state/searchStore';`.

Aggiungere `useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });` al `beforeEach` di `describe('readFocusView — what we can place, we place', …)`: da qui in avanti `readFocusView` legge anche quello store, e un esito lasciato acceso da un altro test sarebbe un arco che compare dal nulla.

Poi, in fondo al file:

```ts
const GHOST_ROUTE = {
  originIata: 'LAS', originName: 'Harry Reid International Airport',
  destinationIata: 'LHR', destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

describe('arcSubject — whose route the globe is drawing', () => {
  it('gives the ghost route the arc while nothing is selected', () => {
    expect(
      arcSubject(null, { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE }).kind
    ).toBe('ghost');
  });

  it('gives a selected flight the arc — even when that flight draws none', () => {
    // The order `run` cannot fix: the click comes AFTER the search. Nothing
    // clears the outcome when the user picks an aircraft, so the line went
    // on announcing "BA999 · position unavailable — outside ADS-B coverage"
    // while the arc it named had been replaced by the selected flight's —
    // or by no arc at all, that flight having no route, which is 95,3% of
    // the fleet. Either way BA999's route had left the globe and the line
    // was still presenting it (D15a).
    expect(
      arcSubject('a1', { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE }).kind
    ).toBe('flight');

    useAircraftStore.setState({ aircraft: new Map([['a1', ac('a1', { route: null })]]) });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSearchStore.setState({
      query: 'BA999',
      outcome: { kind: 'offCoverage', callsign: 'BAW999', route: GHOST_ROUTE },
    });
    expect(readFocusView()).toBeNull();
  });
});
```

```bash
npx vitest run tests/unit/state/sceneView.test.ts
```

Expected: rosso sui due nuovi — `arcSubject` non esiste ancora, quindi o i due test falliscono (`arcSubject is not a function`) o il runner rifiuta l'import prima di eseguire il file, a seconda di come Vite tratta un export mancante. In nessuno dei due casi il comportamento dei 12 test del Task 7 cambia: `readFocusView` non ha ancora imparato niente.

- [ ] **Step 18: L'arco fantasma, e UNA sola autorità su di chi è l'arco — `src/state/sceneView.ts`**

`run` lascia il volo **prima** di promettere l'arco, e questo chiude un ordine solo: cercare mentre un volo è a fuoco. L'ordine opposto — cliccare un aereo **dopo** la ricerca — non lo chiude nessuno: niente azzera l'esito quando l'utente seleziona qualcosa, e l'arco va alla selezione. La riga continuava a dire «BA999 · position unavailable — outside ADS-B coverage» mentre al posto dell'arco di BA999 c'era quello del volo selezionato, oppure — se quel volo non ha rotta, cioè il 95,3 % della flotta — nessun arco. Lo schermo nominava ciò che non stava disegnando.

**La scelta: la riga smette di annunciare l'arco; l'arco non sopravvive alla selezione.** Farlo sopravvivere vorrebbe dire due archi insieme, e quindi due coppie di marcatori D/A, un `openEnd` che non sa più a quale rotta appartenga e un `readOpenAirport` ambiguo: tre pezzi del Task 7 riaperti per uno stato raro, e contro il disegno stesso — il focus svuota il cielo proprio per lasciare **una** storia sullo schermo. La riga ha invece già il precedente giusto: quando un estremo non è collocabile dice «no arc drawn». Questa è la stessa frase per l'altra ragione. E perché le parole e il disegno non divergano, a rispondere «di chi è l'arco» è una funzione sola, che il renderer e la riga interrogano entrambi — altrimenti si riscriverebbe la condizione in due posti, che è la divergenza da cui tutta questa famiglia nasce.

Sostituire la testa di `readFocusView`,

```ts
export function readFocusView(): FocusView | null {
  const icao = useSelectionStore.getState().selectedIcao;
  if (icao === null) return null;
  const ac = useAircraftStore.getState().aircraft.get(icao);
```

con

```ts
/**
 * Whose route the globe is drawing: the selected flight's, the search's
 * ghost route, or nobody's.
 *
 * ONE answer, read by the renderer AND by the line that talks about it.
 * `run` lets go of a focused flight before promising an arc, which settles
 * the order "search while focused"; nothing settles the opposite order,
 * because nothing clears the outcome when the user picks an aircraft — and
 * then the selection takes the arc while the line goes on naming it, which
 * is the invariant reached through the words instead of the picture
 * (D15a). Pure, so the component can ask it with the values it has already
 * subscribed to rather than re-deriving the rule beside it.
 */
export type ArcSubject =
  | { kind: 'flight'; icao: string }
  | { kind: 'ghost'; callsign: string; route: FlightRouteLite }
  | { kind: 'none' };

export function arcSubject(
  selectedIcao: string | null,
  outcome: SearchOutcome
): ArcSubject {
  // The selection wins, and it wins even when it yields no arc at all: a
  // flight whose route adsbdb does not know draws nothing, and the globe
  // is still about THAT flight. 95,3% of the fleet is in that state.
  if (selectedIcao !== null) return { kind: 'flight', icao: selectedIcao };
  if (outcome.kind === 'offCoverage') {
    return { kind: 'ghost', callsign: outcome.callsign, route: outcome.route };
  }
  return { kind: 'none' };
}

export function readArcSubject(): ArcSubject {
  return arcSubject(
    useSelectionStore.getState().selectedIcao,
    useSearchStore.getState().outcome
  );
}

export function readFocusView(): FocusView | null {
  const subject = readArcSubject();
  if (subject.kind === 'none') return null;
  if (subject.kind === 'ghost') {
    // Search outcome 2: a route with no aircraft on it. The SAME buildArc
    // the focused branch uses — no aircraft, so routeArc draws it at one
    // even brightness — and the same consequence when an airport cannot be
    // placed: no arc, but the end we know still gets its marker, and
    // FlightSearch names the airport that is missing.
    const { origin, destination } = routeEnds(subject.route);
    return { origin, destination, arc: buildArc(origin, destination, null) };
  }
  const ac = useAircraftStore.getState().aircraft.get(subject.icao);
```

Il resto del corpo non cambia: `icao` non compariva altrove.

Aggiungere agli import `import { useSearchStore } from './searchStore';`, `import type { SearchOutcome } from './searchStore';` e `import type { FlightRouteLite } from '@/types';`.

```bash
npx vitest run tests/unit/state/sceneView.test.ts
```

Expected: **14 passed**. Suite intera: 450.

- [ ] **Step 19: Creare `src/ui/FlightSearch.tsx`**

```tsx
import { useSearchStore } from '@/state/searchStore';

/**
 * Always visible, never behind a shortcut: someone arriving from a shared
 * link has no way to discover a keystroke (spec §6.3).
 *
 * It searches on SUBMIT, not on every keypress. A search per character
 * would send five requests for "BA274", each of which enqueues a callsign
 * for the adsbdb pump — and it would need a debounce, which is another
 * duration to measure correctly.
 */
export function FlightSearch() {
  const query = useSearchStore((s) => s.query);
  const outcome = useSearchStore((s) => s.outcome);
  const setQuery = useSearchStore((s) => s.setQuery);
  const clear = useSearchStore((s) => s.clear);
  const run = useSearchStore((s) => s.run);
  // Subscribed, not read: selecting an aircraft is what takes the arc away
  // from outcome 2 between two renders of this line, so the line has to
  // re-render when it happens. Nothing clears the outcome on a selection,
  // and nothing should — the answer to the user's question is still true;
  // it is the ARC the line can no longer claim.
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run(query);
      }}
    >
      <input
        type="search"
        className="search__input"
        placeholder="Flight number…"
        aria-label="Search a flight number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}>
        ✕
      </button>
      <p className="search__outcome" role="status" aria-live="polite">
        {outcome.kind === 'offCoverage' && (
          <OffCoverage
            callsign={outcome.callsign}
            route={outcome.route}
            // Asked of the one function that decides whose arc it is, with
            // the values this component is already subscribed to. Never
            // re-derived here: two authorities on one fact is the drift
            // the whole of D15 exists to prevent.
            preempted={arcSubject(selectedIcao, outcome).kind !== 'ghost'}
          />
        )}
        {outcome.kind === 'unknown' && <>No flight by that number</>}
        {/* The fourth outcome, and the only one that is about US. "No
            flight by that number" after a 500 is the screen claiming to
            have checked something it could not even ask about (D15b). */}
        {outcome.kind === 'unreachable' && (
          <>Could not check “{outcome.query}” — the route service did not answer</>
        )}
      </p>
    </form>
  );
}

/**
 * Outcome 2: a flight we know of and cannot see.
 *
 * The first clause is about the AIRCRAFT — we have no position for it. The
 * second is about an AIRPORT, and it exists because the two were once
 * conflated: with an endpoint missing from airports.json the globe drew
 * nothing at all while the only line on screen talked about the aircraft,
 * so the user read "position unavailable" and had no way to learn that the
 * silence belonged to the airport instead (D15b). 13 IATA codes of the
 * committed cache are in exactly that position.
 *
 * The third clause is about the ARC, and it is the same sentence for a
 * third reason. `run` lets go of a focused flight before promising an arc,
 * which settles the order "search while focused"; the opposite order —
 * clicking an aircraft AFTER the search — nothing settles, because nothing
 * clears the outcome on a selection. The selection takes the arc (or draws
 * none at all, its route being unknown, which is 95,3% of the fleet) while
 * this line went on announcing BA999's route as though it were still out
 * there. The answer to the question asked stays on screen; the claim about
 * the picture does not outlive the picture (D15a).
 */
function OffCoverage({
  callsign,
  route,
  preempted,
}: {
  callsign: string;
  route: FlightRouteLite;
  preempted: boolean;
}) {
  const ends = routeEnds(route);
  const unplaced = [ends.origin, ends.destination].filter((e) => !isPlaceable(e));
  return (
    <>
      {callsign} · position unavailable — outside ADS-B coverage
      {preempted && <> · route not drawn while another flight is selected</>}
      {/* Only worth saying while this route is the one on the globe: with
          the arc already gone to a selection, naming the airport we cannot
          place would explain an absence that has a nearer cause. */}
      {!preempted && unplaced.length > 0 && (
        <> · {unplaced.map((e) => e.iata).join(' and ')} position unknown — no arc drawn</>
      )}
    </>
  );
}
```

e aggiungere agli import del file:

```tsx
import { routeEnds, isPlaceable } from '@/data/airportInfo';
import { useSelectionStore } from '@/state/selectionStore';
import { arcSubject } from '@/state/sceneView';
import type { FlightRouteLite } from '@/types';
```

- [ ] **Step 20: Verificare il verde**

```bash
npx vitest run tests/component/FlightSearch.test.tsx
```

Expected: **14 passed**. Suite intera: 464.

- [ ] **Step 21: Aggiungere il gradino della ricerca alla scala di `Esc`**

In `tests/unit/state/escape.test.ts` aggiungere al `beforeEach` `useSearchStore.setState({ query: '', outcome: { kind: 'idle' } });` con il relativo import, e il test:

```ts
  it('clears the search before leaving focus', () => {
    // The search is what put the user in focus; undoing the search undoes
    // the focus with it, and clear() already does exactly that.
    useSearchStore.setState({ query: 'BA274', outcome: { kind: 'focused', callsign: 'BAW274' } });
    useSelectionStore.setState({ selectedIcao: 'a1' });
    expect(handleEscape()).toBe(true);
    expect(useSearchStore.getState().outcome.kind).toBe('idle');
  });
```

In `src/state/escape.ts`, fra il gradino della scheda aeroporto e quello del focus:

```ts
  if (useSearchStore.getState().outcome.kind !== 'idle') {
    useSearchStore.getState().clear();
    return true;
  }
```

con l'import `import { useSearchStore } from './searchStore';`.

- [ ] **Step 22: Montare la barra e darle uno stile**

In `src/ui/AppShell.tsx` aggiungere `import { FlightSearch } from './FlightSearch';` e, nel JSX, `<FlightSearch />` subito dopo `<FleetPanel />`.

In fondo a `src/ui/styles.css`:

```css
/* Flight search — always visible, never behind a shortcut (spec §6.3) */
.search {
  position: fixed;
  top: var(--space-xl);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-xxs);
  flex-wrap: wrap;
  justify-content: center;
}
.search__input {
  width: 190px;
  padding: var(--space-xs) var(--space-md);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-on-dark);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-family: var(--font-stack);
}
.search__clear {
  background: none;
  border: 0;
  color: var(--color-on-dark);
  opacity: 0.5;
  cursor: pointer;
  font-size: 12px;
}
.search__outcome {
  flex-basis: 100%;
  text-align: center;
  margin-top: var(--space-xxs);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
}
```

- [ ] **Step 23: Verificare build, suite e browser**

```bash
npm run build:all && npm test -- --run
```

Expected: build pulita, **465 passed (51 files)**.

Verifica a occhio, con `npm run dev:full`: cercare il callsign di un aereo visibile sul globo (esito 1 → focus); cercare `BA274` nella forma IATA; cercare un volo noto ma fuori copertura (esito 2 → arco con D e A, nessun aereo, riga «outside ADS-B coverage»); cercare `ZZ999` (esito 3 → «No flight by that number», globo intatto). Poi **fermare il server Fastify e ricercare**: la riga deve dire «Could not check … — the route service did not answer», **mai** «No flight by that number». Se dice la seconda, lo Step 15 non è stato applicato e lo schermo sta affermando una cosa che non ha potuto verificare.

- [ ] **Step 24: Commit**

```bash
git add src/data/airlineLookup.ts src/data/flightQuery.ts src/data/routeClient.ts \
        src/state/searchStore.ts src/state/sceneView.ts src/state/escape.ts \
        src/ui/FlightSearch.tsx src/ui/AppShell.tsx src/ui/styles.css \
        server/routeQuery.ts server/index.ts \
        tests/unit/data/flightQuery.test.ts tests/unit/data/routeClient.test.ts \
        tests/unit/server/routeQuery.test.ts tests/component/FlightSearch.test.tsx \
        tests/unit/state/escape.test.ts tests/unit/state/sceneView.test.ts
git commit -m "feat: search a flight number, and three honest answers"
```

---

### Task 9: End-to-end, accessibilità, e il cancello finale

Nessun test unitario di questo piano prova la cosa che conta davvero: che le cinque funzioni, messe insieme in un browser, si comportino come l'utente le ha descritte. E le superfici nuove — pannello, marcatori, barra di ricerca — non sono mai passate sotto axe.

**Files:**
- Create: `tests/e2e/panel-focus-search.spec.ts`
- Modify: `tests/e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: tutto quanto sopra, attraverso il browser
- Produces: nessuna API nuova

**Il feed viene intercettato, non atteso.** `playwright.config.ts:13` avvia solo `npm run dev`, cioè Vite: il server Fastify non c'è e `/api/states` non risponde. Il test `happy-path` esistente sopravvive perché `/\d+ aircraft/` combacia anche con «0 aircraft». Un test sul pannello non può vivere di quello: serve una flotta nota. `page.route()` serve una risposta fissa — il che rende il test **deterministico**, cosa che un feed vero non sarebbe mai, e non manda una sola richiesta verso un servizio gratuito.

- [ ] **Step 1: Creare `tests/e2e/panel-focus-search.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A known sky. playwright.config.ts starts Vite alone, so /api/states would
 * never answer; and even with the server up, a live feed is a different
 * fleet every run. Three aircraft, one of them complete with a real
 * LAS->LHR route — both airports are in public/data/airports.json, so the
 * D and A markers can actually be placed.
 */
const ROUTE = {
  originIata: 'LAS',
  originName: 'Harry Reid International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1', callsign: 'BAW274', longitude: -10, latitude: 50,
    baroAltitudeFt: 38000, velocityKt: 472, headingDeg: 261, onGround: false,
    lastContact: 1_716_163_200, registration: 'G-ZBKA', modelCode: 'B789',
    modelDesc: null, route: null, complete: false, ...over,
  };
}

async function withFleet(page: Page): Promise<void> {
  await page.route('**/api/states*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        stale: false,
        capped: false,
        source: 'test',
        aircraft: [
          aircraft({ icao24: 'a1', callsign: 'BAW274', route: ROUTE, complete: true }),
          aircraft({ icao24: 'a2', callsign: 'RYR1234', latitude: 45, longitude: 9 }),
          aircraft({ icao24: 'a3', callsign: 'NJE004M', latitude: 48, longitude: 2 }),
        ],
      }),
    });
  });
}

test('the counter opens into a panel whose numbers add up', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  const summary = page.locator('.hud__summary');
  await expect(summary).toContainText('3 aircraft');
  await summary.click();
  await expect(page.getByRole('checkbox', { name: /full route/i })).toBeVisible();
  await expect(page.getByTestId('count-complete')).toHaveText('1');
  await expect(page.getByTestId('count-partial')).toHaveText('2');
});

test('switching the greys off says how many it hid, and goes on saying it', async ({ page }) => {
  // At the measured 3,5% complete this is what a real user will see: a
  // nearly empty globe. It must never be a mystery — and it must not stop
  // being explained the moment the drawer closes, because the drawer
  // closes and the filter does not (D14). Esc is the key a user presses to
  // close things, so the explanation used to leave at exactly the moment
  // they were looking for it.
  await withFleet(page);
  await page.goto('/');
  await page.locator('.hud__summary').click();
  await page.getByRole('checkbox', { name: /partial data/i }).click();
  await expect(page.getByText(/2 hidden by filters/i)).toBeVisible();

  await page.keyboard.press('Escape'); // the fleet drop-down, and only it
  await expect(page.getByRole('checkbox', { name: /partial data/i })).toHaveCount(0);
  await expect(page.getByText(/2 hidden by filters/i)).toBeVisible();
  await expect(page.locator('.hud__summary')).toContainText('1 of 3 aircraft');
});

test('searching a flight in the feed focuses it and plants D and A', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BA274'); // the IATA spelling
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.marker[data-end="origin"]')).toBeVisible();
  await expect(page.locator('.marker[data-end="destination"]')).toBeVisible();
  await expect(page.locator('.panel__callsign')).toContainText('BAW274');
});

test('clicking a marker shows the airport, and no terminal is invented', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');
  await page.locator('.marker[data-end="origin"]').click();
  await expect(page.getByText(/Harry Reid International Airport/)).toBeVisible();
  await expect(page.getByText(/terminal/i)).toHaveCount(0);
});

test('an unknown flight number says so and leaves the globe alone', async ({ page }) => {
  await withFleet(page);
  await page.route('**/api/route/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ callsign: 'ZZZ999', known: false, route: null }),
    });
  });
  await page.goto('/');
  await page.getByRole('searchbox').fill('ZZ999');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByText(/no flight by that number/i)).toBeVisible();
  await expect(page.locator('.marker')).toHaveCount(0);
});

test('Escape walks back out one step per press', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.locator('.hud__summary').click();
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');
  await page.locator('.marker[data-end="origin"]').click();

  await page.keyboard.press('Escape'); // the airport card
  await expect(page.getByText(/Harry Reid/)).toHaveCount(0);
  await expect(page.locator('.marker[data-end="origin"]')).toBeVisible();

  await page.keyboard.press('Escape'); // the search, and with it the focus
  await expect(page.locator('.marker')).toHaveCount(0);
  // The flight card went with the flight it belonged to, and what is left
  // is the way back in — not an empty box beside a refilled globe (D13).
  await expect(page.locator('.panel__toggle')).toBeVisible();

  await page.keyboard.press('Escape'); // the fleet drop-down
  await expect(page.getByRole('checkbox', { name: /full route/i })).toHaveCount(0);
});

test('dismissing the flight card gives the sky back, and says so while it is gone', async ({
  page,
}) => {
  // The tenth defect of the family, in a browser. The ✕ called the panel's
  // close() alone: the card went away, the focus stayed on, and the globe
  // kept drawing one aircraft of three while the only words explaining
  // that had just been dismissed with the card (D15).
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');

  // While the focus holds, the count says what is drawn and a line says why.
  await expect(page.locator('.hud__summary')).toContainText('1 of 3 aircraft');
  await expect(page.getByText(/2 hidden while one flight is in focus/i)).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.hud__summary')).toContainText('3 aircraft');
  await expect(page.locator('.hud__summary')).not.toContainText('1 of 3');
  await expect(page.getByText(/in focus/i)).toHaveCount(0);
  await expect(page.locator('.marker')).toHaveCount(0);
  await expect(page.locator('.panel__toggle')).toBeVisible();
});
```

- [ ] **Step 2: Estendere `tests/e2e/a11y.spec.ts`**

Aggiungere in fondo al file:

```ts
test('the fleet panel and the search bar pass axe-core', async ({ page }) => {
  // Three new surfaces have never been under axe: the disclosure button,
  // two checkboxes and a search landmark.
  await page.goto('/');
  await page.locator('.hud__summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

- [ ] **Step 3: Eseguire gli E2E**

```bash
npm run test:e2e
```

Expected: 10 test Playwright verdi — i 2 preesistenti di `happy-path`, i 3 di `a11y` (2 + 1 nuovo) e i 7 nuovi di `panel-focus-search`.

Se `panel-focus-search` trova **un** marcatore invece di due, la causa più probabile non è il marcatore: è il fixture. Un `route` presente con un IATA assente da `airports.json` lascia `arc: null` e un marcatore solo — il comportamento voluto da D11, costruito nel Task 5 e preteso dal Task 7. `LAS` e `LHR` ci sono entrambi, verificato il 2026-11-21.

- [ ] **Step 4: Il cancello completo**

```bash
npm run build:all && npm test -- --run && npm run test:e2e
```

Expected:
- `build:all`: nessun errore su `tsconfig.json` **né** su `tsconfig.server.json`;
- `npm test`: **465 passed (51 files)**;
- `npm run test:e2e`: 10 passed.

> **`npm run lint` non è nel cancello, ed è un difetto preesistente, non una scorciatoia.** Verificato su `main` il 2026-11-21: lo script fallisce prima di guardare un solo file — «ESLint couldn't find an eslint.config.(js|mjs|cjs) file. From ESLint v9.0.0...». Il repo ha `.eslintrc.cjs` e `eslint@9.39.4` installato, che non legge più quel formato. Metterlo nel cancello significherebbe chiedere all'esecutore di far passare qualcosa che non può passare, o — peggio — di migrare la configurazione di ESLint dentro un task di interfaccia. Va riparato, con un commit suo, fuori da questo piano.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/panel-focus-search.spec.ts tests/e2e/a11y.spec.ts
git commit -m "test(e2e): the five things the user asked for, exercised in a browser"
```

---

## Riepilogo dei test attesi

| Dopo il task | Test unitari/componente | File |
|---|---|---|
| partenza | 281 | 32 |
| 1 — regola di visibilità, `isFocusable` e la **tabella dell'invariante** (D15), bordi della dissolvenza compresi | 318 | 35 |
| 2 — colore, picking, regola letta dagli store, accordo fra conteggio e buffer | 339 | 37 |
| 3 — pannello a tendina, che stampa `shown`, nomina ogni causa e promette solo ciò che ha misurato | 361 | 38 |
| 4 — focus, `Esc`, `leaveFlight()`, pannello mai vuoto né muto, e il fotogramma in cui dissolvenza e conteggio si incontrano | 385 | 42 |
| 5 — estremi della rotta | 397 | 44 |
| 6 — arco geodetico | 409 | 45 |
| 7 — marcatori D/A, anche quando l'estremo collocabile è uno solo | 428 | 47 |
| 8 — ricerca, il quarto esito «non ho potuto chiedere», e una sola autorità su di chi è l'arco | 465 | 51 |
| 9 — E2E | 465 unitari + 10 Playwright | 51 |

---

## Cosa questo piano NON fa

- **Non tocca il server del feed.** Il solo codice server aggiunto è `server/routeQuery.ts`, che legge una mappa in memoria. Il poller, la griglia di tile, la flotta cumulativa e `/health` restano quelli del Piano 1.
- **Non interroga adsbdb da nessun percorso interattivo.** Né in fase di scrittura di questo piano, né a runtime: la ricerca legge la cache e accoda, e la pompa lenta del Piano 1 resta l'unica cosa che parla con quel servizio.
- **Non aggiunge il dead reckoning** (spec §4.1). È un piano a sé: tocca il render loop e la finestra di staleness, e mescolarlo a cinque funzioni di interfaccia renderebbe impossibile dire quale dei due ha rotto cosa.
- **Non aggiunge la cartografia a livello regione** (spec §4.3) né il raggio del punto in pixel-schermo (spec §4.2). Riguardano la densità, non ciò che l'utente ha chiesto qui.
- **Non introduce il clustering numerico.** È idioma Flightradar24 e la spec lo dichiara anti-reference.
- **Non promette che il globo si riempia di blu.** Al 3,5 % di completi, oggi, non succede. Il pannello lo spiega; la cache delle rotte lo cambierà da sola, a ~920 voli l'ora, senza che nessuna riga di questo piano debba cambiare.

---

## Il rischio principale, dichiarato

**L'utente apre il pannello, spegne i parziali, e vede sparire il 96,5 % del cielo.** È il comportamento corretto e richiesto, e il Task 3 lo dichiara in cifre nel pannello stesso — sulla riga chiusa («200 of 5 900 aircraft») e nella nota che resta montata anche richiudendo la tendina, perché il filtro resta acceso anche lì (D14). Ma resta un momento in cui il prodotto sembra essersi rotto, e il rimedio onesto non è una soglia che nega la funzione: è il tempo. La cache delle rotte cresce di ~920 voli l'ora e sopravvive ai riavvii — misurata il 2026-11-21 a 8 374 rotte nel file di runtime contro le 4 243 del seed committato. La stessa checkbox, fra qualche settimana, nasconderà una minoranza invece di una maggioranza, e il disegno non avrà bisogno di una riga diversa.

Se dopo una settimana di produzione la percentuale dei completi non si muove, il difetto non sta in questo piano: sta nella pompa delle rotte del Piano 1, e `/health` lo espone già in `routes.stats()`.
