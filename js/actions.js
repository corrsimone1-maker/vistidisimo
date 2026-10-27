// Azioni dell'utente: ognuna produce operazioni sulla libreria.
import { dispatch, item, metaOf, ensureMeta } from './store.js';
import { autoStatus, unwatchedBefore, unwatchedAired } from './derive.js';
import { today, toast, statusLabel } from './ui.js';

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

export function markEpisodes(key, list, info, { offerPrevious = false } = {}) {
  if (!list.length) return;
  ensureItem(key, info, 'watching');
  const it = item(key);
  const d = today();
  dispatch({ op: 'eps', key, add: list.map(([s, e]) => [String(s), String(e), d]), msg: list.length === 1 ? `Visto ${it.title} ${epLabel(...list[0])}` : `Visti ${list.length} episodi di ${it.title}` });
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
  dispatch({ op: 'set', key, fields, msg: `${it.title}: ${statusLabel(it.type, status).toLowerCase()}` });
  if (it.type === 'tv' && status === 'completed') {
    const missing = unwatchedAired(item(key), metaOf(key));
    if (missing.length) {
      toast(`Mancano ${missing.length} episodi usciti`, { label: 'Segnali come visti', run: () => markEpisodes(key, missing) });
    }
  }
}

export function rewatchMovie(key) {
  const it = item(key);
  if (!it) return;
  dispatch({ op: 'set', key, fields: { rewatch: (it.rewatch || 0) + 1, last: nowIso(), status: 'completed', seen: it.seen || today() }, msg: `Rivisto ${it.title}` });
  toast(`Rivisto: ${(it.rewatch || 0) + 1} volte`);
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
