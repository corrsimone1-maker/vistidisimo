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

La barra sotto ogni locandina si riempie con l'avanzamento e ha il colore dello stato: viola completata, blu da guardare, giallo in corso, verde in pari, rosso abbandonata. L'iconcina in alto a sinistra dice se è un film o una serie (rosa se è un anime).

## Struttura

- `index.html`, `app.css` — pagina e tema
- `js/store.js` — stato, coda delle modifiche, sincronizzazione con GitHub, cache TMDB
- `js/derive.js` — avanzamento, stato automatico, prossimo episodio, statistiche
- `js/actions.js` — azioni dell'utente
- `js/views/` — le schermate
- `sw.js`, `manifest.webmanifest`, `icons/` — installazione sulla schermata Home

Font: Unbounded e Manrope (SIL Open Font License). Dati e immagini da TMDB: questa app usa l'API di TMDB ma non è approvata né certificata da TMDB.
