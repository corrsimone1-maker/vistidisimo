// «Collezione» di un titolo (come su Netflix, chiesta da Simo il 3/11/2026): tutto quello che è collegato
// a una serie o a un film, anime e non, in ordine di uscita e compreso il titolo stesso. Una riga nella
// pagina del titolo e la pagina con tutti (#/collezione/<tv|movie>/<id>; #/extra/<id> porta qui).
//
// Da dove arriva:
// - la saga di TMDB (film);
// - MyAnimeList (serie anime): film, OVA, speciali, spin-off, serie prima e dopo (js/mal.js);
// - Wikidata: seguiti, prequel, spin-off, opere derivate, serie e franchise (js/wikidata.js);
// - TMDB: titoli che cominciano allo stesso modo, «Vis a vis» → «Vis a vis: El oasis» (js/collection.js);
// - collegamenti fatti a mano dal menu ⋯ del titolo o dalla pagina (`links`), meno quelli nascosti
//   (`nolinks`).
import { html, icon, img, posterCard, today, openSheet } from '../ui.js';
import { item, metaOf } from '../store.js';
import { tm, tmdbToken, nonLatin, fetchDetails } from '../tmdb.js';
import { isAnimeResult } from '../derive.js';
import { fetchFranchise, cachedFranchise, saveFranchise, FORMAT_LABEL } from '../mal.js';
import { fetchWiki, cachedWiki } from '../wikidata.js';
import { fetchByTitle, cachedByTitle, miniOf, ensureMini, rememberResult, manualOf } from '../collection.js';
import { checkFiller } from '../filler.js';
import { focusJikan, jikanDown } from '../jikan.js';
import { getSaga } from './saga.js';
import { cardFor, emptyState, titleOf } from './common.js';
import { rankScore } from './search.js';
import * as A from '../actions.js';

let repaint = () => {};
const known = new Map(); // key -> { t, ot, co, anime } (dalla pagina del titolo)
const states = new Map(); // key -> { wd, tt, mal }

// Una fonte che si scarica una volta per apertura dell'app (se la copia sul telefono è vecchia).
function source(cached, fetcher, done) {
  const s = { k: cached?.k || null, loading: false, err: '' };
  if (!cached || cached.stale) {
    s.loading = true;
    fetcher().then((k) => { s.k = k; }).catch((e) => { s.err = e.message; }).finally(() => { s.loading = false; done(); });
  }
  return s;
}

function stateOf(key, x) {
  let s = states.get(key);
  if (!s) { s = {}; states.set(key, s); }
  const done = () => repaint();
  if (!s.wd) s.wd = source(cachedWiki(key), () => fetchWiki(key), done);
  if (!s.tt && tmdbToken() && (x.t || x.ot)) s.tt = source(cachedByTitle(key), () => fetchByTitle(key, [x.ot, x.t], x.l), done);
  // MyAnimeList solo per le serie anime
  if (!s.mal && key.startsWith('tv:') && x.anime) {
    const c = cachedFranchise(key);
    s.mal = { data: c, loading: false, err: '' };
    // MyAnimeList spento o che non risponde: si usa solo quello che è già sul telefono
    if ((!c || c.stale) && !jikanDown()) {
      s.mal.loading = true;
      // mentre arriva si mostra quello che c'è (MyAnimeList dà meno di una voce al secondo)
      const onPartial = (d) => { if (s.mal.loading && (!s.mal.data || s.mal.data.partial)) { s.mal.data = d; done(); } };
      fetchFranchise(key, metaOf(key) || { t: x.t, ot: x.ot, y: x.y }, x.t, onPartial)
        .then((d) => { saveFranchise(key, d); s.mal.data = d; s.mal.err = ''; })
        .catch((e) => { s.mal.err = e.message; })
        .finally(() => { s.mal.loading = false; done(); });
    }
  }
  // gli id MyAnimeList della serie servono anche a sapere se ci sono filler (solo a elenco finito)
  if (s.mal?.data?.mal?.length && !s.mal.data.partial) checkFiller(key, s.mal.data.mal, done);
  return s;
}

// ---------- elenco ----------
// [{ key | mal+u, t, p, d, a, l, kind, self }] in ordine di uscita; loading = qualcosa sta arrivando
function build(key, x) {
  const [type] = key.split(':');
  const s = stateOf(key, x);
  const out = new Map();
  const add = (e) => {
    const id = e.key || `mal:${e.mal}`;
    const cur = out.get(id);
    if (!cur) { out.set(id, { ...e }); return; }
    for (const [k, v] of Object.entries(e)) if (cur[k] == null || cur[k] === '') cur[k] = v;
  };
  add({ key, self: true });
  let sagaLoading = false;
  if (type === 'movie' && x.co) {
    const sg = getSaga(x.co[0]);
    if (!sg) sagaLoading = true;
    else if (!sg.err) for (const f of sg.films) add({ key: `movie:${f.id}`, t: f.t, p: f.p, d: f.d, a: isAnimeResult(f) });
  }
  for (const y of s.mal?.data?.items || []) {
    const l = y.l || (y.f === 'TV' ? 'Spin-off' : FORMAT_LABEL[y.f] || y.f);
    if (y.key) add({ key: y.key, t: y.tt || y.t, p: y.tp || y.c, d: y.d, l, a: true });
    else add({ mal: y.id, u: y.u, t: y.t, p: y.c, d: y.d, l, a: true, kind: y.f === 'Movie' ? 'movie' : 'tv' });
  }
  const man = manualOf(key);
  for (const k of [...(s.wd.k || []), ...(s.tt?.k || []), ...man.add]) add({ key: k });
  for (const k of man.add) out.get(k).manual = true;
  for (const k of man.hide) out.delete(k);
  // titolo, locandina e data di quelli che non li hanno ancora
  const missing = [];
  const list = [];
  for (const e of out.values()) {
    if (e.key) {
      const mi = miniOf(e.key);
      if (mi?.gone) continue;
      if (e.self) Object.assign(e, { t: e.t || x.t || mi?.t, d: e.d || mi?.d || x.d || '', p: e.p || mi?.p, a: x.anime });
      else if (!mi && !e.t) { missing.push(e.key); continue; }
      else for (const f of ['t', 'p', 'd', 'a']) if ((e[f] == null || e[f] === '') && mi?.[f] != null) e[f] = mi[f];
      // titoli in libreria: come li vedi altrove
      if (mi?.lib) e.t = mi.t || e.t;
    }
    list.push(e);
  }
  if (missing.length) ensureMini(missing, () => repaint());
  list.sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999') || (a.t || '').localeCompare(b.t || ''));
  const loading = !!(s.wd.loading || s.tt?.loading || s.mal?.loading || sagaLoading || missing.length);
  return { list, loading, s };
}

const seenEntry = (e) => !!e.key && ['completed', 'uptodate'].includes(item(e.key)?.status);
function counts(list, t) {
  const out = list.filter((e) => e.d && e.d <= t);
  return { seen: out.filter(seenEntry).length, total: out.length, coming: list.length - out.length };
}

function labelOf(e, t) {
  const kind = e.l || ((e.key ? e.key.split(':')[0] : e.kind) === 'movie' ? 'Film' : 'Serie');
  const y = (e.d || '').slice(0, 4);
  return [kind, y ? (e.d > t ? `in uscita ${y}` : y) : ''].filter(Boolean).join(' · ');
}

function card(e, t) {
  const extra = html`<span class="pc-title">${e.t}</span><span class="pc-year">${labelOf(e, t)}</span>`;
  if (e.key) {
    const [type, id] = e.key.split(':');
    if (item(e.key)) return cardFor(e.key, { extra, here: e.self });
    return posterCard({ key: e.key, href: `#/t/${type}/${id}`, title: e.t, poster: e.p, kind: { type, anime: !!e.a }, status: null, extra, here: e.self });
  }
  return posterCard({ href: e.u, ext: true, title: e.t, poster: e.p, kind: { type: e.kind, anime: true }, status: null, extra });
}

// ---------- riga nella pagina del titolo ----------
// x: { t, ot, l, y, d, co, anime } (titolo, originale, lingua originale, anno, data di uscita; co: saga
// TMDB [id, nome], 0 se non c'è, undefined se non si sa ancora)
export function collectionSection(key, x, rerender) {
  repaint = rerender;
  known.set(key, x);
  focusJikan(key); // le richieste a MyAnimeList di questo titolo passano prima
  const { list } = build(key, x);
  if (list.length < 2) return '';
  const [type, id] = key.split(':');
  const t = today();
  const { seen, total } = counts(list, t);
  return html`<section class="row d-fr">
    <div class="row-head"><h2>Collezione <span class="fr-count">${seen}/${total}</span></h2><a class="row-all" href="#/collezione/${type}/${id}">Tutti <span>${list.length}</span></a></div>
    <div class="scroller" data-scroll="col-${type}-${id}">${list.slice(0, 30).map((e) => card(e, t))}</div>
  </section>`;
}

// ---------- pagina ----------
const asked = new Set();
function knownOf(key) {
  const x = known.get(key);
  if (x) return x;
  const m = metaOf(key); const it = item(key);
  if (m) {
    const [type] = key.split(':');
    return { t: titleOf(key, it, m), ot: m.ot, l: m.l, y: m.y, co: type === 'movie' ? m.co : 0, anime: !!(it && typeof it.anime === 'boolean' ? it.anime : (m.g || []).includes(16) && (m.l === 'ja' || (m.c || []).includes('JP'))) };
  }
  // aperta da un link senza essere passati dal titolo: servono i suoi dati da TMDB
  if (!asked.has(key) && tmdbToken()) {
    asked.add(key);
    const [type, id] = key.split(':');
    fetchDetails(type, Number(id)).then((d) => {
      if (!d) return;
      known.set(key, {
        t: d.title || d.name || '', ot: d.original_title || d.original_name || '', l: d.original_language, y: Number((d.release_date || d.first_air_date || '').slice(0, 4)) || null,
        co: type === 'movie' ? (d.belongs_to_collection ? [d.belongs_to_collection.id, d.belongs_to_collection.name] : 0) : 0,
        anime: isAnimeResult({ genre_ids: (d.genres || []).map((g) => g.id), original_language: d.original_language, origin_country: d.origin_country }),
        d: d.release_date || d.first_air_date || '',
      });
      repaint();
    }).catch(() => {});
  }
  return null;
}

export function renderCollezione(type, id, rerender) {
  repaint = rerender;
  const key = `${type}:${id}`;
  focusJikan(key);
  const x = knownOf(key);
  const editable = !!item(key);
  const head = html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Collezione</h1>
    ${editable ? html`<button class="btn ghost small push-right" data-act="col-edit" data-key="${key}">Modifica</button>` : ''}
  </header>`;
  if (!x) return html`${head}<p class="muted pad">Carico…</p>`;
  const { list, loading, s } = build(key, x);
  const name = x.t || titleOf(key, item(key), metaOf(key));
  const t = today();
  const sub = html`<p class="col-of">${name}</p>`;
  if (list.length < 2) {
    if (loading) return html`${head}${sub}<p class="muted pad">Cerco i titoli collegati…</p>`;
    return html`${head}${sub}${emptyState(s.mal?.err || 'Nessun titolo collegato')}${editable ? html`<div class="pad"><button class="btn ghost wide" data-act="col-edit" data-key="${key}">${icon.plus}Collega un titolo</button></div>` : ''}`;
  }
  const { seen, total, coming } = counts(list, t);
  return html`${head}${sub}
  <p class="person-count"><b>${seen}</b> ${seen === 1 ? 'visto' : 'visti'} su ${total}${coming ? ` · ${coming} in uscita` : ''}</p>
  <div class="grid person-grid">${list.map((e) => card(e, t))}</div>
  ${s.mal?.err && !s.mal?.data?.items?.length ? html`<p class="muted pad">${s.mal.err}</p>` : ''}`;
}

// ---------- modifica (solo titoli in libreria) ----------
// Cerca un titolo su TMDB e lo collega (o lo toglie); senza ricerca mostra quelli collegati con la ×
// e quelli nascosti con «+». Il foglio resta aperto e la pagina dietro si aggiorna.
export function collectionEditSheet(key) {
  if (!item(key)) return;
  const x = knownOf(key) || { t: item(key).title };
  const st = { q: '', res: null, seq: 0 };
  let timer = null;
  openSheet(String(html`
    <h3 class="sheet-title">Collezione</h3>
    <label class="search-box">${icon.search}<input type="search" data-ce-q placeholder="Cerca un titolo" autocomplete="off" autocorrect="off" enterkeyhint="search"></label>
    <div class="pz-list ce-list"></div>
    <button class="btn primary wide" data-close>Fatto</button>`), {
    className: 'pz-sheet ce-sheet',
    onMount: (el) => {
      const box = el.querySelector('.ce-list');
      const input = el.querySelector('[data-ce-q]');
      const thumb = (p) => html`<span class="pz-thumb">${p ? html`<img loading="lazy" src="${img(p, 'w185')}" alt="">` : ''}</span>`;
      const row = (k, title, p, sub, btn) => html`<div class="pz-row">
        <span class="pz-item ce-item">${thumb(p)}<span class="pz-txt"><b>${title}</b><small>${sub}</small></span></span>
        ${btn}</div>`;
      const t = today();
      const paint = () => {
        const { list } = build(key, x);
        const inCol = new Map(list.filter((e) => !e.self).map((e) => [e.key || `mal:${e.mal}`, e]));
        const man = manualOf(key);
        if (!st.q.trim()) {
          const others = [...inCol.entries()];
          // nascosti: titolo e locandina da TMDB, o dalla voce di MyAnimeList
          const malItems = new Map((states.get(key)?.mal?.data?.items || []).map((y) => [`mal:${y.id}`, y]));
          const hidden = [...man.hide].map((k) => {
            const y = malItems.get(k);
            if (y) return { k, t: y.tt || y.t, p: y.tp || y.c, sub: labelOf({ d: y.d, l: y.l, kind: 'tv' }, t) };
            const mi = k.startsWith('mal:') ? null : miniOf(k);
            return mi && !mi.gone ? { k, t: mi.t, p: mi.p, sub: labelOf({ key: k, d: mi.d }, t) } : null;
          }).filter(Boolean);
          box.innerHTML = String(html`
            ${others.length ? others.map(([k, e]) => row(k, e.t, e.p, labelOf(e, t), html`<button class="icon-btn pz-x" data-ce="rm" data-k="${k}" aria-label="Togli ${e.t}">${icon.x}</button>`)) : html`<p class="muted pz-none">Nessun titolo collegato</p>`}
            ${hidden.length ? html`<p class="sheet-label ce-label">Nascosti</p>${hidden.map((h) => row(h.k, h.t, h.p, h.sub, html`<button class="icon-btn pz-x" data-ce="show" data-k="${h.k}" aria-label="Rimetti ${h.t}">${icon.plus}</button>`))}` : ''}`);
        } else if (!st.res) {
          box.innerHTML = String(html`<p class="muted pz-none">Cerco…</p>`);
        } else {
          const shown = st.res.filter((r) => `${r.media_type}:${r.id}` !== key);
          box.innerHTML = String(shown.length ? html`${shown.map((r) => {
            const k = `${r.media_type}:${r.id}`;
            const on = inCol.has(k);
            const y = (r.release_date || r.first_air_date || '').slice(0, 4);
            const kind = r.media_type === 'movie' ? 'Film' : 'Serie';
            return row(k, r.tt, item(k)?.poster || r.poster_path, [kind, y].filter(Boolean).join(' · '),
              html`<button class="icon-btn pz-x ce-tog ${on ? 'on' : ''}" data-ce="${on ? 'rm' : 'add'}" data-k="${k}" aria-label="${on ? 'Togli' : 'Collega'} ${r.tt}">${on ? icon.check : icon.plus}</button>`);
          })}` : html`<p class="muted pz-none">Nessun risultato</p>`);
        }
        box.querySelectorAll('[data-ce]').forEach((b) => {
          b.onclick = () => {
            const k = b.dataset.k; const what = b.dataset.ce;
            const e = inCol.get(k);
            const title = e?.t || st.res?.find((r) => `${r.media_type}:${r.id}` === k)?.tt || miniOf(k)?.t || '';
            if (what === 'add') {
              if (man.hide.has(k)) A.unhideTitle(key, k, title);
              else { const r = st.res?.find((y) => `${y.media_type}:${y.id}` === k); if (r && !miniOf(k)) rememberResult(k, { ...r, title: r.tt, name: r.tt }); A.linkTitle(key, k, title); }
            } else if (what === 'rm') A.unlinkTitle(key, k, { manual: !!e?.manual, otherTitle: title });
            else if (what === 'show') A.unhideTitle(key, k, title);
            paint();
          };
        });
      };
      const run = async () => {
        const q = st.q.trim();
        const seq = ++st.seq;
        if (!q) { paint(); return; }
        st.res = null; paint();
        try {
          const [it, en] = await Promise.all([
            tm('/search/multi', { query: q, include_adult: 'false' }),
            tm('/search/multi', { query: q, include_adult: 'false', language: 'en-US' }).catch(() => null),
          ]);
          if (seq !== st.seq) return;
          const enT = new Map((en?.results || []).map((r) => [`${r.media_type}:${r.id}`, r.title || r.name]));
          const seen = new Set();
          const all = [...(it?.results || []), ...(en?.results || [])].filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && !seen.has(`${r.media_type}:${r.id}`) && seen.add(`${r.media_type}:${r.id}`));
          all.forEach((r, i) => {
            const k = `${r.media_type}:${r.id}`;
            const tt = r.title || r.name || '';
            r.tt = nonLatin(tt) && enT.get(k) && !nonLatin(enT.get(k)) ? enT.get(k) : tt;
            r.sc = rankScore(r, q, [tt, enT.get(k), r.original_title || r.original_name], i, all.length);
          });
          st.res = all.sort((a, b) => b.sc - a.sc).slice(0, 20);
        } catch { if (seq === st.seq) st.res = []; }
        if (seq === st.seq) paint();
      };
      input.addEventListener('input', () => { st.q = input.value; clearTimeout(timer); timer = setTimeout(run, 350); if (!st.q.trim()) { st.res = null; paint(); } });
      paint();
    },
  });
}

export const collezioneActions = {
  'col-edit': (el) => collectionEditSheet(el.dataset.key),
};
