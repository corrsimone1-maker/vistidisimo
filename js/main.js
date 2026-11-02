import { closeAllSheets } from './ui.js';
import { S, subscribe, loadCache, pull, flush, refreshMeta, hasGhToken, saveMeta } from './store.js';
import { renderHome, renderCollection } from './views/home.js';
import { renderLibrary, libraryActions, libraryInputs } from './views/library.js';
import { renderSearch, searchInputs, searchActions } from './views/search.js';
import { renderUpcoming, upcomingActions, resetUpcomingOrder } from './views/upcoming.js';
import { renderDetail, detailActions } from './views/detail.js';
import { renderEpisode, renderRipasso, episodeActions } from './views/episode.js';
import { renderPerson } from './views/person.js';
import { renderLists, renderList, listActions, initReorder } from './views/lists.js';
import { renderSettings, settingsActions } from './views/settings.js';
import { checkNewSeasons } from './views/newseason.js';
import { renderSaga, renderSagas } from './views/saga.js';
import { renderFranchise } from './views/franchise.js';

const view = document.getElementById('view');
const scrollMem = new Map();
const TAB_OF = { home: 'home', raccolta: 'home', liste: 'home', lista: 'home', impostazioni: 'home', libreria: 'libreria', saghe: 'libreria', cerca: 'cerca', prossimi: 'prossimi' };
// schede di dettaglio: restano sulla scheda della barra da cui le hai aperte
const DETAIL = new Set(['t', 'ep', 'ripasso', 'persona', 'saga', 'extra']);
const KEEP_SCROLL = new Set(['home', 'raccolta', 'liste', 'lista', 'libreria', 'saghe', 'cerca', 'prossimi']);
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
    case 'ep': out = renderEpisode(Number(r.parts[1]), Number(r.parts[2]), Number(r.parts[3]), rerender); break;
    case 'persona': out = renderPerson(Number(r.parts[1]), rerender); break;
    case 'saga': out = renderSaga(Number(r.parts[1]), rerender); break;
    case 'saghe': out = renderSagas(rerender); break;
    case 'extra': out = renderFranchise(Number(r.parts[1]), rerender); break;
    case 'ripasso': out = renderRipasso(Number(r.parts[1]), r.parts[2] == null ? null : Number(r.parts[2]), rerender); break;
    case 'liste': out = renderLists(); break;
    case 'lista': out = renderList(decodeURIComponent(r.parts[1] || '')); break;
    case 'impostazioni': out = renderSettings(); break;
    default: out = renderHome();
  }
  view.innerHTML = String(out);
  view.dataset.route = r.name;
  const tab = DETAIL.has(r.name) ? lastTab : (TAB_OF[r.name] || 'home');
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
  if (document.body.classList.contains('hold-render')) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(scheduleRerender, 300); return; }
  const gap = S.metaJob ? 900 : 0;
  const wait = Math.max(0, lastRerender + gap - Date.now());
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { lastRerender = Date.now(); rerender(); }, wait);
}

// Le schede (titolo, episodio, ripasso, regista) ritrovano lo scroll solo quando ci torni con
// «indietro» (o «avanti») della cronologia, non quando le riapri da un link. Ogni voce nuova della
// cronologia riceve un numero in history.state: se arrivando c'è già, è un ritorno.
// lo scroll lo gestisce l'app: se lo ripristinasse anche il browser, quando arriva «hashchange»
// la pagina che si lascia risulterebbe già spostata
try { history.scrollRestoration = 'manual'; } catch { /* niente */ }
let navCount = 0;
try { history.replaceState({ vds: navCount }, ''); } catch { /* niente */ }
function isHistoryReturn() {
  if (history.state && history.state.vds != null) return true;
  try { history.replaceState({ vds: ++navCount }, ''); } catch { /* niente */ }
  return false;
}

// tornando su Prossimi da un'altra scheda della barra l'ordine si rifà da capo
const OTHER_TABS = new Set(['home', 'raccolta', 'liste', 'lista', 'impostazioni', 'libreria', 'saghe', 'cerca']);

function onHash() {
  if (OTHER_TABS.has(parse(location.hash).name)) resetUpcomingOrder();
  scrollMem.set(currentHash, window.scrollY);
  const hs = {};
  view.querySelectorAll('[data-scroll]').forEach((el) => { hs[el.dataset.scroll] = el.scrollLeft; });
  scrollMem.set(currentHash + '|h', hs);
  const back = isHistoryReturn();
  currentHash = location.hash;
  navDepth += 1;
  closeAllSheets();
  renderRoute();
  const r = parse(location.hash);
  const keep = KEEP_SCROLL.has(r.name) || back;
  const y = keep ? scrollMem.get(currentHash) || 0 : 0;
  const savedH = scrollMem.get(currentHash + '|h') || {};
  view.querySelectorAll('[data-scroll]').forEach((el) => { if (savedH[el.dataset.scroll] != null) el.scrollLeft = savedH[el.dataset.scroll]; });
  window.scrollTo(0, y);
}

const go = (hash) => { location.hash = hash; };
const back = () => { if (navDepth > 0 && history.length > 1) { navDepth -= 2; history.back(); } else location.hash = '#/home'; };

const ACTIONS = {
  ...libraryActions, ...searchActions, ...upcomingActions, ...detailActions, ...episodeActions, ...listActions, ...settingsActions,
  back: () => back(),
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
// I moduli (per ora quello dei token) non ricaricano mai la pagina: l'invio fa l'azione di data-submit.
document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.closest('form[data-submit]');
  if (f) ACTIONS[f.dataset.submit]?.(f, ctx(ev));
});
// Immagini con un ripiego (data-fallback, per esempio i fotogrammi in w780 → original): se la prima non
// carica si prova l'altra, una volta sola. Così niente codice scritto dentro l'HTML con indirizzi da TMDB.
document.addEventListener('error', (ev) => {
  const t = ev.target;
  if (t instanceof HTMLImageElement && t.dataset.fallback) {
    const f = t.dataset.fallback;
    delete t.dataset.fallback;
    t.src = f;
  }
}, true);

// Niente zoom: iOS ignora in parte user-scalable=no, quindi si bloccano anche i gesti di pizzico.
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

window.addEventListener('hashchange', onHash);
initReorder();
subscribe(scheduleRerender);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); saveMeta(); return; }
  if (hasGhToken() && Date.now() - S.lastFetch > 60000) pull().then((ok) => { if (ok) afterPull(); });
});
window.addEventListener('online', () => flush());

window.__vdsBooted = true;

// Libreria appena scaricata: avviso delle stagioni nuove con i dati TMDB che ci sono già, poi di nuovo
// quando sono aggiornati (una stagione uscita oggi arriva di solito da lì).
function afterPull() {
  checkNewSeasons();
  refreshMeta().then(checkNewSeasons, checkNewSeasons);
}

async function boot() {
  loadCache();
  renderRoute();
  if (!hasGhToken()) return;
  const ok = await pull();
  rerender();
  if (ok) afterPull();
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
