# Air View v2 — Design

Data: 2026-09-14
Stato: approvato in brainstorming, pronto per il piano di implementazione
Predecessore: `docs/superpowers/specs/2026-05-20-air-view-design.md`

---

## 1. Perché esiste questa v2

La v1 è in produzione su Railway e il globo è vuoto. L'indagine ha trovato
tre difetti distinti, due dei quali invalidano dati mostrati agli utenti.

### 1.1 Il feed è fermo dal 20 agosto 2026

adsb.lol risponde `403` alle richieste del server. La causa è lo User-Agent:
Node/undici invia `User-Agent: node`, che adsb.lol blocca.

```
UA 'node'    -> 403        node fetch (UA default) -> 403
UA 'undici'  -> 200        node fetch (UA custom)  -> 200
UA 'curl/8'  -> 200
nessun UA    -> 403
```

Il guasto è rimasto invisibile per 25 giorni per tre ragioni cumulative:

1. `server/index.ts` serve la cache scaduta dal ramo `catch` **senza limite di
   età**. La produzione ha continuato a restituire lo snapshot del
   2026-08-20T17:17:23Z.
2. `/health` risponde `{status:'ok'}` incondizionatamente, quindi Railway non
   ha mai visto un degrado.
3. `aircraftStore.removeStale` elimina gli aerei con `lastContact` più vecchio
   di 60 s. Con uno snapshot di 25 giorni, **ogni** aereo viene eliminato al
   primo tick: globo vuoto.

Il punto 3 spiega anche la fase intermedia osservata dall'utente, aerei che
"non si spostano mai": non sembravano fermi, erano lo stesso snapshot
ridisegnato.

### 1.2 Le rotte mostrate sono false

`routeLookup.lookupRoute` ignora il numero di volo e ritorna `list[0]`, la
prima rotta in ordine alfabetico della compagnia.

```
ogni volo BA* -> AAL -> AAR       ogni volo LH* -> ABJ -> BRU
ogni volo FR* -> AAR -> AGP       ogni volo DL* -> ABE -> ATL
ogni volo AZ* -> AAL -> AMS
```

Il 49% degli aerei mostrava origine e destinazione inventate. Viola il
principio fondativo di `PRODUCT.md` ("Honor the data... never simulated").

### 1.3 La banda impedisce sia il dettaglio sia la frequenza

La v1 scarica il feed globale, 5,8 MB, ogni 30-60 s. Da qui discendono
l'impossibilità di aggiornare più spesso, l'impossibilità di aggiungere
dettaglio, e il movimento a scatti.

---

## 2. Obiettivi e non-obiettivi

### Obiettivi

- Il feed torna vivo e **resta osservabile**: un guasto futuro è visibile
  entro minuti, non mesi.
- Posizioni aggiornate di frequente e movimento continuo, senza inventare dati.
- Ogni aereo distinguibile e selezionabile a qualsiasi densità, senza ammassi.
- Origine e destinazione **vere**, o dichiarate assenti.
- Filtro fra aerei con scheda completa e aerei con dati parziali.
- Focus su un volo: gli altri svaniscono, compare la rotta con i marker D e A.
- Ricerca per numero di volo.

### Non-obiettivi (esplicitamente fuori scope)

- Rete stradale, edifici, landmark. La visione "planet to street" di
  `PRODUCT.md` §1 resta per una v3 con spec propria.
- Copertura oceanica. È un limite fisico di ADS-B terrestre, non un difetto
  software: sopra gli oceani non esistono ricevitori. Misurato sullo snapshot
  live: Nord Atlantico 0,1%, Medio Pacifico 0,0%, Oceano Indiano 0,0%, contro
  USA 43,0% ed Europa 37,0%. Richiederebbe ADS-B satellitare commerciale.
- Terminal e gate. Nessuna sorgente gratuita li espone. Il modello dati li
  prevede, la UI li mostra solo se presenti, e in pratica non lo saranno mai.
- Clustering numerico degli aerei: è idioma Flightradar24, anti-reference.

---

## 3. Architettura dei dati

### 3.1 Sorgenti

Modulo `src/data/sources/` con un adattatore per fornitore e un tipo
normalizzato comune. La v1 aveva adsb.lol cablato inline: un singolo 403 ha
spento tutto. L'astrazione è la lezione del guasto.

| Sorgente | Ruolo | Chiave array | Note |
|---|---|---|---|
| `api.adsb.lol` | primaria | `ac` | verificata, 638 aerei su 250 NM da Milano |
| `opendata.adsb.fi` | fallback | `aircraft` | verificata, 646 aerei; espone in più `desc` (modello esteso, "AIRBUS A-330-200") |
| `api.airplanes.live` | scartata | — | 403 anche con UA custom |

Le due sorgenti hanno chiavi diverse: la normalizzazione è per-adattatore, non
condivisa.

Regole:

- **Ogni richiesta uscente porta uno User-Agent identificativo** che nomina il
  progetto e la sua URL. Causa diretta del guasto, e cortesia verso aggregatori
  che ci ospitano gratuitamente.
- Il selettore prova la primaria, scala sulla secondaria al primo errore, e un
  circuit breaker ricorda il guasto per alcuni minuti invece di ritentare a
  ogni richiesta.
- `desc` viene usato quando la sorgente lo fornisce; quando manca si ricade sul
  codice tipo (`A332`).

### 3.2 Cache a tile geografiche

Il mondo è partizionato in celle fisse di 10°. Ogni cella ha la propria voce di
cache con il proprio timestamp. Il fetch richiede le celle che intersecano il
viewport, non un raggio arbitrario.

Due proprietà che il raggio libero non ha:

- Visitatori diversi che guardano la stessa regione condividono la stessa
  cella, quindi il carico verso adsb.lol resta costante al crescere del
  traffico anziché lineare.
- Un pan orizzontale riusa quasi tutte le celle già in memoria.

La cache a tile è anche il punto unico dove imporre il tetto di chiamate verso
l'upstream e dove far scadere i dati vecchi.

### 3.3 Due cadenze sovrapposte (approccio C)

- **Sweep globale magro**, bassa frequenza. Copre tutti gli aerei del mondo,
  ma con un payload ridotto ai soli campi che la vista pianeta usa davvero:
  identificativo, posizione, e il flag completo/parziale. Alla vista pianeta un
  punto è un punto — modello, registrazione e quota non vengono disegnati,
  quindi non devono viaggiare. Serializzato in array posizionali invece che in
  oggetti JSON, sta in poche centinaia di KB contro i 5,8 MB della v1.
  È questa riduzione, non una frequenza più bassa, a rendere sostenibile
  tenere il pianeta sempre popolato. "Magro" significa ridotto nel contenuto,
  non nel numero di aerei: non è un campione.
- **Celle sotto il viewport**, alta frequenza e payload completo, attive quando
  la camera scende sotto la soglia di zoom regionale. Qui i campi ricchi
  servono, perché qui l'utente clicca.

La transizione fra i due è additiva: le celle in vista sovrascrivono i record
magri con quelli completi, non li sostituiscono in blocco, così il globo non
sfarfalla durante il pan.

Valori iniziali proposti, da calibrare con il feed in mano nella prima
iterazione: sweep globale 60 s, celle in vista 10 s, tetto complessivo verso
l'upstream ~1 richiesta/s. Il principio da rispettare, qualunque sia la
calibrazione finale, è che la banda vada dove l'utente sta guardando.

### 3.4 Resilienza — la cura del guasto silenzioso

Tre presidi indipendenti, perché il guasto è passato attraverso tre livelli.

1. **Età massima della cache.** Oltre la soglia la cache smette di essere
   servita. Il server risponde con un errore esplicito che dichiara da quando
   il feed è fermo. Mai più uno snapshot di 25 giorni spacciato per presente.
2. **`/health` diagnostico.** Riporta l'età dell'ultimo fetch riuscito e passa
   a `degraded` oltre soglia, così Railway se ne accorge da solo.
3. **Il client dichiara invece di svuotare.** Ricevendo dati fermi, la UI lo
   comunica. Un contatore che smette di salire è informazione; un globo vuoto
   sembra un bug.

### 3.5 Rotte

`adsbdb.com`, gratuito e senza chiave, risolve il callsign in origine e
destinazione reali. Verificato: `BAW274 -> LAS -> LHR`, `RYR1234 -> STN -> EMA`,
`UAE2 -> LHR -> DXB`.

Copertura misurata su 80 callsign estratti a caso dal feed live: **72% hit**.
I miss sono voli privati, business e militari (`NJE004M`, `MORPH16`, `RVP155`)
— esattamente la popolazione che il design vuole lasciare grigia.

- Cache lato server a lunga scadenza: una rotta di linea non cambia in giornata.
- Lookup solo per i callsign effettivamente presenti nel feed.
- `src/data/routeLookup.ts` e `public/data/openflights-routes.json` (4,2 MB)
  vengono **eliminati**, non corretti: il loro output è falso per costruzione.

---

## 4. Densità e movimento

### 4.1 Dead reckoning

Ogni aereo avanza a ogni frame dall'ultimo fix reale, lungo il proprio `track`,
alla propria `gs` — entrambi forniti dal feed. Il movimento diventa continuo a
60fps restando ancorato a dati misurati.

Questo è ricostruzione, non invenzione: interpola fra due fix reali usando
grandezze che il feed stesso dichiara. Tre vincoli lo tengono onesto:

- **Tetto temporale.** Oltre uno scarto massimo dall'ultimo fix, l'aereo
  smette di avanzare e sbiadisce, invece di volare verso una posizione che
  nessuno ha misurato.
- **Il trail disegna solo fix realmente ricevuti**, mai posizioni calcolate.
  La scia resta un documento, non un'animazione.
- **`removeStale` viene riscritto.** Oggi confronta `lastContact` con l'ora
  locale, e quando il feed è fermo cancella l'intera flotta: è l'ultimo anello
  che ha svuotato il globo. In v2 la staleness di un aereo si misura rispetto
  al `fetchedAt` del batch che lo ha portato, non rispetto all'orologio locale.
  Serve a distinguere un aereo uscito dalla copertura dai suoi coetanei dello
  stesso batch, e nient'altro. Il caso "l'intero feed è fermo" non è compito
  suo: lo gestiscono i presidi di §3.4, che lo dichiarano invece di lasciar
  svuotare la scena.

### 4.2 Separazione

- Il raggio del punto è definito in **pixel-schermo** e cresce con lo zoom. Oggi
  è fisso, quindi zoomando si separa la geografia ma i punti restano attaccati.
- Il fetch camera-driven fa sì che a zoom regionale ci siano centinaia di aerei
  sullo schermo invece di diecimila. La separazione nasce lì.
- **Niente clustering artificiale.** Due aerei sovrapposti restano due punti
  sovrapposti; l'ambiguità la risolve il picking, scegliendo il più vicino al
  cursore e permettendo di ciclare fra quelli coincidenti.
- **Ordine di disegno come gerarchia**: selezionato sopra tutto, poi i completi,
  poi gli incompleti. Anche a densità massima l'informazione ricca non finisce
  sepolta sotto il rumore.

### 4.3 Cartografia

Zoom continuo fino a livello regione/città. Coste, confini nazionali, confini
regionali, città etichettate — tutto nel linguaggio vetro/hairline già in uso.
Nessuna strada, nessun edificio.

---

## 5. Completezza dei dati

### 5.1 Definizione

Un aereo è **completo** quando possiede *sia* origine e destinazione reali
*sia* tutti i campi tecnici: callsign, compagnia, modello, registrazione,
quota, velocità al suolo, rotta bussola.

Disponibilità misurata sul feed live (10.349 aerei):

| Campo | Copertura |
|---|---|
| posizione lat/lon | 100,0% |
| callsign | 97,3% |
| velocità al suolo | 97,8% |
| registrazione | 96,7% |
| modello | 95,4% |
| rotta bussola | 89,6% |
| quota (in volo) | 88,7% |

Registrazione e modello sono nel feed e la v1 non li usava affatto: la scheda
v2 è più ricca a costo zero.

Combinando i campi tecnici (83,5%) con la copertura rotta di adsbdb (72%), la
stima è **~55-58% completi, ~42-45% parziali** — un rapporto che rende il
filtro visivamente significativo.

### 5.2 Perché questo criterio

Il colore predice l'interazione: solo un aereo completo può mostrare D e A
sulla mappa. Un utente impara la regola al primo click e non la dimentica.

---

## 6. Interazione

### 6.1 Pannello

Chiuso di default su una riga, il contatore già esistente. Aperto:

```
IN VOLO                      9 176
──────────────────────────────────
☑  Rotta completa            5 284
☑  Dati parziali             3 892
```

- I conteggi si aggiornano a ogni ciclo di dati e la loro somma è sempre il
  totale: il pannello è autoverificante.
- Le due righe sono deselezionabili indipendentemente. Deselezionando "Dati
  parziali" i grigi svaniscono e i completi restano soli.
- Con il fetch camera-driven il numero caricato cambia con lo zoom, quindi
  l'etichetta cambia con il contesto: `IN VOLO` alla vista pianeta,
  `IN VISTA` su una regione. Il numero dichiara sempre a cosa si riferisce.

### 6.2 Focus su un volo

- Al click gli altri aerei si dissolvono in ~300ms, dentro la finestra
  editoriale 200-400ms di `DESIGN.md`.
- L'arco è una **geodetica vera** fra origine e destinazione. Le rotte reali
  sono curve sulla sfera; disegnarle dritte sarebbe una bugia geometrica
  visibile a chi conosce le rotte polari.
- Il tratto già percorso è più tenue, quello davanti più luminoso, con l'aereo
  al confine fra i due.
- I marker D e A stanno alle coordinate vere degli aeroporti, dimensionati in
  pixel-schermo per restare leggibili a ogni zoom. Sotto una soglia compare
  l'etichetta accanto al pallino.
- Al click su un marker: nome esteso dell'aeroporto, città, IATA/ICAO, e il
  terminal **solo se presente nei dati**. Con le sorgenti gratuite quella riga
  non verrà mai renderizzata.
- **Click su un aereo grigio**: gli altri svaniscono comunque e la scheda si
  apre con ciò che sappiamo davvero; al posto di D→A una riga esplicita
  "Rotta non nota". Nessun arco disegnato, nessuna stima.
- Uscita con `Esc` o click sul vuoto.

### 6.3 Ricerca

Barra discreta ma sempre visibile: dietro una scorciatoia sarebbe invisibile a
chi arriva da un link condiviso.

Accetta sia la forma IATA (`BA274`) sia quella ICAO (`BAW274`), perché adsbdb
espone entrambe e l'utente non sa quale gli serva. Tre esiti:

1. **Volo nel feed** → entra in focus.
2. **Volo non nel feed ma noto a adsbdb** → disegna l'arco con i marker D e A,
   senza punto aereo, e dichiara "posizione non disponibile — fuori copertura
   ADS-B". L'utente impara qualcosa di vero invece di ricevere un errore.
3. **Volo ignoto** → lo dice, globo intatto.

---

## 7. Linguaggio visivo

### 7.1 Colori

| Elemento | Colore | Ragione |
|---|---|---|
| Aereo completo | `#ffe6c4` bianco caldo | invariato dalla v1; è il "warm white / pale gold" di `PRODUCT.md` §3 |
| Aereo parziale | grigio freddo desaturato | arretra; spegnendolo i caldi risaltano |
| Aereo selezionato + arco | `#2997ff` Action Blue | accento unico, riservato |
| Checkbox "Dati parziali" | stesso grigio degli aerei che governa | il controllo ha il colore della cosa controllata: il pannello si spiega da sé |

L'Action Blue resta con **un solo significato**. Un colore non può dire due
cose, e il selezionato deve spiccare su un globo altrimenti svuotato.

### 7.2 Dall'immagine di riferimento

Ripreso: grammatica delle righe del pannello, intestazioni in maiuscoletto
spaziato, numeri in cifre tabulari allineati a destra, archi sottili con glow
misurato, trattamento pallino-più-etichetta per i marker aeroporto.

Scartato: il teal (contraddice l'accento unico), l'apparato "Tweaks / Theme /
Breakpoint" (chrome da editor, vietato da `PRODUCT.md`), gli slider, il toggle
chiaro/scuro.

---

## 8. Moduli

```
src/data/sources/          adattatori per fornitore + selettore con breaker
src/data/tileCache.ts      partizione a 10°, età, tetto upstream
src/data/deadReckoning.ts  avanzamento per frame + tetto temporale
src/data/routeResolver.ts  adsbdb + cache (sostituisce routeLookup.ts)
src/state/filterStore.ts   completi / parziali, conteggi derivati
src/globe/focusMode.ts     dissolvenza, geodetica, marker D/A
src/ui/FilterPanel.tsx     pannello con conteggi e checkbox
src/ui/FlightSearch.tsx    barra di ricerca e i suoi tre esiti
```

Rimossi: `src/data/routeLookup.ts`, `src/data/openSkyClient.ts` (il nome mente
già oggi: parla con il nostro proxy, non con OpenSky),
`public/data/openflights-routes.json`.

---

## 9. Testing

- **Unit**: normalizzazione per ciascun adattatore (chiavi `ac` vs `aircraft`);
  scadenza e partizione della tile cache; dead reckoning incluso il
  superamento del tetto temporale; classificazione completo/parziale; parsing
  del callsign in entrambe le forme.
- **Resilienza**: il test che sarebbe servito in v1 — con l'upstream in errore
  e cache vecchia oltre soglia, il server **non** deve servire la cache, e
  `/health` deve passare a `degraded`.
- **Component**: conteggi del pannello coerenti con lo stato; i tre esiti della
  ricerca; click su aereo grigio senza arco.
- **E2E**: focus e uscita; filtro che rimuove i grigi; ricerca di un volo fuori
  copertura che disegna la rotta senza aereo.
- **A11y**: axe-core sulle nuove superfici, come in v1.

---

## 10. Rischi

| Rischio | Mitigazione |
|---|---|
| adsb.lol cambia di nuovo policy | secondo adattatore già pronto, breaker, `/health` che lo dichiara |
| adsbdb rate-limita | cache a lunga scadenza, lookup solo per callsign presenti; in caso di blocco gli aerei degradano a "parziali", il sito resta vivo |
| Il fetch camera-driven moltiplica le chiamate | cache a tile condivisa fra utenti, tetto complessivo sull'upstream |
| Il dead reckoning diverge dal vero | tetto temporale, sbiadimento, trail sui soli fix reali |
| Copertura oceanica assente delude | è un limite dichiarato, non nascosto; la ricerca di un volo fuori copertura lo spiega esplicitamente |
