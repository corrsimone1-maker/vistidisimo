import { html, icon, confirmSheet, promptSheet, toast } from '../ui.js';
import { lib, metaOf } from '../store.js';
import { listProgress } from '../derive.js';
import * as A from '../actions.js';
import { cardFor, emptyState } from './common.js';
import { listCard } from './home.js';

let editing = null; // id della lista in modifica

export function renderLists() {
  const L = lib();
  const lists = L?.lists || [];
  return html`
  <header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Liste</h1><span class="count">${lists.length}</span>
  </header>
  <div class="list-grid">
    ${lists.map((l) => listCard(l, L.items))}
    <button class="lc lc-new" data-act="list-new">${icon.plus}<span>Nuova lista</span></button>
  </div>`;
}

export function renderList(id) {
  const L = lib();
  const l = (L?.lists || []).find((x) => x.id === id);
  if (!l) return html`<header class="page-top"><button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button><h1>Lista</h1></header>${emptyState('Questa lista non esiste più', '')}`;
  const p = listProgress(l, L.items, metaOf);
  const done = l.items.filter((e) => L.items[e.key]?.status === 'completed').length;
  const isEditing = editing === id;
  return html`
  <header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1 class="wrap">${l.title}</h1>
  </header>
  <div class="list-head">
    <div class="list-pct"><b>${Math.round(p * 100)}%</b><span>completato</span></div>
    <div class="list-sub">${l.items.length} ${l.items.length === 1 ? 'titolo' : 'titoli'}, ${done} finiti</div>
    <div class="tube st-list big"><i style="--p:${p.toFixed(3)}"></i></div>
    <div class="list-tools">
      <button class="btn ghost small ${isEditing ? 'on' : ''}" data-act="list-edit" data-id="${l.id}">${isEditing ? 'Fine' : 'Modifica'}</button>
      <button class="btn ghost small" data-act="list-rename" data-id="${l.id}">Rinomina</button>
      <button class="btn danger-ghost small" data-act="list-delete" data-id="${l.id}">Elimina</button>
    </div>
  </div>
  ${l.items.length
    ? html`<div class="grid ${isEditing ? 'editing' : ''}" data-list="${l.id}">${l.items.map((e) => cardFor(e.key, { fallback: e, removable: isEditing }))}</div>`
    : emptyState('Lista vuota', 'Apri una serie o un film e tocca «Gestisci liste» per aggiungerlo qui.')}`;
}

export const listActions = {
  'list-new': async (el, { go }) => {
    const name = await promptSheet('Nuova lista', '', 'Crea');
    if (!name) return;
    const id = A.createList(name);
    go(`#/lista/${encodeURIComponent(id)}`);
  },
  'list-edit': (el, { rerender }) => { editing = editing === el.dataset.id ? null : el.dataset.id; rerender(); },
  'list-rename': async (el) => {
    const l = lib().lists.find((x) => x.id === el.dataset.id);
    const name = await promptSheet('Rinomina lista', l.title, 'Salva');
    if (name && name !== l.title) A.renameList(l.id, name);
  },
  'list-delete': async (el, { back }) => {
    const l = lib().lists.find((x) => x.id === el.dataset.id);
    const ok = await confirmSheet(`Eliminare «${l.title}»?`, 'I titoli restano nella libreria, sparisce solo la lista.', 'Elimina', { danger: true });
    if (ok) { A.deleteList(l.id, l.title); toast('Lista eliminata'); back(); }
  },
  'list-remove': (el, { ev }) => {
    ev.preventDefault();
    const grid = el.closest('[data-list]');
    A.removeFromList(grid.dataset.list, el.dataset.key);
  },
};
