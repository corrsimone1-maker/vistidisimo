// Calcoli sui dati: avanzamento, stato automatico, prossimo episodio, anime, statistiche.
import { today, daysBetween } from './ui.js';

const ENDED = new Set(['Ended', 'Canceled']);

export function watchedCount(it, { specials = false } = {}) {
  let n = 0;
  for (const [s, eps] of Object.entries(it?.eps || {})) if (specials || s !== '0') n += Object.keys(eps).length;
  return n;
}

export function isWatched(it, s, e) {
  return !!it?.eps?.[String(s)] && String(e) in it.eps[String(s)];
}

// Stagioni regolari (senza speciali) ordinate: [[numero, episodi, data], ...]
export function seasons(m) {
  return (m?.ss || []).filter((s) => s[0] > 0).sort((a, b) => a[0] - b[0]);
}

export function totalEpisodes(m) {
  return seasons(m).reduce((a, s) => a + s[1], 0);
}

// Alcune serie su TMDB (molti anime: Naruto Shippuden, Hunter x Hunter…) numerano gli episodi
// in modo assoluto: la stagione 2 parte dal 33 e non dall'1. Lo si capisce perché l'ultimo episodio
// uscito ha un numero più alto degli episodi della sua stagione.
export function isAbsolute(m) {
  if (!m?.le || !(m.le[0] > 0)) return false;
  const s = (m.ss || []).find((x) => x[0] === m.le[0]);
  return !!s && s[1] > 0 && m.le[1] > s[1];
}

// Primo e ultimo numero di episodio di una stagione regolare.
export function epRange(m, sn) {
  const ss = seasons(m);
  const s = ss.find((x) => x[0] === sn);
  if (!s) return [1, 0];
  if (!isAbsolute(m)) return [1, s[1]];
  let off = 0;
  for (const [n, cnt] of ss) { if (n >= sn) break; off += cnt; }
  return [off + 1, off + s[1]];
}

// Episodi regolari già usciti.
export function airedCount(m) {
  if (!m) return 0;
  const ss = seasons(m);
  if (m.le && m.le[0] > 0) {
    let n = 0;
    for (const [sn, cnt] of ss) {
      if (sn < m.le[0]) n += cnt;
      else if (sn === m.le[0]) { const [first] = epRange(m, sn); n += Math.max(0, Math.min(cnt || Infinity, m.le[1] - first + 1)); }
    }
    return n;
  }
  const t = today();
  return ss.filter((s) => s[2] && s[2] <= t).reduce((a, s) => a + s[1], 0);
}

export function isAired(m, s, e, airDate) {
  if (airDate) return airDate <= today();
  if (!m?.le) return false;
  if (s === 0) return true;
  return s < m.le[0] || (s === m.le[0] && e <= m.le[1]);
}

export const isEnded = (m) => !!m && ENDED.has(m.st);

export function isAnime(it, m) {
  if (typeof it?.anime === 'boolean') return it.anime;
  if (!m) return false;
  return (m.g || []).includes(16) && (m.l === 'ja' || (m.c || []).includes('JP'));
}

// Anime da un risultato di ricerca TMDB (ha genre_ids, original_language, origin_country).
export function isAnimeResult(r) {
  return (r.genre_ids || []).includes(16) && (r.original_language === 'ja' || (r.origin_country || []).includes('JP'));
}

export function category(it, m) {
  if (isAnime(it, m)) return 'anime';
  return it.type === 'tv' ? 'serie' : 'film';
}

// Riempimento della barra: quanta parte della serie hai visto.
export function progress(it, m) {
  if (!it) return 0;
  if (it.type === 'movie') return it.status === 'completed' ? 1 : 0;
  if (it.status === 'completed') return 1;
  const w = watchedCount(it);
  const tot = totalEpisodes(m);
  if (!tot) return it.status === 'uptodate' ? 1 : (w ? 0.05 : 0);
  // proporzione vera, ma con un minimo visibile (1 episodio su 1000 resta un trattino, non sparisce)
  return Math.min(1, Math.max(w ? 0.04 : 0, w / tot));
}

// Stato dopo aver segnato o tolto episodi.
export function autoStatus(it, m) {
  const w = watchedCount(it);
  if (w === 0) return it.status === 'dropped' ? 'dropped' : 'planned';
  const a = airedCount(m);
  if (m && a && w >= a) return isEnded(m) ? 'completed' : 'uptodate';
  return 'watching';
}

// Ultimo episodio visto (il più avanti in ordine).
export function furthest(it) {
  let fs = 0; let fe = 0;
  for (const [s, eps] of Object.entries(it?.eps || {})) {
    const sn = Number(s);
    if (sn === 0) continue;
    for (const e of Object.keys(eps)) {
      const en = Number(e);
      if (sn > fs || (sn === fs && en > fe)) { fs = sn; fe = en; }
    }
  }
  return [fs, fe];
}

// Prossimo episodio da vedere (già uscito), dopo l'ultimo visto.
export function nextEpisode(it, m) {
  if (!m) return null;
  const [fs, fe] = furthest(it);
  let cand = null;
  for (const [sn, cnt] of seasons(m)) {
    if (sn < fs || !cnt) continue;
    const [first, last] = epRange(m, sn);
    if (sn === fs) { if (fe < last) { cand = [sn, Math.max(fe + 1, first)]; break; } continue; }
    cand = [sn, first];
    break;
  }
  if (!cand || !isAired(m, cand[0], cand[1])) return null;
  return { s: cand[0], e: cand[1], left: Math.max(1, airedCount(m) - watchedCount(it)) };
}

// Episodi regolari usciti e non visti fino a (s, e) escluso.
export function unwatchedBefore(it, m, s, e) {
  const out = [];
  for (const [sn] of seasons(m)) {
    if (sn > s) break;
    const [first, lastOfSeason] = epRange(m, sn);
    const last = sn === s ? e - 1 : lastOfSeason;
    for (let en = first; en <= last; en++) if (!isWatched(it, sn, en) && isAired(m, sn, en)) out.push([sn, en]);
  }
  return out;
}

export function unwatchedAired(it, m) {
  const out = [];
  for (const [sn] of seasons(m)) {
    const [first, last] = epRange(m, sn);
    for (let en = first; en <= last; en++) if (!isWatched(it, sn, en) && isAired(m, sn, en)) out.push([sn, en]);
  }
  return out;
}

// ---- nuova stagione ----
// Una stagione nuova è uscita da poco: è l'ultima stagione regolare (dalla 2 in poi) con almeno un
// episodio fuori, è cominciata negli ultimi NEW_SEASON_DAYS giorni e dopo che la serie è entrata in
// libreria, non ne hai visto niente e l'avviso non l'ha ancora mostrata (`announced`). Solo per le
// serie che segui: in corso, in pari o completate (non da guardare, non abbandonate).
// Restituisce { n, d, k, cnt }: stagione, giorno d'inizio, episodi usciti (null se non si sa), episodi.
export const NEW_SEASON_DAYS = 30;
const FOLLOWED = new Set(['watching', 'uptodate', 'completed']);
export function newSeason(it, m, t = today()) {
  if (!it || it.type !== 'tv' || !m || !FOLLOWED.has(it.status)) return null;
  const le = m.le && m.le[0] > 0 ? m.le : null;
  let cand = null;
  for (const s of seasons(m)) {
    const [n, cnt, d] = s;
    if (!cnt) continue;
    const [first] = epRange(m, n);
    // il primo episodio è ancora il «prossimo»: la stagione non è uscita, qualunque data dica TMDB
    if (m.ne && m.ne[0] === n && m.ne[1] <= first) continue;
    if ((le && n <= le[0]) || (d && d <= t)) cand = s;
  }
  if (!cand) return null;
  const [n, cnt, d] = cand;
  if (n < 2 || !d || d > t || n <= (it.announced || 0)) return null;
  if (daysBetween(d, t) > NEW_SEASON_DAYS) return null;
  if (it.added && d <= it.added.slice(0, 10)) return null;
  if (it.eps?.[String(n)] && Object.keys(it.eps[String(n)]).length) return null;
  let k = null;
  if (le && le[0] > n) k = cnt;
  else if (le && le[0] === n) { const [first] = epRange(m, n); k = Math.max(1, Math.min(cnt, le[1] - first + 1)); }
  return { n, d, k, cnt };
}

// ---- rivisioni ----
// Quante volte in più (oltre la prima) è stato visto un episodio.
export function rewatchOf(it, s, e) {
  return it?.rw?.[String(s)]?.[String(e)] || 0;
}

// Quante volte hai visto tutta una stagione (count = i suoi episodi): 0 se non è vista tutta, altrimenti
// 1 + le rivisioni che hanno tutti i suoi episodi (il minimo). Il cerchio della stagione mostra «×N».
export function seasonTimes(it, s, count) {
  const eps = it?.eps?.[String(s)];
  if (!eps || !count) return 0;
  const ks = Object.keys(eps);
  if (ks.length < count) return 0;
  return 1 + Math.min(...ks.map((e) => rewatchOf(it, s, e)));
}

// Quante volte hai visto tutta una serie (scelta di Simo, 3/11/2026: stagioni e serie devono dirsi la
// stessa cosa): 0 se manca qualche episodio uscito delle stagioni regolari, altrimenti 1 + il minimo delle
// rivisioni dei suoi episodi. Così se ogni stagione è «×2» la serie è vista 2 volte, e viceversa.
// Senza dati TMDB vale come vista tutta se è completata o in pari. Il campo `rewatch` delle serie in
// library.json ne è solo una copia (= questo − 1), aggiornata dalle azioni sulle rivisioni.
export function seriesTimes(it, m) {
  if (!it || it.type !== 'tv') return 0;
  const list = watchedList(it);
  if (!list.length) return 0;
  if (m?.ss?.length ? unwatchedAired(it, m).length : !['completed', 'uptodate'].includes(it.status)) return 0;
  return 1 + Math.min(...list.map(([s, e]) => rewatchOf(it, s, e)));
}

// Totale delle visioni in più di tutti gli episodi di una serie.
export function rewatchEpisodes(it) {
  let n = 0;
  for (const eps of Object.values(it?.rw || {})) for (const v of Object.values(eps)) n += v;
  return n;
}

// Episodi visti, in ordine: [[stagione, episodio], ...]. Gli speciali solo se richiesti.
export function watchedList(it, { specials = false, season = null } = {}) {
  const out = [];
  for (const [s, eps] of Object.entries(it?.eps || {})) {
    const sn = Number(s);
    if ((!specials && sn === 0) || (season != null && sn !== season)) continue;
    for (const e of Object.keys(eps)) out.push([sn, Number(e)]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Data più recente in cui hai visto un episodio (le date mancanti degli import valgono come `last`).
export function lastWatchDate(it) {
  let best = '';
  for (const eps of Object.values(it?.eps || {})) for (const d of Object.values(eps)) if (d && d > best) best = d;
  return best || (it?.last || '').slice(0, 10);
}

// Episodio precedente e successivo nell'ordine delle stagioni (gli speciali restano tra gli speciali).
export function neighbors(m, s, e) {
  const list = [];
  if (s === 0) {
    const sp = (m?.ss || []).find((x) => x[0] === 0);
    for (let i = 1; i <= (sp?.[1] || 0); i++) list.push([0, i]);
  } else {
    for (const [sn] of seasons(m)) { const [first, last] = epRange(m, sn); for (let en = first; en <= last; en++) list.push([sn, en]); }
  }
  const i = list.findIndex(([a, b]) => a === s && b === e);
  if (i === -1) return { prev: null, next: null };
  return { prev: list[i - 1] || null, next: list[i + 1] || null };
}

// ---- statistiche ----
export function stats(items, metaOf) {
  let epCount = 0; let tvMin = 0; let films = 0; let filmMin = 0;
  for (const [k, it] of Object.entries(items)) {
    const m = metaOf(k);
    if (it.type === 'tv') {
      const w = watchedCount(it, { specials: true });
      epCount += w;
      const rt = m?.rt || (isAnime(it, m) ? 24 : 42);
      // il tempo conta anche le rivisioni degli episodi; il numero di episodi no
      tvMin += (w + rewatchEpisodes(it)) * rt;
    } else if (it.status === 'completed') {
      films += 1;
      filmMin += (m?.rt || 110) * (1 + (it.rewatch || 0));
    }
  }
  return { epCount, tvMin, films, filmMin };
}

export function splitTime(min) {
  const h = Math.floor(min / 60);
  const months = Math.floor(h / (24 * 30));
  const days = Math.floor((h - months * 720) / 24);
  const hours = h - months * 720 - days * 24;
  return { months, days, hours };
}

// Quando l'hai visto, per ordinare le liste: film = data di visione (o dell'ultima rivisione,
// che aggiorna `last`), serie = ultimo episodio visto. '' = non ancora visto.
export function watchDate(it) {
  if (!it) return '';
  if (it.type === 'movie') return it.status === 'completed' ? [it.seen || '', (it.last || '').slice(0, 10)].sort().pop() : '';
  return watchedCount(it, { specials: true }) ? lastWatchDate(it) : '';
}

// Titoli di una lista dal visto più di recente; quelli non visti in fondo, nell'ordine della lista.
export function listOrder(list, items) {
  return list.items
    .map((e, i) => ({ e, i, d: watchDate(items[e.key]) }))
    .sort((a, b) => (b.d || '').localeCompare(a.d || '') || a.i - b.i)
    .map((x) => x.e);
}

// Percentuale completata di una lista: media dell'avanzamento dei titoli dentro.
export function listProgress(list, items, metaOf) {
  if (!list.items.length) return 0;
  let sum = 0;
  for (const e of list.items) {
    const it = items[e.key];
    sum += it ? progress(it, metaOf(e.key)) : 0;
  }
  return sum / list.items.length;
}

export const byLast = (a, b) => (b.it.last || '').localeCompare(a.it.last || '');
