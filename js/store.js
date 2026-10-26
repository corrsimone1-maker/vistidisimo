// Stato dell'app e sincronizzazione con la repo privata.
//
// La libreria vive in library.json su GitHub. Ogni azione diventa un'"operazione" messa in coda;
// la libreria mostrata è l'ultima versione scaricata con sopra le operazioni in coda. Al salvataggio
// le operazioni vengono riapplicate all'ultima versione su GitHub, così due dispositivi non si
// sovrascrivono a vicenda.
import { ghGet, ghPut, serialize, GhError } from './github.js';
import { tmdbToken, fetchDetails, metaFromDetails, pool } from './tmdb.js';
import { airedCount, watchedCount, isAbsolute, epRange } from './derive.js';
import { today } from './ui.js';

const LS = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* niente */ } },
};

export const S = {
  base: null, baseSha: null,
  ops: [],
  lib: null,
  meta: { v: 1, items: {} }, metaSha: null, metaDirty: false,
  sync: { state: 'idle', msg: '' },
  metaJob: null, // { done, total }
  loaded: false,
  lastFetch: 0,
  lastSaved: null,
};

const subs = new Set();
let notifyQueued = false;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => { notifyQueued = false; subs.forEach((f) => f()); });
}

export const hasGhToken = () => { try { return !!localStorage.getItem('vds.ghToken'); } catch { return false; } };

// ---------- operazioni ----------
function applyOp(doc, op) {
  doc.items ||= {};
  doc.lists ||= [];
  const it = doc.items[op.key];
  switch (op.op) {
    case 'add':
      if (!it) doc.items[op.key] = { ...op.item };
      break;
    case 'set':
      if (it) Object.assign(it, op.fields);
      break;
    case 'del':
      delete doc.items[op.key];
      break;
    case 'eps': {
      if (!it) break;
      it.eps ||= {};
      for (const [s, e, d] of op.add || []) {
        const ss = (it.eps[s] ||= {});
        if (!(e in ss)) ss[e] = d;
      }
      for (const [s, e] of op.rm || []) {
        if (it.eps[s]) { delete it.eps[s][e]; if (!Object.keys(it.eps[s]).length) delete it.eps[s]; }
      }
      // ordine stabile di stagioni ed episodi
      const sorted = {};
      for (const s of Object.keys(it.eps).sort((a, b) => a - b)) {
        sorted[s] = {};
        for (const e of Object.keys(it.eps[s]).sort((a, b) => a - b)) sorted[s][e] = it.eps[s][e];
      }
      it.eps = sorted;
      break;
    }
    case 'lnew':
      if (!doc.lists.some((l) => l.id === op.id)) doc.lists.push({ id: op.id, title: op.title, added: op.at, items: [] });
      break;
    case 'lset': {
      const l = doc.lists.find((x) => x.id === op.id);
      if (l) Object.assign(l, op.fields);
      break;
    }
    case 'ldel':
      doc.lists = doc.lists.filter((l) => l.id !== op.id);
      break;
    case 'lorder': {
      // nuovo ordine delle liste; quelle non citate (create altrove nel frattempo) restano in fondo
      const pos = new Map(op.ids.map((id, i) => [id, i]));
      doc.lists = doc.lists
        .map((l, i) => ({ l, k: pos.has(l.id) ? pos.get(l.id) : op.ids.length + i }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.l);
      break;
    }
    case 'ladd': {
      const l = doc.lists.find((x) => x.id === op.id);
      if (l && !l.items.some((e) => e.key === op.entry.key)) l.items.push(op.entry);
      break;
    }
    case 'lrem': {
      const l = doc.lists.find((x) => x.id === op.id);
      if (l) l.items = l.items.filter((e) => e.key !== op.key);
      break;
    }
    default:
      break;
  }
  return doc;
}

function materialize() {
  const doc = structuredClone(S.base || { v: 1, items: {}, lists: [] });
  for (const op of S.ops) applyOp(doc, op);
  S.lib = doc;
}

export function dispatch(...ops) {
  const list = ops.flat().filter(Boolean);
  if (!list.length) return;
  for (const op of list) { op.ts = Date.now(); S.ops.push(op); applyOp(S.lib, op); }
  LS.set('vds.ops', S.ops);
  notify();
  scheduleFlush();
}

export const lib = () => S.lib;
export const item = (key) => S.lib?.items?.[key] || null;
export const metaOf = (key) => S.meta.items[key] || null;

// ---------- salvataggio ----------
let flushTimer = null;
let flushing = false;
export function scheduleFlush(delay = 1500) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

function commitMessage(ops) {
  const msgs = [...new Set(ops.map((o) => o.msg).filter(Boolean))];
  if (!msgs.length) return 'Aggiorna la libreria';
  if (msgs.length <= 3) return msgs.join('; ');
  return `${msgs.slice(0, 2).join('; ')} e altre ${msgs.length - 2} modifiche`;
}

function setSync(state, msg = '') { S.sync = { state, msg }; notify(); }

export async function flush() {
  clearTimeout(flushTimer);
  if (flushing || !S.ops.length || !hasGhToken() || !S.loaded) return;
  if (!navigator.onLine) { setSync('offline', 'Sei offline: le modifiche partono appena torni online.'); return; }
  flushing = true;
  setSync('saving');
  const sending = S.ops.slice();
  try {
    let base = S.base; let sha = S.baseSha;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        const r = await ghGet('library.json'); base = r.data || { v: 1, items: {}, lists: [] }; sha = r.sha;
      }
      const next = structuredClone(base || { v: 1, items: {}, lists: [] });
      for (const op of sending) applyOp(next, op);
      next.updated = new Date().toISOString();
      try {
        const newSha = await ghPut('library.json', serialize(next), sha, commitMessage(sending));
        S.base = next; S.baseSha = newSha;
        S.lastSaved = new Date().toISOString();
        LS.set('vds.lastSaved', S.lastSaved);
        break;
      } catch (e) {
        if (e instanceof GhError && e.conflict && attempt < 4) continue;
        throw e;
      }
    }
    S.ops = S.ops.slice(sending.length);
    LS.set('vds.ops', S.ops);
    LS.set('vds.base', { sha: S.baseSha, doc: S.base });
    materialize();
    setSync(S.ops.length ? 'saving' : 'idle');
  } catch (e) {
    console.error(e);
    setSync('error', e.auth ? 'Il token GitHub non funziona più (forse è scaduto). Le modifiche restano su questo dispositivo: incolla un token nuovo in Impostazioni e partono da sole.' : `Salvataggio non riuscito (${e.message}). Le modifiche restano su questo dispositivo e riprovo tra poco.`);
    if (!e.auth) scheduleFlush(20000);
  } finally {
    flushing = false;
    if (S.ops.length && S.sync.state !== 'error') scheduleFlush(300);
  }
}

// ---------- caricamento ----------
export function loadCache() {
  const b = LS.get('vds.base');
  if (b) { S.base = b.doc; S.baseSha = b.sha; }
  S.ops = LS.get('vds.ops', []);
  S.lastSaved = LS.get('vds.lastSaved', null);
  const m = LS.get('vds.meta');
  if (m) { S.meta = m.doc; S.metaSha = m.sha; }
  materialize();
}

export async function pull() {
  if (!hasGhToken()) return;
  try {
    const [libR, metaR, cfgR] = await Promise.all([
      ghGet('library.json'),
      ghGet('meta.json').catch(() => ({ sha: null, data: null })),
      tmdbToken() ? Promise.resolve(null) : ghGet('config.json').catch(() => null),
    ]);
    if (cfgR?.data?.tmdb) { try { localStorage.setItem('vds.tmdbToken', cfgR.data.tmdb); } catch { /* niente */ } }
    S.base = libR.data || { v: 1, items: {}, lists: [] };
    S.baseSha = libR.sha;
    LS.set('vds.base', { sha: S.baseSha, doc: S.base });
    if (metaR.data) {
      // unisce: tiene la voce più recente per ogni titolo
      const merged = { v: 1, items: { ...metaR.data.items } };
      for (const [k, v] of Object.entries(S.meta.items || {})) {
        if (!merged.items[k] || (v.at || 0) > (merged.items[k].at || 0)) merged.items[k] = v;
      }
      S.meta = merged;
      S.metaSha = metaR.sha;
      LS.set('vds.meta', { sha: S.metaSha, doc: S.meta });
    }
    S.loaded = true;
    S.lastFetch = Date.now();
    materialize();
    setSync(S.ops.length ? 'saving' : 'idle');
    notify();
    if (S.ops.length) flush();
    return true;
  } catch (e) {
    console.error(e);
    S.loaded = !!S.base;
    setSync('error', e.auth ? 'Il token GitHub non funziona più (forse è scaduto). Incolla un token nuovo in Impostazioni: i dati sono al sicuro nella repo.' : `Non riesco a raggiungere GitHub (${e.message}). Ti mostro l’ultima copia salvata su questo dispositivo.`);
    return false;
  }
}

// ---------- metadati TMDB ----------
const H = 3600 * 1000;
function needsRefresh(key, it, m, now) {
  if (!m) return true;
  const age = now - (m.at || 0);
  if (key.startsWith('tv:')) {
    if (m.st === 'Ended' || m.st === 'Canceled') return age > 30 * 24 * H;
    if (it && it.status === 'dropped') return age > 7 * 24 * H;
    return age > 12 * H;
  }
  if (m.rd && m.rd > today()) return age > 3 * 24 * H;
  return age > 60 * 24 * H;
}

export function allKeys() {
  const keys = new Set(Object.keys(S.lib?.items || {}));
  for (const l of S.lib?.lists || []) for (const e of l.items) keys.add(e.key);
  return [...keys];
}

// Aggiorna un titolo in meta e, se sono usciti episodi nuovi, rimette in corso le serie in pari/completate.
export function putMeta(key, m) {
  const old = S.meta.items[key];
  S.meta.items[key] = m;
  S.metaDirty = true;
  repairNumbering(key, m);
  const it = item(key);
  if (it && it.type === 'tv' && old && (it.status === 'uptodate' || it.status === 'completed')) {
    const a0 = airedCount(old); const a1 = airedCount(m);
    if (a1 > a0 && watchedCount(it) < a1) {
      dispatch({ op: 'set', key, fields: { status: 'watching' }, msg: `Nuovi episodi: ${it.title}` });
    }
  }
}

// Alcuni anime importati da TV Time hanno una stagione numerata da 1 mentre TMDB la numera in modo
// assoluto (es. Naruto Shippuden stagione 21: 1–8 invece di 480–487). Se tutti gli episodi segnati
// stanno prima dell'inizio della stagione e ci entrano, li sposta sui numeri giusti.
function repairNumbering(key, m) {
  const it = item(key);
  if (!it || it.type !== 'tv' || !isAbsolute(m)) return;
  const add = []; const rm = [];
  for (const [s, eps] of Object.entries(it.eps || {})) {
    const sn = Number(s);
    if (sn === 0) continue;
    const [first, last] = epRange(m, sn);
    const nums = Object.keys(eps).map(Number);
    if (!nums.length || first <= 1 || Math.max(...nums) >= first || Math.max(...nums) > last - first + 1) continue;
    for (const e of nums) { rm.push([s, String(e)]); add.push([s, String(first + e - 1), eps[String(e)]]); }
  }
  if (add.length) dispatch({ op: 'eps', key, rm, add: [], msg: `Corregge la numerazione degli episodi di ${it.title}` }, { op: 'eps', key, add });
}

let metaRunning = false;
export async function refreshMeta({ force = false } = {}) {
  if (metaRunning || !tmdbToken() || !S.lib) return;
  metaRunning = true;
  try {
    const now = Date.now();
    const items = S.lib.items;
    const keys = allKeys()
      .filter((k) => force || needsRefresh(k, items[k], S.meta.items[k], now))
      .sort((a, b) => {
        const ma = S.meta.items[a] ? 1 : 0; const mb = S.meta.items[b] ? 1 : 0;
        if (ma !== mb) return ma - mb; // prima quelli senza dati
        return (items[b]?.last || '').localeCompare(items[a]?.last || '');
      });
    if (!keys.length) return;
    const firstBuild = keys.filter((k) => !S.meta.items[k]).length > 40;
    S.metaJob = { done: 0, total: keys.length, firstBuild };
    notify();
    let sinceSave = 0;
    await pool(keys, 6, async (key) => {
      const [type, id] = key.split(':');
      const d = await fetchDetails(type, Number(id));
      if (d) putMeta(key, metaFromDetails(type, d));
      S.metaJob.done += 1;
      sinceSave += 1;
      if (sinceSave >= 60) { sinceSave = 0; LS.set('vds.meta', { sha: S.metaSha, doc: S.meta }); }
      notify();
    });
    LS.set('vds.meta', { sha: S.metaSha, doc: S.meta });
    await saveMeta();
  } finally {
    metaRunning = false;
    S.metaJob = null;
    notify();
  }
}

export async function saveMeta() {
  if (!S.metaDirty || !hasGhToken() || !S.loaded) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = JSON.stringify(S.meta);
      S.metaSha = await ghPut('meta.json', text, S.metaSha, 'Aggiorna i dati da TMDB');
      S.metaDirty = false;
      LS.set('vds.meta', { sha: S.metaSha, doc: S.meta });
      return;
    } catch (e) {
      if (!(e instanceof GhError && e.conflict)) { console.warn('meta', e); return; }
      const r = await ghGet('meta.json');
      if (r.data) {
        for (const [k, v] of Object.entries(r.data.items || {})) {
          const mine = S.meta.items[k];
          if (!mine || (v.at || 0) > (mine.at || 0)) S.meta.items[k] = v;
        }
      }
      S.metaSha = r.sha;
    }
  }
}

let metaSaveTimer = null;
export function scheduleMetaSave() {
  LS.set('vds.meta', { sha: S.metaSha, doc: S.meta });
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => { if (!metaRunning) saveMeta(); }, 8000);
}

// Scrive config.json (condiviso tra i dispositivi).
export async function saveConfig(patch) {
  const r = await ghGet('config.json');
  const cfg = { ...(r.data || {}), ...patch };
  await ghPut('config.json', JSON.stringify(cfg, null, 2) + '\n', r.sha, 'Aggiorna le impostazioni');
}

export function forgetDevice() {
  ['vds.ghToken', 'vds.tmdbToken', 'vds.base', 'vds.ops', 'vds.meta', 'vds.libf', 'vds.upTab', 'vds.lastSaved'].forEach(LS.del);
}

export function resetMetaCache() {
  S.meta = { v: 1, items: {} };
  S.metaDirty = true;
  LS.del('vds.meta');
}

export { LS };
