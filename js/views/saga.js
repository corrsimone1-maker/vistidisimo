// Saghe dei film (collezioni di TMDB): la pagina di una saga (#/saga/<id>) con tutti i film in ordine di
// uscita e «N visti su M», e l'elenco delle saghe dei film in libreria (#/saghe, dal menu ≡ della
// Libreria). Nella pagina del film la saga entra nella «Collezione» (js/views/collezione.js).
import { html, icon, img, posterCard, today } from '../ui.js';
import { lib, item, metaOf, LS } from '../store.js';
import { fetchCollection, tmdbToken, pool, sagaName } from '../tmdb.js';
import { isAnimeResult, watchDate } from '../derive.js';
import { cardFor, emptyState } from './common.js';

let repaint = () => {};
const TTL = 7 * 24 * 3600 * 1000;
const mem = new Map(); // id -> saga | 'loading' | { err }
let disk = null;
const saved = () => (disk ||= LS.get('vds.sagas', {}) || {});

function remember(s) {
  const all = saved();
  all[s.id] = { ...s, at: Date.now() };
  LS.set('vds.sagas', all);
}

// La saga dalla memoria, dal telefono o da TMDB (che poi ridisegna). Una copia vecchia si mostra
// subito e intanto si riscarica.
export function getSaga(id, { fetch = true } = {}) {
  const v = mem.get(id);
  if (v && v !== 'loading') return v;
  const s = saved()[id];
  const fresh = s && Date.now() - (s.at || 0) < TTL;
  if (fetch && !fresh && v !== 'loading' && tmdbToken()) {
    mem.set(id, 'loading');
    fetchCollection(id)
      .then((d) => { if (d) { remember(d); mem.set(id, d); } else mem.set(id, s || { err: 'TMDB non conosce questa saga.' }); repaint(); })
      .catch((e) => { mem.set(id, s || { err: e.message }); repaint(); });
  }
  if (s) { if (fresh) mem.set(id, s); return s; }
  return null;
}

const released = (f, t) => !!f.d && f.d <= t;
const seenFilm = (f) => item(`movie:${f.id}`)?.status === 'completed';

// Quanti film usciti hai visto: { seen, total, p }
export function sagaProgress(s, t = today()) {
  const out = s.films.filter((f) => released(f, t));
  const seen = out.filter(seenFilm).length;
  return { seen, total: out.length, p: out.length ? seen / out.length : 0 };
}

function filmCard(f, t) {
  const key = `movie:${f.id}`;
  const when = f.d ? (f.d > t ? `in uscita ${f.d.slice(0, 4)}` : f.d.slice(0, 4)) : 'senza data';
  const extra = html`<span class="pc-title">${f.t}</span><span class="pc-year">${when}</span>`;
  if (item(key)) return cardFor(key, { extra });
  return posterCard({ key, href: `#/t/movie/${f.id}`, title: f.t, poster: f.p, kind: { type: 'movie', anime: isAnimeResult(f) }, status: null, extra });
}

const head = (title) => html`<header class="page-top">
  <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
  <h1 class="wrap">${title}</h1>
</header>`;

export function renderSaga(id, rerender) {
  repaint = rerender;
  const s = getSaga(id);
  const fallback = Object.values(lib()?.items || {}).map((it) => metaOf(`movie:${it.id}`)?.co).find((co) => co && co[0] === id);
  if (!s) return html`${head(fallback ? sagaName(fallback[1]) : '')}<p class="muted pad">Carico la saga…</p>`;
  if (s.err) return html`${head(fallback ? sagaName(fallback[1]) : '')}${emptyState(s.err)}`;
  const t = today();
  const { seen, total } = sagaProgress(s, t);
  const coming = s.films.length - total;
  return html`
  ${head(s.name)}
  <p class="person-count"><b>${seen}</b> ${seen === 1 ? 'visto' : 'visti'} su ${total}${coming ? ` · ${coming} in uscita` : ''}</p>
  <div class="grid person-grid">${s.films.map((f) => filmCard(f, t))}</div>`;
}

// ---------- elenco delle saghe ----------
// Le saghe dei film in libreria (da meta.json): { id, name, keys }
function sagasInLibrary() {
  const by = new Map();
  for (const [k, it] of Object.entries(lib()?.items || {})) {
    if (it.type !== 'movie') continue;
    const co = metaOf(k)?.co;
    if (!co) continue;
    if (!by.has(co[0])) by.set(co[0], { id: co[0], name: sagaName(co[1]), keys: [] });
    by.get(co[0]).keys.push(k);
  }
  return [...by.values()];
}

let loadingAll = false;
function loadMissing(list) {
  const todo = list.filter((x) => !mem.get(x.id) && !(saved()[x.id] && Date.now() - saved()[x.id].at < TTL));
  if (!todo.length || loadingAll || !tmdbToken()) return;
  loadingAll = true;
  for (const x of todo) mem.set(x.id, 'loading');
  pool(todo, 4, async (x) => {
    try { const d = await fetchCollection(x.id); if (d) { remember(d); mem.set(x.id, d); } else mem.delete(x.id); } catch { mem.delete(x.id); }
  }).finally(() => { loadingAll = false; repaint(); });
}

function sagaCard(x, t) {
  const s = getSaga(x.id, { fetch: false });
  const films = s && !s.err ? s.films : null;
  const covers = (films ? films.map((f) => item(`movie:${f.id}`)?.poster || metaOf(`movie:${f.id}`)?.p || f.p) : x.keys.map((k) => item(k)?.poster || metaOf(k)?.p))
    .filter(Boolean).slice(0, 4);
  const pr = films ? sagaProgress(s, t) : null;
  return html`<a class="lc" href="#/saga/${x.id}">
    <div class="lc-mosaic n${covers.length}">${covers.map((p) => html`<img loading="lazy" src="${img(p, 'w185')}" alt="">`)}</div>
    <div class="lc-name">${s?.name || x.name}</div>
    <div class="lc-meta"><span>${pr ? `${pr.seen} di ${pr.total}` : `${x.keys.length} in libreria`}</span>${pr ? html`<b>${Math.round(pr.p * 100)}%</b>` : ''}</div>
    <div class="tube st-list"><i style="--p:${(pr ? pr.p : 0).toFixed(3)}"></i></div>
  </a>`;
}

export function renderSagas(rerender) {
  repaint = rerender;
  const list = sagasInLibrary();
  loadMissing(list);
  const t = today();
  // prima quelle a metà, poi quelle finite, poi quelle mai iniziate; dentro, dall'ultima vista
  const order = (x) => {
    const s = getSaga(x.id, { fetch: false });
    const last = x.keys.map((k) => watchDate(item(k))).sort().pop() || '';
    if (!s || s.err) return [1, last];
    const { seen, total } = sagaProgress(s, t);
    return [seen === 0 ? 2 : seen >= total ? 1 : 0, last];
  };
  const sorted = list.map((x) => ({ x, o: order(x) }))
    .sort((a, b) => a.o[0] - b.o[0] || b.o[1].localeCompare(a.o[1]) || a.x.name.localeCompare(b.x.name))
    .map((y) => y.x);
  return html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Saghe</h1><span class="count">${list.length}</span>
  </header>
  ${list.length ? html`<div class="list-grid">${sorted.map((x) => sagaCard(x, t))}</div>` : emptyState('Nessuna saga')}`;
}
