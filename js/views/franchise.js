// Film, OVA, speciali e spin-off di un anime (da AniList, vedi js/anilist.js): una riga nella pagina della serie e
// la pagina con tutti (#/extra/<idSerie>). Quelli collegati a TMDB si aprono nell'app e mostrano il tuo
// stato; quelli che TMDB non ha aprono la pagina di AniList.
import { html, icon, posterCard } from '../ui.js';
import { item, metaOf } from '../store.js';
import { fetchFranchise, cachedFranchise, saveFranchise, FORMAT_LABEL } from '../anilist.js';
import { checkFiller } from '../filler.js';
import { cardFor, emptyState, titleOf } from './common.js';

let repaint = () => {};
const state = new Map(); // key -> { loading, data, err }

function get(key, m, title) {
  let st = state.get(key);
  if (!st) {
    const c = cachedFranchise(key);
    st = { loading: false, data: c, err: '' };
    state.set(key, st);
  }
  if (!st.loading && (!st.data || st.data.stale) && !st.tried) {
    st.loading = true; st.tried = true;
    fetchFranchise(key, m, title)
      .then((d) => { saveFranchise(key, d); st.data = d; st.err = ''; })
      .catch((e) => { st.err = e.message; })
      .finally(() => { st.loading = false; repaint(); });
  }
  return st;
}

const seen = (x) => !!x.key && item(x.key)?.status === 'completed';

function card(x) {
  const year = x.d ? x.d.slice(0, 4) : '';
  const label = [FORMAT_LABEL[x.f] || x.f, year].filter(Boolean).join(' · ');
  if (x.key && item(x.key)) {
    return cardFor(x.key, { extra: html`<span class="pc-title">${titleOf(x.key, item(x.key), metaOf(x.key)) || x.tt || x.t}</span><span class="pc-year">${label}</span>` });
  }
  const extra = html`<span class="pc-title">${x.tt || x.t}</span><span class="pc-year">${label}</span>`;
  if (x.key) {
    const [type] = x.key.split(':');
    return posterCard({ key: x.key, href: `#/t/${x.key.replace(':', '/')}`, title: x.tt || x.t, poster: x.tp || x.c, kind: { type, anime: true }, status: null, extra });
  }
  return posterCard({ href: x.u, ext: true, title: x.t, poster: x.c, kind: { type: x.f === 'MOVIE' ? 'movie' : 'tv', anime: true }, status: null, extra });
}

// La riga nella pagina di un anime (serie). Niente finché non c'è niente da mostrare.
export function franchiseSection(key, it, m, title, rerender) {
  repaint = rerender;
  const st = get(key, m, title);
  // da AniList arrivano anche gli id MyAnimeList: servono a sapere se ci sono filler
  if (st.data?.mal?.length) checkFiller(key, st.data.mal, () => repaint());
  const items = st.data?.items || [];
  const id = key.split(':')[1];
  if (!items.length) return st.loading && !st.data ? html`<section class="d-sec"><h2>Film e OVA</h2><p class="muted">Cerco film e OVA…</p></section>` : '';
  const n = items.filter(seen).length;
  return html`<section class="row d-fr">
    <div class="row-head"><h2>Film e OVA <span class="fr-count">${n}/${items.length}</span></h2><a class="row-all" href="#/extra/${id}">Tutti <span>${items.length}</span></a></div>
    <div class="scroller" data-scroll="fr-${id}">${items.slice(0, 20).map(card)}</div>
  </section>`;
}

export function renderFranchise(tvId, rerender) {
  repaint = rerender;
  const key = `tv:${tvId}`;
  const it = item(key); const m = metaOf(key);
  const name = titleOf(key, it, m);
  const st = get(key, m, it?.title || name);
  const items = st.data?.items || [];
  const head = html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1 class="wrap">${name ? `${name}: film e OVA` : 'Film e OVA'}</h1>
  </header>`;
  if (!items.length) {
    if (st.loading) return html`${head}<p class="muted pad">Cerco film e OVA…</p>`;
    if (st.err) return html`${head}${emptyState(st.err)}`;
    return html`${head}${emptyState(st.data?.none ? 'AniList non ha trovato questa serie' : 'Nessun film o OVA')}`;
  }
  const n = items.filter(seen).length;
  return html`${head}
  <p class="person-count"><b>${n}</b> ${n === 1 ? 'visto' : 'visti'} su ${items.length}</p>
  <div class="grid person-grid">${items.map(card)}</div>`;
}
