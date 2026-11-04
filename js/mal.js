// Film, OVA, speciali, spin-off e serie prima e dopo di un anime, da MyAnimeList (tramite Jikan, vedi
// js/jikan.js), per la «Collezione» della serie (js/views/collezione.js).
//
// TMDB non collega una serie anime ai suoi film e OVA; MyAnimeList sì, con le «relazioni» (seguito,
// prequel, storia parallela, spin-off…). Qui si trova l'anime su MyAnimeList, si seguono le relazioni e
// ogni voce trovata si collega al titolo TMDB corrispondente (così si sa se è in libreria e si apre
// nell'app). Si allargano solo le parti della stessa serie: il prequel o il seguito che su TMDB è
// un'altra serie (Naruto → Naruto Shippuden → Boruto) si mostra ma non si allarga, e i film collegati
// direttamente restano.
//
// MyAnimeList non dice il tipo (film, OVA, serie) di un titolo collegato: ogni voce si scarica a parte
// (`/anime/{id}/full`, che porta anche le sue relazioni). Per questo le voci restano sul telefono 30
// giorni (`vds.mal.node`), l'elenco di ogni serie 7 giorni (`vds.mal.fr`) e i collegamenti a TMDB 120
// giorni (`vds.mal.map`, non trovati 14).
import { searchTmdb } from './tmdb.js';
import { LS } from './store.js';
import { jikan, jikanDown } from './jikan.js';

const DAY = 24 * 3600 * 1000;
const FR_TTL = 7 * DAY; // elenco dei film e OVA di una serie
const NODE_TTL = 30 * DAY; // una voce di MyAnimeList (titoli, tipo, data, relazioni)
const HIT_TTL = 120 * DAY; // collegamento a TMDB trovato
const MISS_TTL = 14 * DAY; // non trovato: si riprova dopo un po'
const FR_VER = 2;
const MAX_NODES = 80; // voci scaricate al massimo per una serie

// cache di una versione precedente di «Film e OVA», non più usate: si tolgono dal telefono
for (const k of ['vds.al.fr', 'vds.al.map']) LS.del(k);

// relazioni (nomi di MyAnimeList) che allargano la ricerca e relazioni che si mostrano soltanto
const FOLLOW = new Set(['Sequel', 'Prequel', 'Parent Story', 'Side Story']);
const LEAF = new Set(['Spin-Off', 'Summary', 'Alternative Version', 'Alternative Setting']);
// formati che si mostrano sempre
const SHOW = new Set(['Movie', 'OVA', 'ONA', 'Special', 'TV Special']);
// le serie TV si mostrano se su TMDB sono un'altra serie (quelle che su TMDB sono questa stessa serie
// sono sue stagioni): seguiti e prequel («Serie»), spin-off e storie parallele («Spin-off», es. Magia
// Record in Madoka Magica, chiesto da Simo il 3/11/2026). Uno spin-off che TMDB non ha resta come link
// a MyAnimeList; un seguito che TMDB non ha no (di solito è una stagione che non si è riusciti a collegare).
const SPIN_TV = new Set(['Spin-Off', 'Side Story']);
const SERIESLIKE = new Set(['TV', 'ONA']);
export const FORMAT_LABEL = { Movie: 'Film', OVA: 'OVA', ONA: 'ONA', Special: 'Speciale', 'TV Special': 'Speciale', TV: 'Spin-off' };

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

// ---- una voce di MyAnimeList, ridotta a quello che serve ----
// { id, type, date, year, ja, en, ro, img, url, adult, rel: [[relazione, id]] } (solo anime)
function slim(a) {
  const date = (a.aired?.from || '').slice(0, 10);
  return {
    id: a.mal_id, type: a.type || '', date, year: Number(date.slice(0, 4)) || a.year || null,
    ja: a.title_japanese || null, en: a.title_english || null, ro: a.title || null,
    img: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
    url: typeof a.url === 'string' && a.url.startsWith('https://myanimelist.net/') ? a.url : `https://myanimelist.net/anime/${a.mal_id}`,
    adult: /^Rx/.test(a.rating || ''),
    rel: (a.relations || []).flatMap((g) => (g.entry || []).filter((e) => e.type === 'anime').map((e) => [g.relation, e.mal_id])),
  };
}
const titles = (n) => [n.ja, n.en, n.ro].filter(Boolean);

// le voci restano in memoria e si salvano sul telefono mezzo secondo dopo l'ultima arrivata
let nodeMem = null;
let saveTimer = null;
const nodeCache = () => (nodeMem ||= LS.get('vds.mal.node', {}) || {});
function saveNodes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = nodeCache();
    // tiene le 1500 voci viste più di recente
    const ks = Object.keys(all);
    if (ks.length > 1500) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 1500).forEach((k) => delete all[k]);
    LS.set('vds.mal.node', all);
  }, 500);
}
// key: il titolo per cui serve (le richieste del titolo aperto passano prima, vedi js/jikan.js)
async function getNode(id, key) {
  const c = nodeCache()[id];
  if (c && Date.now() - c.at < NODE_TTL) return c;
  const j = await jikan(`/anime/${id}/full`, { key });
  if (!j?.data) return null;
  const n = { ...slim(j.data), at: Date.now() };
  nodeCache()[id] = n;
  saveNodes();
  return n;
}

// ---- MyAnimeList → TMDB ----
// Il titolo TMDB di una voce: { key, t, p } oppure null. Cerca con il titolo giapponese, poi inglese,
// poi romaji; accetta solo animazione con titolo simile e anno vicino (±1). `anyYear`: per capire se una
// serie TV di MyAnimeList è una stagione della serie TMDB, l'anno non conta.
async function findTmdb(n, { anyYear = false } = {}) {
  const year = n.year || null;
  const types = n.type === 'Movie' ? ['movie'] : SERIESLIKE.has(n.type) ? ['tv'] : ['tv', 'movie'];
  let best = null;
  // tutte le ricerche insieme (prima si facevano una dopo l'altra: lento)
  const asks = [...new Set(titles(n))].flatMap((q) => types.map((type) => [q, type]));
  const answers = await Promise.all(asks.map(([q, type]) => searchTmdb(type, q).then((res) => [type, res]).catch(() => [type, []])));
  for (const [type, res] of answers) {
    for (const r of res.slice(0, 8)) {
      if (!(r.genre_ids || []).includes(16)) continue;
      const ry = Number((r.release_date || r.first_air_date || '').slice(0, 4)) || null;
      const yearOk = year && ry ? Math.abs(ry - year) <= 1 : false;
      if (!yearOk && !anyYear) continue;
      const s = Math.max(
        sim(r.original_title || r.original_name, n.ja),
        sim(r.title || r.name, n.en), sim(r.title || r.name, n.ro),
        sim(r.original_title || r.original_name, n.ro),
      );
      const score = s + (yearOk ? 0.05 : 0);
      if (s >= (anyYear && !yearOk ? 0.8 : 0.6) && (!best || score > best.score)) {
        best = { score, key: `${type}:${r.id}`, t: r.title || r.name || '', p: r.poster_path || null };
      }
    }
  }
  return best;
}

function mapCache() { return LS.get('vds.mal.map', {}) || {}; }
// collegamento già noto (senza chiedere niente): { key, t, p }, null = non c'è, undefined = non si sa
function knownMap(id) {
  const hit = mapCache()[id];
  if (!hit || Date.now() - hit.at >= (hit.k ? HIT_TTL : MISS_TTL)) return undefined;
  return hit.k ? { key: hit.k, t: hit.t, p: hit.p } : null;
}
async function mapToTmdb(n, opts) {
  const hit = mapCache()[n.id];
  if (hit && Date.now() - hit.at < (hit.k ? HIT_TTL : MISS_TTL)) return hit.k ? { key: hit.k, t: hit.t, p: hit.p } : null;
  const b = await findTmdb(n, opts);
  const all = mapCache();
  all[n.id] = b ? { k: b.key, t: b.t, p: b.p, at: Date.now() } : { k: null, at: Date.now() };
  LS.set('vds.mal.map', all);
  return b;
}

// ---- un titolo TMDB su MyAnimeList ----
// names: titoli TMDB (originale, italiano…), year: anno di uscita, kinds: tipi di MyAnimeList ammessi,
// key: il titolo TMDB per cui si cerca (precedenza nella fila di Jikan).
async function findMal(names, year, kinds, key) {
  const qs = [...new Set(names.filter(Boolean))];
  for (const q of qs) {
    const d = await jikan(`/anime?q=${encodeURIComponent(q)}&limit=15`, { key });
    const res = (d?.data || []).map(slim).filter((x) => !x.adult && kinds.has(x.type));
    const ok = res.filter((x) => x.year && year && Math.abs(x.year - year) <= 1)
      .map((x) => ({ x, s: Math.max(...titles(x).map((t) => Math.max(...qs.map((n) => sim(t, n))))) + (x.year === year ? 0.05 : 0) }))
      .filter((y) => y.s >= 0.5)
      .sort((a, b) => b.s - a.s);
    if (ok.length) return ok[0].x;
  }
  return null;
}
// La serie: m = dati TMDB della serie (meta.json): t titolo, ot originale, y anno della prima puntata.
const findStart = (m, fallbackTitle, key) => findMal([m?.ot, m?.t, fallbackTitle], m?.y, SERIESLIKE, key);
const MOVIELIKE = new Set(['Movie', 'OVA', 'Special', 'TV Special', 'ONA']);

// ---- titolo romaji degli anime (es. «Shingeki no Kyojin»), al posto dell'originale in giapponese ----
// È il titolo principale di MyAnimeList. Sul telefono in `vds.mal.ro` (trovato 180 giorni, no 14).
const RO_HIT = 180 * DAY;
const RO_MISS = 14 * DAY;
let roMem = null;
const roCache = () => (roMem ||= LS.get('vds.mal.ro', {}) || {});
function saveRo(key, r) {
  const all = roCache();
  all[key] = { r: r || '', at: Date.now() };
  LS.set('vds.mal.ro', all);
}
export function romajiOf(key) { return roCache()[key]?.r || ''; }
// Romaji trovato altrove (titoli alternativi di TMDB): si salva solo se MyAnimeList non ne ha già dato uno.
export function rememberRomaji(key, r) { if (r && !romajiOf(key)) saveRo(key, r); }
const roTried = new Set();
// Cerca il romaji di `key` se non c'è ancora; `done` ridisegna. Per le serie lo trova «Film e OVA»
// (si legge dalla serie già trovata); per i film una ricerca su MyAnimeList.
export function ensureRomaji(key, { ot, t, y }, done) {
  const c = roCache()[key];
  if ((c && Date.now() - c.at < (c.r ? RO_HIT : RO_MISS)) || roTried.has(key)) return;
  const [type] = key.split(':');
  if (type === 'tv') {
    const fr = cachedFranchise(key);
    const n = fr?.start ? nodeCache()[fr.start] : null;
    if (n?.ro) { roTried.add(key); saveRo(key, n.ro); done(); }
    return; // altrimenti lo salva fetchFranchise
  }
  if (jikanDown()) return; // il romaji arriva comunque dai titoli alternativi di TMDB (pagina del titolo)
  roTried.add(key);
  findMal([ot, t], Number(y) || null, MOVIELIKE, key)
    .then((n) => { saveRo(key, n?.ro || ''); done(); })
    .catch(() => {});
}

// ---- ricerca in qualunque lingua (romaji, inglese, giapponese) ----
// I primi anime che MyAnimeList trova per `q`, collegati a TMDB: [{ key, t, p, year, names }] nell'ordine
// di MyAnimeList. Salva anche il loro romaji.
// Se MyAnimeList non trova niente che somigli (un errore di battitura, «shingeki no kiojin»), si cerca
// con le due parole più lunghe una per volta e si tengono i titoli simili a quello scritto (Dice ≥ 0,7).
export async function searchMal(q) {
  if (jikanDown()) return null;
  const ask = async (text) => {
    const d = await jikan(`/anime?q=${encodeURIComponent(text)}&limit=10`, { prio: 0 });
    return (d?.data || []).map(slim).filter((n) => !n.adult && (SERIESLIKE.has(n.type) || n.type === 'Movie'));
  };
  const close = (n) => titles(n).some((t) => sim(t, q) >= 0.7 || norm(t).includes(norm(q)));
  let found = await ask(q);
  if (!found.some(close)) {
    const words = [...new Set(q.split(/\s+/).filter((w) => w.length >= 4))].sort((a, b) => b.length - a.length).slice(0, 2);
    for (const w of words) {
      if (w.toLowerCase() === q.trim().toLowerCase()) continue;
      const more = (await ask(w)).filter(close);
      if (more.length) { found = more; break; }
    }
  }
  const hits = found.slice(0, 4);
  const out = await Promise.all(hits.map(async (n) => {
    try {
      const t = await mapToTmdb(n);
      if (!t) return null;
      if (n.ro) saveRo(t.key, n.ro);
      return { key: t.key, t: t.t, p: t.p, year: n.year, names: titles(n) };
    } catch { return null; }
  }));
  return out.filter(Boolean);
}

// Tutti i film/OVA/speciali, gli spin-off e le serie prima e dopo collegati alla serie TMDB `key` (es.
// «tv:31910»), in ordine di uscita. Risultato: { v, at, start, mal, items: [{ id, f, l, d, t, c, u, rel,
// key, tt, tp }] } — id e pagina (u) di MyAnimeList, f tipo, l etichetta («Film», «OVA», «Serie»,
// «Spin-off»…), d data, t titolo (inglese o romaji), c copertina, key/tt/tp titolo TMDB se trovato;
// mal = id MyAnimeList delle parti che su TMDB sono questa stessa serie (per i filler).
// onPartial(dati): mentre le voci arrivano (MyAnimeList ne dà meno di una al secondo) si mostra quello che
// c'è già, ogni 2 secondi: film, OVA e speciali col collegamento a TMDB se è già noto.
export async function fetchFranchise(key, m, fallbackTitle, onPartial) {
  const tvId = Number(key.split(':')[1]);
  const found = await findStart(m, fallbackTitle, key);
  if (!found) return { v: FR_VER, at: Date.now(), items: [], none: true };
  if (found.ro) saveRo(key, found.ro);
  const nodes = new Map();
  const same = new Set([found.id]); // parti di MyAnimeList che su TMDB sono questa stessa serie
  const rels = new Map(); // id -> relazioni con cui è arrivato
  const expanded = new Set();
  const load = async (id) => {
    if (nodes.has(id)) return nodes.get(id);
    if (nodes.size >= MAX_NODES) return null;
    nodes.set(id, null);
    const n = await getNode(id, key).catch((e) => { if (id === found.id) throw e; return null; });
    nodes.set(id, n);
    partial();
    return n;
  };
  // quello che c'è finora (solo film, OVA e speciali: le serie TV si decidono alla fine)
  let lastPartial = 0;
  const partial = (force) => {
    if (!onPartial || (!force && Date.now() - lastPartial < 2000)) return;
    lastPartial = Date.now();
    const keys = new Set();
    const items = [...rels.keys()].map((id) => nodes.get(id)).filter((n) => n && !n.adult && !same.has(n.id) && SHOW.has(n.type))
      .map((n) => {
        const t = knownMap(n.id);
        const x = { id: n.id, f: n.type, d: n.date, t: n.en || n.ro || n.ja || '', c: n.img, u: n.url, l: FORMAT_LABEL[n.type] || n.type };
        return t && t.key !== `tv:${tvId}` ? { ...x, key: t.key, tt: t.t, tp: t.p } : x;
      })
      .sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999') || a.t.localeCompare(b.t))
      .filter((x) => !x.key || (keys.has(x.key) ? false : keys.add(x.key)));
    try { onPartial({ v: FR_VER, at: Date.now(), start: found.id, mal: [...same], items, partial: true }); } catch { /* niente */ }
  };
  // A ogni giro si scaricano le voci raggiunte da una relazione «di famiglia» e si allargano: il punto
  // di partenza, i film/OVA/speciali e le serie TV che su TMDB sono questa stessa serie (una stagione
  // divisa su MyAnimeList); le altre serie TV (prequel, seguito) no.
  let frontier = [found.id];
  for (let depth = 0; depth < 10 && frontier.length; depth++) {
    const got = (await Promise.all(frontier.map(load))).filter(Boolean);
    const next = [];
    for (const x of got) {
      if (expanded.has(x.id)) continue;
      expanded.add(x.id);
      if (x.id !== found.id && x.type === 'TV') {
        const t = await mapToTmdb(x, { anyYear: true });
        if (t?.key !== `tv:${tvId}`) continue;
        same.add(x.id);
      }
      for (const [rel, id] of x.rel) {
        const follow = FOLLOW.has(rel); const leaf = LEAF.has(rel);
        if ((!follow && !leaf) || id === found.id) continue;
        if (!rels.has(id)) rels.set(id, new Set());
        rels.get(id).add(rel);
        if (follow && !expanded.has(id) && !next.includes(id)) next.push(id);
      }
    }
    frontier = next;
  }
  // voci viste solo come relazione (spin-off, riassunti…): servono tipo, titolo, data e copertina
  await Promise.all([...rels.keys()].map(load));
  const list = [...rels.keys()].map((id) => nodes.get(id)).filter((n) => n && !n.adult && !same.has(n.id)
    && (SHOW.has(n.type) || n.type === 'TV'));
  const spinOf = (n) => n.type === 'TV' && ![...rels.get(n.id)].some((r) => r === 'Sequel' || r === 'Prequel') && [...rels.get(n.id)].some((r) => SPIN_TV.has(r));
  const items = list.map((n) => ({
    id: n.id, f: n.type, d: n.date, t: n.en || n.ro || n.ja || '', c: n.img, u: n.url, rel: [...rels.get(n.id)][0],
    l: n.type === 'TV' ? (spinOf(n) ? 'Spin-off' : 'Serie') : (FORMAT_LABEL[n.type] || n.type),
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
        else if (t && list[idx].type === 'TV') drop.add(idx); // è questa serie, non uno spin-off
        else if (!t && list[idx].type === 'TV' && !spinOf(list[idx])) drop.add(idx);
      } catch { /* resta senza */ }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  const keys = new Set();
  const out = items.filter((_, idx) => !drop.has(idx))
    .sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999') || a.t.localeCompare(b.t))
    // lo stesso titolo TMDB da più voci (es. le stagioni di uno spin-off): una carta sola
    .filter((x) => !x.key || (keys.has(x.key) ? false : keys.add(x.key)));
  return { v: FR_VER, at: Date.now(), start: found.id, mal: [...same], items: out };
}

// ---- cache per serie ----
export function cachedFranchise(key) {
  const all = LS.get('vds.mal.fr', {}) || {};
  const v = all[key];
  // una copia di una versione precedente si mostra, ma si riscarica subito
  return v ? { ...v, stale: v.v !== FR_VER || Date.now() - (v.at || 0) > FR_TTL } : null;
}
export function saveFranchise(key, v) {
  const all = LS.get('vds.mal.fr', {}) || {};
  all[key] = v;
  // tiene le 60 serie aperte più di recente
  const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const k of keys.slice(60)) delete all[k];
  LS.set('vds.mal.fr', all);
}
