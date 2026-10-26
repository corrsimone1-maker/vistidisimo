import { html, icon } from '../ui.js';
import { lib, metaOf, LS } from '../store.js';
import { category, byLast } from '../derive.js';
import { cardFor, titleOf, emptyState } from './common.js';

const KINDS = [['serie', 'Serie'], ['film', 'Film'], ['anime', 'Anime']];
const STATI = [['all', 'Tutti'], ['watching', 'In corso'], ['planned', 'Da guardare'], ['uptodate', 'In pari'], ['completed', 'Completati'], ['dropped', 'Abbandonati']];
const SORTS = [['last', 'Ultima attività'], ['added', 'Aggiunti di recente'], ['title', 'Titolo'], ['rating', 'Voto'], ['year', 'Anno di uscita']];

const F = Object.assign({ kinds: ['serie', 'film', 'anime'], status: 'all', sort: 'last', q: '' }, LS.get('vds.libf', {}), { q: '' });
const save = () => LS.set('vds.libf', { kinds: F.kinds, status: F.status, sort: F.sort });

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function filtered() {
  const L = lib();
  const q = norm(F.q.trim());
  let list = Object.entries(L?.items || {}).map(([k, it]) => ({ k, it, m: metaOf(k) }));
  list = list.filter((x) => F.kinds.includes(category(x.it, x.m)));
  if (F.status !== 'all') list = list.filter((x) => x.it.status === F.status);
  if (q) list = list.filter((x) => norm(titleOf(x.k, x.it, x.m)).includes(q) || norm(x.it.title).includes(q) || norm(x.m?.ot).includes(q));
  const t = (x) => titleOf(x.k, x.it, x.m);
  const sorters = {
    last: byLast,
    added: (a, b) => (b.it.added || '').localeCompare(a.it.added || ''),
    title: (a, b) => t(a).localeCompare(t(b), 'it', { sensitivity: 'base' }),
    rating: (a, b) => (b.it.rating ?? -1) - (a.it.rating ?? -1) || byLast(a, b),
    year: (a, b) => ((b.m?.y || b.it.year || 0) - (a.m?.y || a.it.year || 0)) || byLast(a, b),
  };
  return list.sort(sorters[F.sort] || byLast);
}

function gridHtml() {
  const list = filtered();
  if (!list.length) return emptyState('Niente qui', F.q ? 'Nessun titolo corrisponde alla ricerca.' : 'Prova a cambiare i filtri.');
  return html`<div class="grid">${list.map((x) => cardFor(x.k))}</div>`;
}

export function renderLibrary() {
  const L = lib();
  const all = Object.entries(L?.items || {});
  const counts = { serie: 0, film: 0, anime: 0 };
  for (const [k, it] of all) counts[category(it, metaOf(k))] += 1;
  const allOn = F.kinds.length === 3;
  return html`
  <header class="page-top"><h1>Libreria</h1><span class="count">${all.length}</span></header>
  <div class="lib-tools">
    <label class="search-box">${icon.search}<input type="search" data-input="lib-q" placeholder="Filtra per titolo" value="${F.q}" autocomplete="off" enterkeyhint="search"></label>
    <div class="chips" role="group" aria-label="Tipo">
      <button class="chip ${allOn ? 'on' : ''}" data-act="lib-kind" data-v="all">Tutto</button>
      ${KINDS.map(([v, label]) => html`<button class="chip ${!allOn && F.kinds.includes(v) ? 'on' : ''}" data-act="lib-kind" data-v="${v}">${label} <span>${counts[v]}</span></button>`)}
    </div>
    <div class="chips scroll-x" role="group" aria-label="Stato">
      ${STATI.map(([v, label]) => html`<button class="chip st ${v !== 'all' ? 'st-' + v : ''} ${F.status === v ? 'on' : ''}" data-act="lib-status" data-v="${v}">${v !== 'all' ? html`<i></i>` : ''}${label}</button>`)}
    </div>
    <label class="sort">Ordina per
      <select data-input="lib-sort">${SORTS.map(([v, label]) => html`<option value="${v}" ${F.sort === v ? 'selected' : ''}>${label}</option>`)}</select>
    </label>
  </div>
  <div id="lib-grid">${gridHtml()}</div>`;
}

export const libraryActions = {
  'lib-kind': (el, { rerender }) => {
    const v = el.dataset.v;
    if (v === 'all') F.kinds = ['serie', 'film', 'anime'];
    else if (F.kinds.length === 3) F.kinds = [v];
    else {
      F.kinds = F.kinds.includes(v) ? F.kinds.filter((x) => x !== v) : [...F.kinds, v];
      if (!F.kinds.length) F.kinds = ['serie', 'film', 'anime'];
    }
    save(); rerender();
  },
  'lib-status': (el, { rerender }) => { F.status = el.dataset.v; save(); rerender(); },
};

export const libraryInputs = {
  'lib-q': (el) => { F.q = el.value; const g = document.getElementById('lib-grid'); if (g) g.innerHTML = String(gridHtml()); },
  'lib-sort': (el, { rerender }) => { F.sort = el.value; save(); rerender(); },
};
