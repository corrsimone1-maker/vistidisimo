import { html, raw, icon, img, today, fmtDayLong, daysBetween, toast } from '../ui.js';
import { lib, metaOf, item, dispatch, LS } from '../store.js';
import * as A from '../actions.js';
import { nextEpisode, isAnime, airedCount, byLast } from '../derive.js';
import { fetchSeason } from '../tmdb.js';
import { titleOf, emptyState, metaBanner } from './common.js';

let tab = LS.get('vds.upTab', 'next');
const seasonCache = new Map(); // "id:s" -> stagione | 'loading' | null
let repaint = () => {};

export function getSeason(id, s, onLoad) {
  const k = `${id}:${s}`;
  const v = seasonCache.get(k);
  if (v === undefined) {
    seasonCache.set(k, 'loading');
    fetchSeason(id, s).then((d) => { seasonCache.set(k, d); onLoad?.(); }).catch(() => seasonCache.set(k, null));
    return null;
  }
  return v === 'loading' ? null : v;
}
export function seasonFromCache(id, s) { const v = seasonCache.get(`${id}:${s}`); return v && v !== 'loading' ? v : null; }
export function putSeasonCache(id, s, d) { seasonCache.set(`${id}:${s}`, d); }

// ---- animazione del cerchio in «Da vedere» ----
// Tocco: la spunta si accende con un piccolo salto, l'episodio esce a sinistra e il ridisegno fa
// entrare il prossimo da destra. Se non ce n'è un altro la scheda esce e la lista si richiude.
// Durante le animazioni i ridisegni aspettano (classe hold-render); quelli che arrivano mentre
// un'animazione d'entrata è a metà la riprendono da dove era (animation-delay negativo).
const motion = { busy: new Set(), holds: 0, anim: new Map() }; // anim: "sezione:chiave" -> { kind, t }
const ANIM_MS = { next: 320, back: 320, appear: 420 };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function animOf(sec, key) {
  const id = `${sec}:${key}`;
  const a = motion.anim.get(id);
  if (!a) return { cls: '', style: '' };
  const now = performance.now();
  if (a.t == null) a.t = now;
  const el = now - a.t;
  if (el >= ANIM_MS[a.kind]) { motion.anim.delete(id); return { cls: '', style: '' }; }
  return { cls: ` anim-${a.kind}`, style: `--ad:-${Math.round(el)}ms` };
}

function hold(d, rerender) {
  motion.holds = Math.max(0, motion.holds + d);
  document.body.classList.toggle('hold-render', motion.holds > 0);
  if (motion.holds === 0 && rerender) rerender();
}

const inGoing = (it, m) => !!it && it.type === 'tv' && (it.status === 'watching' || it.status === 'uptodate') && !!nextEpisode(it, m);

function checkEpisode(el, rerender) {
  const card = el.closest('.ep-card');
  const key = el.dataset.key; const s = Number(el.dataset.s); const e = Number(el.dataset.e);
  const sec = card?.dataset.sec || 'next';
  const id = `${sec}:${key}`;
  if (!card || motion.busy.has(id)) return;
  motion.busy.add(id);
  const before = item(key);
  const prev = { status: before.status, last: before.last };
  hold(+1);
  el.classList.add('done');
  A.markEpisodes(key, [[s, e]]);
  const it = item(key); const m = metaOf(key);
  const stays = sec === 'next' && inGoing(it, m);
  // da «Da iniziare» la serie passa in cima a «Da vedere»
  if (sec === 'start' && inGoing(it, m)) motion.anim.set(`next:${key}`, { kind: 'appear' });
  toast(`Visto S${s} · E${e}`, {
    label: 'Annulla',
    run: () => {
      A.unmarkEpisodes(key, [[s, e]]);
      dispatch({ op: 'set', key, fields: prev });
      // l'episodio torna: da sinistra se la scheda c'era ancora, se no la scheda riappare
      if (sec === 'next') motion.anim.set(id, { kind: stays ? 'back' : 'appear' });
      else { motion.anim.set(id, { kind: 'appear' }); motion.anim.delete(`next:${key}`); }
      rerender();
    },
  });
  const fast = reduced();
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.24)' }, { transform: 'scale(1)' }], { duration: fast ? 0 : 280, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  const finish = () => { motion.busy.delete(id); hold(-1, rerender); };
  setTimeout(() => {
    if (stays) {
      const parts = [...card.querySelectorAll('.ep-still, .ep-body')];
      const anims = parts.map((p) => p.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-44px)' }],
        { duration: fast ? 0 : 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
      ));
      Promise.all(anims.map((a) => a.finished)).catch(() => {}).then(() => { motion.anim.set(id, { kind: 'next' }); finish(); });
    } else {
      // via a sinistra, poi la scheda si chiude (anche lo spazio tra le schede)
      const h = card.offsetHeight;
      const a = card.animate([
        { transform: 'none', opacity: 1, height: `${h}px`, paddingTop: '8px', paddingBottom: '8px', marginBottom: '0px' },
        { transform: 'translateX(-104%)', opacity: 0, height: `${h}px`, paddingTop: '8px', paddingBottom: '8px', marginBottom: '0px', offset: 0.55 },
        { transform: 'translateX(-104%)', opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-10px' },
      ], { duration: fast ? 0 : 540, easing: 'ease-in-out', fill: 'forwards' });
      a.finished.catch(() => {}).then(finish);
    }
  }, fast ? 0 : 170);
}

// Mentre resti in Prossimi le serie non cambiano posto (se no quella appena segnata salterebbe in
// cima); quelle nuove entrano in cima. Si riordina quando torni da un'altra scheda della barra.
let order = null;
export function resetUpcomingOrder() { order = null; }
function stableOrder(list) {
  if (!order) { order = list.map((x) => x.k); return list; }
  const pos = new Map(order.map((k, i) => [k, i]));
  const fresh = list.filter((x) => !pos.has(x.k));
  const known = list.filter((x) => pos.has(x.k)).sort((a, b) => pos.get(a.k) - pos.get(b.k));
  order = [...fresh.map((x) => x.k), ...order];
  return [...fresh, ...known];
}

function nextRow(key, it, m, ne, startLabel) {
  const id = Number(key.split(':')[1]);
  const sec = startLabel ? 'start' : 'next';
  const an = animOf(sec, key);
  const season = getSeason(id, ne.s, () => repaint());
  const ep = season?.eps?.find((e) => e.n === ne.e);
  const still = ep?.still ? img(ep.still, 'w300') : ((it.backdrop || m?.b) ? img(it.backdrop || m.b, 'w300') : (it.poster || m?.p ? img(it.poster || m.p, 'w185') : ''));
  const left = ne.left - 1;
  return html`<div class="ep-card${an.cls}" data-sec="${sec}" ${an.style ? raw(`style="${an.style}"`) : ''}>
    <a class="ep-still" href="#/t/tv/${id}">${still ? html`<img loading="lazy" src="${still}" alt="">` : ''}<span class="kind-dot ${isAnime(it, m) ? 'is-anime' : ''}"></span></a>
    <a class="ep-body" href="#/t/tv/${id}">
      <span class="ep-show">${titleOf(key, it, m)}</span>
      <span class="ep-code">S${ne.s} · E${ne.e}${ep?.name ? html` <em>${ep.name}</em>` : ''}</span>
      <span class="ep-left">${startLabel || (left > 0 ? `Poi ne restano ${left}` : 'È l’ultimo uscito')}</span>
    </a>
    <button class="check-btn st-${it.status}" data-act="up-check" data-key="${key}" data-s="${ne.s}" data-e="${ne.e}" aria-label="Segna come visto">${icon.check}</button>
  </div>`;
}

function renderNext() {
  const L = lib();
  const entries = Object.entries(L?.items || {}).map(([k, it]) => ({ k, it, m: metaOf(k) })).filter((x) => x.it.type === 'tv');
  const going = entries.filter((x) => x.it.status === 'watching' || x.it.status === 'uptodate')
    .map((x) => ({ ...x, ne: nextEpisode(x.it, x.m) })).filter((x) => x.ne).sort(byLast);
  const goingShown = stableOrder(going);
  const start = entries.filter((x) => x.it.status === 'planned' && x.m && airedCount(x.m) > 0)
    .map((x) => ({ ...x, ne: { s: 1, e: 1, left: airedCount(x.m) } })).sort((a, b) => (b.it.added || '').localeCompare(a.it.added || ''));
  const out = [];
  if (goingShown.length) out.push(html`<div class="ep-list">${goingShown.map((x) => nextRow(x.k, x.it, x.m, x.ne))}</div>`);
  else out.push(emptyState('Sei in pari con tutto', 'Quando escono episodi nuovi delle serie che segui li trovi qui.'));
  if (start.length) {
    out.push(html`<h2 class="section-title">Da iniziare <span>${start.length}</span></h2>`);
    out.push(html`<div class="ep-list">${start.slice(0, 40).map((x) => nextRow(x.k, x.it, x.m, x.ne, `${x.ne.left} episodi usciti`))}</div>`);
  }
  return out;
}

function renderAiring() {
  const L = lib();
  const t = today();
  const rows = [];
  for (const [k, it] of Object.entries(L?.items || {})) {
    const m = metaOf(k);
    if (!m || it.status === 'dropped') continue;
    if (it.type === 'tv' && m.ne && m.ne[2] && m.ne[2] >= t) rows.push({ date: m.ne[2], k, it, m, s: m.ne[0], e: m.ne[1], name: m.ne[3] });
    if (it.type === 'movie' && it.status === 'planned' && m.rd && m.rd >= t) rows.push({ date: m.rd, k, it, m });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || byLast(a, b));
  if (!rows.length) return emptyState('Nessuna uscita in vista', 'Qui compaiono i prossimi episodi delle serie che segui e i film che vuoi vedere.');
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === r.date) g.rows.push(r); else groups.push({ date: r.date, rows: [r] });
  }
  const label = (d) => {
    const n = daysBetween(t, d);
    if (n === 0) return 'Oggi';
    if (n === 1) return 'Domani';
    return fmtDayLong(d);
  };
  const sub = (d) => { const n = daysBetween(t, d); return n > 1 ? `tra ${n} giorni` : ''; };
  return groups.map((g) => html`<section class="day">
    <h2 class="day-head"><span>${label(g.date)}</span><small>${sub(g.date)}</small></h2>
    ${g.rows.map((r) => html`<a class="air-row" href="#/t/${r.k.replace(':', '/')}">
      ${(r.it.poster || r.m.p) ? html`<img loading="lazy" src="${img(r.it.poster || r.m.p, 'w185')}" alt="">` : html`<span class="air-ph"></span>`}
      <span class="air-body">
        <span class="ep-show">${titleOf(r.k, r.it, r.m)}</span>
        <span class="ep-code">${r.it.type === 'tv' ? html`S${r.s} · E${r.e}${r.name ? html` <em>${r.name}</em>` : ''}${r.e === 1 ? html` <b class="tag">nuova stagione</b>` : ''}` : 'Film in uscita'}</span>
      </span>
    </a>`)}
  </section>`);
}

export function renderUpcoming(rerender) {
  repaint = rerender;
  return html`
  <header class="page-top"><h1>Prossimi</h1></header>
  ${metaBanner()}
  <div class="seg" role="tablist">
    <button role="tab" class="${tab === 'next' ? 'on' : ''}" data-act="up-tab" data-v="next">Da vedere</button>
    <button role="tab" class="${tab === 'air' ? 'on' : ''}" data-act="up-tab" data-v="air">In uscita</button>
  </div>
  <div class="up-body">${tab === 'next' ? renderNext() : renderAiring()}</div>`;
}

export const upcomingActions = {
  'up-tab': (el, { rerender }) => { tab = el.dataset.v; LS.set('vds.upTab', tab); rerender(); },
  'up-check': (el, { rerender }) => checkEpisode(el, rerender),
};
