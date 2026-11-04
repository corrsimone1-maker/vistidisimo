// Novità nelle Collezioni (4/11/2026, chiesto da Simo: «al tempo ho visto Horimiya e poi è uscito Horimiya:
// The Missing Pieces; avendo solo Horimiya salvato sull'app la serie nuova non mi viene proposta e io mi perdo
// la continuazione; idem per i film, con Enola Holmes che è uscito il 3 e non lo sapevo»).
//
// In Home, in cima, la riga «Novità» (e «Tutte» → #/novita): i titoli **usciti nell'ultimo anno o in uscita**
// (con una data) che stanno nella Collezione di qualcosa che hai guardato (in corso, in pari o completato; non
// da guardare né abbandonato) e che non hai in libreria. Le regole sono quelle della Collezione
// (js/views/collezione.js), con quello che è già sul telefono. Un titolo sparisce da solo quando lo aggiungi
// alla libreria; con la × lo togli tu (operazione `news`, campo `newsOff` di library.json: vale su ogni
// dispositivo).
//
// In sottofondo (`scanNews`, dopo l'aggiornamento dei dati di TMDB a ogni apertura dell'app) si rifanno le
// fonti della Collezione dei titoli guardati, dai mai controllati e poi da quelli controllati da più tempo:
// Wikidata e la ricerca per nome (copie di 7 giorni), le saghe, i dati dei titoli collegati; gli stessi
// personaggi (una ventina di richieste a TMDB per titolo) per pochi titoli a volta e al massimo una volta al
// mese. Uno alla volta, e si ferma se l'app va in background.
import { html, raw, icon, img, kindBadge, fmtDay, today, toast } from './ui.js';
import { LS, S, lib, item, metaOf, dispatch, notify } from './store.js';
import { tmdbToken } from './tmdb.js';
import { fetchWiki, cachedWiki } from './wikidata.js';
import { fetchByTitle, cachedByTitle, fetchByCast, castAge, ensureMiniAsync } from './collection.js';
import { hasWatched } from './derive.js';
import { loadSaga } from './views/saga.js';
import { cachedCollection, xFromMeta } from './views/collezione.js';
import { titleOf } from './views/common.js';

export const NEWS_DAYS = 365; // quanto indietro: uscito nell'ultimo anno (o in uscita)
const DAY = 24 * 3600 * 1000;
const SCAN_TTL = 7 * DAY; // ogni titolo si ricontrolla dopo una settimana
const CAST_SCAN_TTL = 30 * DAY; // gli stessi personaggi al massimo una volta al mese
const PER_RUN = 12; // titoli per apertura dell'app
const CAST_PER_RUN = 3; // di questi, quanti anche con gli stessi personaggi
const SOURCES = new Set(['completed', 'uptodate', 'watching']);

// i titoli di cui si cercano le novità: quelli che hai guardato almeno in parte e non hai abbandonato
export function newsSources() {
  const items = lib()?.items || {};
  return Object.keys(items).filter((k) => SOURCES.has(items[k].status) && hasWatched(items[k]));
}

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- elenco ----------
let ver = 0; // cresce quando il giro in sottofondo porta qualcosa
let memo = { sig: '', at: 0, list: [] };

// [{ key, t, p, d, a, from: [chiavi dei titoli guardati da cui arriva] }]: prima quelli usciti, dal più
// recente, poi quelli in uscita, dal più vicino
export function newsList() {
  const L = lib();
  if (!L) return [];
  const sig = `${S.rev}|${ver}|${Object.keys(S.meta.items).length}|${today()}`;
  // si rifà quando cambia la libreria o arriva qualcosa dal giro; il resto (dati arrivati aprendo una
  // Collezione) dopo 20 s
  if (memo.lib === L && memo.sig === sig && Date.now() - memo.at < 20000) return memo.list;
  const off = new Set(L.newsOff || []);
  const t = today();
  const from = addDays(t, -NEWS_DAYS);
  const found = new Map();
  for (const src of newsSources()) {
    const x = xFromMeta(src);
    if (!x) continue;
    for (const e of cachedCollection(src, x).list) {
      if (e.self || !e.key || item(e.key) || off.has(e.key) || !e.d || e.d.length < 10 || e.d < from) continue;
      const cur = found.get(e.key);
      if (cur) { if (!cur.from.includes(src)) cur.from.push(src); continue; }
      found.set(e.key, { key: e.key, t: e.t || '', p: e.p || null, d: e.d, a: !!e.a, from: [src] });
    }
  }
  const all = [...found.values()];
  const out = all.filter((e) => e.d <= t).sort((a, b) => b.d.localeCompare(a.d))
    .concat(all.filter((e) => e.d > t).sort((a, b) => a.d.localeCompare(b.d)));
  memo = { lib: L, sig, at: Date.now(), list: out };
  return out;
}

// ---------- giro in sottofondo ----------
let running = false;

export async function scanNews({ perRun = PER_RUN, castPerRun = CAST_PER_RUN } = {}) {
  if (running || !tmdbToken() || navigator.onLine === false) return;
  running = true;
  try {
    const times = LS.get('vds.news.scan', {}) || {};
    const now = Date.now();
    const last = (k) => item(k)?.last || '';
    const todo = newsSources()
      .filter((k) => metaOf(k) && now - (times[k] || 0) > SCAN_TTL)
      // prima i mai controllati, dal più guardato di recente; poi quelli controllati da più tempo
      .sort((a, b) => (times[a] || 0) - (times[b] || 0) || last(b).localeCompare(last(a)))
      .slice(0, perRun);
    let castLeft = castPerRun;
    for (const k of todo) {
      if (document.visibilityState === 'hidden') break;
      const x = xFromMeta(k);
      if (!x) continue;
      const wd = cachedWiki(k);
      if (!wd || wd.stale) await fetchWiki(k).catch(() => null);
      const tt = cachedByTitle(k);
      if ((!tt || tt.stale) && (x.t || x.ot)) await fetchByTitle(k, [x.ot, x.t], x.l).catch(() => null);
      if (castLeft > 0 && castAge(k) > CAST_SCAN_TTL) {
        castLeft -= 1;
        await fetchByCast(k, { t: x.t, ot: x.ot, l: x.l, anime: !!x.anime }).catch(() => null);
      }
      // la saga del film, poi i dati dei collegati e le saghe dei film collegati (che si sanno coi loro dati)
      if (Array.isArray(x.co)) await loadSaga(x.co[0]);
      for (let round = 0; round < 3; round += 1) {
        const r = cachedCollection(k, x);
        const keys = [...r.missing, ...r.needCo];
        if (!keys.length && !r.sagaPending.length) break;
        await ensureMiniAsync(keys);
        for (const id of r.sagaPending) await loadSaga(id);
      }
      times[k] = Date.now();
      LS.set('vds.news.scan', times);
      ver += 1;
      notify();
    }
  } finally {
    running = false;
  }
}

// ---------- disegno ----------
function whenOf(e, t) {
  const movie = e.key.startsWith('movie:');
  const kind = `${movie ? 'Film' : 'Serie'}${e.a ? ' anime' : ''}`;
  const day = fmtDay(e.d, { year: e.d.slice(0, 4) !== t.slice(0, 4) });
  return `${kind} · ${e.d > t ? `esce il ${day}` : `${movie ? 'uscito' : 'uscita'} il ${day}`}`;
}

function fromOf(e) {
  const name = (k) => titleOf(k, item(k), metaOf(k));
  const more = e.from.length - 1;
  return `Collezione di ${name(e.from[0])}${more ? ` e di ${more === 1 ? name(e.from[1]) : `altri ${more}`}` : ''}`;
}

function newsCard(e, t) {
  const [type, id] = e.key.split(':');
  return html`<a class="nv" href="#/t/${type}/${id}" data-key="${e.key}">
    <span class="nv-img">${e.p ? html`<img loading="lazy" decoding="async" src="${img(e.p, 'w185')}" alt="">` : ''}${kindBadge({ type, anime: e.a })}</span>
    <span class="nv-txt">
      <b class="nv-t">${e.t}</b>
      <span class="nv-when${e.d > t ? ' soon' : ''}">${whenOf(e, t)}</span>
      <span class="nv-from">${fromOf(e)}</span>
    </span>
    <button class="nv-x" data-act="news-off" data-key="${e.key}" aria-label="Togli dalle novità">${icon.x}</button>
  </a>`;
}

// la riga in Home (niente se non c'è niente)
export function newsRow() {
  const list = newsList();
  if (!list.length) return '';
  const t = today();
  return html`<section class="row news">
    <div class="row-head"><h2>Novità</h2><a class="row-all" href="#/novita">Tutte <span>${list.length}</span></a></div>
    <div class="scroller nv-row" data-scroll="h-novita">${list.slice(0, 20).map((e) => newsCard(e, t))}</div>
  </section>`;
}

// #/novita
export function renderNews() {
  const list = newsList();
  const t = today();
  return html`
  <header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Novità</h1><span class="count">${list.length}</span>
  </header>
  ${list.length ? html`<div class="nv-list">${list.map((e) => newsCard(e, t))}</div>` : html`<p class="row-empty">${raw('Nessuna novità.')}</p>`}`;
}

// ---------- azioni ----------
export const newsActions = {
  'news-off': (el) => {
    const key = el.dataset.key;
    const title = newsList().find((e) => e.key === key)?.t || key;
    dispatch({ op: 'news', off: [key], msg: `Toglie ${title} dalle novità` });
    toast('Tolto dalle novità', { label: 'Annulla', run: () => dispatch({ op: 'news', on: [key], msg: `Rimette ${title} nelle novità` }) });
  },
};
