// Piccoli strumenti di interfaccia: template HTML con escape, icone, locandine, fogli, avvisi.

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(String(v));
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += fmt(vals[i]); });
  return new Raw(out);
}

const svg = (body, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`);
export const icon = {
  home: svg('<path d="M3.5 10.8 12 3.6l8.5 7.2"/><path d="M5.8 9.4V20h4.6v-5.6h3.2V20h4.6V9.4"/>'),
  library: svg('<rect x="3.5" y="3.5" width="7" height="9" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.6"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.6"/>'),
  search: svg('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m20 20-4.2-4.2"/>'),
  upcoming: svg('<rect x="3.2" y="4.6" width="17.6" height="16" rx="2.6"/><path d="M3.2 9.4h17.6M8 2.8v3.6M16 2.8v3.6"/><path d="m10.4 12.4 4.2 2.6-4.2 2.6z" fill="currentColor"/>'),
  tv: svg('<rect x="2.6" y="6.4" width="18.8" height="12.6" rx="2.6"/><path d="m8.2 2.8 3.8 3.4 3.8-3.4"/>', 'stroke-width="2.2"'),
  film: svg('<rect x="3.4" y="3" width="17.2" height="18" rx="2.4"/><path d="M7.6 3v18M16.4 3v18M3.4 8.6h4.2M3.4 15.4h4.2M16.4 8.6h4.2M16.4 15.4h4.2"/>', 'stroke-width="2.2"'),
  check: svg('<path d="m5 12.6 4.4 4.4L19 7.4"/>', 'stroke-width="2.4"'),
  heart: svg('<path d="M12 20.2s-7.6-4.6-7.6-10.3a4.3 4.3 0 0 1 7.6-2.8 4.3 4.3 0 0 1 7.6 2.8c0 5.7-7.6 10.3-7.6 10.3z"/>'),
  back: svg('<path d="M15 4.8 7.8 12l7.2 7.2"/>', 'stroke-width="2.2"'),
  more: svg('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  sliders: svg('<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.2"'),
  chevron: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>', 'stroke-width="2.2"'),
  list: svg('<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.6" cy="6.5" r="1" fill="currentColor"/><circle cx="4.6" cy="12" r="1" fill="currentColor"/><circle cx="4.6" cy="17.5" r="1" fill="currentColor"/>'),
  replay: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.2 4.2v4h4"/>'),
};

export const IMG = 'https://image.tmdb.org/t/p/';
export const img = (path, size = 'w342') => (path ? IMG + size + path : '');

export const STATUS = {
  planned: { label: 'Da guardare', short: 'Da guardare' },
  watching: { label: 'In corso', short: 'In corso' },
  uptodate: { label: 'In pari', short: 'In pari' },
  completed: { label: 'Completata', short: 'Completata' },
  dropped: { label: 'Abbandonata', short: 'Abbandonata' },
};
export function statusLabel(type, st) {
  if (type === 'movie') return st === 'completed' ? 'Visto' : 'Da guardare';
  return STATUS[st]?.label || st;
}

export function tube(status, p) {
  if (!status) return '';
  const v = Math.max(0, Math.min(1, p || 0));
  return html`<div class="tube st-${status}"><i style="--p:${v.toFixed(3)}"></i></div>`;
}

export function kindBadge(kind) {
  // kind: { type: 'tv'|'movie', anime: bool }
  return html`<span class="kind${kind.anime ? ' is-anime' : ''}" title="${kind.anime ? 'Anime · ' : ''}${kind.type === 'tv' ? 'Serie' : 'Film'}">${kind.type === 'tv' ? icon.tv : icon.film}</span>`;
}

export function fmtRating(r) { return r == null ? '' : Number(r).toFixed(1); }

// Una locandina: immagine, iconcina film/serie, voto e tubo di stato sotto.
export function posterCard(c) {
  // c: { href, title, poster, kind, status, progress, rating, extra, removable, key }
  return html`<a class="pc" href="${c.href}" ${c.key ? raw(`data-key="${esc(c.key)}"`) : ''}>
    <div class="pc-img">
      ${c.poster ? html`<img loading="lazy" decoding="async" src="${img(c.poster)}" alt="">` : html`<div class="pc-ph"><span>${c.title}</span></div>`}
      ${kindBadge(c.kind)}
      ${c.removable ? html`<button class="pc-x" data-act="list-remove" data-key="${c.key}" aria-label="Togli dalla lista">${icon.x}</button>` : ''}
    </div>
    ${tube(c.status, c.progress)}
    ${c.extra || ''}
  </a>`;
}

// ---- avvisi in basso ----
let toastTimer = null;
export function toast(msg, action) {
  const root = document.getElementById('toast-root');
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { root.innerHTML = ''; action.run(); };
    el.appendChild(b);
  }
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }, action ? 6500 : 2600);
}

// ---- fogli dal basso ----
export function openSheet(content, { onMount, onClose, className = '' } = {}) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${className}" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${content}</div>`;
  root.appendChild(wrap);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
  };
  wrap.querySelector('.sheet-bg').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  requestAnimationFrame(() => wrap.classList.add('in'));
  onMount?.(wrap.querySelector('.sheet'), close);
  return close;
}

export function closeAllSheets() {
  document.querySelectorAll('#sheet-root .sheet-wrap').forEach((w) => w.remove());
}

export function confirmSheet(title, text, okLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    openSheet(String(html`
      <h3 class="sheet-title">${title}</h3>
      ${text ? html`<p class="sheet-text">${text}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn ghost" data-close>Annulla</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okLabel}</button>
      </div>`), {
      onMount: (el, close) => { el.querySelector('[data-ok]').onclick = () => { ok = true; close(); }; },
      onClose: () => resolve(ok),
    });
  });
}

export function promptSheet(title, value, okLabel) {
  return new Promise((resolve) => {
    let result = null;
    openSheet(String(html`
      <h3 class="sheet-title">${title}</h3>
      <input class="field" type="text" value="${value || ''}" maxlength="80" enterkeyhint="done">
      <div class="sheet-actions">
        <button class="btn ghost" data-close>Annulla</button>
        <button class="btn primary" data-ok>${okLabel}</button>
      </div>`), {
      onMount: (el, close) => {
        const inp = el.querySelector('input');
        const ok = () => { const v = inp.value.trim(); if (!v) return; result = v; close(); };
        el.querySelector('[data-ok]').onclick = ok;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
        setTimeout(() => inp.focus(), 250);
      },
      onClose: () => resolve(result),
    });
  });
}

// ---- date ----
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export function parseDay(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDay(s, { year = true } = {}) {
  if (!s) return '';
  const d = parseDay(s);
  return `${d.getDate()} ${MESI[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}
export function fmtDayLong(s) {
  const d = parseDay(s);
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI_LUNGHI[d.getMonth()]}`;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
