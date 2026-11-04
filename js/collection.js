// Pezzi della «Collezione» di un titolo (la sezione è in js/views/collezione.js):
// - titoli con gli stessi personaggi fatti dagli stessi attori (spin-off, seguiti, film di una serie);
// - titoli che cominciano allo stesso modo («Vis a vis» → «Vis a vis: El oasis», «Narcos» → «Narcos:
//   Messico»), cercati su TMDB;
// - titolo, locandina e data dei titoli collegati che non sono in libreria (da TMDB);
// - collegamenti fatti a mano (`links` dell'item) e collegamenti automatici nascosti (`nolinks`), in
//   tutte e due le direzioni.
import { LS, S, item, metaOf, lib } from './store.js';
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
// Il titolo intero di A sta dentro quello di B, dopo un separatore («Puella Magi Madoka Magica» →
// «Magia Record: Puella Magi Madoka Magica Side Story», «Breaking Bad» → «El Camino: A Breaking Bad Movie»), o
// all'inizio della parte prima del separatore con altre parole («Sword Art Online the Movie – Progressive – …»).
// Solo titoli di almeno due parole e dieci lettere, così «Home» o «The Office» non trovano mezzo mondo. Aggiunto
// il 4/11/2026: su TMDB e su Wikidata Magia Record non è collegato a Madoka in nessun altro modo.
export function containsTitle(titlesA, titlesB) {
  // il titolo intero e la parte prima del separatore (il film «Puella Magi Madoka Magica: Parte 3…» trova Magia
  // Record come la serie)
  const mine = new Set(titlesA.filter(Boolean).flatMap((t) => [stemText(t), stemOf(t).stem]));
  for (const a of mine) {
    if (a.split(' ').length < 2 || a.replace(/ /g, '').length < 10) continue;
    for (const raw of titlesB.filter(Boolean)) {
      const parts = raw.split(SEP);
      if (parts.length < 2) continue;
      // dopo il separatore: «Music from Puella Magi Madoka Magica: …» (un disco) no
      const after = ` ${stemText(parts.slice(1).join(' '))} `;
      if (after.includes(` ${a} `)) return true;
      // oppure all'inizio, con altre parole prima del separatore: «Sword Art Online the Movie – Progressive – …»,
      // «Jujutsu Kaisen 0 - Il film» (senza separatore no: «Breaking Bad Wolf»)
      if (`${stemText(parts[0])} `.startsWith(`${a} `) && stemText(parts[0]) !== a) return true;
    }
  }
  return false;
}

// documentari, notiziari, reality e talk show non entrano (dagli stessi personaggi e dal nome)
const NOT_WORKS = new Set([99, 10763, 10764, 10767]);
// concerti e serate dal vivo (solo «Musica»: l'orchestra di Attack on Titan con i doppiatori); i musical no
const onlyMusic = (r) => { const g = r.genre_ids || []; return g.length > 0 && g.every((x) => x === 10402 || x === 99); };
// da nessuna fonte automatica: notiziari, reality, talk show («Talking Dead» per The Walking Dead, le versioni
// straniere di LOL); i documentari sì se Wikidata li collega («La casa di carta - Il fenomeno»)
const NOT_SHOWN = new Set([10763, 10764, 10767]);
// un titolo da non mostrare nella Collezione: film per adulti (le parodie porno che Wikidata collega come
// «basato su»), notiziari, reality, talk show
export const unwanted = (mi) => !!mi && (!!mi.x || !!mi.nw);
const TT_TTL = 7 * DAY;
let ttMem = null;
const ttCache = () => (ttMem ||= LS.get('vds.col.tt', {}) || {});
export function cachedByTitle(key) {
  const c = ttCache()[key];
  // le copie senza `lo` sono di prima del 4/11/2026: si rifanno
  return c ? { k: c.k || [], lo: c.lo || [], stale: !c.lo || Date.now() - (c.at || 0) > TT_TTL } : null;
}

// Cerca su TMDB i titoli con lo stesso nome prima del separatore e la stessa lingua originale `lang`.
// names = [originale, italiano]. { k: titoli conosciuti (almeno 10 voti e la locandina), lo: gli altri, che
// entrano solo se sono in libreria quando apri la Collezione (prima si decideva al momento della ricerca, e
// un titolo aggiunto dopo, come Tokyo Ghoul: Pinto, restava fuori per 7 giorni) }
export async function fetchByTitle(key, names, lang) {
  const stems = [...new Map(names.filter(Boolean).map(stemOf).filter((s) => longEnough(s.stem)).map((s) => [s.stem, s])).values()];
  const found = new Map();
  for (const s of stems.slice(0, 2)) {
    const d = await tm('/search/multi', { query: s.raw, include_adult: 'false' });
    for (const r of d?.results || []) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const k = `${r.media_type}:${r.id}`;
      if (k === key || found.has(k)) continue;
      if ((r.genre_ids || []).some((g) => NOT_WORKS.has(g)) || onlyMusic(r)) continue;
      if (lang && r.original_language && r.original_language !== lang) continue;
      const theirs = [r.original_title || r.original_name, r.title || r.name];
      if (!sameStem(names, theirs) && !containsTitle(names, theirs)) continue;
      found.set(k, r);
    }
  }
  const known = (r) => (r.vote_count || 0) >= 10 && !!r.poster_path;
  const sorted = [...found.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const keyOf = (r) => { const k = `${r.media_type}:${r.id}`; rememberResult(k, r); return k; };
  const keys = sorted.filter(known).slice(0, 12).map(keyOf);
  const lo = sorted.filter((r) => !known(r)).slice(0, 12).map(keyOf);
  const all = ttCache();
  all[key] = { k: keys, lo, at: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > 900) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 900).forEach((x) => delete all[x]);
  LS.set('vds.col.tt', all);
  return { k: keys, lo };
}

// ---------- stessi personaggi (spin-off, seguiti, film di una serie) ----------
// Uno spin-off o un seguito ha gli stessi personaggi fatti dagli stessi attori (Pedro Alonso è Berlino nella
// Casa di carta, in Berlino e in Berlino e la dama con l'ermellino; Junko Takeuchi è la voce di Naruto
// Uzumaki in Naruto, Shippuden, Boruto e nei film). Due serie diverse degli stessi autori invece no: Alba
// Flores è Saray in Vis a vis e Nairobi nella Casa di carta. Dati di TMDB (cast con i nomi dei personaggi),
// cercati dal vivo: si prendono gli attori principali del titolo, i loro altri ruoli, e si tengono i titoli
// dove fanno **lo stesso personaggio**. Funziona per film, serie e anime, senza altre fonti.
// Regole più strette dal 4/11/2026 (Simo ha trovato «Il duca della morte» nella Collezione di Jujutsu Kaisen:
// i doppiatori fanno centinaia di ruoli, e un nome solo uguale capita per caso):
// - stessa lingua originale e stessa natura (anime con anime, il resto col resto);
// - di ogni attore conta solo il ruolo principale nel titolo aperto, non quelli fatti di passaggio
//   («Narration», «Studente»);
// - un titolo entra se il nome del personaggio sta nel suo titolo (dalla Casa di carta, «Berlín» → la serie
//   «Berlín»), oppure se gli attori in comune sono almeno due e almeno uno ha nome e cognome uguali. Gli altri
//   (un attore solo, o solo nomi singoli come «Rob» e «Rob») si tengono a parte (`w`) e servono solo a
//   confermare un collegamento debole di Wikidata. Provato il 4/11/2026 sui cast veri di TMDB (Jujutsu Kaisen,
//   Naruto Shippuden, Madoka, La casa di carta, Berlino, Vis a vis, Breaking Bad): con un attore solo entravano
//   ruoli sbagliati di TMDB («Nobara Kugisaki» in Girls und Panzer, «Sayaka Miki» in altri due anime).
// Risultato sul telefono `vds.col.cast` per 7 giorni; i ruoli degli attori solo in memoria (sono tanti).
const CAST_TTL = 7 * DAY;
const CAST_VER = 2;
// quanti attori principali: nelle serie quelli con almeno un quinto degli episodi del primo (Pedro Alonso nella
// Casa di carta ne ha meno di una decina di altri, ma è Berlino), fino a 15; nei film i primi 10
const MAIN_TV = 15;
const MAIN_MOVIE = 10;
// parole che non dicono chi è il personaggio («Self», «Narrator», «Young Mike», «Male Student»…)
const GENERIC = new Set(('self himself herself themselves yourself narrator narration narratore narrazione narrador narracion '
  + 'voice voices voce additional host guest various uncredited archive footage young younger older old little man woman men women '
  + 'boy boys girl girls kid kids child children baby police officer doctor dottore nurse student students teacher mother father mom '
  + 'dad brother sister son daughter wife husband king queen prince princess soldier soldiers guard guards cameo presenter judge '
  + 'contestant reporter announcer unknown the and his her mrs miss stesso stessa mismo misma lui lei ella professor profesor '
  + 'professore detective agent agente captain capitano lieutenant sergeant general president customer waiter waitress driver friend '
  + 'friends neighbor neighbour villager villagers citizen citizens people crowd extra extras singer dancer member members guest_star '
  + 'episode episodes adult teen teenager boss chief inspector ispettore commissario male female elderly middle aged mob staff '
  + 'employee worker workers servant maid butler witch demon demons spirit spirits curse cursed monster monsters creature classmate '
  + 'classmates passerby shopkeeper clerk grandpa grandma grandfather grandmother uncle aunt cousin leader master lord lady sir madam '
  + 'priest nun monk knight warrior pilot robot villain hero girlfriend boyfriend twin manager secretary assistant scientist lawyer '
  + 'bartender thug thugs gangster prisoner inmate patient victim suspect witness person ghost zombie alien god goddess angel devil '
  + 'ragazzo ragazza uomo donna madre padre bambino bambina studente studentessa hombre mujer chico chica nino nina policia guardia '
  + 'presentatore presentador invitato invitado alumno alumna spectator spectators transfigured ordinary fan fans chef principal '
  + 'grandson granddaughter corpse youngster attendee attendant housewife vendor pickpocket mysterious').split(/\s+/));
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
// le parole di uno o più titoli (per riconoscere un soprannome che dà il nome allo spin-off)
export const titleWords = (...ts) => new Set(ts.flatMap((t) => stemText(t).split(' ')).filter((w) => w.length >= 4));
// «berlin» sta in «Berlín» e anche in «Berlino» (stessa radice, al massimo 2 lettere in più)
function inTitle(words, w) {
  for (const t of words) {
    if (t === w) return true;
    if (t.length >= 5 && w.length >= 5 && Math.abs(t.length - w.length) <= 2 && (t.startsWith(w) || w.startsWith(t))) return true;
  }
  return false;
}
// Quanto due personaggi sono lo stesso: { level: 2 = nome e cognome (almeno due parole in comune), 1 = un nome
// solo uguale («Tokyo» e «Silene Oliveira / Tokyo», «Panda» e «Panda»), 0 = no; title: una parola in comune sta
// anche nei titoli `words` («Berlín» e la serie «Berlín», «Saul» e «Better Call Saul») }. Mai con un solo nome
// comunissimo («Michael»).
export function compareChars(a, b, words = new Set()) {
  let level = 0; let title = false;
  for (const A of charNames(a)) {
    for (const B of charNames(b)) {
      const shared = [...A].filter((w) => B.has(w));
      if (!shared.length) continue;
      let lv = 2;
      if (shared.length < 2) {
        const w = shared[0];
        if (COMMON.has(w)) continue;
        // un nome solo deve essere tutto il nome di uno dei due (un soprannome), non un cognome in comune
        if (A.size !== 1 && B.size !== 1) continue;
        if (w.length < 4 && !(A.size === 1 && B.size === 1)) continue;
        lv = 1;
      }
      level = Math.max(level, lv);
      if (shared.some((w) => !COMMON.has(w) && inTitle(words, w))) title = true;
    }
  }
  return { level, title };
}
export const sameCharacter = (a, b) => compareChars(a, b).level > 0;
let castMem = null;
const castCache = () => (castMem ||= LS.get('vds.col.cast', {}) || {});
// { k: titoli sicuri, w: titoli deboli, stale }. Le copie di prima del 4/11/2026 (senza `v`) erano fatte con le
// regole larghe: non valgono niente, si rifanno.
export function cachedByCast(key) {
  const c = castCache()[key];
  if (!c) return null;
  if (c.v !== CAST_VER) return { k: [], w: [], stale: true };
  return { k: c.k || [], w: c.w || [], stale: Date.now() - (c.at || 0) > CAST_TTL };
}
// da quanto tempo (ms) sono stati cercati gli stessi personaggi di `key` (Infinity se mai, o con regole vecchie)
export function castAge(key) {
  const c = castCache()[key];
  return c && c.v === CAST_VER ? Date.now() - (c.at || 0) : Infinity;
}
const people = new Map(); // id attore -> Promise dei suoi ruoli (per la sessione)
const rolesOf = (pid) => {
  if (!people.has(pid)) people.set(pid, tm(`/person/${pid}/combined_credits`).then((d) => d?.cast || []).catch(() => { people.delete(pid); return []; }));
  return people.get(pid);
};
// Gli attori principali di un titolo: [{ id, ch, top }] (top = tra i primi 3). Di una serie, di ogni attore si
// tengono i ruoli principali (almeno un quarto degli episodi del suo ruolo più lungo).
async function mainCast(type, id) {
  if (type === 'tv') {
    const d = await tm(`/tv/${id}/aggregate_credits`);
    const cast = (d?.cast || []).map((c) => {
      const roles = (c.roles || []).filter((r) => r.character);
      const most = Math.max(0, ...roles.map((r) => r.episode_count || 0));
      const main = roles.filter((r) => (r.episode_count || 0) >= most / 4);
      return { id: c.id, ch: main.map((r) => r.character).join(' / '), n: c.total_episode_count || 0 };
    })
      .filter((c) => charNames(c.ch).length)
      .sort((a, b) => b.n - a.n);
    const min = Math.max(2, (cast[0]?.n || 0) / 5);
    return cast.filter((c, i) => i < 3 || c.n >= min).slice(0, MAIN_TV).map((c, i) => ({ id: c.id, ch: c.ch, top: i < 3 }));
  }
  const d = await tm(`/movie/${id}/credits`);
  const cast = (d?.cast || []).filter((c) => charNames(c.character).length).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return cast.slice(0, MAIN_MOVIE).map((c, i) => ({ id: c.id, ch: c.character, top: i < 3 }));
}
// I titoli dove gli attori principali di `key` fanno lo stesso personaggio: { k: sicuri, w: deboli }, dal più
// legato (più attori in comune) al meno. x = { t, ot, l, anime } del titolo aperto. Si scartano le comparsate
// (1 episodio), i programmi che non sono opere (talk show, documentari…), le altre lingue originali e, per un
// anime, quello che non è anime (e viceversa).
export async function fetchByCast(key, x = {}) {
  const [type, id] = key.split(':');
  const cast = await mainCast(type, Number(id));
  const mine = titleWords(x.t, x.ot);
  const found = new Map(); // chiave -> { r, score, who, full, title }
  await Promise.all(cast.map(async (c) => {
    for (const r of await rolesOf(c.id)) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const k = `${r.media_type}:${r.id}`;
      if (k === key || (r.genre_ids || []).some((g) => NOT_WORKS.has(g)) || onlyMusic(r)) continue;
      if (r.media_type === 'tv' && (r.episode_count || 0) < 2) continue;
      if (r.adult || /\b(?:self|himself|herself)\b/i.test(r.character || '')) continue;
      if (x.l && r.original_language && r.original_language !== x.l) continue;
      if (typeof x.anime === 'boolean' && isAnimeResult(r) !== x.anime) continue;
      // il nome del personaggio conta solo nel titolo dell'altro (lo spin-off che porta il suo nome): un ruolo
      // sbagliato su TMDB con il nome del protagonista del titolo aperto non deve bastare
      const m = compareChars(c.ch, r.character, titleWords(r.title, r.name, r.original_title, r.original_name));
      if (!m.level) continue;
      const f = found.get(k) || { r, score: 0, who: new Set(), full: false, title: false };
      if (m.level === 2) f.full = true;
      if (m.title) f.title = true;
      // il protagonista fa nell'altro titolo il personaggio che dà il nome a questo (Pedro Alonso è Berlín nella
      // Casa di carta, aperta da «Berlín y la dama del armiño»): vale solo se quel titolo l'hai in libreria, così
      // un ruolo sbagliato su TMDB col nome del protagonista non porta dentro titoli a caso
      if (c.top && item(k) && compareChars(c.ch, r.character, mine).title) f.title = true;
      if (!f.who.has(c.id)) { f.who.add(c.id); f.score += (c.top ? 2 : 1) + m.level; }
      found.set(k, f);
    }
  }));
  const sorted = [...found.entries()]
    .sort((a, b) => b[1].score - a[1].score || (b[1].r.popularity || 0) - (a[1].r.popularity || 0));
  const keyOf = ([k, f]) => { if (!item(k) && !metaOf(k)) rememberResult(k, f.r); return k; };
  // sicuro: il nome del personaggio sta nel titolo (Berlino, Better Call Saul), oppure almeno due attori in comune
  // con lo stesso personaggio (anche solo nomi: «Kirito» e «Asuna» nei film di Sword Art Online). Un attore solo
  // non basta, nemmeno con nome e cognome: su TMDB ci sono ruoli sbagliati (Asami Seto «Nobara Kugisaki» in Girls
  // und Panzer, Eri Kitamura «Sayaka Miki» in altri due anime, Itziar Ituño «Raquel Murillo» in un film che non
  // c'entra, Ikue Otani «Tony Tony Chopper» in un film dal vero)
  const sure = ([, f]) => f.title || f.who.size >= 2;
  const keys = sorted.filter(sure).slice(0, 30).map(keyOf);
  const weak = sorted.filter((e) => !sure(e)).slice(0, 30).map(keyOf);
  const all = castCache();
  all[key] = { k: keys, w: weak, at: Date.now(), v: CAST_VER };
  const ks = Object.keys(all);
  if (ks.length > 900) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 900).forEach((x) => delete all[x]);
  LS.set('vds.col.cast', all);
  return { k: keys, w: weak };
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
    if (ks.length > 2500) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 2500).forEach((k) => delete all[k]);
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
    l: r.original_language || old?.l || '',
    ...(r.adult ? { x: 1 } : {}),
    ...((r.genre_ids || (r.genres || []).map((g) => g.id)).some((g) => NOT_SHOWN.has(g)) ? { nw: 1 } : {}),
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

// { t, p, d, a, l, co, lib, x, nw } oppure null se non si sa ancora (a = anime, l = lingua originale, x = per
// adulti, nw = notiziario/reality/talk show)
export function miniOf(key) {
  const [type] = key.split(':');
  const it = item(key); const m = metaOf(key);
  if (it || m) {
    const t = (m?.t && !nonLatin(m.t) ? m.t : '') || it?.title || m?.t || '';
    // appena aggiunto, senza ancora i dati di TMDB: se è anime non si sa (null), a meno che non l'abbia detto Simo
    const c = m ? null : miniCache()[key];
    const a = m || typeof it?.anime === 'boolean' ? isAnime(it || {}, m) : (c && !c.gone ? c.a : null);
    const nw = m ? (m.g || []).some((g) => NOT_SHOWN.has(g)) : !!c?.nw;
    return { t, p: it?.poster || m?.p || c?.p || null, d: metaDate(type, m) || c?.d || (it?.year ? String(it.year) : ''), a, l: m?.l || c?.l || '', co: m ? m.co : c?.co, lib: !!it, ...(nw ? { nw: 1 } : {}) };
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

// Come ensureMini, ma con una promessa che si risolve quando sono arrivati (subito se non manca niente):
// per le Novità in Home (js/novita.js), che li chiede in sottofondo.
export function ensureMiniAsync(keys) {
  return new Promise((resolve) => {
    const now = Date.now();
    const need = keys.some((k) => {
      if (asking.has(k) || item(k) || metaOf(k)) return false;
      const c = miniCache()[k];
      return !c || now - c.at > MINI_TTL || (k.startsWith('movie:') && !c.gone && c.co === undefined);
    });
    if (!need || !tmdbToken()) { resolve(); return; }
    ensureMini(keys, resolve);
  });
}

// ---------- collegamenti a mano ----------
// `links` = titoli collegati a mano, `nolinks` = collegamenti automatici nascosti. Valgono in tutte e due
// le direzioni: se «A» ha «B» in links, «B» mostra «A».
// chi ha `key` nei suoi links / nolinks: { links: Map(key -> [chiavi]), nolinks: … }, rifatto quando la
// libreria cambia (le Novità in Home lo chiedono per ogni titolo guardato)
let back = { rev: -1, lib: null, links: new Map(), nolinks: new Map() };
function backLinks() {
  if (back.rev === S.rev && back.lib === lib()) return back;
  back = { rev: S.rev, lib: lib(), links: new Map(), nolinks: new Map() };
  for (const [k, it] of Object.entries(lib()?.items || {})) {
    for (const f of ['links', 'nolinks']) for (const o of it[f] || []) { if (!back[f].has(o)) back[f].set(o, []); back[f].get(o).push(k); }
  }
  return back;
}
export function manualOf(key) {
  const add = new Set(item(key)?.links || []);
  const hide = new Set(item(key)?.nolinks || []);
  const b = backLinks();
  for (const k of b.links.get(key) || []) if (k !== key) add.add(k);
  for (const k of b.nolinks.get(key) || []) if (k !== key) hide.add(k);
  for (const k of hide) add.delete(k);
  add.delete(key);
  return { add, hide };
}
