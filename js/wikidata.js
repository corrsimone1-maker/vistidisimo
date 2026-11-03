// Wikidata (query.wikidata.org: pubblico, senza chiave, risponde anche dal browser; dati CC0): i titoli
// collegati a un film o a una serie di TMDB, per la «Collezione» (js/collection.js).
//
// Si trova la voce di Wikidata con l'id TMDB (P4947 film, P4983 serie) e si prendono le voci collegate
// che hanno anche loro un id TMDB:
// - seguiti e prequel (P155 «preceduto da», P156 «seguito da»), anche in catena;
// - spin-off (P2512), opere derivate (P4969) e «basato su» (P144), in tutte e due le direzioni, e gli
//   altri spin-off e opere derivate dello stesso titolo (da «La casa di carta: Corea» anche «Berlino»);
// - la serie o il franchise di cui fa parte (P179, P8345), se ha un id TMDB, e chi ne fa parte;
// - gli altri titoli della stessa serie o dello stesso franchise, se non sono più di 40 (così un
//   franchise enorme non riempie la pagina).
// Sul telefono in `vds.wd` per 7 giorni (le ultime 400 voci). Se Wikidata non risponde non si salva
// niente e per 10 minuti non si riprova.
import { LS } from './store.js';

const WDQS = 'https://query.wikidata.org/sparql';
const TTL = 7 * 24 * 3600 * 1000;
const MAX_KEEP = 400;
const MAX_GROUP = 40;
let downUntil = 0;

// La query SPARQL per il titolo TMDB `type`/`id` (esportata per le prove).
export function wdQuery(type, id) {
  const P = type === 'movie' ? 'P4947' : 'P4983';
  const lit = `"${String(Number(id))}"`;
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT DISTINCT ?tv ?mv WHERE {
  ?item wdt:${P} ${lit} .
  {
    ?item (wdt:P155|wdt:P156|^wdt:P155|^wdt:P156)+ ?r .
  } UNION {
    ?item (wdt:P2512|wdt:P4969|wdt:P144|^wdt:P2512|^wdt:P4969|^wdt:P144) ?r .
  } UNION {
    ?item (^wdt:P2512|^wdt:P4969)/(wdt:P2512|wdt:P4969) ?r .
  } UNION {
    ?item (wdt:P179|wdt:P8345) ?r .
  } UNION {
    ?r (wdt:P179|wdt:P8345) ?item .
  } UNION {
    {
      SELECT ?g WHERE {
        ?i wdt:${P} ${lit} .
        ?i (wdt:P179|wdt:P8345) ?g .
        ?m (wdt:P179|wdt:P8345) ?g .
        ?m (wdt:P4947|wdt:P4983) ?mid .
      } GROUP BY ?g HAVING (COUNT(DISTINCT ?m) <= ${MAX_GROUP})
    }
    ?r (wdt:P179|wdt:P8345) ?g .
  }
  FILTER(?r != ?item)
  OPTIONAL { ?r wdt:P4983 ?tv . }
  OPTIONAL { ?r wdt:P4947 ?mv . }
  FILTER(BOUND(?tv) || BOUND(?mv))
}
LIMIT 200`;
}

// Dalla risposta JSON di Wikidata alle chiavi dell'app («tv:1234», «movie:5678»), senza `self`.
export function keysFromResults(j, self) {
  const out = new Set();
  for (const b of j?.results?.bindings || []) {
    for (const [v, type] of [['tv', 'tv'], ['mv', 'movie']]) {
      const id = b[v]?.value;
      if (id && /^\d+$/.test(id)) out.add(`${type}:${Number(id)}`);
    }
  }
  out.delete(self);
  return [...out];
}

let mem = null;
const cache = () => (mem ||= LS.get('vds.wd', {}) || {});

// Le chiavi già note per `key` (anche vecchie), oppure null.
export function cachedWiki(key) {
  const c = cache()[key];
  return c ? { k: c.k || [], stale: Date.now() - (c.at || 0) > TTL } : null;
}

// Chiede a Wikidata i titoli collegati a `key`: array di chiavi. Errore se Wikidata non risponde.
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
  all[key] = { k: keys, at: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > MAX_KEEP) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - MAX_KEEP).forEach((k) => delete all[k]);
  LS.set('vds.wd', all);
  return keys;
}
