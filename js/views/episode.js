// Scheda di un episodio (trama più completa che TMDB ha, regia, tutti i fotogrammi) e «Ripasso»
// (tutti gli episodi visti di una stagione, con immagine e trama, per ricordarsi dove eravamo rimasti).
// Le trame: italiano, se manca inglese, se manca spagnolo; altre lingue no.
import { html, raw, icon, img, fmtDay, today, daysBetween, openSheet, toast, closeAllSheets } from '../ui.js';
import { item, metaOf } from '../store.js';
import { fetchEpisode, fetchSeason, tmdbToken, genericName } from '../tmdb.js';
import { isWatched, isAired, rewatchOf, neighbors, watchedList, lastWatchDate, furthest, nextEpisode } from '../derive.js';
import * as A from '../actions.js';
import { getSeason } from './upcoming.js';
import { titleOf, emptyState, seenTitles } from './common.js';

let repaint = () => {};
const epCache = new Map(); // "id:s:e" -> dati | 'loading' | { err }
const langCache = new Map(); // "id:s:lang" -> stagione | 'loading' | null
const revealed = new Set(); // episodi non visti di cui hai chiesto di vedere trama e immagini (solo per questa sessione)
let cur = null; // { id, s, e } della scheda aperta


function getEpisode(id, s, e) {
  const k = `${id}:${s}:${e}`;
  const v = epCache.get(k);
  if (v === undefined && tmdbToken()) {
    epCache.set(k, 'loading');
    fetchEpisode(id, s, e)
      .then((d) => { epCache.set(k, d || { err: 'TMDB non conosce questo episodio.' }); repaint(); })
      .catch((err) => { epCache.set(k, { err: err.message }); repaint(); });
    return null;
  }
  return v && v !== 'loading' ? v : null;
}

function getSeasonIn(id, s, language) {
  const k = `${id}:${s}:${language}`;
  const v = langCache.get(k);
  if (v === undefined && tmdbToken()) {
    langCache.set(k, 'loading');
    fetchSeason(id, s, language).then((d) => { langCache.set(k, d); repaint(); }).catch(() => langCache.set(k, null));
    return null;
  }
  return v && v !== 'loading' ? v : null;
}

const epName = (name, s, e) => (name && !genericName(name) ? name : (s === 0 ? `Speciale ${e}` : `Episodio ${e}`));
export const code = (s, e) => (s === 0 ? `Speciale ${e}` : `S${s} · E${e}`);

export function agoText(day) {
  if (!day) return '';
  const n = daysBetween(day, today());
  if (n <= 0) return 'oggi';
  if (n === 1) return 'ieri';
  if (n < 30) return `${n} giorni fa`;
  const mo = Math.round(n / 30.44);
  if (mo < 12) return mo === 1 ? 'un mese fa' : `${mo} mesi fa`;
  const y = Math.floor(mo / 12);
  const rest = mo % 12;
  const ys = y === 1 ? 'un anno' : `${y} anni`;
  return rest >= 3 && y < 3 ? `${ys} e ${rest === 1 ? 'un mese' : `${rest} mesi`} fa` : `${ys} fa`;
}

// Cerchio di spunta su un episodio già visto: rivisto, togli una rivisione, oppure non visto.
export function watchedEpisodeSheet(key, s, e) {
  const it = item(key);
  if (!isWatched(it, s, e)) return;
  const rw = rewatchOf(it, s, e);
  const seenOn = it.eps[String(s)][String(e)];
  openSheet(String(html`
    <h3 class="sheet-title">${code(s, e)}</h3>
    <p class="sheet-text">${seenOn ? `Visto il ${fmtDay(seenOn)}` : 'Visto'}${rw ? ` · ${rw + 1} volte` : ''}</p>
    <div class="opt-list">
      <button class="opt act-opt" data-o="rw">${icon.replay}L’ho rivisto</button>
      ${rw ? html`<button class="opt act-opt" data-o="rw-1">${icon.minus}Togli una rivisione</button>` : ''}
      <button class="opt act-opt bad" data-o="off">${icon.x}Segna come non visto</button>
    </div>`), {
    onMount: (el, close) => {
      el.querySelectorAll('[data-o]').forEach((b) => {
        b.onclick = () => {
          close();
          const o = b.dataset.o;
          if (o === 'rw') { A.setEpisodeRewatch(key, s, e, rw + 1); toast(`${code(s, e)}: visto ${rw + 2} volte`); }
          if (o === 'rw-1') A.setEpisodeRewatch(key, s, e, rw - 1);
          if (o === 'off') A.unmarkEpisodes(key, [[s, e]]);
        };
      });
    },
  });
}

// Fotogramma grande e nitido. TMDB elenca per i fotogrammi solo w92/w185/w300/original: w780 è una
// misura dei banner che di solito va anche qui; se non va si ripiega sull'originale.
function bigImg(path, { lazy = false } = {}) {
  return html`<img ${lazy ? raw('loading="lazy"') : ''} src="${img(path, 'w780')}" onerror="this.onerror=null;this.src='${img(path, 'original')}'" alt="">`;
}

function paragraphs(text) {
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => html`<p>${p}</p>`);
}

// ---------- scheda episodio ----------
export function renderEpisode(id, s, e, rerender) {
  repaint = rerender;
  cur = { id, s, e };
  const key = `tv:${id}`;
  const it = item(key); const m = metaOf(key);
  const show = titleOf(key, it, m) || seenTitles.get(key)?.title || 'Torna alla serie';
  const d = getEpisode(id, s, e);
  const err = d?.err;
  const data = err ? null : d;
  const sd = getSeason(id, s, () => repaint());
  const se = sd?.eps?.find((x) => x.n === e);
  const name = epName(data?.name || se?.name, s, e);
  const air = data?.air || se?.air || null;
  const rt = data?.rt || se?.rt || null;
  const watched = isWatched(it, s, e);
  const aired = air ? air <= today() : isAired(m, s, e);
  const ek = `${id}:${s}:${e}`;
  const hidden = !watched && !revealed.has(ek);
  const stills = data?.stills?.length ? data.stills : (se?.still ? [se.still] : []);
  const ov = data ? data.ov : (se?.ov || '');
  const seenOn = watched ? it.eps[String(s)][String(e)] : '';
  const rw = rewatchOf(it, s, e);
  const { prev, next } = neighbors(m, s, e);
  const loading = !d && tmdbToken();

  const facts = [];
  if (data?.directors?.length) facts.push(['Regia', data.directors.join(', ')]);
  if (data?.writers?.length) facts.push(['Sceneggiatura', data.writers.join(', ')]);

  let plot;
  if (hidden) plot = html`<button class="btn ghost small" data-act="ep-reveal">${icon.eye}Mostra trama e immagini</button>`;
  else if (ov) plot = html`<div class="epd-ov">${paragraphs(ov)}</div>`;
  else if (loading || (!data && !err)) plot = html`<p class="muted">Carico la trama…</p>`;
  else plot = html`<p class="muted">${err || 'Trama non disponibile.'}</p>`;

  return html`
  <div class="epd">
    <div class="epd-hero ${hidden ? 'veiled' : ''}">
      ${stills[0] ? (hidden
        ? html`<img src="${img(stills[0], 'w300')}" alt="">`
        : html`<button class="epd-hero-btn" data-act="ep-view" data-i="0" aria-label="Apri l’immagine">${bigImg(stills[0])}</button>`)
        : html`<div class="epd-ph">${icon.tv}</div>`}
      ${hidden && (stills.length || ov || data) ? html`<button class="veil" data-act="ep-reveal" aria-label="Mostra trama e immagini">${icon.eye}<b>Mostra</b></button>` : ''}
    </div>
    <div class="hero-bar">
      <button class="icon-btn glass" data-act="back" aria-label="Indietro">${icon.back}</button>
    </div>
    <div class="epd-head">
      <a class="epd-show" href="#/t/tv/${id}">${show}</a>
      <p class="epd-code">${s === 0 ? `Speciale · Episodio ${e}` : `Stagione ${s} · Episodio ${e}`}</p>
      <h1>${name}</h1>
      <p class="epd-meta">${air ? (aired ? `Uscito il ${fmtDay(air)}` : `Esce il ${fmtDay(air)}`) : ''}${air && rt ? ' · ' : ''}${rt ? `${rt} min` : ''}</p>
    </div>
    <div class="epd-seen-row">
      <button class="check-btn ${it ? `st-${it.status}` : ''} ${watched ? 'on' : ''}" data-act="ep-check" ${aired || watched ? '' : 'disabled'} aria-label="${watched ? 'Rivisto o non visto' : 'Segna come visto'}">${icon.check}</button>
      <span class="epd-seen">${watched ? html`<b>${rw ? `Visto ${rw + 1} volte` : 'Visto'}</b>${seenOn ? html`<small>${rw ? 'la prima volta ' : ''}il ${fmtDay(seenOn)}</small>` : ''}` : html`<b>${aired ? 'Da vedere' : 'Non ancora uscito'}</b>`}</span>
    </div>
    <section class="d-sec epd-plot"><h2>Trama</h2>${plot}</section>
    ${facts.length ? html`<dl class="facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}
    ${!hidden && stills.length ? html`<section class="d-sec">
      <h2>Immagini <span class="count">${stills.length}</span></h2>
      <div class="stills">${stills.map((p, i) => html`<button class="still" data-act="ep-view" data-i="${i}" aria-label="Apri l’immagine ${i + 1}"><img loading="lazy" src="${img(p, 'w300')}" alt=""></button>`)}</div>
    </section>` : (loading && !hidden ? html`<p class="muted pad epd-loading">Carico le immagini…</p>` : '')}
    <nav class="epd-nav">
      ${prev ? html`<a class="btn ghost" href="#/ep/${id}/${prev[0]}/${prev[1]}">${icon.back}${code(...prev)}</a>` : html`<span></span>`}
      ${next ? html`<a class="btn ghost next" href="#/ep/${id}/${next[0]}/${next[1]}">${code(...next)}${icon.back}</a>` : html`<span></span>`}
    </nav>
    ${watched ? html`<a class="btn ghost wide epd-rp" href="#/ripasso/${id}/${s}">${icon.list}Ripassa la stagione</a>` : ''}
  </div>`;
}

// Visore a tutto schermo: si scorre di lato, si chiude con la ×.
function openViewer(paths, start) {
  closeAllSheets();
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap viewer';
  wrap.innerHTML = String(html`
    <div class="viewer-track">${paths.map((p) => html`<div class="viewer-cell"><img loading="lazy" src="${img(p, 'original')}" alt=""></div>`)}</div>
    <div class="viewer-top"><span class="viewer-n">${start + 1} / ${paths.length}</span><button class="icon-btn glass" data-viewer-close aria-label="Chiudi">${icon.x}</button></div>`);
  root.appendChild(wrap);
  const track = wrap.querySelector('.viewer-track');
  const n = wrap.querySelector('.viewer-n');
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; wrap.classList.add('in'); });
  track.addEventListener('scroll', () => { n.textContent = `${Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + 1} / ${paths.length}`; }, { passive: true });
  const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowRight') track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
    if (ev.key === 'ArrowLeft') track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
  };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-viewer-close]').onclick = close;
}

function stillsOf(id, s, e) {
  const d = epCache.get(`${id}:${s}:${e}`);
  if (d && d !== 'loading' && d.stills?.length) return d.stills;
  const se = getSeason(id, s)?.eps?.find((x) => x.n === e);
  return se?.still ? [se.still] : [];
}

function toggleWatched() {
  const { id, s, e } = cur;
  const key = `tv:${id}`;
  const it = item(key);
  if (isWatched(it, s, e)) watchedEpisodeSheet(key, s, e);
  else {
    const m = metaOf(key);
    const seen = seenTitles.get(key);
    A.markEpisodes(key, [[s, e]], { type: 'tv', id, title: titleOf(key, it, m) || seen?.title || '', year: m?.y ?? seen?.year ?? null }, { offerPrevious: true });
  }
}

// ---------- ripasso ----------
export function renderRipasso(id, sParam, rerender) {
  repaint = rerender;
  const key = `tv:${id}`;
  const it = item(key); const m = metaOf(key);
  const show = titleOf(key, it, m) || 'Serie';
  const all = watchedList(it, { specials: true });
  const head = html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>Ripasso</h1>
  </header>`;
  if (!all.length) return html`${head}${emptyState('Nessun episodio visto')}`;
  const seasonsSeen = [...new Set(all.map(([s]) => s))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  const [fs, fe] = furthest(it);
  const s = seasonsSeen.includes(sParam) ? sParam : (fs || seasonsSeen[0]);
  const list = all.filter(([x]) => x === s);
  const sd = getSeason(id, s, () => repaint());
  // trame e titoli mancanti in italiano: si chiede la stagione in inglese, e solo se serve in spagnolo
  const byN = (d) => new Map((d?.eps || []).map((x) => [x.n, x]));
  const itMap = byN(sd);
  const needEn = sd && list.some(([, e]) => !itMap.get(e)?.ov || genericName(itMap.get(e)?.name));
  const enMap = byN(needEn ? getSeasonIn(id, s, 'en-US') : null);
  const needEs = needEn && langCache.get(`${id}:${s}:en-US`) !== 'loading' && list.some(([, e]) => !itMap.get(e)?.ov && !enMap.get(e)?.ov);
  const esMap = byN(needEs ? getSeasonIn(id, s, 'es-ES') : null);
  const pending = (l) => { const v = langCache.get(`${id}:${s}:${l}`); return v === undefined || v === 'loading'; };
  const stillLoading = tmdbToken() && (!sd || (needEn && pending('en-US')) || (needEs && pending('es-ES')));
  const last = lastWatchDate(it);
  const nx = nextEpisode(it, m);

  const card = ([, e]) => {
    const a = itMap.get(e); const b = enMap.get(e); const c = esMap.get(e);
    const name = [a?.name, b?.name, c?.name].find((x) => x && !genericName(x)) || '';
    const ov = a?.ov || b?.ov || c?.ov || '';
    const still = a?.still || b?.still || c?.still;
    const seen = it.eps[String(s)][String(e)];
    const rw = rewatchOf(it, s, e);
    return html`<a class="rp-card" href="#/ep/${id}/${s}/${e}">
      <div class="rp-still">${still ? bigImg(still, { lazy: true }) : html`<span>${icon.tv}</span>`}<span class="rp-n">${s === 0 ? 'SP' : ''}${e}</span></div>
      <div class="rp-body">
        <b class="rp-name">${epName(name, s, e)}</b>
        <small>${seen ? `visto il ${fmtDay(seen)}` : 'visto'}${rw ? ` · ${rw + 1} volte` : ''}</small>
        ${ov ? html`<div class="rp-ov">${paragraphs(ov)}</div>` : html`<p class="rp-ov muted">${stillLoading ? 'Carico la trama…' : 'Trama non disponibile.'}</p>`}
      </div>
    </a>`;
  };

  return html`
  ${head}
  <a class="rp-show" href="#/t/tv/${id}">${show}</a>
  ${fs ? html`<p class="rp-intro">Ultimo visto <b>${code(fs, fe)}</b>${last ? `, ${agoText(last)}` : ''}</p>` : ''}
  ${seasonsSeen.length > 1 ? html`<div class="chips scroll-x rp-seasons" data-scroll="rp-seasons">
    ${seasonsSeen.map((x) => html`<a class="chip ${x === s ? 'on' : ''}" href="#/ripasso/${id}/${x}">${x === 0 ? 'Speciali' : `Stagione ${x}`} <span>${all.filter(([y]) => y === x).length}</span></a>`)}
  </div>` : ''}
  ${list.length > 12 ? html`<button class="btn ghost small rp-jump" data-act="rp-end">${icon.chevron}Vai all’ultimo visto (E${list[list.length - 1][1]})</button>` : ''}
  <div class="rp-list">${list.map(card)}</div>
  ${nx && s === fs ? html`<a class="btn primary wide rp-next" href="#/ep/${id}/${nx.s}/${nx.e}">Il prossimo da vedere: ${code(nx.s, nx.e)}</a>` : ''}`;
}

export const episodeActions = {
  'ep-check': () => toggleWatched(),
  'rp-end': () => {
    const cards = document.querySelectorAll('.rp-card');
    const lastCard = cards[cards.length - 1];
    if (lastCard) window.scrollTo(0, lastCard.getBoundingClientRect().top + window.scrollY - 12);
  },
  'ep-reveal': (el, { rerender }) => { revealed.add(`${cur.id}:${cur.s}:${cur.e}`); rerender(); },
  'ep-view': (el) => {
    const { id, s, e } = cur;
    const paths = stillsOf(id, s, e);
    if (paths.length) openViewer(paths, Math.min(paths.length - 1, Number(el.dataset.i) || 0));
  },
};
