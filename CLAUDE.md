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
| `js/views/*.js` | schermate: `home`, `library`, `search`, `upcoming` (Prossimi), `detail`, `lists`, `settings` |
| `sw.js` | service worker: rete prima, cache solo come ripiego offline |
| `dev/` | prove con Playwright e API finte (vedi sotto). Non fa parte dell'app |

Rotte: `#/home`, `#/raccolta/<serie|film|serie-preferite|film-preferiti>`, `#/libreria`, `#/cerca`, `#/prossimi`, `#/t/<tv|movie>/<id>`, `#/liste`, `#/lista/<id>`, `#/impostazioni`.

### Sincronizzazione (non romperla)
- Ogni azione è un'**operazione** (`add`, `set`, `del`, `eps`, `lnew`, `lset`, `ldel`, `ladd`, `lrem`, `lorder`) messa in coda in `localStorage` (`vds.ops`). La libreria mostrata = ultima versione scaricata (`vds.base`) + operazioni in coda.
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

`meta.json` (cache TMDB, chiavi corte): `t` titolo, `ot` originale, `y` anno, `p` locandina, `b` sfondo, `g` generi, `l` lingua, `c` paesi, `rt` durata, `st` stato TMDB, `ss` stagioni `[n, episodi, data]`, `le` ultimo uscito `[s, e, data]`, `ne` prossimo `[s, e, data, nome]`, `rd` uscita film, `at` timestamp. Si aggiorna da solo: serie in corso ogni 12 h, finite ogni 30 giorni, film ogni 60.

## Scelte di Simo (rispettale)
- **Tema scuro**: notte violacea con lilla e neon blu/rosa. Font self-hosted: Unbounded (titoli, numeri) + Manrope (testo).
- **Barra sotto ogni locandina** che si riempie con l'avanzamento (episodi visti / episodi totali su TMDB, con un minimo visibile del 4%), colorata per stato: viola completata, blu da guardare, giallo in corso, verde in pari, rosso abbandonata.
- **Iconcina** in alto a sinistra sulla locandina: film o serie; rosa se è un anime (dice comunque se è film o serie).
- **Voto** da 0.1 a 10.0 con una cifra decimale, per tutta la serie o il film. Mai voti a episodi o stagioni. Il voto si vede **solo nella pagina del titolo**, non sulle locandine.
- **Niente** community, reazioni, mood, recensioni social.
- **Home** come il vecchio TV Time: statistiche in piccolo, ultime serie, ultimi film, serie preferite, film preferiti, liste. Ordine per ultima attività (`last`), nessun tasto per riordinare. Mettere voto o preferito non cambia `last`.
- **Barra in basso**: Home (casetta), Libreria, Cerca, Prossimi.
- **Deve sembrare un'app, non un sito**: niente zoom (viewport `maximum-scale=1, user-scalable=no`, `touch-action: pan-x pan-y`, gesti di pizzico bloccati in `main.js`), niente pagina che scivola di lato o rimbalza (`overscroll-behavior: none`, `overflow-x: hidden`), niente selezione del testo né menu della pressione lunga (tranne nei campi di testo). Nessun elemento deve uscire in larghezza dallo schermo.
- **Libreria**: categorie Serie / Film / Anime (disgiunte, anime = serie+film anime), selezionabili singolarmente o tutte; filtro per stato; ordinamento.
- **Cerca**: due viste con un tasto in alto (scelta ricordata in `vds.searchView`): elenco con titolo, tipo (Serie/Film, anime), anno, titolo originale e stato se è già in libreria (**niente trama**: troppe informazioni), oppure griglia compatta di locandine con il titolo tradotto sotto, piccolo. Simo deve distinguere serie, film e OVA con lo stesso nome. Se il titolo italiano di TMDB è in scrittura non latina (anime senza traduzione) si usa quello inglese (`nonLatin` in `tmdb.js`, ricerca fatta anche in `en-US`).
- **Prossimi**: "Da vedere" (prossimo episodio delle serie in corso/in pari, più "Da iniziare") e "In uscita".
- **Liste**: % completata = media dell'avanzamento dei titoli dentro; riordinabili trascinando (pagina Liste → Riordina), l'ordine vale anche in Home.
- **Anime**: animazione (genere 16) + lingua `ja` o paese `JP`; correggibile a mano dal menu ⋯ (`anime: true/false`).
- **Icona**: ciak con popcorn, pellicola e stelline sui toni viola/rosa, scelta da Simo il 27/10/2026 (immagine sua, originale in `icons/sorgente-ciak.png`). Ritagliata, angoli riempiti col colore del bordo, leggermente ingrandita, e con «vds» al neon scritto sul ciak a destra della stella. File `icons/ciak-*.png`. Prima c'era il televisore al neon; occhio e versioni a linea sottile bocciati. Non cambiarla senza che lo chieda; se la si cambia usa **nomi di file nuovi**, perché iOS e GitHub Pages tengono in cache le icone con lo stesso nome.

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
```
Le due repo devono stare una accanto all'altra (le prove leggono `../vistidisimo-dati/library.json` senza modificarlo). `mock.js` simula l'API Contents di GitHub (con sha e 409), TMDB (dettagli, stagioni, ricerca, tendenze) e le immagini. Viewport 393×852 come l'iPhone di Simo; guarda sempre gli screenshot.
