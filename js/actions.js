// Azioni dell'utente: ognuna produce operazioni sulla libreria.
import { dispatch, item, metaOf, ensureMeta } from './store.js';
import { autoStatus, unwatchedBefore, unwatchedAired, rewatchOf, watchedList, isWatched, seriesTimes } from './derive.js';
import { today, toast, statusLabel, fmtClock } from './ui.js';

const nowIso = () => new Date().toISOString();

export function keyOf(type, id) { return `${type}:${id}`; }

// Aggiunge un titolo se non c'è già. info: { type, id, title, year }
export function ensureItem(key, info, status = 'planned') {
  if (item(key)) return;
  const [type, id] = key.split(':');
  const m = metaOf(key);
  const it = {
    type, id: Number(id), title: info?.title || m?.t || '', year: info?.year ?? m?.y ?? null,
    status, rating: null, added: nowIso(), last: nowIso(), fav: null, rewatch: 0,
  };
  if (type === 'tv') it.eps = {};
  if (type === 'movie' && status === 'completed') it.seen = today();
  dispatch({ op: 'add', key, item: it, msg: `Aggiunge ${it.title}` });
  ensureMeta(key);
}

function updateStatusAfterEps(key) {
  const it = item(key);
  if (!it) return;
  const st = autoStatus(it, metaOf(key));
  const fields = { last: nowIso() };
  if (st !== it.status) fields.status = st;
  dispatch({ op: 'set', key, fields });
}

const epLabel = (s, e) => (s === 0 ? `Speciale ${e}` : `S${s}E${e}`);

// ---- dove mi sono fermato ----
// Un punto in sospeso per titolo: { s, e, t, d } per una serie, { t, d } per un film (t in secondi,
// d il giorno in cui l'hai segnato). Sta in library.json, così lo ritrovi su tutti i dispositivi.
export function setPause(key, { s, e, t }) {
  const it = item(key);
  if (!it || t == null) return;
  const v = it.type === 'tv' ? { s: Number(s), e: Number(e), t, d: today() } : { t, d: today() };
  dispatch({ op: 'pause', key, v, msg: `${it.title}: fermo a ${it.type === 'tv' ? `${epLabel(v.s, v.e)} ` : ''}${fmtClock(t)}` });
}

export function clearPause(key, { msg = true } = {}) {
  const it = item(key);
  if (!it?.pause) return;
  dispatch({ op: 'pause', key, v: null, msg: msg ? `${it.title}: tolto il punto in sospeso` : undefined });
}

export function restorePause(key, v) {
  if (v && item(key)) dispatch({ op: 'pause', key, v });
}

// Finito l'episodio (o il film) lasciato a metà, il punto in sospeso non serve più.
function finishPause(key, list) {
  const p = item(key)?.pause;
  if (!p) return;
  if (list == null || list.some(([s, e]) => Number(s) === p.s && Number(e) === p.e)) clearPause(key, { msg: false });
}

export function markEpisodes(key, list, info, { offerPrevious = false } = {}) {
  if (!list.length) return;
  ensureItem(key, info, 'watching');
  const it = item(key);
  const d = today();
  dispatch({ op: 'eps', key, add: list.map(([s, e]) => [String(s), String(e), d]), msg: list.length === 1 ? `Visto ${it.title} ${epLabel(...list[0])}` : `Visti ${list.length} episodi di ${it.title}` });
  finishPause(key, list);
  updateStatusAfterEps(key);
  if (offerPrevious && list.length === 1 && list[0][0] > 0) {
    const prev = unwatchedBefore(item(key), metaOf(key), list[0][0], list[0][1]);
    if (prev.length) {
      toast(`Ci sono ${prev.length} episodi precedenti non visti`, {
        label: 'Segna anche quelli',
        run: () => markEpisodes(key, prev),
      });
    }
  }
}

export function unmarkEpisodes(key, list) {
  const it = item(key);
  if (!it || !list.length) return;
  dispatch({ op: 'eps', key, rm: list.map(([s, e]) => [String(s), String(e)]), msg: list.length === 1 ? `Tolto ${it.title} ${epLabel(...list[0])}` : `Tolti ${list.length} episodi di ${it.title}` });
  updateStatusAfterEps(key);
}

export function setStatus(key, status, info) {
  if (!item(key)) { ensureItem(key, info, status); return; }
  const it = item(key);
  const fields = { status, last: nowIso() };
  if (it.type === 'movie' && status === 'completed' && !it.seen) fields.seen = today();
  const wasSeen = it.status === 'completed';
  dispatch({ op: 'set', key, fields, msg: `${it.title}: ${statusLabel(it.type, status).toLowerCase()}` });
  if (it.type === 'movie' && status === 'completed' && !wasSeen) finishPause(key, null);
  if (it.type === 'tv' && status === 'completed') {
    const missing = unwatchedAired(item(key), metaOf(key));
    if (missing.length) {
      toast(`Mancano ${missing.length} episodi usciti`, { label: 'Segnali come visti', run: () => markEpisodes(key, missing) });
    }
  }
}

// ---- rivisioni ----
// Valore assoluto per ogni episodio, così l'operazione si può riapplicare senza contare due volte.
function rwOps(it, list, delta) {
  return list.map(([s, e]) => [String(s), String(e), Math.max(0, rewatchOf(it, s, e) + delta)]);
}

// Rivisioni intere di un titolo: quelle di un film stanno in `rewatch`; quelle di una serie sono il
// minimo delle rivisioni dei suoi episodi (`seriesTimes` − 1), e `rewatch` ne è solo una copia.
export const titleRewatch = (it) => (it?.type === 'tv' ? Math.max(0, seriesTimes(it, metaOf(`tv:${it.id}`)) - 1) : (it?.rewatch || 0));

// Tiene `rewatch` di una serie uguale alle rivisioni dei suoi episodi (dopo una stagione o un episodio rivisto).
function syncSeriesRewatch(key) {
  const it = item(key);
  if (!it || it.type !== 'tv') return;
  const v = titleRewatch(it);
  if ((it.rewatch || 0) !== v) dispatch({ op: 'set', key, fields: { rewatch: v } });
}

// Quante volte hai rivisto per intero un titolo. Per una serie (vista tutta) ogni rivisione intera è una
// visione in più di ogni episodio visto, e toglierla la toglie anche agli episodi: così anche ogni
// stagione passa da «×N» a «×N+1».
export function setRewatch(key, n) {
  const it = item(key);
  if (!it) return;
  const tv = it.type === 'tv';
  if (tv && !seriesTimes(it, metaOf(key))) return;
  const old = titleRewatch(it);
  const v = Math.max(0, Math.min(99, n));
  if (v === old) return;
  const fields = { rewatch: v };
  if (v > old) fields.last = nowIso();
  if (!tv && v > old) { fields.status = 'completed'; if (!it.seen) fields.seen = today(); }
  const word = tv ? 'Rivista' : 'Rivisto';
  const ops = [{ op: 'set', key, fields, msg: v > old ? `${word} ${it.title} (${v + 1}ª volta)` : `${it.title}: ${tv ? 'vista' : 'visto'} ${v + 1} ${v ? 'volte' : 'volta'}` }];
  if (tv) {
    // salta gli episodi che resterebbero a zero comunque
    const set = rwOps(it, watchedList(it), v - old).filter(([s, e, x]) => x > 0 || rewatchOf(it, s, e) > 0);
    if (set.length) ops.push({ op: 'rw', key, set });
  }
  dispatch(...ops);
  if (v > old) finishPause(key, null);
}

// Visioni in più di un singolo episodio.
export function setEpisodeRewatch(key, s, e, n) {
  const it = item(key);
  if (!it || !isWatched(it, s, e)) return;
  const v = Math.max(0, Math.min(99, n));
  const old = rewatchOf(it, s, e);
  if (v === old) return;
  const ops = [{ op: 'rw', key, set: [[String(s), String(e), v]], msg: `${it.title} ${epLabel(s, e)}: ${v ? `visto ${v + 1} volte` : 'mai rivisto'}` }];
  if (v > old) ops.push({ op: 'set', key, fields: { last: nowIso() } });
  dispatch(...ops);
  syncSeriesRewatch(key);
  if (v > old) finishPause(key, [[s, e]]);
}

// Una stagione rivista (delta +1, con «Annulla») o una rivisione in meno (delta −1, solo agli episodi
// che ne avevano) per ogni episodio visto della stagione.
export function rewatchSeason(key, s, delta = 1) {
  const it = item(key);
  if (!it) return;
  let list = watchedList(it, { specials: true, season: s });
  if (delta < 0) list = list.filter(([a, b]) => rewatchOf(it, a, b) > 0);
  if (!list.length) return;
  const name = s === 0 ? 'speciali' : `stagione ${s}`;
  const before = list.map(([a, b]) => [String(a), String(b), rewatchOf(it, a, b)]);
  const ops = [{ op: 'rw', key, set: rwOps(it, list, delta), msg: delta > 0 ? `Rivista ${it.title} ${name}` : `${it.title} ${name}: una rivisione in meno` }];
  if (delta > 0) ops.push({ op: 'set', key, fields: { last: nowIso() } });
  const pause = it.pause ? { ...it.pause } : null;
  dispatch(...ops);
  syncSeriesRewatch(key);
  if (delta > 0) {
    finishPause(key, list);
    toast(`${s === 0 ? 'Speciali rivisti' : `Stagione ${s} rivista`}`, {
      label: 'Annulla',
      run: () => { dispatch({ op: 'rw', key, set: before, msg: `Annulla rivisione di ${it.title}` }); syncSeriesRewatch(key); if (pause && !item(key)?.pause) restorePause(key, pause); },
    });
  }
}

export function setRating(key, value) {
  const it = item(key);
  if (!it) return;
  const v = value == null ? null : Math.round(value * 10) / 10;
  dispatch({ op: 'set', key, fields: { rating: v }, msg: v == null ? `Toglie il voto a ${it.title}` : `Voto ${v.toFixed(1)} a ${it.title}` });
}

export function toggleFav(key, info) {
  if (!item(key)) ensureItem(key, info, key.startsWith('movie:') ? 'completed' : 'planned');
  const it = item(key);
  const fav = it.fav ? null : nowIso();
  dispatch({ op: 'set', key, fields: { fav }, msg: fav ? `${it.title} tra i preferiti` : `${it.title} tolto dai preferiti` });
}

// Copertina (poster) o banner (backdrop) scelti a mano; path null = torna a quella predefinita di TMDB.
export function setArtwork(key, kind, path) {
  const it = item(key);
  if (!it) return;
  const field = kind === 'backdrop' ? 'backdrop' : 'poster';
  dispatch({ op: 'set', key, fields: { [field]: path || undefined }, msg: `${path ? 'Cambia' : 'Ripristina'} ${field === 'poster' ? 'la copertina' : 'il banner'} di ${it.title}` });
}

export function setAnime(key, v) {
  const it = item(key);
  if (!it) return;
  const fields = { anime: v };
  dispatch({ op: 'set', key, fields, msg: `Categoria di ${it.title}` });
}

export function removeItem(key) {
  const it = item(key);
  if (!it) return;
  dispatch({ op: 'del', key, msg: `Rimuove ${it.title}` });
}

// ---- liste ----
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---- collezione ----
// Collega a mano `other` a `key` (key è in libreria). Vale in tutte e due le direzioni.
export function linkTitle(key, other, otherTitle) {
  const it = item(key);
  if (!it || other === key) return;
  dispatch({ op: 'link', key, add: [other], msg: `${it.title}: collega ${otherTitle || other} alla collezione` });
}
// Toglie `other` dalla collezione di `key`: un collegamento fatto a mano si toglie (da qualunque dei
// due lati sia stato fatto), uno automatico si nasconde.
export function unlinkTitle(key, other, { manual, otherTitle } = {}) {
  const it = item(key);
  const ops = [];
  if (manual) {
    if (it?.links?.includes(other)) ops.push({ op: 'link', key, rm: [other] });
    if (item(other)?.links?.includes(key)) ops.push({ op: 'link', key: other, rm: [key] });
  } else if (it) ops.push({ op: 'link', key, hide: [other] });
  if (!ops.length) return;
  ops[0].msg = `${it?.title || item(other)?.title || key}: toglie ${otherTitle || other} dalla collezione`;
  dispatch(ops);
}
// Rimette un collegamento automatico nascosto (da qualunque dei due lati sia stato nascosto).
export function unhideTitle(key, other, otherTitle) {
  const ops = [];
  if (item(key)?.nolinks?.includes(other)) ops.push({ op: 'link', key, show: [other] });
  if (item(other)?.nolinks?.includes(key)) ops.push({ op: 'link', key: other, show: [key] });
  if (!ops.length) return;
  ops[0].msg = `${item(key)?.title || key}: rimette ${otherTitle || other} nella collezione`;
  dispatch(ops);
}

export function createList(title) {
  const id = uid();
  dispatch({ op: 'lnew', id, title, at: nowIso(), msg: `Nuova lista ${title}` });
  return id;
}
export function renameList(id, title) { dispatch({ op: 'lset', id, fields: { title }, msg: `Rinomina lista ${title}` }); }
export function deleteList(id, title) { dispatch({ op: 'ldel', id, msg: `Elimina lista ${title}` }); }
export function addToList(id, entry) { dispatch({ op: 'ladd', id, entry, msg: `Aggiunge ${entry.title} a una lista` }); }
export function reorderLists(ids) { dispatch({ op: 'lorder', ids, msg: 'Riordina le liste' }); }
export function removeFromList(id, key) { dispatch({ op: 'lrem', id, key, msg: 'Toglie un titolo da una lista' }); }
