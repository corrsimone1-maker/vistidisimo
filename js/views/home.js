import { html, icon, img } from '../ui.js';
import { lib, metaOf, S } from '../store.js';
import { stats, splitTime, listProgress, byLast } from '../derive.js';
import { cardFor, syncDot, metaBanner, syncBanner } from './common.js';

function timeValue(min) {
  const { months, days, hours } = splitTime(min);
  const parts = [];
  if (months) parts.push(html`<b>${months}</b> ${months === 1 ? 'mese' : 'mesi'}`);
  if (days || months) parts.push(html`<b>${days}</b> ${days === 1 ? 'giorno' : 'giorni'}`);
  parts.push(html`<b>${hours}</b> ${hours === 1 ? 'ora' : 'ore'}`);
  return parts.map((p, i) => html`${i ? ' ' : ''}${p}`);
}

function row(id, title, list, href, allLabel, emptyText) {
  return html`<section class="row">
    <div class="row-head">
      <h2>${title}</h2>
      ${list.length ? html`<a class="row-all" href="${href}">${allLabel} <span>${list.length}</span></a>` : ''}
    </div>
    ${list.length
      ? html`<div class="scroller" data-scroll="${id}">${list.slice(0, 20).map((x) => cardFor(x.k))}</div>`
      : html`<p class="row-empty">${emptyText}</p>`}
  </section>`;
}

export function listCard(l, items) {
  const p = listProgress(l, items, metaOf);
  const covers = l.items.slice(0, 4).map((e) => items[e.key]?.poster || metaOf(e.key)?.p).filter(Boolean);
  return html`<a class="lc" href="#/lista/${encodeURIComponent(l.id)}">
    <div class="lc-mosaic n${covers.length}">${covers.map((p2) => html`<img loading="lazy" src="${img(p2, 'w185')}" alt="">`)}</div>
    <div class="lc-name">${l.title}</div>
    <div class="lc-meta"><span>${l.items.length} ${l.items.length === 1 ? 'titolo' : 'titoli'}</span><b>${Math.round(p * 100)}%</b></div>
    <div class="tube st-list"><i style="--p:${p.toFixed(3)}"></i></div>
  </a>`;
}

export function renderHome() {
  const L = lib();
  const entries = Object.entries(L?.items || {}).map(([k, it]) => ({ k, it }));
  const series = entries.filter((x) => x.it.type === 'tv').sort(byLast);
  const films = entries.filter((x) => x.it.type === 'movie').sort(byLast);
  const byFav = (a, b) => (b.it.fav || '').localeCompare(a.it.fav || '');
  const favS = entries.filter((x) => x.it.fav && x.it.type === 'tv').sort(byFav);
  const favF = entries.filter((x) => x.it.fav && x.it.type === 'movie').sort(byFav);
  const st = stats(L?.items || {}, metaOf);
  const metaReady = Object.keys(S.meta.items).length > 0;

  return html`
  <header class="home-top">
    <h1 class="wordmark">vistidisimo</h1>
    <a class="icon-btn" href="#/impostazioni" aria-label="Impostazioni">${syncDot()}${icon.sliders}</a>
  </header>
  ${syncBanner()}
  ${metaBanner()}
  <section class="stats" aria-label="Statistiche">
    <div class="stat"><span class="stat-l">Tempo davanti alle serie</span><span class="stat-v">${metaReady ? timeValue(st.tvMin) : '…'}</span></div>
    <div class="stat"><span class="stat-l">Episodi visti</span><span class="stat-v"><b>${st.epCount.toLocaleString('it-IT')}</b></span></div>
    <div class="stat"><span class="stat-l">Tempo davanti ai film</span><span class="stat-v">${metaReady ? timeValue(st.filmMin) : '…'}</span></div>
    <div class="stat"><span class="stat-l">Film visti</span><span class="stat-v"><b>${st.films.toLocaleString('it-IT')}</b></span></div>
  </section>
  ${row('h-serie', 'Serie', series, '#/raccolta/serie', 'Tutte', 'Cerca una serie e aggiungila: comparirà qui.')}
  ${row('h-film', 'Film', films, '#/raccolta/film', 'Tutti', 'Cerca un film e segnalo come visto: comparirà qui.')}
  ${row('h-fs', 'Serie preferite', favS, '#/raccolta/serie-preferite', 'Tutte', 'Tocca il cuore nella pagina di una serie per metterla qui.')}
  ${row('h-ff', 'Film preferiti', favF, '#/raccolta/film-preferiti', 'Tutti', 'Tocca il cuore nella pagina di un film per metterlo qui.')}
  <section class="row">
    <div class="row-head"><h2>Liste</h2>${L?.lists?.length ? html`<a class="row-all" href="#/liste">Tutte <span>${L.lists.length}</span></a>` : ''}</div>
    <div class="scroller lists" data-scroll="h-liste">
      ${(L?.lists || []).map((l) => listCard(l, L.items))}
      <button class="lc lc-new" data-act="list-new">${icon.plus}<span>Nuova lista</span></button>
    </div>
  </section>`;
}

const COLLECTIONS = {
  serie: { title: 'Serie', filter: (it) => it.type === 'tv', sort: byLast },
  film: { title: 'Film', filter: (it) => it.type === 'movie', sort: byLast },
  'serie-preferite': { title: 'Serie preferite', filter: (it) => it.type === 'tv' && it.fav, sort: (a, b) => (b.it.fav || '').localeCompare(a.it.fav || '') },
  'film-preferiti': { title: 'Film preferiti', filter: (it) => it.type === 'movie' && it.fav, sort: (a, b) => (b.it.fav || '').localeCompare(a.it.fav || '') },
};

export function renderCollection(name) {
  const c = COLLECTIONS[name] || COLLECTIONS.serie;
  const L = lib();
  const list = Object.entries(L?.items || {}).map(([k, it]) => ({ k, it })).filter((x) => c.filter(x.it)).sort(c.sort);
  return html`
  <header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>${c.title}</h1><span class="count">${list.length}</span>
  </header>
  <div class="grid">${list.map((x) => cardFor(x.k, { withTitle: true }))}</div>`;
}
