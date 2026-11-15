import { html, icon, img, confirmSheet, promptSheet, openSheet, toast } from '../ui.js';
import { lib, metaOf, LS } from '../store.js';
import { listProgress, listOrder, category } from '../derive.js';
import * as A from '../actions.js';
import { cardFor, emptyState, titleOf } from './common.js';
import { listCard } from './home.js';
import { KINDS, STATI, ALL_KINDS, toggleKinds } from './library.js';

let editing = null; // id della lista in modifica
let reordering = false;

// Filtri delle liste (menu ⋯ in alto a destra): gli stessi della Libreria, tipo e stato. Valgono per ogni
// lista e si ricordano sul dispositivo; il pallino sul ⋯ dice che sono accesi.
const LF = Object.assign({ kinds: [...ALL_KINDS], status: 'all' }, LS.get('vds.listf', {}));
if (!Array.isArray(LF.kinds) || !LF.kinds.length) LF.kinds = [...ALL_KINDS];
const saveLF = () => LS.set('vds.listf', { kinds: LF.kinds, status: LF.status });
const filterOn = () => LF.kinds.length < ALL_KINDS.length || LF.status !== 'all';

const kindOfEntry = (items, e) => category(items[e.key] || { type: e.key.split(':')[0] }, metaOf(e.key));
function visibleEntries(l, items) {
  return listOrder(l, items).filter((e) => LF.kinds.includes(kindOfEntry(items, e)) && (LF.status === 'all' || items[e.key]?.status === LF.status));
}

// Esporta come testo (chiesto da Simo il 15/11/2026): i titoli che vedi con i filtri accesi, uno per riga
// nell'ordine della lista, «Titolo (anno)» (l'anno serve a distinguere i titoli con lo stesso nome).
export function listText(l) {
  const items = lib()?.items || {};
  return visibleEntries(l, items).map((e) => {
    const it = items[e.key]; const m = metaOf(e.key);
    const title = titleOf(e.key, it, m) || e.title || '';
    const y = m?.y || it?.year || e.year;
    return y ? `${title} (${y})` : title;
  }).join('\n');
}

// Negli appunti: l'API moderna (parte dal tocco, va anche su iPhone), se no il vecchio giro col campo di testo.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* si prova l'altro modo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function filtersSheet(listId, rerender) {
  const paint = (el) => {
    const l = (lib()?.lists || []).find((x) => x.id === listId);
    const items = lib()?.items || {};
    const n = l ? visibleEntries(l, items).length : 0;
    const counts = { serie: 0, film: 0, anime: 0 };
    for (const e of l?.items || []) counts[kindOfEntry(items, e)] += 1;
    const allOn = LF.kinds.length === ALL_KINDS.length;
    el.querySelector('.lf-body').innerHTML = String(html`
      <div class="chips" role="group" aria-label="Tipo">
        <button class="chip ${allOn ? 'on' : ''}" data-lf-kind="all">Tutto</button>
        ${KINDS.map(([v, label]) => html`<button class="chip ${!allOn && LF.kinds.includes(v) ? 'on' : ''}" data-lf-kind="${v}">${label} <span>${counts[v]}</span></button>`)}
      </div>
      <div class="chips" role="group" aria-label="Stato">
        ${STATI.map(([v, label]) => html`<button class="chip st ${v !== 'all' ? 'st-' + v : ''} ${LF.status === v ? 'on' : ''}" data-lf-status="${v}">${v !== 'all' ? html`<i></i>` : ''}${label}</button>`)}
      </div>
      <button class="btn ghost wide lf-copy" data-lf-copy ${n ? '' : 'disabled'}>${icon.copy}Copia ${n === 1 ? '1 titolo' : `${n} titoli`}</button>`);
  };
  openSheet(String(html`
    <h3 class="sheet-title">Filtri</h3>
    <div class="lf-body"></div>
    <button class="btn primary wide" data-close>Fatto</button>`), {
    className: 'lf-sheet',
    onMount: (el, close) => {
      paint(el);
      // il foglio resta aperto: si vede la lista cambiare dietro
      el.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-lf-copy]')) {
          const l = (lib()?.lists || []).find((x) => x.id === listId);
          const text = l ? listText(l) : '';
          if (!text) return;
          const count = text.split('\n').length;
          const ok = await copyText(text);
          if (ok) { close(); toast(count === 1 ? 'Copiato 1 titolo' : `Copiati ${count} titoli`); } else toast('Non riesco a copiare');
          return;
        }
        const k = ev.target.closest('[data-lf-kind]');
        const s = ev.target.closest('[data-lf-status]');
        if (k) LF.kinds = toggleKinds(LF.kinds, k.dataset.lfKind);
        else if (s) LF.status = s.dataset.lfStatus;
        else return;
        saveLF(); paint(el); rerender();
      });
    },
  });
}

export function renderLists() {
  const L = lib();
  const lists = L?.lists || [];
  const head = html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Liste</h1><span class="count">${lists.length}</span>
    ${lists.length > 1 ? html`<button class="btn ghost small push-right ${reordering ? 'on' : ''}" data-act="lists-reorder">${reordering ? 'Fine' : 'Riordina'}</button>` : ''}
  </header>`;
  if (reordering) {
    return html`${head}
    <p class="hint">Trascina le liste dalla maniglia. L’ordine vale anche per la Home.</p>
    <ul class="reorder" id="reorder">
      ${lists.map((l) => {
        const cover = l.items.map((e) => L.items[e.key]?.poster || metaOf(e.key)?.p).find(Boolean);
        return html`<li class="ro-row" data-id="${l.id}">
          <span class="ro-thumb">${cover ? html`<img src="${img(cover, 'w185')}" alt="">` : ''}</span>
          <span class="ro-name">${l.title}<small>${l.items.length} ${l.items.length === 1 ? 'titolo' : 'titoli'}</small></span>
          <span class="ro-handle" role="button" aria-label="Trascina per spostare ${l.title}">${icon.grip}</span>
        </li>`;
      })}
    </ul>`;
  }
  return html`${head}
  <div class="list-grid">
    ${lists.map((l) => listCard(l, L.items))}
    <button class="lc lc-new" data-act="list-new">${icon.plus}<span>Nuova lista</span></button>
  </div>`;
}

// Trascinamento delle righe nella modalità riordina (dito o mouse).
export function initReorder() {
  document.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.ro-handle');
    if (!handle) return;
    ev.preventDefault();
    const row = handle.closest('.ro-row');
    const rows = [...row.parentElement.children];
    const from = rows.indexOf(row);
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const step = rects[from].height + gap; // di quanto si spostano le altre righe
    const centers = rects.map((r) => r.top + r.height / 2);
    const startY = ev.clientY;
    let to = from;
    document.body.classList.add('hold-render');
    row.classList.add('dragging');
    try { handle.setPointerCapture(ev.pointerId); } catch { /* niente */ }
    const move = (e) => {
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const c = centers[from] + dy;
      to = centers.filter((y, i) => i !== from && y < c).length;
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -step;
        if (from > to && i < from && i >= to) shift = step;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('hold-render');
      const ids = rows.map((r) => r.dataset.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
      if (to !== from) A.reorderLists(ids);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export function renderList(id) {
  const L = lib();
  const l = (L?.lists || []).find((x) => x.id === id);
  if (!l) return html`<header class="page-top"><button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button><h1>Lista</h1></header>${emptyState('Questa lista non esiste più', '')}`;
  const p = listProgress(l, L.items, metaOf);
  const done = l.items.filter((e) => L.items[e.key]?.status === 'completed').length;
  const isEditing = editing === id;
  const shown = visibleEntries(l, L.items);
  return html`
  <header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1 class="wrap">${l.title}</h1>
    <button class="icon-btn menu-btn push-right" data-act="list-filters" data-id="${l.id}" aria-label="Filtri">${icon.more}${filterOn() ? html`<span class="menu-dot lf-dot"></span>` : ''}</button>
  </header>
  <div class="list-head">
    <div class="list-pct"><b>${Math.round(p * 100)}%</b><span>completato</span></div>
    <div class="list-sub">${l.items.length} ${l.items.length === 1 ? 'titolo' : 'titoli'}, ${done} finiti${shown.length < l.items.length ? ` · ne vedi ${shown.length}` : ''}</div>
    <div class="tube st-list big"><i style="--p:${p.toFixed(3)}"></i></div>
    <div class="list-tools">
      <button class="btn ghost small ${isEditing ? 'on' : ''}" data-act="list-edit" data-id="${l.id}">${isEditing ? 'Fine' : 'Modifica'}</button>
      <button class="btn ghost small" data-act="list-rename" data-id="${l.id}">Rinomina</button>
      <button class="btn danger-ghost small" data-act="list-delete" data-id="${l.id}">Elimina</button>
    </div>
  </div>
  ${!l.items.length
    ? emptyState('Lista vuota', 'Apri una serie o un film e tocca «Gestisci liste» per aggiungerlo qui.')
    : (shown.length
      ? html`<div class="grid ${isEditing ? 'editing' : ''}" data-list="${l.id}">${shown.map((e) => cardFor(e.key, { fallback: e, removable: isEditing, withTitle: true }))}</div>`
      : emptyState('Niente qui', 'Prova a cambiare i filtri.'))}`;
}

export const listActions = {
  'list-new': async (el, { go }) => {
    const name = await promptSheet('Nuova lista', '', 'Crea');
    if (!name) return;
    const id = A.createList(name);
    go(`#/lista/${encodeURIComponent(id)}`);
  },
  'lists-reorder': (el, { rerender }) => { reordering = !reordering; rerender(); },
  'list-filters': (el, { rerender }) => filtersSheet(el.dataset.id, rerender),
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
