// Tutti i film di un regista, dal più recente (#/persona/<id>), senza cortometraggi.
import { html, icon, posterCard } from '../ui.js';
import { item, metaOf } from '../store.js';
import { fetchDirector, tmdbToken } from '../tmdb.js';
import { isAnimeResult } from '../derive.js';
import { cardFor, emptyState } from './common.js';

let repaint = () => {};
const cache = new Map(); // id -> dati | 'loading' | { err }

function getDirector(id) {
  const v = cache.get(id);
  if (v === undefined && tmdbToken()) {
    cache.set(id, 'loading');
    // per i film già in libreria la durata c'è in meta.json: niente richiesta
    fetchDirector(id, (filmId) => metaOf(`movie:${filmId}`)?.rt || null)
      .then((d) => { cache.set(id, d || { err: 'TMDB non conosce questa persona.' }); repaint(); })
      .catch((e) => { cache.set(id, { err: e.message }); repaint(); });
    return null;
  }
  return v && v !== 'loading' ? v : null;
}

function filmCard(f) {
  const key = `movie:${f.id}`;
  const year = f.d ? f.d.slice(0, 4) : '';
  const extra = html`<span class="pc-title">${f.t}</span><span class="pc-year">${year || 'senza data'}</span>`;
  if (item(key)) return cardFor(key, { extra });
  return posterCard({
    key, href: `#/t/movie/${f.id}`, title: f.t, poster: f.p,
    kind: { type: 'movie', anime: isAnimeResult(f) }, status: null, extra,
  });
}

export function renderPerson(id, rerender) {
  repaint = rerender;
  const d = getDirector(id);
  const head = (title) => html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>${title}</h1>
  </header>`;
  if (!d) return html`${head('')}${cache.get(id)?.err ? emptyState(cache.get(id).err) : html`<p class="muted pad">Carico i film…</p>`}`;
  if (d.err) return html`${head('')}${emptyState(d.err)}`;
  const seen = d.films.filter((f) => item(`movie:${f.id}`)?.status === 'completed').length;
  return html`
  ${head(d.name)}
  ${d.films.length ? html`<p class="person-count"><b>${seen}</b> visti su ${d.films.length}</p>
  <div class="grid person-grid">${d.films.map(filmCard)}</div>` : emptyState('Nessun film')}`;
}
