// Pezzi della «Collezione» di un titolo (la sezione è in js/views/collezione.js):
// - titoli con gli stessi personaggi fatti dagli stessi attori (spin-off, seguiti, film di una serie);
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

// ---------- stessi personaggi (spin-off, seguiti, film di una serie) ----------
// Uno spin-off o un seguito ha gli stessi personaggi fatti dagli stessi attori (Pedro Alonso è Berlino nella
// Casa di carta, in Berlino e in Berlino e la dama con l'ermellino; Junko Takeuchi è la voce di Naruto
// Uzumaki in Naruto, Shippuden, Boruto e nei film). Due serie diverse degli stessi autori invece no: Alba
// Flores è Saray in Vis a vis e Nairobi nella Casa di carta. Dati di TMDB (cast con i nomi dei personaggi),
// cercati dal vivo: si prendono gli attori principali del titolo, i loro altri ruoli, e si tengono i titoli
// dove fanno **lo stesso personaggio**. Funziona per film, serie e anime, senza altre fonti.
// Risultato sul telefono `vds.col.cast` per 7 giorni; i ruoli degli attori solo in memoria (sono tanti).
const CAST_TTL = 7 * DAY;
// quanti attori principali: nelle serie quelli con almeno un quinto degli episodi del primo (Pedro Alonso nella
// Casa di carta ne ha meno di una decina di altri, ma è Berlino), fino a 15; nei film i primi 10
const MAIN_TV = 15;
const MAIN_MOVIE = 10;
// parole che non dicono chi è il personaggio («Self», «Narrator», «Young Mike»…)
const GENERIC = new Set(('self himself herself themselves yourself narrator narratore narrador voice voices voce additional host '
  + 'guest various uncredited archive footage young younger older old little man woman men women boy girl kid kids child children baby '
  + 'police officer doctor dottore nurse student students teacher mother father mom dad brother sister son daughter wife husband '
  + 'king queen prince princess soldier guard cameo presenter judge contestant reporter announcer unknown the and his her mrs miss '
  + 'stesso stessa mismo misma lui lei ella professor profesor professore detective agent agente captain capitano lieutenant sergeant '
  + 'general president doctor customer waiter waitress driver friend friends neighbor neighbour villager citizen people crowd extra '
  + 'singer dancer member members student guest_star episode episodes adult teen teenager boss chief inspector ispettore commissario').split(/\s+/));
// nomi propri troppo comuni per bastare da soli («Michael» in due serie diverse)
const COMMON = new Set(('john james michael david robert william richard thomas mark paul peter george jack daniel joseph charles '
  + 'mary anna maria sarah laura julia emma lisa jennifer jessica elizabeth susan karen nancy linda carlos juan jose luis antonio '
  + 'marco luca giuseppe francesco giovanni alessandro andrea sofia chiara elena martina giulia kevin ryan chris nick mike alex '
  + 'sam ben tom max steve tony frank henry harry eric adam jake luke matt josh anne kate jane alice lucy sara pablo javier miguel '
  + 'manuel pedro diego jorge alberto roberto mario paolo stefano matteo lorenzo').split(/\s+/));
const noise = /\((?:voice|uncredited|archive footage|credit only|singing voice|english version|japanese version|young|adult|child)[^)]*\)/gi;
// Le varianti di un personaggio («Andrés de Fonollosa / Berlín» → due varianti), ognuna come insieme di parole.
export function charNames(s) {
  return (s || '').replace(noise, ' ').split(/\s*(?:\/|;|\||\baka\b)\s*/i)
    .map((alt) => new Set(stemText(alt).split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w))))
    .filter((set) => set.size > 0);
}
// Stesso personaggio: stesse parole, oppure almeno due parole in comune, oppure un nome solo (soprannome)
// che compare nell'altro e non è un nome proprio comunissimo.
export function sameCharacter(a, b) {
  for (const A of charNames(a)) {
    for (const B of charNames(b)) {
      const shared = [...A].filter((w) => B.has(w));
      if (!shared.length) continue;
      if (shared.length >= 2 || (shared.length === A.size && shared.length === B.size && !(A.size === 1 && COMMON.has(shared[0])))) return true;
      if ((A.size === 1 || B.size === 1) && shared[0].length >= 4 && !COMMON.has(shared[0])) return true;
    }
  }
  return false;
}
let castMem = null;
const castCache = () => (castMem ||= LS.get('vds.col.cast', {}) || {});
export function cachedByCast(key) {
  const c = castCache()[key];
  return c ? { k: c.k || [], stale: Date.now() - (c.at || 0) > CAST_TTL } : null;
}
const people = new Map(); // id attore -> Promise dei suoi ruoli (per la sessione)
const rolesOf = (pid) => {
  if (!people.has(pid)) people.set(pid, tm(`/person/${pid}/combined_credits`).then((d) => d?.cast || []).catch(() => { people.delete(pid); return []; }));
  return people.get(pid);
};
// Gli attori principali di un titolo: [{ id, ch, top }] (top = tra i primi 3)
async function mainCast(type, id) {
  if (type === 'tv') {
    const d = await tm(`/tv/${id}/aggregate_credits`);
    const cast = (d?.cast || []).map((c) => ({ id: c.id, ch: (c.roles || []).map((r) => r.character).filter(Boolean).join(' / '), n: c.total_episode_count || 0 }))
      .filter((c) => charNames(c.ch).length)
      .sort((a, b) => b.n - a.n);
    const min = Math.max(2, (cast[0]?.n || 0) / 5);
    return cast.filter((c, i) => i < 3 || c.n >= min).slice(0, MAIN_TV).map((c, i) => ({ id: c.id, ch: c.ch, top: i < 3 }));
  }
  const d = await tm(`/movie/${id}/credits`);
  const cast = (d?.cast || []).filter((c) => charNames(c.character).length).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return cast.slice(0, MAIN_MOVIE).map((c, i) => ({ id: c.id, ch: c.character, top: i < 3 }));
}
// I titoli dove gli attori principali di `key` fanno lo stesso personaggio: array di chiavi, dal più
// legato (più attori in comune) al meno. Si scartano le comparsate (1 episodio) e i programmi che non
// sono opere (talk show, documentari…).
export async function fetchByCast(key) {
  const [type, id] = key.split(':');
  const cast = await mainCast(type, Number(id));
  const found = new Map(); // chiave -> { r, score }
  await Promise.all(cast.map(async (c) => {
    for (const r of await rolesOf(c.id)) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const k = `${r.media_type}:${r.id}`;
      if (k === key || (r.genre_ids || []).some((g) => NOT_WORKS.has(g))) continue;
      if (r.media_type === 'tv' && (r.episode_count || 0) < 2) continue;
      if (!sameCharacter(c.ch, r.character)) continue;
      const f = found.get(k) || { r, score: 0, who: new Set() };
      if (f.who.has(c.id)) continue;
      f.who.add(c.id);
      f.score += c.top ? 2 : 1;
      found.set(k, f);
    }
  }));
  const keys = [...found.entries()]
    .sort((a, b) => b[1].score - a[1].score || (b[1].r.popularity || 0) - (a[1].r.popularity || 0))
    .slice(0, 30)
    .map(([k, f]) => { if (!item(k) && !metaOf(k)) rememberResult(k, f.r); return k; });
  const all = castCache();
  all[key] = { k: keys, at: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > 400) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 400).forEach((x) => delete all[x]);
  LS.set('vds.col.cast', all);
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
