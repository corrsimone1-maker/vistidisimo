import { html, icon, img, kindBadge, statusLabel, tube, posterCard } from '../ui.js';
import { tm, tmdbToken, nonLatin, romajiFromTitles } from '../tmdb.js';
import { item, metaOf, LS } from '../store.js';
import { isAnimeResult, progress } from '../derive.js';
import { searchMal, romajiOf, rememberRomaji, norm, sim } from '../mal.js';
import { stemText } from '../collection.js';
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
  if (anime || nonLatin(orig)) orig = romajiOf(key) || orig;
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

// Quanto uno dei titoli (italiano, inglese, originale, romaji…) corrisponde a quello che hai scritto:
// uguale 1, comincia con quelle parole 0,85, le contiene 0,8, comincia o le contiene a metà parola
// («Berlinoises» per «berlino») 0,6 / 0,55, quasi uguale (somiglianza ≥ 0,8: un errore di battitura)
// 0,8–0,85, se no la somiglianza × 0,5.
export function textScore(names, q) {
  const qw = stemText(q);
  if (!qw) return 0;
  const qj = qw.replace(/ /g, '');
  let best = 0;
  for (const n of names) {
    const x = stemText(n);
    if (!x) continue;
    let s;
    if (x === qw || x.replace(/ /g, '') === qj) s = 1;
    else if (x.startsWith(qw + ' ')) s = 0.85;
    else if ((' ' + x + ' ').includes(' ' + qw + ' ')) s = 0.8;
    else if (x.startsWith(qw)) s = 0.6;
    else if (x.includes(qw)) s = 0.55;
    else {
      // quasi uguale (un errore di battitura: «shingeki no kiojin»): conta quasi come se lo contenesse
      const d = sim(n, q);
      s = d >= 0.8 ? 0.6 + 0.25 * d : 0.5 * d;
    }
    if (s > best) best = s;
  }
  return best;
}
// Quanto è conosciuto un titolo: popolarità e numero di voti su TMDB (scala logaritmica, da 0 a 1).
const lg = (v, top) => Math.min(1, Math.log10(1 + Math.max(0, v || 0)) / Math.log10(1 + top));
const quality = (r) => 0.6 * lg(r.popularity, 500) + 0.4 * lg(r.vote_count, 20000);
// Ordine dei risultati (come nelle app normali: «berlino» dà prima «Berlino e la dama con l'ermellino»,
// non un film sconosciuto che si chiama proprio «Berlino»): corrispondenza del titolo 55%, quanto è
// conosciuto 35%, posizione data da TMDB 10%; senza locandina un po' più giù.
export function rankScore(r, q, names, pos = 0, n = 1) {
  return 0.55 * textScore(names, q) + 0.35 * quality(r) + 0.1 * (1 - Math.min(1, pos / Math.max(1, n))) - (r.poster_path ? 0 : 0.1);
}
const namesOf = (r) => { const key = keyOf(r); return [r.title || r.name, st.en.get(key)?.title, r.original_title || r.original_name, romajiOf(key), ...(st.aka.get(key) || [])]; };

// I risultati di TMDB si mostrano appena arrivano (prima si aspettava anche MyAnimeList fino a 2,5 s, e
// Cerca sembrava lento). Gli anime trovati su MyAnimeList (romaji, inglese, giapponese, anche con un
// errore di battitura) si aggiungono quando arrivano, se è passato poco e non hai ancora fatto scorrere
// la pagina; dopo portano solo i romaji, così l'ordine non cambia sotto le dita. Se TMDB non ha trovato
// niente (es. «shingeki no kiojin») si aspetta MyAnimeList fino a 6 secondi invece di dire «Nessun risultato».
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const LATE_MERGE_MS = 3000;

// Titoli alternativi di TMDB (romaji, inglese, altre lingue in lettere latine), per la sessione. Servono
// quando TMDB trova un titolo con un nome che non mostra (cerchi «shingeki no kyojin» e TMDB dà «L'attacco
// dei giganti»): così l'ordine sa che corrisponde.
const altMem = new Map(); // key -> [titoli]
async function altTitles(list) {
  await Promise.all(list.filter((r) => !altMem.has(keyOf(r))).map(async (r) => {
    const k = keyOf(r);
    altMem.set(k, []);
    try {
      const d = await tm(`/${r.media_type}/${r.id}/alternative_titles`, { language: null });
      const names = (d?.results || d?.titles || []).map((x) => x?.title).filter((t) => t && !nonLatin(t));
      // originale in una scrittura che Simo non legge: il romaji va anche sotto il titolo
      if (nonLatin(r.original_title || r.original_name)) rememberRomaji(k, romajiFromTitles({ alternative_titles: d }, { loose: isAnimeResult(r) }));
      altMem.set(k, [...new Set(names)].slice(0, 30));
    } catch { altMem.delete(k); }
  }));
  for (const r of list) { const a = altMem.get(keyOf(r)); if (a?.length) st.aka.set(keyOf(r), [...new Set([...(st.aka.get(keyOf(r)) || []), ...a])]); }
}
const byPop = (a, b) => (b.popularity || 0) - (a.popularity || 0);
const strong = (r, q) => textScore(namesOf(r), q) >= 0.75;

// Quando niente di quello che ha dato TMDB somiglia a quello che hai scritto:
// 1. si guardano i titoli alternativi dei 6 risultati più conosciuti (il romaji di solito sta lì);
// 2. se ancora niente e hai scritto almeno 6 lettere (un errore di battitura: «shingeki no kiojin»,
//    «l'attaco dei giganti»), si cerca di nuovo con le due parole più lunghe, una per volta, e si tengono
//    i titoli quasi uguali a quello scritto (anche tra i loro titoli alternativi).
// Restituisce i risultati da aggiungere.
async function rescue(q, base, seen) {
  if (base.length) {
    await altTitles([...base].sort(byPop).slice(0, 6));
    if (base.some((r) => strong(r, q))) return [];
  }
  if (q.replace(/\s/g, '').length < 6) return [];
  const words = [...new Set(q.split(/\s+/).filter((w) => w.length >= 4 && w.toLowerCase() !== q.toLowerCase()))].sort((a, b) => b.length - a.length).slice(0, 2);
  for (const w of words) {
    const d = await tm('/search/multi', { query: w, include_adult: 'false' }).catch(() => null);
    const found = (d?.results || []).filter(keep).filter((r) => !seen.has(keyOf(r)));
    if (!found.length) continue;
    const top = found.sort(byPop).slice(0, 8);
    await altTitles(top.filter((r) => !strong(r, q)).slice(0, 6));
    const good = top.filter((r) => strong(r, q));
    if (good.length) { good.forEach((r) => seen.add(keyOf(r))); return good; }
  }
  return [];
}

async function runSearch() {
  const q = st.q.trim();
  const seq = ++st.seq;
  if (!q) { st.results = null; paint(); return; }
  st.results = null; st.error = '';
  paint();
  try {
    const ask = (page, language) => tm('/search/multi', { query: q, include_adult: 'false', page, language });
    let malDone = false;
    const malP = (q.length >= 3 ? searchMal(q).catch(() => null) : Promise.resolve(null)).then((m) => { malDone = true; return m; });
    const [p1, p2, e1, e2] = await Promise.all([ask(1), ask(2), ask(1, 'en-US').catch(() => null), ask(2, 'en-US').catch(() => null)]);
    if (seq !== st.seq) return;
    rememberEnglish([...(e1?.results || []), ...(e2?.results || [])]);
    const seen = new Set();
    const base = [...(p1?.results || []), ...(p2?.results || []), ...(e1?.results || [])].filter(keep).filter((r) => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!base.some((r) => strong(r, q))) {
      base.push(...await rescue(q, base, seen));
      if (seq !== st.seq) return;
    }
    const nTmdb = base.length; // i risultati di MyAnimeList aggiunti dopo non hanno una posizione TMDB
    const merge = (mal) => {
      const list = [...base];
      const have = new Set(seen);
      for (const h of mal || []) {
        st.aka.set(h.key, h.names);
        if (have.has(h.key)) continue;
        // un anime che TMDB non ha dato: si aggiunge solo se il titolo corrisponde davvero
        const [type, id] = h.key.split(':');
        // popolarità di un titolo medio: TMDB non l'ha data, ma MyAnimeList l'ha trovato
        const r = { id: Number(id), media_type: type, poster_path: h.p, genre_ids: [16], original_language: 'ja', origin_country: ['JP'], popularity: 20 };
        if (type === 'movie') Object.assign(r, { title: h.t, release_date: h.year ? `${h.year}` : '' });
        else Object.assign(r, { name: h.t, first_air_date: h.year ? `${h.year}` : '' });
        if (textScore(namesOf(r), q) >= 0.75) { have.add(h.key); list.push(r); }
      }
      return list.map((r, i) => ({ r, i, s: rankScore(r, q, namesOf(r), Math.min(i, nTmdb), nTmdb) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
    };
    // MyAnimeList ha già risposto? (una microattesa basta a saperlo)
    let mal = await withTimeout(malP, 0);
    if (!malDone && !base.length) mal = await withTimeout(malP, 6000);
    if (seq !== st.seq) return;
    st.results = merge(mal);
    paint();
    if (!malDone) {
      const shownAt = Date.now();
      malP.then((m) => {
        if (!m || seq !== st.seq) return;
        if (Date.now() - shownAt < LATE_MERGE_MS && window.scrollY < 60) st.results = merge(m);
        paint();
      });
    }
    return;
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
