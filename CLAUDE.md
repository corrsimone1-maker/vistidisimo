# vistidisimo — istruzioni per Claude

Web app personale di Simo per tenere traccia di serie TV, film e anime visti (sostituisce TV Time, chiuso a luglio 2026, e Refract). Interfaccia, testi e messaggi di commit in **italiano**.

- App (GitHub Pages, repo pubblica): https://corrsimone1-maker.github.io/vistidisimo/
- Dati (repo **privata**): `corrsimone1-maker/vistidisimo-dati` — vedi il suo `CLAUDE.md`
- Simo gestisce da solo le impostazioni di GitHub Pages; Claude costruisce, prova e fa push su `main`.
- Simo la usa su iPhone (app aggiunta alla schermata Home), iPad e Mac. È solo per lui: niente account, niente amici, niente social.

## Architettura

HTML/CSS/JS statici, moduli ES senza build né dipendenze. Niente framework.

| File | Cosa fa |
|---|---|
| `index.html`, `app.css` | pagina, barra in basso, tema |
| `js/main.js` | router a hash, ridisegno delle schermate, delega degli eventi (`data-act`, `data-input`), avvio |
| `js/store.js` | stato, coda delle operazioni, sincronizzazione con GitHub, cache TMDB (`meta.json`), correzione numerazione episodi |
| `js/github.js` | API Contents di GitHub (`ghGet`/`ghPut`), `serialize` (una voce per riga). **`OWNER` e `DATA_REPO` sono scritti qui** |
| `js/tmdb.js` | API TMDB (lingua `it-IT`), `metaFromDetails`, `fetchSeason`, `pool` (max 6 richieste insieme) |
| `js/derive.js` | avanzamento, stato automatico, prossimo episodio, anime, statistiche, % liste |
| `js/actions.js` | azioni utente → operazioni |
| `js/ui.js` | template `html` con escape, icone SVG, locandina (`posterCard`), fogli dal basso, avvisi, date |
| `js/views/*.js` | schermate: `home`, `library`, `search`, `upcoming` (Prossimi), `detail`, `episode` (scheda episodio e Ripasso), `person` (film di un regista), `lists`, `settings` |
| `sw.js` | service worker: rete prima, cache solo come ripiego offline |
| `dev/` | prove con Playwright e API finte (vedi sotto). Non fa parte dell'app |

Rotte: `#/home`, `#/raccolta/<serie|film|serie-preferite|film-preferiti>`, `#/libreria`, `#/cerca`, `#/prossimi`, `#/t/<tv|movie>/<id>`, `#/ep/<idSerie>/<stagione>/<episodio>`, `#/ripasso/<idSerie>[/<stagione>]`, `#/persona/<idTMDB>`, `#/liste`, `#/lista/<id>`, `#/impostazioni`. La pagina del titolo, il Ripasso e la pagina di una persona tengono lo scroll quando ci torni da una loro sotto-pagina (`CHILD_OF` in `main.js`); i dettagli TMDB dei titoli aperti restano in memoria per la sessione (`seenDetails` in `detail.js`), così tornando la pagina è subito completa.

### Sincronizzazione (non romperla)
- Ogni azione è un'**operazione** (`add`, `set`, `del`, `eps`, `rw`, `lnew`, `lset`, `ldel`, `ladd`, `lrem`, `lorder`) messa in coda in `localStorage` (`vds.ops`). La libreria mostrata = ultima versione scaricata (`vds.base`) + operazioni in coda.
- `flush()` parte 1,5 s dopo l'ultima azione, quando l'app va in background e al ritorno online. Riapplica le operazioni sull'ultima versione di GitHub; se lo sha non torna (409/422), riscarica e riprova. Così due dispositivi non si sovrascrivono.
- Ogni salvataggio è un commit su `library.json` con un messaggio leggibile (`op.msg`).
- Token scaduto o sbagliato (401/403): la coda resta sul dispositivo, in Home compare un avviso rosso, e incollando un token nuovo in Impostazioni la coda parte da sola.
- Nuove operazioni: aggiungile ad `applyOp` in `store.js` in modo che riapplicarle due volte non faccia danni.

### Token
- Token GitHub *fine-grained* con accesso solo a `vistidisimo-dati`, permesso Contents in lettura/scrittura. Sta in `localStorage` (`vds.ghToken`) su ogni dispositivo.
- Chiave TMDB (API Read Access Token, usata come Bearer) in `vds.tmdbToken` e in `config.json` nella repo dati, così gli altri dispositivi la prendono da lì.
- **Mai** chiedere a Simo di incollare i token in chat, mai scriverli nel codice o nei commit.

## Modello dati (riassunto)
Chiave `tipo:idTMDB` (`tv:48866`, `movie:129`). Stati: `planned` da guardare, `watching` in corso, `uptodate` in pari, `completed` completata/visto, `dropped` abbandonata. Non esiste "in pausa": Simo l'ha tolto. Episodi: `eps[stagione][episodio] = "YYYY-MM-DD"` (o `""`), stagione `0` = speciali. Formato completo nel README della repo dati.

**Rivisioni** (28/10/2026):
- **Dal cerchio di spunta** (scelta di Simo, 28/10/2026): toccare il cerchio di un episodio **già visto** (nella lista o nella sua scheda) apre un foglio con «L’ho rivisto», «Togli una rivisione» (se ce n'è) e «Segna come non visto». Lo stesso per il cerchio di una **stagione** vista tutta: «L’ho rivista» (+1 a ogni episodio, con «Annulla»), «Togli una rivisione», «Togli la stagione». Se l'episodio o la stagione non sono visti, il cerchio li segna subito come prima.
- `rw[stagione][episodio] = n` = visioni **in più** di un singolo episodio (visto n+1 volte); solo valori > 0. L'operazione `rw` scrive valori assoluti, quindi si può riapplicare. Togliere un episodio dai visti toglie anche le sue rivisioni.
- `rewatch` = quante volte hai rivisto **per intero** il titolo (film o serie): **bottoncino ↻ accanto allo stato** (col numero se > 0), che apre un foglio con − / + (`rewatchSheet` in `detail.js`). Simo non vuole un riquadro grande nella pagina. Per una serie, ±1 sposta di ±1 anche ogni episodio visto (`setRewatch` in `actions.js`).
- I 336 episodi rivisti sono stati recuperati dal `rewatchCount` del backup Refract (l'import iniziale aveva preso solo quello per titolo).
- Il tempo in Home conta anche le rivisioni (episodi: `rw`; film: `rewatch`); il numero di episodi/film visti no.

`meta.json` (cache TMDB, chiavi corte): `t` titolo, `ot` originale, `y` anno, `p` locandina, `b` sfondo, `g` generi, `l` lingua, `c` paesi, `rt` durata, `st` stato TMDB, `ss` stagioni `[n, episodi, data]`, `le` ultimo uscito `[s, e, data]`, `ne` prossimo `[s, e, data, nome]`, `rd` uscita film, `at` timestamp. Si aggiorna da solo: serie in corso ogni 12 h, finite ogni 30 giorni, film ogni 60.

## Scelte di Simo (rispettale)
- **Tema scuro**: notte violacea con lilla e neon blu/rosa. Font self-hosted: Unbounded (titoli, numeri) + Manrope (testo).
- **Barra sotto ogni locandina** che si riempie con l'avanzamento (episodi visti / episodi totali su TMDB, con un minimo visibile del 4%), colorata per stato: viola completata, blu da guardare, giallo in corso, verde in pari, rosso abbandonata.
- **Iconcina** in alto a sinistra sulla locandina: film o serie; rosa se è un anime (dice comunque se è film o serie).
- **Voto** da 0.1 a 10.0 con una cifra decimale, per tutta la serie o il film. Mai voti a episodi o stagioni. Il voto si vede **solo nella pagina del titolo**, non sulle locandine.
- **Niente** community, reazioni, mood, recensioni social.
- **Niente scritte che spiegano l'app** (tipo «solo gli episodi visti, niente spoiler», «trama in inglese: manca quella italiana», «+ quando la rivedi»): Simo le trova inutili. Nell'app solo dati e azioni; le spiegazioni si danno in chat.
- **Home** come il vecchio TV Time: statistiche in piccolo, ultime serie, ultimi film, serie preferite, film preferiti, liste. Ordine per ultima attività (`last`), nessun tasto per riordinare. Mettere voto o preferito non cambia `last`.
- **Barra in basso**: Home (casetta), Libreria, Cerca, Prossimi.
- **Deve sembrare un'app, non un sito**: niente zoom (viewport `maximum-scale=1, user-scalable=no`, `touch-action: pan-x pan-y`, gesti di pizzico bloccati in `main.js`), niente pagina che scivola di lato o rimbalza (`overscroll-behavior: none`, `overflow-x: hidden`), niente selezione del testo né menu della pressione lunga (tranne nei campi di testo). Nessun elemento deve uscire in larghezza dallo schermo.
- **Titoli sotto le locandine**: piccoli, su massimo due righe, nelle griglie (Libreria, pagine «Tutte», liste, Cerca in vista griglia). **Non** nelle righe della Home.
- **Libreria**: categorie Serie / Film / Anime (disgiunte, anime = serie+film anime), selezionabili singolarmente o tutte; filtro per stato; ordinamento.
- **Cerca**: due viste con un tasto in alto (scelta ricordata in `vds.searchView`): elenco con titolo, tipo (Serie/Film, anime), anno, titolo originale e stato se è già in libreria (**niente trama**: troppe informazioni), oppure griglia compatta di locandine con il titolo tradotto sotto, piccolo. Simo deve distinguere serie, film e OVA con lo stesso nome. Se il titolo italiano di TMDB è in scrittura non latina (anime senza traduzione) si usa quello inglese (`nonLatin` in `tmdb.js`, ricerca fatta anche in `en-US`).
- **Scheda episodio** (`#/ep/…`, si apre toccando il titolo di un episodio): fotogramma grande, titolo, uscita, durata, visto il, rivisioni, trama, tutti i fotogrammi di TMDB (`/episode/…/images` senza `language`) con visore a tutto schermo, episodio precedente/successivo. **Trame solo in italiano, poi inglese, poi spagnolo** (le lingue che Simo legge; `pickPlot` in `tmdb.js`, dalle `translations` dell'episodio), senza scrivere in che lingua sono; se non c'è niente, «Trama non disponibile». I titoli segnaposto «Episodio N» di TMDB si sostituiscono con quello vero in inglese se c'è. **Niente modelli né AI per riassumere**: Simo non vuole pagare e non vuole spoiler. Episodi non visti: trama e immagini velate (occhio «Mostra») finché non tocchi, solo per la sessione.
- **Ripasso** (`#/ripasso/…`): tutti gli episodi **visti** di una stagione in ordine, con fotogramma grande e trama (stessa regola delle lingue: si chiede la stagione in `en-US`/`es-ES` solo se mancano trame), per ricordarsi la storia prima di riprendere. In testa solo «Ultimo visto S·E, quanto tempo fa», poi le stagioni e «Vai all’ultimo visto». Nella pagina della serie, se è in corso/in pari e l'ultimo episodio visto è di più di 60 giorni fa, compare il riquadro «Dove eravamo rimasti» (ultimo visto + da dove riprendere); altrimenti un pulsante «Ripassa gli episodi visti». C'è anche «Ripassa» in fondo a ogni stagione aperta.
- **Regia**: solo nei **film** (non negli episodi; la sceneggiatura Simo non la vuole), nella tabella dei dati, dai `credits` di TMDB (`movieDirectors` in `tmdb.js`, massimo 3 nomi). Ogni nome porta a `#/persona/<id>`: tutti i film che ha diretto, **dal più recente al più vecchio** (quelli annunciati senza data in cima), con anno sotto il titolo, barra di stato per quelli in libreria e «N visti su M». **Niente cortometraggi**: fuori i film di 40 minuti o meno (soglia dell'Academy) e i contenuti `video` di TMDB; se la durata è sconosciuta il film resta. La durata viene da `meta.json` per i film in libreria, altrimenti da `/movie/{id}` (6 richieste per volta, cache per la sessione). Una richiesta per la filmografia: `/person/{id}?append_to_response=movie_credits` (più `en-US` se ci sono titoli in scrittura non latina). Niente foto della persona.
- Fotogrammi grandi con `w780` (non è tra le misure dei fotogrammi su TMDB ma di solito funziona) e ripiego automatico su `original` se non carica.
- **Prossimi**: "Da vedere" (prossimo episodio delle serie in corso/in pari, più "Da iniziare") e "In uscita".
- **Ordine dentro una lista**: dal titolo visto più di recente (film: data di visione o dell'ultima rivisione; serie: ultimo episodio visto), quelli non ancora visti in fondo nell'ordine della lista (`listOrder` in `derive.js`). Vale anche per le 4 copertine della lista in Home. È solo un ordine di visualizzazione: `lists[].items` su GitHub non cambia.
- **Liste**: % completata = media dell'avanzamento dei titoli dentro, mostrata **piccola e discreta** (percentuale rosa e barra sottile a gradiente: Simo le voleva meno ingombranti); riordinabili trascinando (pagina Liste → Riordina), l'ordine vale anche in Home.
- **Copertina e banner**: si cambiano dal menu ⋯ in alto nella pagina del titolo («Cambia copertina» / «Cambia banner»), solo per i titoli in libreria. Il foglio mostra tutte le immagini di TMDB (`/images` senza `language`) divise per lingua (Italiano, Inglese, Senza testo, Giapponese, poi le altre), ordinate per voto, più «Torna a quella predefinita». Si salvano in `poster` / `backdrop` dell'item. I **loghi** di TMDB non si usano (l'app scrive il titolo).
- **Anime**: animazione (genere 16) + lingua `ja` o paese `JP`; correggibile a mano dal menu ⋯ (`anime: true/false`).
- **Icona**: ciak viola con la spunta (✓) sulla tavoletta, scelta da Simo il 28/10/2026 (immagine sua, originale in `icons/sorgente-spunta.png`). Ritagliata al riquadro arrotondato, angoli neri riempiti col colore del bordo (solo il nero esterno, non le ombre interne), ingrandita del 4%, e con «vds» bianco al neon (Unbounded, alone rosa/lilla) in basso a destra sulla tavoletta, sotto il braccio destro della spunta. File `icons/spunta-*.png` (192, 512, apple-180, maskable-512 col disegno all'80% su sfondo sfocato). Prima: ciak con popcorn (`ciak-*`, 27/10), e prima ancora il televisore al neon. Non cambiarla senza che lo chieda; se la si cambia usa **nomi di file nuovi**, perché iOS e GitHub Pages tengono in cache le icone con lo stesso nome.

## Insidie note
- Alcuni anime su TMDB usano numerazione **assoluta** (Naruto Shippuden: la stagione 2 parte dal 33). `isAbsolute`/`epRange` in `derive.js` la gestiscono; `repairNumbering` in `store.js` sposta le stagioni importate da TV Time numerate da 1. Su One Piece e Naruto i dati importati sono comunque in parte incoerenti: non "correggerli" in automatico senza chiedere.
- `airedCount` usa `le` (ultimo episodio uscito); `nextEpisode` parte dall'ultimo episodio visto più avanti, non dal primo buco.
- Variabili colore: i default `--c` stanno in `:where(...)` per non battere le classi `st-*` — non rimettere `--c` dentro `.status-pill`, `.check-btn`, `.opt`, `.tube`.

## Rilasci
A ogni modifica che cambia CSS o JS: `python3 dev/versione.py N` con N = versione attuale + 1 (la vedi in `VERSION` di `js/views/settings.js`). Lo script aggiorna la **mappa degli import** in `index.html` (ogni modulo JS con `?v=N`), `app.css`/`main.js`/manifest, la cache di `sw.js` e `VERSION`. Poi commit in italiano e push su `main`.

Perché: GitHub Pages fa tenere i file in cache per 10 minuti; senza indirizzi nuovi il telefono può caricare un modulo nuovo che importa qualcosa da uno vecchio e l'app non parte (è successo il 27/10/2026). Se nasce un nuovo file JS lo script lo aggiunge da solo alla mappa. In `index.html` c'è anche un controllo di emergenza: se l'app non parte entro 7 s mostra «Ripara e riapri», che svuota service worker e cache (non `localStorage`) e ricarica. `main.js` segnala l'avvio con `window.__vdsBooted`.

## Prove
Dal container non si raggiungono TMDB e le immagini: si prova con API finte.
```bash
cd dev && node prova-completa.js /percorso/screenshot   # primo avvio, tutte le schermate, conflitto tra dispositivi
node prova-anime.js /percorso/screenshot                 # numerazione assoluta, colori di stato, ricarica dalla cache
node prova-token.js /percorso/screenshot                 # token scaduto e ripresa, esportazione CSV
node prova-liste.js /percorso/screenshot                 # riordino delle liste trascinando
node prova-cerca.js /percorso/screenshot                 # ricerca: righe con titoli leggibili anche per gli anime
node prova-avvio.js /percorso/screenshot                 # moduli tutti con ?v=N e schermata «Ripara e riapri» se un modulo è vecchio
node prova-dati-veri.js /percorso/screenshot             # apre ogni schermata con library.json e meta.json veri
node prova-app.js                                        # nessuna schermata più larga del telefono, viewport senza zoom
node prova-copertine.js /percorso/screenshot             # cambia copertina e banner dal menu ⋯, salvataggio e ripristino
node prova-episodi.js /percorso/screenshot               # scheda episodio (lingue, fotogrammi, visore, velo), ripasso, rivisioni di titoli/stagioni/episodi
node prova-persone.js /percorso/screenshot               # regia nei film, pagina coi film di un regista dal più recente, senza corti
```
Playwright è installato globalmente: lancia le prove con `NODE_PATH=$(npm root -g) node …`. Se una prova si interrompe può lasciare acceso il suo `python3 -m http.server`: spegnilo (`pkill -f "[h]ttp\.server 81"`) prima di rilanciare, se no la prova successiva sulla stessa porta usa il server vecchio. Le due repo devono stare una accanto all'altra (le prove leggono `../vistidisimo-dati/library.json` senza modificarlo). `mock.js` simula l'API Contents di GitHub (con sha e 409), TMDB (dettagli, stagioni, ricerca, tendenze) e le immagini. Viewport 393×852 come l'iPhone di Simo; guarda sempre gli screenshot.
