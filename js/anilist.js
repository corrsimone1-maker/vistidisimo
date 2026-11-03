// Film, OVA, speciali e spin-off di un anime, da AniList (API pubblica, gratuita, senza chiave).
//
// TMDB non collega una serie anime ai suoi film e OVA; AniList sì, con le «relazioni» (seguito, prequel,
// storia parallela…). Qui si trova l'anime su AniList, si seguono le relazioni e ogni film/OVA trovato si
// collega al titolo TMDB corrispondente (così si sa se è in libreria e si apre nell'app). Si seguono solo
// le parti della stessa serie: il prequel o il seguito che su TMDB è un'altra serie (Naruto → Naruto
// Shippuden → Boruto) non si allarga, ma i film collegati direttamente restano.
//
// Le risposte si tengono sul telefono (`vds.al.fr` per serie, `vds.al.map` per i collegamenti a TMDB):
// AniList permette circa 30 richieste al minuto.
import { searchTmdb } from './tmdb.js';
import { LS } from './store.js';

const API = 'https://graphql.anilist.co';
const DAY = 24 * 3600 * 1000;
const FR_TTL = 7 * DAY; // elenco dei film e OVA di una serie
const FR_VER = 2; // 2: anche gli spin-off in forma di serie TV e gli id MyAnimeList (per i filler)
const HIT_TTL = 120 * DAY; // collegamento a TMDB trovato
const MISS_TTL = 14 * DAY; // non trovato: si riprova dopo un po'

// relazioni che allargano la ricerca e relazioni che si mostrano soltanto
const FOLLOW = new Set(['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY']);
const LEAF = new Set(['SPIN_OFF', 'SUMMARY', 'COMPILATION', 'ALTERNATIVE']);
// formati che si mostrano (le serie TV della stessa saga sono le stagioni della serie stessa)
export const SHOW = new Set(['MOVIE', 'OVA', 'ONA', 'SPECIAL', 'TV_SHORT']);
// le serie TV si mostrano solo se sono uno spin-off (o una storia parallela) che su TMDB è un'altra
// serie: Magia Record in Madoka Magica (chiesto da Simo, 3/11/2026)
const SPIN_TV = new Set(['SPIN_OFF', 'SIDE_STORY']);
const SERIESLIKE = new Set(['TV', 'TV_SHORT', 'ONA']);
export const FORMAT_LABEL = { MOVIE: 'Film', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Speciale', TV_SHORT: 'Corti', TV: 'Spin-off' };
const MAX_NODES = 160;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AniListError extends Error {}

async function gql(query, variables) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    } catch {
      if (attempt === 2) throw new AniListError('AniList non è raggiungibile');
      await sleep(1000 * (attempt + 1));
      continue;
    }
    // troppe richieste: AniList blocca per un minuto, inutile insistere
    if (r.status === 429) throw new AniListError('AniList chiede di aspettare un minuto');
    if (r.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new AniListError(`AniList ha risposto ${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new AniListError(j.errors[0].message || 'Errore di AniList');
    return j.data;
  }
  throw new AniListError('AniList non risponde');
}

const FIELDS = 'id idMal type format isAdult startDate { year month day } title { romaji english native } coverImage { large } siteUrl';
const Q_SEARCH = `query ($q: String) { Page(perPage: 10) { media(search: $q, type: ANIME) { ${FIELDS} } } }`;
const Q_NODES = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${FIELDS} relations { edges { relationType(version: 2) node { id type format isAdult } } } } } }`;

// ---- confronto dei titoli ----
export function norm(s) {
  return (s || '').normalize('NFKC').toLowerCase()
    .replace(/[\s\-‐-―_:;,.!?¡¿'"’‘“”«»()[\]{}【】「」『』〈〉《》・~〜☆★♪&+/\\|]/g, '');
}
// somiglianza (coefficiente di Dice sulle coppie di caratteri), da 0 a 1
export function sim(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const gx = grams(x); const gy = grams(y);
  let both = 0;
  for (const [g, n] of gx) both += Math.min(n, gy.get(g) || 0);
  return (2 * both) / (x.length - 1 + y.length - 1);
}

const ymd = (d) => (d?.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '');
const titles = (n) => [n.title?.native, n.title?.english, n.title?.romaji].filter(Boolean);

// ---- AniList → TMDB ----
// Il titolo TMDB di un elemento AniList: { key, t, p } oppure null. Cerca con il titolo giapponese, poi
// inglese, poi romaji; accetta solo animazione con titolo simile e anno vicino (±1). `anyYear`: per
// capire se una serie TV AniList è una stagione della serie TMDB, l'anno non conta.
async function findTmdb(n, { anyYear = false } = {}) {
  const year = n.startDate?.year || null;
  const types = n.format === 'MOVIE' ? ['movie'] : SERIESLIKE.has(n.format) ? ['tv'] : ['tv', 'movie'];
  let best = null;
  for (const q of [...new Set(titles(n))]) {
    for (const type of types) {
      const res = await searchTmdb(type, q).catch(() => []);
      for (const r of res.slice(0, 8)) {
        if (!(r.genre_ids || []).includes(16)) continue;
        const ry = Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null;
        const yearOk = year && ry ? Math.abs(ry - year) <= 1 : false;
        if (!yearOk && !anyYear) continue;
        const s = Math.max(
          sim(r.original_title || r.original_name, n.title?.native),
          sim(r.title || r.name, n.title?.english), sim(r.title || r.name, n.title?.romaji),
          sim(r.original_title || r.original_name, n.title?.romaji),
        );
        const score = s + (yearOk ? 0.05 : 0);
        if (s >= (anyYear && !yearOk ? 0.8 : 0.6) && (!best || score > best.score)) {
          best = { score, key: `${type}:${r.id}`, t: r.title || r.name || '', p: r.poster_path || null };
        }
      }
      if (best && best.score >= 0.95) return best;
    }
  }
  return best;
}

function mapCache() { return LS.get('vds.al.map', {}) || {}; }
async function mapToTmdb(n, opts) {
  const c = mapCache();
  const hit = c[n.id];
  if (hit && Date.now() - hit.at < (hit.k ? HIT_TTL : MISS_TTL)) return hit.k ? { key: hit.k, t: hit.t, p: hit.p } : null;
  const b = await findTmdb(n, opts);
  const all = mapCache();
  all[n.id] = b ? { k: b.key, t: b.t, p: b.p, at: Date.now() } : { k: null, at: Date.now() };
  LS.set('vds.al.map', all);
  return b;
}

// ---- la serie su AniList ----
// m: dati TMDB della serie (meta.json): t titolo, ot originale, y anno della prima puntata.
async function findStart(m, fallbackTitle) {
  const qs = [...new Set([m?.ot, m?.t, fallbackTitle].filter(Boolean))];
  for (const q of qs) {
    const d = await gql(Q_SEARCH, { q });
    const res = (d?.Page?.media || []).filter((x) => !x.isAdult && SERIESLIKE.has(x.format));
    const ok = res.filter((x) => x.startDate?.year && m?.y && Math.abs(x.startDate.year - m.y) <= 1)
      .map((x) => ({ x, s: Math.max(...titles(x).map((t) => Math.max(sim(t, m?.ot), sim(t, m?.t), sim(t, fallbackTitle)))) + (x.startDate.year === m.y ? 0.05 : 0) }))
      .filter((y) => y.s >= 0.5)
      .sort((a, b) => b.s - a.s);
    if (ok.length) return ok[0].x;
  }
  return null;
}

// Tutti i film/OVA/speciali (e gli spin-off) collegati alla serie TMDB `key` (es. «tv:31910»), in ordine
// di uscita. Risultato: { v, at, start, mal, items: [{ al, f, d, t, c, u, rel, key, tt, tp }] } — al id
// AniList, f formato, d data, t titolo (inglese o romaji), c copertina AniList, u pagina AniList,
// key/tt/tp titolo TMDB se trovato; mal = id MyAnimeList delle parti AniList che sono questa serie.
export async function fetchFranchise(key, m, fallbackTitle) {
  const tvId = Number(key.split(':')[1]);
  const start = await findStart(m, fallbackTitle);
  if (!start) return { v: FR_VER, at: Date.now(), items: [], none: true };
  const nodes = new Map([[start.id, { ...start, rel: 'START' }]]);
  const fetched = new Set();
  const show = new Map(); // id -> relazione con cui è arrivato
  const same = new Set([start.id]); // parti AniList che su TMDB sono questa stessa serie
  // A ogni giro si scaricano (con le loro relazioni) gli elementi raggiunti da una relazione «di
  // famiglia». Si allargano il punto di partenza, i film/OVA/speciali e le serie TV che su TMDB sono
  // questa stessa serie (una stagione divisa su AniList); le altre serie TV (prequel, seguito) no.
  let toFetch = [start.id];
  for (let depth = 0; depth < 12 && toFetch.length; depth++) {
    const got = [];
    for (let i = 0; i < toFetch.length; i += 50) {
      const d = await gql(Q_NODES, { ids: toFetch.slice(i, i + 50) });
      for (const x of d?.Page?.media || []) {
        fetched.add(x.id);
        nodes.set(x.id, { ...nodes.get(x.id), ...x });
        got.push(nodes.get(x.id));
      }
    }
    for (const id of toFetch) fetched.add(id);
    const next = [];
    for (const x of got) {
      if (x.id !== start.id && x.format === 'TV') {
        const t = await mapToTmdb(x, { anyYear: true });
        if (t?.key !== `tv:${tvId}`) continue;
        same.add(x.id);
      }
      for (const e of x.relations?.edges || []) {
        const n = e.node;
        if (!n || n.type !== 'ANIME' || n.isAdult || n.format === 'MUSIC') continue;
        const follow = FOLLOW.has(e.relationType); const leaf = LEAF.has(e.relationType);
        if (!follow && !leaf) continue;
        if (!nodes.has(n.id)) nodes.set(n.id, { ...n, rel: e.relationType });
        const shown = SHOW.has(n.format) || (n.format === 'TV' && SPIN_TV.has(e.relationType));
        if (shown && !show.has(n.id) && n.id !== start.id) show.set(n.id, e.relationType);
        if (follow && !fetched.has(n.id) && !next.includes(n.id) && nodes.size < MAX_NODES) next.push(n.id);
      }
    }
    toFetch = next;
  }
  // dati mancanti (nodi visti solo come relazione: scaricati per titolo, data e copertina)
  const missing = [...show.keys()].filter((id) => !nodes.get(id)?.title);
  for (let i = 0; i < missing.length; i += 50) {
    const d = await gql(Q_NODES, { ids: missing.slice(i, i + 50) });
    for (const x of d?.Page?.media || []) nodes.set(x.id, { ...nodes.get(x.id), ...x });
  }
  const list = [...show.keys()].map((id) => nodes.get(id)).filter((n) => n?.title && !same.has(n.id));
  const items = list.map((n) => ({
    al: n.id, f: n.format, d: ymd(n.startDate), t: n.title.english || n.title.romaji || n.title.native || '',
    c: n.coverImage?.large || null, u: n.siteUrl || `https://anilist.co/anime/${n.id}`, rel: show.get(n.id),
  }));
  // collegamento a TMDB, 4 alla volta
  const drop = new Set();
  let i = 0;
  const work = async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        const t = await mapToTmdb(list[idx]);
        if (t && t.key !== `tv:${tvId}`) Object.assign(items[idx], { key: t.key, tt: t.t, tp: t.p });
        else if (t && list[idx].format === 'TV') drop.add(idx); // è questa serie, non uno spin-off
      } catch { /* resta senza */ }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  const keys = new Set();
  const out = items.filter((_, idx) => !drop.has(idx))
    .sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999') || a.t.localeCompare(b.t))
    // lo stesso titolo TMDB da più voci AniList (es. le stagioni di uno spin-off): una carta sola
    .filter((x) => !x.key || (keys.has(x.key) ? false : keys.add(x.key)));
  const mal = [...new Set([...same].map((id) => nodes.get(id)?.idMal).filter(Boolean))];
  return { v: FR_VER, at: Date.now(), start: start.id, mal, items: out };
}

// ---- cache per serie ----
export function cachedFranchise(key) {
  const all = LS.get('vds.al.fr', {}) || {};
  const v = all[key];
  // una copia di una versione precedente si mostra, ma si riscarica subito
  return v ? { ...v, stale: v.v !== FR_VER || Date.now() - (v.at || 0) > FR_TTL } : null;
}
export function saveFranchise(key, v) {
  const all = LS.get('vds.al.fr', {}) || {};
  all[key] = v;
  // tiene le 60 serie aperte più di recente
  const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const k of keys.slice(60)) delete all[k];
  LS.set('vds.al.fr', all);
}
