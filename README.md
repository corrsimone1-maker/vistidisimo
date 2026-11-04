# vistidisimo

Le serie e i film che ho visto. Web app personale (GitHub Pages) che sostituisce TV Time / Refract.

**App:** https://corrsimone1-maker.github.io/vistidisimo/

## Come funziona

- I dati stanno nella repo privata `vistidisimo-dati` (`library.json`). L'app li legge e li scrive con l'API di GitHub usando un token *fine-grained* limitato a quella repo; ogni modifica è un commit, quindi c'è sempre la storia completa.
- Titoli, locandine, stagioni ed episodi arrivano da [TMDB](https://www.themoviedb.org/) e vengono messi in cache in `meta.json` nella stessa repo privata.
- Le modifiche vengono messe in coda sul dispositivo e salvate dopo un attimo; se due dispositivi scrivono insieme, le modifiche vengono riapplicate sull'ultima versione invece di sovrascriversi.

## Schermate

- **Home**: statistiche, ultime serie, ultimi film, serie e film preferiti, liste con la percentuale completata.
- **Libreria**: tutto, filtrabile per Serie / Film / Anime e per stato.
- **Cerca**: ricerca su TMDB e tendenze della settimana.
- **Prossimi**: il prossimo episodio da vedere per ogni serie in corso, le serie da iniziare e le uscite in arrivo.
- **Episodio**: tocca il titolo di un episodio per trama (italiano, se manca inglese, se manca spagnolo), tutti i fotogrammi di TMDB e quante volte l'hai visto. Se non l'hai ancora visto, trama e immagini restano velate finché non tocchi.
- **Ripasso**: gli episodi già visti di una stagione, uno dopo l'altro con immagine e trama, per ricordarsi dove eravamo rimasti. Dopo una pausa lunga la pagina della serie lo propone da sola.
- **Registi**: nella pagina di un film tocca il nome del regista per vedere tutti i suoi film, dal più recente, senza cortometraggi, con quelli che hai già visto.
- **Collezione**: nella pagina di ogni serie e film, tutto quello che è collegato in ordine di uscita — la saga, seguiti, prequel, spin-off e franchise (da [Wikidata](https://www.wikidata.org)), i titoli con lo stesso nome («Vis a vis» → «Vis a vis: El oasis»), per gli anime film, OVA, speciali e spin-off (da [MyAnimeList](https://myanimelist.net) tramite [Jikan](https://jikan.moe): spento dal 4/11/2026, perché l'API pubblica di Jikan è stata chiusa il 1° ottobre 2026) — più i collegamenti fatti a mano.
- **Saghe**: dal menu ≡ della Libreria, «Saghe» elenca quelle dei tuoi film con la percentuale vista.
- **Nuova stagione**: quando esce una stagione nuova di una serie che segui, all'apertura compare una finestra (una volta sola).
- **Mancano** e **Trailer**: nella pagina di una serie quanti episodi e quanto tempo mancano; il trailer di TMDB, se c'è.
- **Esporta per altre app** (Impostazioni): film per Letterboxd, tutto per Simkl. Il backup completo resta `library.json`.
- **Rivisioni**: quante volte hai rivisto un film, una serie intera, una stagione o un singolo episodio.

La barra sotto ogni locandina si riempie con l'avanzamento e ha il colore dello stato: viola completata, blu da guardare, giallo in corso, verde in pari, rosso abbandonata. L'iconcina in alto a sinistra dice se è un film o una serie (rosa se è un anime).

## Struttura

- `index.html`, `app.css` — pagina e tema
- `js/store.js` — stato, coda delle modifiche, sincronizzazione con GitHub, cache TMDB
- `js/derive.js` — avanzamento, stato automatico, prossimo episodio, statistiche
- `js/actions.js` — azioni dell'utente
- `js/tmdb.js` — TMDB
- `js/jikan.js`, `js/mal.js`, `js/filler.js` — MyAnimeList tramite Jikan: film, OVA e spin-off degli anime, filler
- `js/wikidata.js`, `js/collection.js`, `js/views/collezione.js` — Collezione
- `js/views/` — le schermate
- `sw.js`, `manifest.webmanifest`, `icons/` — installazione sulla schermata Home
- `dev/` — prove automatiche con API finte (non fanno parte dell'app)
- `CLAUDE.md` — istruzioni per Claude, per lavorarci da altre chat

Font: Unbounded e Manrope (SIL Open Font License). Dati e immagini da TMDB: questa app usa l'API di TMDB ma non è approvata né certificata da TMDB. Film, OVA e filler degli anime da MyAnimeList, tramite Jikan (non affiliato a MyAnimeList). Collegamenti tra titoli anche da Wikidata (dati CC0).
