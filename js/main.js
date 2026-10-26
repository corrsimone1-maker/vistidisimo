import { closeAllSheets, toast } from './ui.js';
import { S, subscribe, loadCache, pull, flush, refreshMeta, hasGhToken, saveMeta } from './store.js';
import * as A from './actions.js';
import { renderHome, renderCollection } from './views/home.js';
import { renderLibrary, libraryActions, libraryInputs } from './views/library.js';
import { renderSearch, searchInputs } from './views/search.js';
import { renderUpcoming, upcomingActions } from './views/upcoming.js';
import { renderDetail, detailActions } from './views/detail.js';
import { renderLists, renderList, listActions } from './views/lists.js';
import { renderSettings, settingsActions } from './views/settings.js';

const view = document.getElementById('view');
const scrollMem = new Map();
const TAB_OF = { home: 'home', raccolta: 'home', liste: 'home', lista: 'home', impostazioni: 'home', libreria: 'libreria', cerca: 'cerca', prossimi: 'prossimi' };
const KEEP_SCROLL = new Set(['home', 'raccolta', 'liste', 'lista', 'libreria', 'cerca', 'prossimi']);
let lastTab = 'home';
let navDepth = 0;
let currentHash = location.hash;

function parse(hash) {
  const h = (hash || '').replace(/^#\/?/, '') || 'home';
  const [path] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, name: parts[0] || 'home' };
}

function renderRoute() {
  const r = parse(location.hash);
  if (!hasGhToken() && r.name !== 'impostazioni') { location.replace('#/impostazioni'); return; }
  let out;
  switch (r.name) {
    case 'raccolta': out = renderCollection(r.parts[1]); break;
    case 'libreria': out = renderLibrary(); break;
    case 'cerca': out = renderSearch(); break;
    case 'prossimi': out = renderUpcoming(rerender); break;
    case 't': out = renderDetail(r.parts[1] === 'movie' ? 'movie' : 'tv', Number(r.parts[2]), rerender); break;
    case 'liste': out = renderLists(); break;
    case 'lista': out = renderList(decodeURIComponent(r.parts[1] || '')); break;
    case 'impostazioni': out = renderSettings(); break;
    default: out = renderHome();
  }
  view.innerHTML = String(out);
  view.dataset.route = r.name;
  const tab = r.name === 't' ? lastTab : (TAB_OF[r.name] || 'home');
  lastTab = tab;
  document.querySelectorAll('#tabs a').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.classList.toggle('no-tabs', !hasGhToken());
}

// Ridisegna la schermata corrente senza perdere scroll e campo attivo.
function rerender() {
  const y = window.scrollY;
  const hs = {};
  view.querySelectorAll('[data-scroll]').forEach((el) => { hs[el.dataset.scroll] = el.scrollLeft; });
  const active = document.activeElement;
  const activeInput = active && view.contains(active) ? active.dataset?.input : null;
  const sel = activeInput && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  renderRoute();
  view.querySelectorAll('[data-scroll]').forEach((el) => { if (hs[el.dataset.scroll] != null) el.scrollLeft = hs[el.dataset.scroll]; });
  window.scrollTo(0, y);
  if (activeInput) {
    const el = view.querySelector(`[data-input="${activeInput}"]`);
    if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* niente */ } } }
  }
}

let rerenderTimer = null;
let lastRerender = 0;
function scheduleRerender() {
  const gap = S.metaJob ? 900 : 0;
  const wait = Math.max(0, lastRerender + gap - Date.now());
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { lastRerender = Date.now(); rerender(); }, wait);
}

function onHash() {
  scrollMem.set(currentHash, window.scrollY);
  const hs = {};
  view.querySelectorAll('[data-scroll]').forEach((el) => { hs[el.dataset.scroll] = el.scrollLeft; });
  scrollMem.set(currentHash + '|h', hs);
  currentHash = location.hash;
  navDepth += 1;
  closeAllSheets();
  renderRoute();
  const r = parse(location.hash);
  const y = KEEP_SCROLL.has(r.name) ? scrollMem.get(currentHash) || 0 : 0;
  const savedH = scrollMem.get(currentHash + '|h') || {};
  view.querySelectorAll('[data-scroll]').forEach((el) => { if (savedH[el.dataset.scroll] != null) el.scrollLeft = savedH[el.dataset.scroll]; });
  window.scrollTo(0, y);
}

const go = (hash) => { location.hash = hash; };
const back = () => { if (navDepth > 0 && history.length > 1) { navDepth -= 2; history.back(); } else location.hash = '#/home'; };

const ACTIONS = {
  ...libraryActions, ...upcomingActions, ...detailActions, ...listActions, ...settingsActions,
  back: () => back(),
  'up-check': (el) => {
    const key = el.dataset.key; const s = Number(el.dataset.s); const e = Number(el.dataset.e);
    el.classList.add('done');
    A.markEpisodes(key, [[s, e]]);
    toast(`Visto S${s} · E${e}`);
  },
};
const INPUTS = { ...libraryInputs, ...searchInputs };

function ctx(ev) { return { rerender, go, back, ev }; }

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  fn(el, ctx(ev));
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]');
  if (!el || el.tagName === 'SELECT') return;
  INPUTS[el.dataset.input]?.(el, ctx(ev));
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('select[data-input]');
  if (el) INPUTS[el.dataset.input]?.(el, ctx(ev));
});

window.addEventListener('hashchange', onHash);
subscribe(scheduleRerender);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); saveMeta(); return; }
  if (hasGhToken() && Date.now() - S.lastFetch > 60000) pull().then((ok) => { if (ok) refreshMeta(); });
});
window.addEventListener('online', () => flush());

async function boot() {
  loadCache();
  renderRoute();
  if (!hasGhToken()) return;
  const ok = await pull();
  rerender();
  if (ok) refreshMeta();
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
