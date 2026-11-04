// Wikidata (query.wikidata.org: pubblico, senza chiave, risponde anche dal browser; dati CC0): i titoli
// collegati a un film o a una serie di TMDB, per la «Collezione» (js/collection.js).
//
// Si trova la voce di Wikidata con l'id TMDB (P4947 film, P4983 serie) e si prendono le voci collegate che hanno
// anche loro un id TMDB, divise per quanto il collegamento è sicuro. Regole del 4/11/2026, decise dopo aver
// provato la query sul Wikidata vero per tutti i 584 titoli della libreria di Simo (dal browser del suo Mac):
// - spin-off (`k`, entrano): P2512 «series spin-off» nei due sensi e gli altri spin-off dello stesso titolo
//   (da «La casa di carta: Corea» anche «Berlino»). Puliti: Better Call Saul, Fear the Walking Dead, Torchwood;
// - famiglia (`f`, entrano tra anime, altrimenti solo se un'altra fonte li conferma): franchise (P8345, anche
//   gli altri titoli dello stesso franchise se non sono più di 40), i titoli che fanno parte di questo (P179
//   verso questo), «basato su» (P144) e opere derivate (P4969) dirette, altre opere dallo stesso libro o manga.
//   Tra anime sono film, OVA e spin-off veri (One Piece, Fate, Demon Slayer); fuori dagli anime ci sono parodie
//   porno («… XXX: A Porn Parody»), film amatoriali (tre su Harry Potter), rifacimenti in altre lingue
//   (Metástasis per Breaking Bad), dieci adattamenti dell'Odissea, e un franchise «Marvel Television» che
//   mette Agatha All Along e Ms. Marvel nella Collezione di Spider-Man: No Way Home;
// - seguiti (`s`, solo se confermati): P155 «preceduto da», P156 «seguito da» fino a 3 passi, e la serie di
//   cui fa parte (P179). Nella libreria sono quasi sempre giusti (Star Wars, Hunger Games), ma P155/P156
//   possono dire solo cosa andava in onda prima nella stessa fascia oraria.
// «Conferma» = stessi personaggi (anche un solo nome uguale) o stesso nome prima del separatore (vedi
// js/views/collezione.js). Tolti il 4/11/2026: gli altri titoli della stessa serie P179 (raggruppati come per il
// franchise), che sul servizio vero facevano durare la query più di 10 secondi (Breaking Bad), e un confronto
// della lingua originale su Wikidata (P364), che la rallentava fino a 40 secondi.
// Jujutsu Kaisen su Wikidata ha solo il manga, il franchise e il film «Execution»: «Il duca della morte» non
// arrivava da qui ma dagli stessi personaggi («Narration», vedi js/collection.js).
// Sul telefono in `vds.wd` per 7 giorni (le ultime 900 voci: le Novità in Home le chiedono per ogni titolo visto). Se Wikidata non risponde non si salva
// niente e per 10 minuti non si riprova.
import { LS } from './store.js';

const WDQS = 'https://query.wikidata.org/sparql';
const TTL = 7 * 24 * 3600 * 1000;
const MAX_KEEP = 900;
const MAX_GROUP = 40;
const VER = 2;
let downUntil = 0;

// La query SPARQL per il titolo TMDB `type`/`id` (esportata per le prove). ?w: 0 spin-off, 2 famiglia,
// 1 seguito.
export function wdQuery(type, id) {
  const P = type === 'movie' ? 'P4947' : 'P4983';
  const lit = `"${String(Number(id))}"`;
  const SEQ = '(wdt:P155|wdt:P156|^wdt:P155|^wdt:P156)';
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT DISTINCT ?tv ?mv ?w WHERE {
  ?item wdt:${P} ${lit} .
  {
    ?item (wdt:P2512|^wdt:P2512) ?r . BIND(0 AS ?w)
  } UNION {
    ?item ^wdt:P2512/wdt:P2512 ?r . BIND(0 AS ?w)
  } UNION {
    ?item (wdt:P8345|^wdt:P8345|^wdt:P179|wdt:P4969|wdt:P144|^wdt:P4969|^wdt:P144) ?r . BIND(2 AS ?w)
  } UNION {
    {
      SELECT ?g WHERE {
        ?i wdt:${P} ${lit} .
        ?i wdt:P8345 ?g .
        ?m wdt:P8345 ?g .
        ?m (wdt:P4947|wdt:P4983) ?mid .
      } GROUP BY ?g HAVING (COUNT(DISTINCT ?m) <= ${MAX_GROUP})
    }
    ?r wdt:P8345 ?g . BIND(2 AS ?w)
  } UNION {
    ?item (wdt:P144|^wdt:P4969)/(^wdt:P144|wdt:P4969) ?r . BIND(2 AS ?w)
  } UNION {
    ?item ${SEQ}/${SEQ}?/${SEQ}? ?r . BIND(1 AS ?w)
  } UNION {
    ?item wdt:P179 ?r . BIND(1 AS ?w)
  }
  FILTER(?r != ?item)
  OPTIONAL { ?r wdt:P4983 ?tv . }
  OPTIONAL { ?r wdt:P4947 ?mv . }
  FILTER(BOUND(?tv) || BOUND(?mv))
}
LIMIT 400`;
}

// Dalla risposta JSON di Wikidata alle chiavi dell'app («tv:1234», «movie:5678»), senza `self`:
// { k: spin-off, f: famiglia, s: seguiti }. Una voce arrivata in più modi vale per il più sicuro (in
// quest'ordine).
export function keysFromResults(j, self) {
  const R = { 0: 0, 2: 1, 1: 2 }; // ?w -> posto nell'ordine
  const rank = new Map();
  for (const b of j?.results?.bindings || []) {
    const w = R[Number(b.w?.value ?? 0)] ?? 2;
    for (const [v, type] of [['tv', 'tv'], ['mv', 'movie']]) {
      const id = b[v]?.value;
      if (!id || !/^\d+$/.test(id)) continue;
      const k = `${type}:${Number(id)}`;
      if (k === self) continue;
      rank.set(k, Math.min(rank.get(k) ?? 9, w));
    }
  }
  const of = (n) => [...rank].filter(([, r]) => r === n).map(([k]) => k);
  return { k: of(0), f: of(1), s: of(2) };
}

let mem = null;
const cache = () => (mem ||= LS.get('vds.wd', {}) || {});

// Le chiavi già note per `key` (anche vecchie): { k, f, s, stale } oppure null. Le copie di prima del 4/11/2026
// (senza `v`) non distinguevano i collegamenti sicuri: non valgono niente, si rifanno.
export function cachedWiki(key) {
  const c = cache()[key];
  if (!c) return null;
  if (c.v !== VER) return { k: [], f: [], s: [], stale: true };
  return { k: c.k || [], f: c.f || [], s: c.s || [], stale: Date.now() - (c.at || 0) > TTL };
}

// Chiede a Wikidata i titoli collegati a `key`: { k, f, s } (vedi keysFromResults). Errore se Wikidata non
// risponde.
export async function fetchWiki(key) {
  if (Date.now() < downUntil) throw new Error('Wikidata non risponde');
  const [type, id] = key.split(':');
  const u = `${WDQS}?format=json&query=${encodeURIComponent(wdQuery(type, id))}`;
  let r;
  try {
    r = await fetch(u, { headers: { Accept: 'application/sparql-results+json' } });
  } catch {
    downUntil = Date.now() + 10 * 60 * 1000;
    throw new Error('Wikidata non è raggiungibile');
  }
  if (!r.ok) {
    if (r.status === 429 || r.status >= 500) downUntil = Date.now() + 10 * 60 * 1000;
    throw new Error(`Wikidata ha risposto ${r.status}`);
  }
  const keys = keysFromResults(await r.json(), key);
  const all = cache();
  all[key] = { ...keys, at: Date.now(), v: VER };
  const ks = Object.keys(all);
  if (ks.length > MAX_KEEP) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - MAX_KEEP).forEach((k) => delete all[k]);
  LS.set('vds.wd', all);
  return keys;
}
