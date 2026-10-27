import { html, raw, icon, img, fmtRating, fmtDay, today, statusLabel, openSheet, confirmSheet, promptSheet, toast, kindBadge, tube, esc } from '../ui.js';
import { item, metaOf, lib, putMeta, scheduleMetaSave } from '../store.js';
import { fetchDetails, metaFromDetails, tmdbToken } from '../tmdb.js';
import { isAnime, isAnimeResult, progress, isWatched, isAired, epRange, watchedCount, airedCount, nextEpisode } from '../derive.js';
import * as A from '../actions.js';
import { getSeason } from './upcoming.js';
import { titleOf } from './common.js';

let cur = { key: null, d: null, err: '', open: new Set() };
let repaint = () => {};

const TV_STATUS = { 'Returning Series': 'In corso', Ended: 'Conclusa', Canceled: 'Cancellata', 'In Production': 'In produzione', Planned: 'Annunciata', Pilot: 'Pilot' };
const MOVIE_STATUS = { Released: 'Uscito', 'Post Production': 'In post-produzione', 'In Production': 'In produzione', Planned: 'Annunciato', Rumored: 'Voci di corridoio', Canceled: 'Cancellato' };

async function load(type, id) {
  const key = `${type}:${id}`;
  if (!tmdbToken()) return;
  try {
    const d = await fetchDetails(type, id, { overview: true });
    if (cur.key !== key) return;
    if (!d) { cur.err = 'TMDB non conosce questo titolo.'; repaint(); return; }
    cur.d = d;
    if (item(key) || metaOf(key)) { putMeta(key, metaFromDetails(type, d)); scheduleMetaSave(); }
    repaint();
  } catch (e) {
    if (cur.key === key) { cur.err = e.message; repaint(); }
  }
}

const info = () => {
  const [type, id] = cur.key.split(':');
  const d = cur.d; const m = metaOf(cur.key); const it = item(cur.key);
  return { type, id: Number(id), title: d?.title || d?.name || m?.t || it?.title || '', year: Number((d?.release_date || d?.first_air_date || '').slice(0, 4)) || m?.y || it?.year || null };
};

function runtimeText(min) {
  if (!min) return '';
  const h = Math.floor(min / 60); const mm = min % 60;
  return h ? `${h} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
}

// ---------- stagioni ----------
function seasonList(m) {
  const d = cur.d;
  if (d?.seasons) return d.seasons.map((s) => ({ n: s.season_number, name: s.name, count: s.episode_count || 0, air: s.air_date }));
  return (m?.ss || []).map(([n, count, air]) => ({ n, name: n === 0 ? 'Speciali' : `Stagione ${n}`, count, air }));
}

function seasonEpisodes(id, s, count) {
  const data = getSeason(id, s.n, () => repaint());
  if (data?.eps?.length) return { eps: data.eps, loaded: true };
  const first = s.n > 0 ? epRange(metaOf(cur.key), s.n)[0] : 1;
  return { eps: Array.from({ length: count }, (_, i) => ({ n: first + i, name: '', air: null })), loaded: false };
}

function seasonBlock(key, it, m, s) {
  const id = Number(key.split(':')[1]);
  const watched = Object.keys(it?.eps?.[String(s.n)] || {}).length;
  const open = cur.open.has(s.n);
  const p = s.count ? Math.min(1, watched / s.count) : 0;
  const allDone = s.count > 0 && watched >= s.count;
  let body = '';
  if (open) {
    const { eps, loaded } = seasonEpisodes(id, s, s.count);
    body = html`<ul class="eps">
      ${eps.map((e) => {
        const on = isWatched(it, s.n, e.n);
        const aired = loaded ? (e.air ? e.air <= today() : false) : isAired(m, s.n, e.n);
        const when = e.air ? (e.air <= today() ? fmtDay(e.air) : `Esce il ${fmtDay(e.air, { year: false })}`) : '';
        const seenOn = on ? it.eps[String(s.n)][String(e.n)] : '';
        return html`<li class="ep ${on ? 'on' : ''} ${aired || on ? '' : 'future'}">
          <span class="ep-n">${e.n}</span>
          <span class="ep-t">${e.name || `Episodio ${e.n}`}<small>${when}${seenOn ? html` <span class="seen">visto il ${fmtDay(seenOn)}</span>` : ''}</small></span>
          <button class="check-btn small ${on ? 'on' : ''}" data-act="d-ep" data-s="${s.n}" data-e="${e.n}" ${aired || on ? '' : 'disabled'} aria-label="${on ? 'Segna come non visto' : 'Segna come visto'}">${icon.check}</button>
        </li>`;
      })}
      ${!loaded && tmdbToken() ? html`<li class="ep muted">Carico gli episodi…</li>` : ''}
    </ul>`;
  }
  return html`<div class="season ${open ? 'open' : ''}">
    <div class="season-row">
      <button class="season-head" data-act="d-season" data-s="${s.n}" aria-expanded="${open}">
        <span class="s-name">${s.n === 0 ? 'Speciali' : (s.name || `Stagione ${s.n}`)}</span>
        <span class="s-count">${watched}/${s.count}</span>
        <span class="chev">${icon.chevron}</span>
      </button>
      <button class="check-btn small ${allDone ? 'on' : ''}" data-act="d-season-all" data-s="${s.n}" aria-label="${allDone ? 'Togli la stagione' : 'Segna tutta la stagione'}">${icon.check}</button>
    </div>
    ${it ? tube(it.status, p) : ''}
    ${body}
  </div>`;
}

// ---------- pagina ----------
export function renderDetail(type, id, rerender) {
  repaint = rerender;
  const key = `${type}:${id}`;
  if (cur.key !== key) { cur = { key, d: null, err: '', open: new Set() }; load(type, id); }
  const it = item(key); const m = metaOf(key); const d = cur.d;
  const title = d?.title || d?.name || titleOf(key, it, m);
  const poster = it?.poster || d?.poster_path || m?.p;
  const backdrop = d?.backdrop_path || m?.b;
  const yr = (d?.release_date || d?.first_air_date || '').slice(0, 4) || m?.y || it?.year || '';
  const anime = it ? isAnime(it, m) : (d ? isAnimeResult({ genre_ids: (d.genres || []).map((g) => g.id), original_language: d.original_language, origin_country: d.origin_country }) : isAnime({}, m));
  const genres = (d?.genres || []).slice(0, 3).map((g) => g.name);
  const L = lib();
  const inLists = (L?.lists || []).filter((l) => l.items.some((e) => e.key === key));
  const p = it ? progress(it, m) : 0;

  const chips = [
    html`<span class="chip-s">${kindBadge({ type, anime })}${anime ? 'Anime' : ''}${anime ? ' ' : ''}${type === 'tv' ? (anime ? 'serie' : 'Serie') : (anime ? 'film' : 'Film')}</span>`,
    yr ? html`<span class="chip-s">${yr}</span>` : '',
    ...genres.map((g) => html`<span class="chip-s">${g}</span>`),
  ];

  let statusArea;
  if (it) {
    statusArea = html`<button class="status-pill st-${it.status}" data-act="d-status"><i></i>${statusLabel(type, it.status)}${icon.chevron}</button>`;
  } else if (type === 'movie') {
    statusArea = html`<div class="add-row"><button class="btn primary" data-act="d-add" data-st="completed">${icon.check}Visto</button><button class="btn ghost" data-act="d-add" data-st="planned">Da guardare</button></div>`;
  } else {
    statusArea = html`<div class="add-row"><button class="btn primary" data-act="d-add" data-st="planned">${icon.plus}Da guardare</button></div>`;
  }

  // info
  const facts = [];
  if (type === 'movie') {
    if (d?.release_date || m?.rd) facts.push(['Uscita', fmtDay(d?.release_date || m.rd)]);
    if (d?.runtime || m?.rt) facts.push(['Durata', runtimeText(d?.runtime || m.rt)]);
    if (it?.status === 'completed' && it.seen) facts.push(['Visto il', fmtDay(it.seen)]);
    if (it?.rewatch) facts.push(['Rivisto', `${it.rewatch} ${it.rewatch === 1 ? 'volta' : 'volte'}`]);
    if (d?.status && d.status !== 'Released') facts.push(['Stato', MOVIE_STATUS[d.status] || d.status]);
  } else {
    const st = d?.status || m?.st;
    if (st) facts.push(['Serie', TV_STATUS[st] || st]);
    const ne = d?.next_episode_to_air ? [d.next_episode_to_air.season_number, d.next_episode_to_air.episode_number, d.next_episode_to_air.air_date] : m?.ne;
    if (ne && ne[2]) facts.push(['Prossimo episodio', `S${ne[0]} · E${ne[1]}, ${fmtDay(ne[2])}`]);
    if (it) {
      const a = airedCount(m); const w = watchedCount(it);
      facts.push(['Visti', a ? `${w} di ${a} usciti` : `${w}`]);
      const nx = nextEpisode(it, m);
      if (nx && it.status !== 'dropped') facts.push(['Il prossimo da vedere', `S${nx.s} · E${nx.e}`]);
    }
    if (d?.episode_run_time?.length || m?.rt) facts.push(['Durata episodi', runtimeText(d?.episode_run_time?.[0] || m.rt)]);
  }

  const seasonsHtml = type === 'tv' ? (() => {
    const list = seasonList(m);
    if (!list.length) return cur.d || !tmdbToken() ? '' : html`<p class="muted pad">Carico le stagioni…</p>`;
    const regular = list.filter((s) => s.n > 0).sort((a, b) => a.n - b.n);
    const specials = list.filter((s) => s.n === 0 && s.count > 0);
    return html`<section class="d-sec"><h2>Stagioni</h2>${regular.map((s) => seasonBlock(key, it, m, s))}${specials.map((s) => seasonBlock(key, it, m, s))}</section>`;
  })() : '';

  return html`
  <div class="detail">
    <div class="hero">${backdrop ? html`<img src="${img(backdrop, 'w780')}" alt="">` : ''}</div>
    <div class="hero-bar">
      <button class="icon-btn glass" data-act="back" aria-label="Indietro">${icon.back}</button>
      <span></span>
      <button class="icon-btn glass heart ${it?.fav ? 'on' : ''}" data-act="d-fav" aria-label="${it?.fav ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}">${icon.heart}</button>
      <button class="icon-btn glass" data-act="d-more" aria-label="Altre opzioni">${icon.more}</button>
    </div>
    <div class="d-head">
      <div class="d-poster">${poster ? html`<img src="${img(poster)}" alt="">` : html`<div class="pc-ph"><span>${title}</span></div>`}</div>
      <div class="d-titles">
        <h1>${title}</h1>
        ${d && (d.original_title || d.original_name) && (d.original_title || d.original_name) !== title ? html`<p class="d-orig">${d.original_title || d.original_name}</p>` : ''}
        <div class="d-chips">${chips}</div>
      </div>
    </div>
    <div class="d-status">${statusArea}${it ? tube(it.status, p) : ''}</div>
    ${it ? html`<button class="rating-box ${it.rating != null ? 'has' : ''}" data-act="d-rate">
        ${it.rating != null ? html`<span class="rate-num">${fmtRating(it.rating)}</span><span class="rate-l">Il tuo voto<small>tocca per cambiarlo</small></span>` : html`<span class="rate-l">Dai un voto<small>da 0.1 a 10.0</small></span>`}
      </button>` : ''}
    ${d?.overview ? html`<p class="overview">${d.overview}</p>` : (cur.err ? html`<p class="muted pad">${cur.err}</p>` : '')}
    ${facts.length ? html`<dl class="facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}
    ${type === 'movie' && it?.status === 'completed' ? html`<button class="btn ghost wide" data-act="d-rewatch">${icon.replay}L’ho rivisto</button>` : ''}
    ${seasonsHtml}
    <section class="d-sec">
      <h2>Liste</h2>
      ${inLists.length ? html`<div class="d-lists">${inLists.map((l) => html`<a class="chip-s link" href="#/lista/${encodeURIComponent(l.id)}">${l.title}</a>`)}</div>` : html`<p class="muted">Non è in nessuna lista.</p>`}
      <button class="btn ghost wide" data-act="d-lists">${icon.list}Gestisci liste</button>
    </section>
  </div>`;
}

// ---------- fogli ----------
function statusSheet() {
  const key = cur.key; const it = item(key);
  const opts = it.type === 'movie' ? ['completed', 'planned'] : ['watching', 'planned', 'uptodate', 'completed', 'dropped'];
  openSheet(String(html`
    <h3 class="sheet-title">Stato</h3>
    <div class="opt-list">
      ${opts.map((o) => html`<button class="opt st-${o} ${it.status === o ? 'on' : ''}" data-v="${o}"><i></i>${statusLabel(it.type, o)}${it.status === o ? icon.check : ''}</button>`)}
    </div>
    <button class="btn danger-ghost wide" data-remove>Rimuovi dalla libreria</button>`), {
    onMount: (el, close) => {
      el.querySelectorAll('.opt').forEach((b) => { b.onclick = () => { close(); if (b.dataset.v !== it.status) A.setStatus(key, b.dataset.v); }; });
      el.querySelector('[data-remove]').onclick = async () => { close(); await askRemove(key); };
    },
  });
}

async function askRemove(key) {
  const it = item(key);
  if (!it) return;
  const n = it.type === 'tv' ? watchedCount(it, { specials: true }) : 0;
  const ok = await confirmSheet(`Rimuovere ${it.title}?`, n ? `Perdi anche i ${n} episodi segnati come visti. La versione precedente resta comunque nella storia della repo su GitHub.` : 'Lo togli dalla libreria; le liste lo mantengono.', 'Rimuovi', { danger: true });
  if (ok) { A.removeItem(key); toast('Rimosso dalla libreria'); }
}

function ratingSheet() {
  const key = cur.key; const it = item(key);
  let v = it.rating != null ? Math.round(it.rating * 10) : 70;
  openSheet(String(html`
    <h3 class="sheet-title">Il tuo voto</h3>
    <div class="rate-big" aria-live="polite">${(v / 10).toFixed(1)}</div>
    <div class="rate-ctl">
      <button class="icon-btn round" data-d="-1" aria-label="Meno 0.1">−</button>
      <input type="range" min="1" max="100" step="1" value="${v}" aria-label="Voto">
      <button class="icon-btn round" data-d="1" aria-label="Più 0.1">+</button>
    </div>
    <div class="sheet-actions">
      ${it.rating != null ? html`<button class="btn ghost" data-clear>Togli voto</button>` : html`<button class="btn ghost" data-close>Annulla</button>`}
      <button class="btn primary" data-ok>Salva ${raw('<span data-ok-v>' + esc((v / 10).toFixed(1)) + '</span>')}</button>
    </div>`), {
    className: 'rate-sheet',
    onMount: (el, close) => {
      const big = el.querySelector('.rate-big'); const range = el.querySelector('input'); const okv = el.querySelector('[data-ok-v]');
      const set = (nv) => { v = Math.max(1, Math.min(100, nv)); range.value = v; big.textContent = (v / 10).toFixed(1); okv.textContent = (v / 10).toFixed(1); big.style.setProperty('--glow', (v / 100).toFixed(2)); };
      set(v);
      range.addEventListener('input', () => set(Number(range.value)));
      el.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => set(v + Number(b.dataset.d)); });
      el.querySelector('[data-ok]').onclick = () => { A.setRating(key, v / 10); close(); };
      el.querySelector('[data-clear]')?.addEventListener('click', () => { A.setRating(key, null); close(); });
    },
  });
}

function moreSheet() {
  const key = cur.key; const it = item(key); const m = metaOf(key);
  const [type, id] = key.split(':');
  const auto = isAnime({}, m);
  const mode = typeof it?.anime === 'boolean' ? (it.anime ? 'yes' : 'no') : 'auto';
  openSheet(String(html`
    <h3 class="sheet-title">${it?.title || info().title}</h3>
    ${it ? html`<p class="sheet-label">Categoria</p>
    <div class="seg small">
      <button class="${mode === 'auto' ? 'on' : ''}" data-anime="auto">Automatica (${auto ? 'anime' : 'non anime'})</button>
      <button class="${mode === 'yes' ? 'on' : ''}" data-anime="yes">Anime</button>
      <button class="${mode === 'no' ? 'on' : ''}" data-anime="no">Non anime</button>
    </div>` : ''}
    <a class="btn ghost wide" href="https://www.themoviedb.org/${type}/${id}" target="_blank" rel="noopener">Apri su TMDB</a>
    ${it ? html`<button class="btn danger-ghost wide" data-remove>Rimuovi dalla libreria</button>` : ''}`), {
    onMount: (el, close) => {
      el.querySelectorAll('[data-anime]').forEach((b) => {
        b.onclick = () => { const v = b.dataset.anime; A.setAnime(key, v === 'auto' ? undefined : v === 'yes'); close(); };
      });
      el.querySelector('[data-remove]')?.addEventListener('click', async () => { close(); await askRemove(key); });
    },
  });
}

export function listsSheet(key, entryInfo) {
  const L = lib();
  const render = () => String(html`
    <h3 class="sheet-title">Liste</h3>
    <div class="opt-list">
      ${(L.lists || []).map((l) => {
        const on = l.items.some((e) => e.key === key);
        return html`<button class="opt list-opt ${on ? 'on' : ''}" data-id="${l.id}"><span class="box">${on ? icon.check : ''}</span>${l.title}<small>${l.items.length}</small></button>`;
      })}
    </div>
    <button class="btn ghost wide" data-new>${icon.plus}Nuova lista</button>
    <button class="btn primary wide" data-close>Fatto</button>`);
  openSheet(render(), {
    onMount: (el, close) => {
      const bind = () => {
        el.querySelectorAll('.list-opt').forEach((b) => {
          b.onclick = () => {
            const l = lib().lists.find((x) => x.id === b.dataset.id);
            if (l.items.some((e) => e.key === key)) A.removeFromList(l.id, key); else A.addToList(l.id, { key, title: entryInfo.title, year: entryInfo.year });
            b.classList.toggle('on');
            b.querySelector('.box').innerHTML = b.classList.contains('on') ? String(icon.check) : '';
          };
        });
        el.querySelector('[data-new]').onclick = async () => {
          close();
          const name = await promptSheet('Nuova lista', '', 'Crea');
          if (!name) return;
          const id = A.createList(name);
          A.addToList(id, { key, title: entryInfo.title, year: entryInfo.year });
          toast(`Aggiunto a ${name}`);
        };
      };
      bind();
    },
  });
}

// ---------- azioni ----------
function toggleEpisode(s, e) {
  const key = cur.key; const it = item(key);
  if (isWatched(it, s, e)) A.unmarkEpisodes(key, [[s, e]]);
  else A.markEpisodes(key, [[s, e]], info(), { offerPrevious: true });
}

async function toggleSeason(s) {
  const key = cur.key; const it = item(key); const m = metaOf(key);
  const id = Number(key.split(':')[1]);
  const sl = seasonList(m).find((x) => x.n === s);
  if (!sl) return;
  const watched = Object.keys(it?.eps?.[String(s)] || {}).length;
  if (sl.count > 0 && watched >= sl.count) {
    const ok = await confirmSheet(`Togliere ${s === 0 ? 'gli speciali' : `la stagione ${s}`}?`, `${watched} episodi tornano non visti.`, 'Togli', { danger: true });
    if (ok) A.unmarkEpisodes(key, Object.keys(it.eps[String(s)]).map((e) => [s, Number(e)]));
    return;
  }
  const data = getSeason(id, s);
  const first = s > 0 ? epRange(m, s)[0] : 1;
  const eps = data?.eps?.length ? data.eps : Array.from({ length: sl.count }, (_, i) => ({ n: first + i, air: null }));
  const todo = eps.filter((e) => !isWatched(it, s, e.n) && (data?.eps?.length ? (e.air && e.air <= today()) : isAired(m, s, e.n))).map((e) => [s, e.n]);
  if (!todo.length) { toast('Nessun episodio uscito da segnare'); return; }
  A.markEpisodes(key, todo, info());
}

export const detailActions = {
  'd-ep': (el) => toggleEpisode(Number(el.dataset.s), Number(el.dataset.e)),
  'd-season': (el, { rerender }) => { const s = Number(el.dataset.s); if (cur.open.has(s)) cur.open.delete(s); else cur.open.add(s); rerender(); },
  'd-season-all': (el) => toggleSeason(Number(el.dataset.s)),
  'd-status': () => statusSheet(),
  'd-rate': () => ratingSheet(),
  'd-more': () => moreSheet(),
  'd-fav': () => { A.toggleFav(cur.key, info()); },
  'd-add': (el) => { A.setStatus(cur.key, el.dataset.st, info()); toast(el.dataset.st === 'completed' ? 'Segnato come visto' : 'Aggiunto a da guardare'); },
  'd-rewatch': () => A.rewatchMovie(cur.key),
  'd-lists': () => listsSheet(cur.key, info()),
};
