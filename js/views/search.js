import { html, icon } from '../ui.js';
import { tm, tmdbToken } from '../tmdb.js';
import { cardForResult, emptyState } from './common.js';

const st = { q: '', results: null, loading: false, error: '', trending: null, trendingTried: false, seq: 0 };
let timer = null;

const keep = (r) => (r.media_type === 'movie' || r.media_type === 'tv');

function resultsHtml() {
  if (!tmdbToken()) return emptyState('Manca la chiave TMDB', 'Inseriscila in Impostazioni per cercare serie e film.', html`<a class="btn primary" href="#/impostazioni">Apri Impostazioni</a>`);
  if (st.error) return emptyState('Ricerca non riuscita', st.error);
  if (st.q.trim()) {
    if (!st.results) return html`<p class="muted pad">Cerco…</p>`;
    if (!st.results.length) return emptyState('Nessun risultato', `Niente per «${st.q.trim()}». Prova col titolo originale o in inglese.`);
    return html`<div class="grid">${st.results.map(cardForResult)}</div>`;
  }
  if (!st.trending) return html`<p class="muted pad">Carico le tendenze…</p>`;
  return html`<h2 class="section-title">Di tendenza questa settimana</h2><div class="grid">${st.trending.map(cardForResult)}</div>`;
}

function paint() {
  const el = document.getElementById('search-results');
  if (el) el.innerHTML = String(resultsHtml());
}

async function loadTrending() {
  if (st.trendingTried || !tmdbToken()) return;
  st.trendingTried = true;
  try {
    const d = await tm('/trending/all/week');
    st.trending = (d?.results || []).filter(keep);
  } catch (e) { st.trendingTried = false; st.error = e.message; }
  paint();
}

async function runSearch() {
  const q = st.q.trim();
  const seq = ++st.seq;
  if (!q) { st.results = null; paint(); return; }
  st.results = null; st.error = '';
  paint();
  try {
    const pages = await Promise.all([1, 2].map((page) => tm('/search/multi', { query: q, include_adult: 'false', page })));
    if (seq !== st.seq) return;
    const seen = new Set();
    st.results = pages.flatMap((p) => p?.results || []).filter(keep).filter((r) => { const k = r.media_type + r.id; if (seen.has(k)) return false; seen.add(k); return true; });
  } catch (e) { if (seq === st.seq) st.error = e.message; }
  if (seq === st.seq) paint();
}

export function renderSearch() {
  setTimeout(loadTrending, 0);
  return html`
  <header class="page-top"><h1>Cerca</h1></header>
  <div class="search-head">
    <label class="search-box big">${icon.search}<input type="search" data-input="search-q" placeholder="Serie, film, anime" value="${st.q}" autocomplete="off" autocorrect="off" enterkeyhint="search"></label>
  </div>
  <div id="search-results">${resultsHtml()}</div>
  <p class="tmdb-note">Dati e immagini da TMDB. Questa app usa l'API di TMDB ma non è approvata né certificata da TMDB.</p>`;
}

export const searchInputs = {
  'search-q': (el) => {
    st.q = el.value;
    clearTimeout(timer);
    timer = setTimeout(runSearch, 350);
    if (!st.q.trim()) { st.results = null; paint(); }
  },
};
