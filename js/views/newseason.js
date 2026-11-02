// Finestra «Nuova stagione»: quando esce la prima puntata di una stagione nuova di una serie che segui,
// all'apertura dell'app compare una finestra con il banner della serie. Si mostra una volta sola per
// stagione su tutti i dispositivi: chiudendola (o aprendo la serie) si segna `announced` nella libreria.
import { html, img, today, daysBetween, fmtDayLong } from '../ui.js';
import { S, dispatch, metaOf } from '../store.js';
import { newSeason } from '../derive.js';

let open = false;
let retry = null;

// Le stagioni nuove da annunciare, dalla più recente.
export function pendingSeasons() {
  const out = [];
  for (const [key, it] of Object.entries(S.lib?.items || {})) {
    const m = metaOf(key);
    const ns = newSeason(it, m);
    if (ns) out.push({ key, it, m, ...ns });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d) || (b.it.last || '').localeCompare(a.it.last || ''));
}

function when(d) {
  const n = daysBetween(d, today());
  if (n <= 0) return 'Uscita oggi';
  if (n === 1) return 'Uscita ieri';
  return `Uscita ${fmtDayLong(d)}`;
}

function episodes({ k, cnt }) {
  if (k == null) return '';
  if (cnt === 1) return '1 episodio';
  return `${k} ${k === 1 ? 'episodio' : 'episodi'} su ${cnt}`;
}

function card(x) {
  const pic = x.it.backdrop || x.m.b;
  const href = `#/t/tv/${x.key.split(':')[1]}`;
  return html`<a class="ns-card" href="${href}" data-ns-go>
    <div class="ns-img">${pic ? html`<img src="${img(pic, 'w780')}" data-fallback="${img(pic, 'original')}" alt="" decoding="async">` : ''}</div>
    <div class="ns-txt">
      <b class="ns-s">Stagione ${x.n}</b>
      <span class="ns-t">${x.m.t || x.it.title}</span>
      <small>${[when(x.d), episodes(x)].filter(Boolean).join(' · ')}</small>
    </div>
  </a>`;
}

function show(list) {
  open = true;
  const many = list.length > 1;
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'ns-wrap';
  wrap.innerHTML = String(html`<div class="ns-bg"></div>
    <div class="ns${many ? ' many' : ''}" role="dialog" aria-modal="true" aria-labelledby="ns-k">
      <p class="ns-k" id="ns-k">${many ? 'Nuove stagioni' : 'Nuova stagione'}</p>
      <div class="ns-list">${list.map(card)}</div>
      <div class="ns-actions">
        <button class="btn ghost" data-ns-ok>Ok</button>
        ${many ? '' : html`<a class="btn primary" href="#/t/tv/${list[0].key.split(':')[1]}" data-ns-go>Apri</a>`}
      </div>
    </div>`);
  root.appendChild(wrap);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // segna come annunciate tutte quelle mostrate, anche aprendone una sola
    dispatch(...list.map((x) => ({ op: 'ann', key: x.key, n: x.n, msg: `${x.it.title}: avviso della stagione ${x.n}` })));
    wrap.classList.remove('in');
    setTimeout(() => { wrap.remove(); open = false; }, 240);
  };
  // i link aprono la serie da soli (cambia l'indirizzo): qui la finestra si chiude e basta
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-ns-go]')) { close(); return; }
    if (e.target.closest('[data-ns-ok]') || e.target.classList.contains('ns-bg')) { e.preventDefault(); close(); }
  });
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in')));
}

// Da chiamare quando la libreria è scaricata e quando arrivano dati nuovi da TMDB. Con un foglio aperto
// o l'app in background aspetta; durante la prima costruzione dei dati TMDB non fa niente.
export function checkNewSeasons() {
  clearTimeout(retry);
  if (open || !S.loaded || !S.lib || S.metaJob?.firstBuild) return;
  const list = pendingSeasons();
  if (!list.length) return;
  if (document.visibilityState === 'hidden' || document.querySelector('#sheet-root .sheet-wrap')) {
    retry = setTimeout(checkNewSeasons, 1500);
    return;
  }
  show(list);
}
