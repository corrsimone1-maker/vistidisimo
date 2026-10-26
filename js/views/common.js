import { html, posterCard, icon } from '../ui.js';
import { item, metaOf, S } from '../store.js';
import { isAnime, progress, isAnimeResult } from '../derive.js';

export const titleOf = (key, it, m) => m?.t || it?.title || '';

// Locandina di un titolo della libreria (o di una lista).
export function cardFor(key, { fallback, removable = false, extra } = {}) {
  const it = item(key);
  const m = metaOf(key);
  const type = key.split(':')[0];
  return posterCard({
    key,
    href: `#/t/${key.replace(':', '/')}`,
    title: titleOf(key, it, m) || fallback?.title || '',
    poster: it?.poster || m?.p || null,
    kind: { type, anime: isAnime(it || {}, m) },
    status: it?.status || null,
    progress: it ? progress(it, m) : 0,
    rating: it?.rating ?? null,
    removable,
    extra,
  });
}

// Locandina di un risultato TMDB (ricerca, tendenze).
export function cardForResult(r) {
  const type = r.media_type || (r.title ? 'movie' : 'tv');
  const key = `${type}:${r.id}`;
  const it = item(key);
  if (it) return cardFor(key);
  return posterCard({
    key,
    href: `#/t/${type}/${r.id}`,
    title: r.title || r.name,
    poster: r.poster_path,
    kind: { type, anime: isAnimeResult(r) },
    status: null,
  });
}

export function syncDot() {
  const st = S.sync.state;
  const cls = st === 'error' ? 'bad' : (st === 'saving' || st === 'offline' || S.ops.length) ? 'busy' : 'ok';
  const label = cls === 'bad' ? 'Problema di sincronizzazione' : cls === 'busy' ? 'Salvataggio in corso' : 'Tutto salvato';
  return html`<span class="sync-dot ${cls}" title="${label}" aria-label="${label}"></span>`;
}

export function backButton() {
  return html`<button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>`;
}

export function metaBanner() {
  const j = S.metaJob;
  if (!j || !j.firstBuild) return '';
  return html`<div class="banner">
    <span>Scarico locandine ed episodi da TMDB: ${j.done} di ${j.total}</span>
    <div class="tube st-planned"><i style="--p:${(j.done / Math.max(1, j.total)).toFixed(3)}"></i></div>
  </div>`;
}

export function emptyState(title, text, action) {
  return html`<div class="empty"><p class="empty-title">${title}</p>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;
}
