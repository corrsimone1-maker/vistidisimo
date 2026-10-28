import { html, icon, img, today, fmtDayLong, daysBetween } from '../ui.js';
import { lib, metaOf, LS } from '../store.js';
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

function nextRow(key, it, m, ne, startLabel) {
  const id = Number(key.split(':')[1]);
  const season = getSeason(id, ne.s, () => repaint());
  const ep = season?.eps?.find((e) => e.n === ne.e);
  const still = ep?.still ? img(ep.still, 'w300') : ((it.backdrop || m?.b) ? img(it.backdrop || m.b, 'w300') : (it.poster || m?.p ? img(it.poster || m.p, 'w185') : ''));
  const left = ne.left - 1;
  return html`<div class="ep-card">
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
  const start = entries.filter((x) => x.it.status === 'planned' && x.m && airedCount(x.m) > 0)
    .map((x) => ({ ...x, ne: { s: 1, e: 1, left: airedCount(x.m) } })).sort((a, b) => (b.it.added || '').localeCompare(a.it.added || ''));
  const out = [];
  if (going.length) out.push(html`<div class="ep-list">${going.map((x) => nextRow(x.k, x.it, x.m, x.ne))}</div>`);
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
};
