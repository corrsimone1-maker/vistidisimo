// Tutti i film di un regista o di uno sceneggiatore, in ordine di uscita (#/persona/<id>/<regia|scrittura>).
import { html, icon, posterCard } from '../ui.js';
import { item } from '../store.js';
import { fetchPerson, tmdbToken } from '../tmdb.js';
import { isAnimeResult } from '../derive.js';
import { cardFor, emptyState } from './common.js';

let repaint = () => {};
const cache = new Map(); // id -> dati | 'loading' | { err }

function getPerson(id) {
  const v = cache.get(id);
  if (v === undefined && tmdbToken()) {
    cache.set(id, 'loading');
    fetchPerson(id)
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

export function renderPerson(id, role, rerender) {
  repaint = rerender;
  const d = getPerson(id);
  const head = (title) => html`<header class="page-top">
    <button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>
    <h1>${title}</h1>
  </header>`;
  if (!d) return html`${head('')}${cache.get(id)?.err ? emptyState(cache.get(id).err) : html`<p class="muted pad">Carico i film…</p>`}`;
  if (d.err) return html`${head('')}${emptyState(d.err)}`;
  const lists = { regia: d.directed, scrittura: d.wrote };
  // se il ruolo chiesto è vuoto si mostra l'altro
  const r = lists[role]?.length ? role : (d.directed.length ? 'regia' : 'scrittura');
  const films = lists[r];
  const seen = films.filter((f) => item(`movie:${f.id}`)?.status === 'completed').length;
  return html`
  ${head(d.name)}
  ${d.directed.length && d.wrote.length ? html`<div class="seg" role="tablist">
    <button role="tab" class="${r === 'regia' ? 'on' : ''}" data-act="person-role" data-id="${id}" data-v="regia">Regia ${d.directed.length}</button>
    <button role="tab" class="${r === 'scrittura' ? 'on' : ''}" data-act="person-role" data-id="${id}" data-v="scrittura">Sceneggiatura ${d.wrote.length}</button>
  </div>` : ''}
  ${films.length ? html`<p class="person-count"><b>${seen}</b> visti su ${films.length}</p>
  <div class="grid person-grid">${films.map(filmCard)}</div>` : emptyState('Nessun film')}`;
}

export const personActions = {
  'person-role': (el) => { location.replace(`#/persona/${el.dataset.id}/${el.dataset.v}`); },
};
