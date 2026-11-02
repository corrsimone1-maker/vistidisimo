// Menu ≡ in alto a destra nella Libreria: «Segna dove mi sono fermato» (titolo → episodio →
// minuto), «Saghe» (porta a #/saghe) e i titoli lasciati a metà, ognuno con la × per toglierlo. Le voci
// nuove si aggiungono qui.
import { html, icon, img, openSheet, toast, fmtClock, parseClock, statusLabel } from '../ui.js';
import { lib, item, metaOf } from '../store.js';
import { seasons, epRange, isWatched, isAired, nextEpisode, byLast, isAnime } from '../derive.js';
import { genericName } from '../tmdb.js';
import * as A from '../actions.js';
import { getSeason } from './upcoming.js';
import { titleOf } from './common.js';
import { agoText, code } from './episode.js';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const hasPaused = () => Object.values(lib()?.items || {}).some((it) => it.pause);

export function pausedEntries() {
  return Object.entries(lib()?.items || {})
    .filter(([, it]) => it.pause)
    .map(([k, it]) => ({ k, it, m: metaOf(k) }))
    .sort((a, b) => (b.it.pause.d || '').localeCompare(a.it.pause.d || '') || byLast(a, b));
}

// "S2 · E4 · 23:14" per una serie, "1:34:20" per un film
export function pauseText(it) {
  const p = it?.pause;
  if (!p) return '';
  return it.type === 'tv' ? `${code(p.s, p.e)} · ${fmtClock(p.t)}` : fmtClock(p.t);
}

function thumb(it, m, dot) {
  const p = it.poster || m?.p;
  return html`<span class="pz-thumb">${p ? html`<img loading="lazy" src="${img(p, 'w185')}" alt="">` : ''}${dot ? html`<span class="pc-pause"></span>` : ''}</span>`;
}

const kindText = (it, m) => {
  const anime = isAnime(it, m);
  const t = it.type === 'tv' ? 'serie' : 'film';
  return anime ? `Anime ${t}` : t[0].toUpperCase() + t.slice(1);
};

// Stagioni della serie con il primo e l'ultimo numero di episodio (anche con numerazione assoluta);
// gli speciali in fondo. Senza dati TMDB: le stagioni degli episodi già segnati.
function seasonsOf(it, m) {
  const list = seasons(m).filter(([, cnt]) => cnt > 0).map(([n]) => { const [first, last] = epRange(m, n); return { n, first, last }; });
  const sp = (m?.ss || []).find((x) => x[0] === 0 && x[1] > 0);
  if (sp) list.push({ n: 0, first: 1, last: sp[1] });
  if (!list.length) {
    const ss = Object.keys(it.eps || {}).map(Number).sort((a, b) => (a === 0) - (b === 0) || a - b);
    for (const s of ss) {
      const nums = Object.keys(it.eps[String(s)]).map(Number);
      list.push({ n: s, first: Math.min(...nums), last: Math.max(...nums) + 1 });
    }
  }
  if (!list.length) list.push({ n: 1, first: 1, last: 24 });
  return list;
}

// Episodio proposto: quello già in sospeso, se no il prossimo da vedere, se no il primo.
function defaultEp(it, m, list) {
  if (it.pause?.s != null && list.some((x) => x.n === it.pause.s)) return [it.pause.s, it.pause.e];
  const nx = nextEpisode(it, m);
  if (nx && list.some((x) => x.n === nx.s)) return [nx.s, nx.e];
  const s0 = list.find((x) => x.n > 0) || list[0];
  return [s0.n, s0.first];
}

export function openLibraryMenu() { pauseSheet({ view: 'menu' }); }
// Direttamente sull'editor di un titolo (dalla sua pagina): «Annulla» chiude.
export function openPauseEditor(key) { if (item(key)) pauseSheet({ view: 'edit', key, direct: true }); }

function pauseSheet(start) {
  const st = { view: 'menu', key: null, from: 'menu', q: '', s: null, e: null, time: '', direct: false };
  let closed = false;
  openSheet('<div class="pz"></div>', {
    className: 'pz-sheet',
    onClose: () => { closed = true; },
    onMount: (sheet, close) => {
      const root = sheet.querySelector('.pz');
      const $ = (sel) => root.querySelector(sel);

      // ---------- menu ----------
      const paintMenu = () => {
        const list = pausedEntries();
        root.innerHTML = String(html`
          <div class="opt-list">
            <button class="opt act-opt" data-m="pick">${icon.bookmark}Segna dove mi sono fermato</button>
            <button class="opt act-opt" data-m="saghe">${icon.saga}Saghe</button>
          </div>
          ${list.length ? html`
            <p class="sheet-label pz-label"><i></i>In sospeso</p>
            <div class="pz-list">${list.map((x) => html`<div class="pz-row">
              <button class="pz-item" data-m="edit" data-k="${x.k}">
                ${thumb(x.it, x.m, true)}
                <span class="pz-txt"><b>${titleOf(x.k, x.it, x.m)}</b><small><span class="pz-tag">${pauseText(x.it)}</span>${x.it.pause.d ? ` · ${agoText(x.it.pause.d)}` : ''}</small></span>
              </button>
              <button class="icon-btn pz-x" data-m="clear" data-k="${x.k}" aria-label="Togli ${titleOf(x.k, x.it, x.m)}">${icon.x}</button>
            </div>`)}</div>
            ${list.length > 1 ? html`<button class="btn danger-ghost wide" data-m="clear-all">Azzera tutti</button>` : ''}` : ''}`);
      };

      // ---------- scelta del titolo ----------
      const pickRows = () => {
        const q = norm(st.q.trim());
        let list = Object.entries(lib()?.items || {}).map(([k, it]) => ({ k, it, m: metaOf(k) }));
        if (q) list = list.filter((x) => norm(titleOf(x.k, x.it, x.m)).includes(q) || norm(x.it.title).includes(q) || norm(x.m?.ot).includes(q));
        list.sort(byLast);
        const shown = list.slice(0, q ? 60 : 30);
        if (!shown.length) return html`<p class="muted pz-none">Nessun titolo</p>`;
        return html`${shown.map((x) => html`<button class="pz-item" data-m="choose" data-k="${x.k}">
          ${thumb(x.it, x.m, !!x.it.pause)}
          <span class="pz-txt"><b>${titleOf(x.k, x.it, x.m)}</b><small>${kindText(x.it, x.m)} · ${statusLabel(x.it.type, x.it.status)}</small></span>
        </button>`)}`;
      };
      const paintPick = () => {
        root.innerHTML = String(html`
          <div class="pz-head">
            <button class="icon-btn back" data-m="menu" aria-label="Indietro">${icon.back}</button>
            <h3 class="sheet-title">Cosa stavi guardando?</h3>
          </div>
          <label class="search-box">${icon.search}<input type="search" data-pz-q placeholder="Filtra per titolo" value="${st.q}" autocomplete="off" enterkeyhint="search"></label>
          <div class="pz-list pz-pick">${pickRows()}</div>`);
        const inp = $('[data-pz-q]');
        inp.addEventListener('input', () => { st.q = inp.value; $('.pz-pick').innerHTML = String(pickRows()); });
      };

      // ---------- episodio e minuto ----------
      const paintSave = () => {
        const it = item(st.key);
        const b = $('[data-m=save]');
        if (!b || !it) return;
        const t = parseClock(st.time);
        b.disabled = t == null || (it.type === 'tv' && st.e == null);
        b.textContent = t == null ? 'Salva' : `Salva ${fmtClock(t)}`;
      };
      const paintName = () => {
        const el = $('.pz-epname');
        if (!el) return;
        if (st.e == null) { el.innerHTML = '&nbsp;'; return; }
        const key = st.key; const s = st.s; const e = st.e;
        const sd = getSeason(Number(key.split(':')[1]), s, () => { if (!closed && st.view === 'edit' && st.key === key && st.s === s) paintName(); });
        const ep = sd?.eps?.find((x) => x.n === e);
        const name = ep?.name && !genericName(ep.name) ? ep.name : '';
        el.innerHTML = String(html`<b>${code(s, e)}</b>${name ? html` · ${name}` : ''}`);
      };
      const paintEps = () => {
        const it = item(st.key); const m = metaOf(st.key);
        const list = seasonsOf(it, m);
        const sx = list.find((x) => x.n === st.s) || list[0];
        st.s = sx.n;
        const chips = $('.pz-seasons');
        chips.hidden = list.length < 2;
        chips.innerHTML = String(html`${list.map((x) => html`<button class="chip ${x.n === sx.n ? 'on' : ''}" data-m="season" data-s="${x.n}">${x.n === 0 ? 'Speciali' : `Stagione ${x.n}`}</button>`)}`);
        const nums = [];
        for (let n = sx.first; n <= sx.last; n++) nums.push(n);
        const grid = $('.pz-eps');
        grid.innerHTML = String(html`${nums.map((n) => {
          const seen = isWatched(it, sx.n, n);
          const aired = seen || sx.n === 0 || !m?.le || isAired(m, sx.n, n);
          return html`<button class="pz-ep ${seen ? 'seen' : ''} ${st.e === n ? 'on' : ''}" data-m="ep" data-e="${n}" ${aired ? '' : 'disabled'} aria-label="Episodio ${n}">${n}</button>`;
        })}`);
        // stagione ed episodio scelti in vista (senza muovere il foglio)
        // (.pz-seasons e .pz-eps sono position: relative, quindi offsetLeft/offsetTop sono interni)
        const chip = chips.querySelector('.chip.on');
        if (chip && !chips.hidden) chips.scrollLeft = chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2;
        const on = grid.querySelector('.pz-ep.on');
        grid.scrollTop = on ? on.offsetTop - (grid.clientHeight - on.offsetHeight) / 2 : 0;
        paintName();
      };
      const paintEdit = () => {
        const it = item(st.key);
        if (!it) { go('menu'); return; }
        const tv = it.type === 'tv';
        root.innerHTML = String(html`
          <div class="pz-head">
            ${st.direct ? '' : html`<button class="icon-btn back" data-m="cancel" aria-label="Indietro">${icon.back}</button>`}
            <h3 class="sheet-title">${titleOf(st.key, it, metaOf(st.key))}</h3>
          </div>
          ${tv ? html`<div class="chips scroll-x pz-seasons" role="group" aria-label="Stagione"></div>
            <div class="pz-eps" role="group" aria-label="Episodio"></div>
            <p class="pz-epname">&nbsp;</p>` : ''}
          <p class="sheet-label">Minuto</p>
          <input class="field pz-time" type="text" inputmode="decimal" placeholder="0:00" autocomplete="off" enterkeyhint="done" aria-label="Minuto">
          <div class="sheet-actions">
            ${it.pause ? html`<button class="btn danger-ghost" data-m="remove">Togli</button>` : html`<button class="btn ghost" data-m="cancel">Annulla</button>`}
            <button class="btn primary" data-m="save" disabled>Salva</button>
          </div>`);
        if (tv) paintEps();
        const inp = $('.pz-time');
        inp.value = st.time;
        inp.addEventListener('input', () => { st.time = inp.value; paintSave(); });
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
        paintSave();
      };

      const paint = () => { if (st.view === 'pick') paintPick(); else if (st.view === 'edit') paintEdit(); else paintMenu(); };
      const go = (view, patch = {}) => { Object.assign(st, patch, { view }); paint(); sheet.scrollTop = 0; };

      const startEdit = (key, from) => {
        const it = item(key);
        if (!it) return;
        const patch = { key, from, e: null, s: null, time: it.pause ? fmtClock(it.pause.t) : '' };
        if (it.type === 'tv') [patch.s, patch.e] = defaultEp(it, metaOf(key), seasonsOf(it, metaOf(key)));
        go('edit', patch);
      };

      const save = () => {
        const it = item(st.key);
        const t = parseClock(st.time);
        if (!it || t == null) return;
        const tv = it.type === 'tv';
        if (tv && st.e == null) return;
        A.setPause(st.key, tv ? { s: st.s, e: st.e, t } : { t });
        toast(`Fermo a ${tv ? `${code(st.s, st.e)}, ` : ''}${fmtClock(t)}`);
        close();
      };

      // toglie uno o più punti in sospeso, con «Annulla» che li rimette
      const clear = (keys) => {
        const saved = keys.map((k) => [k, item(k)?.pause ? { ...item(k).pause } : null]).filter(([, v]) => v);
        if (!saved.length) return;
        for (const [k] of saved) A.clearPause(k);
        const one = saved.length === 1 ? item(saved[0][0]) : null;
        toast(one ? `${titleOf(saved[0][0], one, metaOf(saved[0][0]))} non è più in sospeso` : `Tolti ${saved.length} titoli in sospeso`, {
          label: 'Annulla',
          run: () => { for (const [k, v] of saved) A.restorePause(k, v); if (!closed && st.view === 'menu') paintMenu(); },
        });
      };

      root.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-m]');
        if (!b || b.disabled) return;
        const k = b.dataset.k;
        switch (b.dataset.m) {
          case 'menu': go('menu'); break;
          case 'saghe': close(); location.hash = '#/saghe'; break;
          case 'pick': go('pick', { q: '' }); break;
          case 'edit': startEdit(k, 'menu'); break;
          case 'choose': startEdit(k, 'pick'); break;
          case 'cancel': if (st.direct) close(); else go(st.from); break;
          case 'clear': clear([k]); paintMenu(); break;
          case 'clear-all': clear(pausedEntries().map((x) => x.k)); paintMenu(); break;
          case 'remove': clear([st.key]); if (st.direct) close(); else go('menu'); break;
          case 'season': st.s = Number(b.dataset.s); st.e = item(st.key)?.pause?.s === st.s ? item(st.key).pause.e : null; paintEps(); paintSave(); break;
          case 'ep':
            st.e = Number(b.dataset.e);
            root.querySelectorAll('.pz-ep.on').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            paintName(); paintSave();
            break;
          case 'save': save(); break;
          default: break;
        }
      });

      if (start.view === 'edit') { st.direct = !!start.direct; startEdit(start.key, 'menu'); } else paint();
    },
  });
}
