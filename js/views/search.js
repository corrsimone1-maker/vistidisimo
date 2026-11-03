import { html, icon, img, kindBadge, statusLabel, tube, posterCard } from '../ui.js';
import { tm, tmdbToken, nonLatin } from '../tmdb.js';
import { item, metaOf, LS } from '../store.js';
import { isAnimeResult, progress } from '../derive.js';
import { searchMal, romajiOf, norm, sim } from '../mal.js';
import { emptyState } from './common.js';

// aka: altri titoli (romaji, inglese, giapponese) dei risultati trovati anche su MyAnimeList
const st = { q: '', results: null, error: '', trending: null, trendingTried: false, seq: 0, en: new Map(), aka: new Map(), view: LS.get('vds.searchView', 'list') };
let timer = null;

const keep = (r) => (r.media_type === 'movie' || r.media_type === 'tv');
const keyOf = (r) => `${r.media_type}:${r.id}`;

// Tiene da parte titolo e trama in inglese: servono quando TMDB non ha la traduzione italiana
// e restituirebbe il titolo in giapponese (o in un'altra scrittura non latina).
function rememberEnglish(results) {
  for (const r of results) if (keep(r)) st.en.set(keyOf(r), { title: r.title || r.name, overview: r.overview });
}

function readableTitle(r) {
  const it = r.title || r.name || '';
  if (!nonLatin(it)) return it;
  const en = st.en.get(keyOf(r))?.title;
  if (en && !nonLatin(en)) return en;
  const lib = item(keyOf(r))?.title;
  return lib && !nonLatin(lib) ? lib : it;
}

function resultRow(r) {
  const type = r.media_type;
  const key = keyOf(r);
  const it = item(key);
  const title = readableTitle(r);
  const year = (r.release_date || r.first_air_date || '').slice(0, 4);
  const anime = isAnimeResult(r);
  // titolo originale: per gli anime il romaji, se si conosce; mai in una scrittura che Simo non legge
  let orig = r.original_title || r.original_name || '';
  if (anime) orig = romajiOf(key) || orig;
  if (nonLatin(orig)) orig = '';
  const kind = type === 'tv' ? (anime ? 'Serie anime' : 'Serie') : (anime ? 'Film anime' : 'Film');
  const poster = it?.poster || r.poster_path;
  return html`<a class="sr" href="#/t/${type}/${r.id}">
    <span class="sr-poster">
      ${poster ? html`<img loading="lazy" src="${img(poster, 'w185')}" alt="">` : html`<span class="sr-ph"></span>`}
      ${kindBadge({ type, anime })}
    </span>
    <span class="sr-body">
      <span class="sr-title">${title}</span>
      <span class="sr-meta">${kind}${year ? `, ${year}` : ''}</span>
      ${orig && norm(orig) !== norm(title) ? html`<span class="sr-orig">${orig}</span>` : ''}
      ${it ? html`<span class="sr-st st-${it.status}"><i></i>${statusLabel(type, it.status)}</span>${tube(it.status, progress(it, metaOf(key)))}` : ''}
    </span>
  </a>`;
}

// Vista compatta: griglia di locandine con il titolo (tradotto, non l'originale) sotto.
function gridCell(r) {
  const type = r.media_type;
  const key = keyOf(r);
  const it = item(key);
  const title = readableTitle(r);
  return posterCard({
    key, href: `#/t/${type}/${r.id}`, title, poster: it?.poster || r.poster_path,
    kind: { type, anime: isAnimeResult(r) },
    status: it?.status || null, progress: it ? progress(it, metaOf(key)) : 0,
    extra: html`<span class="pc-title">${title}</span>`,
  });
}

const resultsBlock = (list) => (st.view === 'grid'
  ? html`<div class="grid">${list.map(gridCell)}</div>`
  : html`<div class="sr-list">${list.map(resultRow)}</div>`);

function resultsHtml() {
  if (!tmdbToken()) return emptyState('Manca la chiave TMDB', 'Inseriscila in Impostazioni per cercare serie e film.', html`<a class="btn primary" href="#/impostazioni">Apri Impostazioni</a>`);
  if (st.error) return emptyState('Ricerca non riuscita', st.error);
  if (st.q.trim()) {
    if (!st.results) return html`<p class="muted pad">Cerco…</p>`;
    if (!st.results.length) return emptyState('Nessun risultato', `Niente per «${st.q.trim()}». Prova col titolo originale o in inglese.`);
    return resultsBlock(st.results);
  }
  if (!st.trending) return html`<p class="muted pad">Carico le tendenze…</p>`;
  return html`<h2 class="section-title">Di tendenza questa settimana</h2>${resultsBlock(st.trending)}`;
}

function paint() {
  const el = document.getElementById('search-results');
  if (el) el.innerHTML = String(resultsHtml());
}

async function loadTrending() {
  if (st.trendingTried || !tmdbToken()) return;
  st.trendingTried = true;
  try {
    const [d, en] = await Promise.all([tm('/trending/all/week'), tm('/trending/all/week', { language: 'en-US' }).catch(() => null)]);
    rememberEnglish(en?.results || []);
    st.trending = (d?.results || []).filter(keep);
  } catch (e) { st.trendingTried = false; st.error = e.message; }
  paint();
}

// Quanto un risultato corrisponde a quello che hai scritto, in qualunque lingua: titolo italiano, inglese,
// originale e (per gli anime) romaji. Uguale 1, comincia così ~0,9, lo contiene 0,75, se no somiglianza.
function score(r, q) {
  const qn = norm(q);
  const key = keyOf(r);
  const names = [r.title || r.name, st.en.get(key)?.title, r.original_title || r.original_name, romajiOf(key), ...(st.aka.get(key) || [])];
  let best = 0;
  for (const n of names) {
    const x = norm(n);
    if (!x || !qn) continue;
    const s = x === qn ? 1 : x.startsWith(qn) ? 0.9 - Math.min(0.1, (x.length - qn.length) / 200) : x.includes(qn) ? 0.75 : 0.7 * sim(n, q);
    if (s > best) best = s;
  }
  return best;
}
// Prima quello che corrisponde meglio; a parità, il più seguito (popolarità di TMDB).
const rank = (r, q) => score(r, q) + 0.05 * Math.min(1, Math.log10(1 + (r.popularity || 0)) / 3);

// Gli anime trovati su MyAnimeList per la stessa ricerca (al massimo 2,5 secondi di attesa): così
// «Shingeki no Kyojin» o «Attack on Titan» trovano la serie anche se TMDB non la mette in cima.
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function runSearch() {
  const q = st.q.trim();
  const seq = ++st.seq;
  if (!q) { st.results = null; paint(); return; }
  st.results = null; st.error = '';
  paint();
  try {
    const ask = (page, language) => tm('/search/multi', { query: q, include_adult: 'false', page, language });
    const malP = q.length >= 3 ? searchMal(q).catch(() => null) : Promise.resolve(null);
    const [p1, p2, e1, e2, mal] = await Promise.all([ask(1), ask(2), ask(1, 'en-US').catch(() => null), ask(2, 'en-US').catch(() => null), withTimeout(malP, 2500)]);
    if (seq !== st.seq) return;
    rememberEnglish([...(e1?.results || []), ...(e2?.results || [])]);
    const seen = new Set();
    const list = [...(p1?.results || []), ...(p2?.results || []), ...(e1?.results || [])].filter(keep).filter((r) => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
    for (const h of mal || []) {
      st.aka.set(h.key, h.names);
      if (seen.has(h.key)) continue;
      // un anime che TMDB non ha dato: si aggiunge solo se il titolo corrisponde davvero
      const [type, id] = h.key.split(':');
      const r = { id: Number(id), media_type: type, poster_path: h.p, genre_ids: [16], original_language: 'ja', origin_country: ['JP'], popularity: 0 };
      if (type === 'movie') Object.assign(r, { title: h.t, release_date: h.year ? `${h.year}` : '' });
      else Object.assign(r, { name: h.t, first_air_date: h.year ? `${h.year}` : '' });
      if (score(r, q) >= 0.75) { seen.add(h.key); list.push(r); }
    }
    const order = new Map(list.map((r, i) => [keyOf(r), i]));
    st.results = list.map((r) => ({ r, s: rank(r, q) })).sort((a, b) => b.s - a.s || order.get(keyOf(a.r)) - order.get(keyOf(b.r))).map((x) => x.r);
    // se MyAnimeList arriva dopo, porta solo i romaji (l'ordine non cambia sotto le dita)
    if (!mal) malP.then((m) => { if (m && seq === st.seq) paint(); });
  } catch (e) { if (seq === st.seq) st.error = e.message; }
  if (seq === st.seq) paint();
}

export function renderSearch() {
  setTimeout(loadTrending, 0);
  return html`
  <header class="page-top">
    <h1>Cerca</h1>
    <button class="icon-btn push-right view-btn" data-act="search-view" aria-label="${st.view === 'grid' ? 'Mostra come elenco' : 'Mostra come griglia'}">${st.view === 'grid' ? icon.list : icon.library}</button>
  </header>
  <div class="search-head">
    <label class="search-box big">${icon.search}<input type="search" data-input="search-q" placeholder="Serie, film, anime" value="${st.q}" autocomplete="off" autocorrect="off" enterkeyhint="search"></label>
  </div>
  <div id="search-results">${resultsHtml()}</div>
  <p class="tmdb-note">Dati e immagini da TMDB. Questa app usa l'API di TMDB ma non è approvata né certificata da TMDB.</p>`;
}

export const searchActions = {
  'search-view': (el, { rerender }) => {
    st.view = st.view === 'grid' ? 'list' : 'grid';
    LS.set('vds.searchView', st.view);
    rerender();
  },
};

export const searchInputs = {
  'search-q': (el) => {
    st.q = el.value;
    clearTimeout(timer);
    timer = setTimeout(runSearch, 350);
    if (!st.q.trim()) { st.results = null; paint(); }
  },
};
