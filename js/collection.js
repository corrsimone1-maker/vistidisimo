// Pezzi della «Collezione» di un titolo (la sezione è in js/views/collezione.js):
// - titoli che cominciano allo stesso modo («Vis a vis» → «Vis a vis: El oasis», «Narcos» → «Narcos:
//   Messico»), cercati su TMDB;
// - titolo, locandina e data dei titoli collegati che non sono in libreria (da TMDB);
// - collegamenti fatti a mano (`links` dell'item) e collegamenti automatici nascosti (`nolinks`), in
//   tutte e due le direzioni.
import { LS, item, metaOf, lib } from './store.js';
import { tm, tmdbToken, nonLatin, pool } from './tmdb.js';
import { isAnime, isAnimeResult } from './derive.js';

const DAY = 24 * 3600 * 1000;

// ---------- titoli che cominciano allo stesso modo ----------
// Separatori tra il nome della saga e il resto: «:», «|» e trattini lunghi o corti tra spazi (non il
// trattino di «Spider-Man»).
const SEP = /\s*[:|：]\s*|\s+[-–—]\s+/;
export const stemText = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// { raw: testo prima del separatore, stem: lo stesso normalizzato, cut: c'era un separatore }
export function stemOf(title) {
  const parts = (title || '').trim().split(SEP);
  return { raw: parts[0].trim(), stem: stemText(parts[0]), cut: parts.length > 1 };
}
const longEnough = (stem) => stem.replace(/ /g, '').length >= 4;

// Due titoli sono collegati se hanno lo stesso nome prima del separatore e almeno uno dei due ne ha
// uno: «Vis a vis» e «Vis a vis: El oasis» sì, due film che si chiamano tutti e due «Berlino» no.
// (fetchByTitle chiede anche la stessa lingua originale: un film francese «Vis-à-vis» non c'entra.)
export function sameStem(titlesA, titlesB) {
  for (const a of titlesA.filter(Boolean).map(stemOf)) {
    if (!longEnough(a.stem)) continue;
    for (const b of titlesB.filter(Boolean).map(stemOf)) if (a.stem === b.stem && (a.cut || b.cut)) return true;
  }
  return false;
}

// documentari, notiziari, reality e talk show non entrano
const NOT_WORKS = new Set([99, 10763, 10764, 10767]);
const TT_TTL = 7 * DAY;
let ttMem = null;
const ttCache = () => (ttMem ||= LS.get('vds.col.tt', {}) || {});
export function cachedByTitle(key) {
  const c = ttCache()[key];
  return c ? { k: c.k || [], stale: Date.now() - (c.at || 0) > TT_TTL } : null;
}

// Cerca su TMDB i titoli con lo stesso nome prima del separatore e la stessa lingua originale `lang`.
// names = [originale, italiano].
export async function fetchByTitle(key, names, lang) {
  const stems = [...new Map(names.filter(Boolean).map(stemOf).filter((s) => longEnough(s.stem)).map((s) => [s.stem, s])).values()];
  const found = new Map();
  for (const s of stems.slice(0, 2)) {
    const d = await tm('/search/multi', { query: s.raw, include_adult: 'false' });
    for (const r of d?.results || []) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const k = `${r.media_type}:${r.id}`;
      if (k === key || found.has(k)) continue;
      if ((r.genre_ids || []).some((g) => NOT_WORKS.has(g))) continue;
      if (lang && r.original_language && r.original_language !== lang) continue;
      const mine = !!item(k);
      if (!mine && ((r.vote_count || 0) < 10 || !r.poster_path)) continue;
      if (!sameStem(names, [r.original_title || r.original_name, r.title || r.name])) continue;
      found.set(k, r);
    }
  }
  const keys = [...found.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 12)
    .map((r) => { const k = `${r.media_type}:${r.id}`; rememberResult(k, r); return k; });
  const all = ttCache();
  all[key] = { k: keys, at: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > 400) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 400).forEach((x) => delete all[x]);
  LS.set('vds.col.tt', all);
  return keys;
}

// ---------- titolo, locandina e data ----------
// Dei titoli in libreria (o in meta.json) si usa quello che c'è già; degli altri si chiede a TMDB e si
// tiene sul telefono 30 giorni (`vds.col.tm`, ultimi 1500). { t, p, d, a } oppure { gone } se TMDB non
// lo conosce più.
const MINI_TTL = 30 * DAY;
let miniMem = null;
let miniTimer = null;
const miniCache = () => (miniMem ||= LS.get('vds.col.tm', {}) || {});
function saveMini() {
  clearTimeout(miniTimer);
  miniTimer = setTimeout(() => {
    const all = miniCache();
    const ks = Object.keys(all);
    if (ks.length > 1500) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 1500).forEach((k) => delete all[k]);
    LS.set('vds.col.tm', all);
  }, 400);
}
// co (solo film): saga di TMDB [id, nome], 0 se non ce l'ha, undefined se non si sa (i risultati di una
// ricerca non lo dicono, i dettagli sì). Serve alla Collezione per prendere tutta la saga di un film collegato.
export function rememberResult(k, r, en) {
  let t = r.title || r.name || '';
  if (nonLatin(t) && en && !nonLatin(en)) t = en;
  const old = miniCache()[k];
  const details = Array.isArray(r.genres);
  const co = k.startsWith('movie:') ? (details ? (r.belongs_to_collection ? [r.belongs_to_collection.id, r.belongs_to_collection.name || ''] : 0) : old?.co) : undefined;
  miniCache()[k] = {
    t, p: r.poster_path || null, d: r.release_date || r.first_air_date || '',
    a: isAnimeResult({ genre_ids: r.genre_ids || (r.genres || []).map((g) => g.id), original_language: r.original_language, origin_country: r.origin_country }),
    ...(co !== undefined ? { co } : {}),
    at: Date.now(),
  };
  saveMini();
}

// data di uscita di un titolo dai dati di meta.json
function metaDate(type, m) {
  if (!m) return '';
  if (type === 'movie') return m.rd || (m.y ? String(m.y) : '');
  return m.ad || (m.ss || []).filter((s) => s[0] > 0 && s[2]).map((s) => s[2]).sort()[0] || (m.y ? String(m.y) : '');
}

// { t, p, d, a, co, lib } oppure null se non si sa ancora
export function miniOf(key) {
  const [type] = key.split(':');
  const it = item(key); const m = metaOf(key);
  if (it || m) {
    const t = (m?.t && !nonLatin(m.t) ? m.t : '') || it?.title || m?.t || '';
    return { t, p: it?.poster || m?.p || null, d: metaDate(type, m) || (it?.year ? String(it.year) : ''), a: isAnime(it || {}, m), co: m?.co, lib: !!it };
  }
  const c = miniCache()[key];
  if (c && !c.gone) return c;
  return c?.gone ? { gone: true } : null;
}

const asking = new Set();
// Chiede a TMDB i titoli che mancano (6 alla volta), poi `done()`. Anche i film di cui non si sa ancora la
// saga (arrivati da una ricerca).
export function ensureMini(keys, done) {
  const now = Date.now();
  const todo = keys.filter((k) => {
    if (asking.has(k) || item(k) || metaOf(k)) return false;
    const c = miniCache()[k];
    return !c || now - c.at > MINI_TTL || (k.startsWith('movie:') && !c.gone && c.co === undefined);
  });
  if (!todo.length || !tmdbToken()) return;
  todo.forEach((k) => asking.add(k));
  pool(todo, 6, async (k) => {
    const [type, id] = k.split(':');
    try {
      const r = await tm(`/${type}/${id}`);
      if (!r) { miniCache()[k] = { gone: true, at: Date.now() }; saveMini(); return; }
      let en = null;
      if (nonLatin(r.title || r.name)) { const e = await tm(`/${type}/${id}`, { language: 'en-US' }).catch(() => null); en = e?.title || e?.name || null; }
      rememberResult(k, r, en);
    } finally { asking.delete(k); }
  }).finally(done);
}

// ---------- collegamenti a mano ----------
// `links` = titoli collegati a mano, `nolinks` = collegamenti automatici nascosti. Valgono in tutte e due
// le direzioni: se «A» ha «B» in links, «B» mostra «A».
export function manualOf(key) {
  const add = new Set(item(key)?.links || []);
  const hide = new Set(item(key)?.nolinks || []);
  for (const [k, it] of Object.entries(lib()?.items || {})) {
    if (k === key) continue;
    if (it.links?.includes(key)) add.add(k);
    if (it.nolinks?.includes(key)) hide.add(k);
  }
  for (const k of hide) add.delete(k);
  add.delete(key);
  return { add, hide };
}
