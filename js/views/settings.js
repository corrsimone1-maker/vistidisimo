import { html, icon, toast, confirmSheet, statusLabel, today } from '../ui.js';
import { S, pull, flush, refreshMeta, saveConfig, forgetDevice, hasGhToken, lib, metaOf } from '../store.js';
import { tm, tmdbToken } from '../tmdb.js';
import { OWNER, DATA_REPO, serialize } from '../github.js';
import { watchedCount, isAnime } from '../derive.js';

export const VERSION = '1.3.0';
let busy = false;
let note = '';

function syncText() {
  if (!hasGhToken()) return 'Non collegato.';
  if (S.sync.state === 'error') return S.sync.msg;
  if (S.sync.state === 'offline') return S.sync.msg;
  if (S.ops.length) return `${S.ops.length} ${S.ops.length === 1 ? 'modifica' : 'modifiche'} in attesa di salvataggio.`;
  return 'Tutto salvato su GitHub.';
}

function lastSavedText() {
  if (!S.lastSaved) return '';
  const d = new Date(S.lastSaved);
  const same = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `Ultimo salvataggio da questo dispositivo: ${same ? 'oggi' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${hm}.`;
}

// Esporta la libreria in due file CSV leggibili con Numbers o Excel.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportCsv() {
  const L = lib();
  const day = today();
  const head = ['Tipo', 'Anime', 'Titolo', 'Anno', 'Stato', 'Voto', 'Preferito', 'Episodi visti', 'Visto il', 'Rivisto', 'Aggiunto', 'Ultima attività', 'TMDB'];
  const rows = [head];
  const eps = [['Serie', 'Stagione', 'Episodio', 'Visto il', 'TMDB']];
  for (const [k, it] of Object.entries(L.items)) {
    const m = metaOf(k);
    rows.push([it.type === 'tv' ? 'Serie' : 'Film', isAnime(it, m) ? 'sì' : '', m?.t || it.title, m?.y || it.year || '', statusLabel(it.type, it.status),
      it.rating == null ? '' : it.rating.toFixed(1).replace('.', ','), it.fav ? 'sì' : '', it.type === 'tv' ? watchedCount(it, { specials: true }) : '',
      it.seen || '', it.rewatch || '', (it.added || '').slice(0, 10), (it.last || '').slice(0, 10), `https://www.themoviedb.org/${it.type}/${it.id}`]);
    for (const [s, list] of Object.entries(it.eps || {})) for (const [e, d] of Object.entries(list)) eps.push([m?.t || it.title, s, e, d, it.id]);
  }
  const toCsv = (rs) => '\ufeff' + rs.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  download(`vistidisimo-titoli-${day}.csv`, toCsv(rows), 'text/csv');
  setTimeout(() => download(`vistidisimo-episodi-${day}.csv`, toCsv(eps), 'text/csv'), 600);
}

export function renderSettings() {
  const gh = hasGhToken(); const tmdb = !!tmdbToken();
  const L = lib();
  const n = Object.keys(L?.items || {}).length;
  const eps = Object.values(L?.items || {}).reduce((a, it) => a + (it.type === 'tv' ? watchedCount(it, { specials: true }) : 0), 0);
  return html`
  <header class="page-top">
    ${gh ? html`<button class="icon-btn back" data-act="back" aria-label="Indietro">${icon.back}</button>` : ''}
    <h1>${gh ? 'Impostazioni' : 'Benvenuto'}</h1>
  </header>
  ${!gh ? html`<p class="intro">Per collegare l’app alla tua libreria incolla qui i due token che hai generato. Restano su questo dispositivo; la chiave TMDB viene salvata anche nella tua repo privata, così sugli altri dispositivi basta il token GitHub.</p>` : ''}
  <section class="set-sec">
    <h2>Collegamento</h2>
    <label class="set-field">
      <span>Token GitHub ${gh ? html`<em class="ok">salvato</em>` : ''}</span>
      <input type="password" id="gh-token" placeholder="${gh ? 'Incolla un nuovo token per sostituirlo' : 'github_pat_…'}" autocomplete="off" autocapitalize="off" spellcheck="false">
    </label>
    <label class="set-field">
      <span>Chiave TMDB (API Read Access Token) ${tmdb ? html`<em class="ok">salvata</em>` : ''}</span>
      <input type="password" id="tmdb-token" placeholder="${tmdb ? 'Incolla una nuova chiave per sostituirla' : 'eyJhbGciOi…'}" autocomplete="off" autocapitalize="off" spellcheck="false">
    </label>
    ${note ? html`<p class="set-note">${note}</p>` : ''}
    <button class="btn primary wide" data-act="set-save" ${busy ? 'disabled' : ''}>${busy ? 'Controllo…' : (gh ? 'Salva' : 'Collega')}</button>
  </section>
  ${gh ? html`
  <section class="set-sec">
    <h2>Sincronizzazione</h2>
    <p class="set-status ${S.sync.state === 'error' ? 'bad' : ''}">${syncText()}</p>
    ${lastSavedText() ? html`<p class="muted small">${lastSavedText()}</p>` : ''}
    <button class="btn ghost wide" data-act="set-sync">Sincronizza ora</button>
  </section>
  <section class="set-sec">
    <h2>Dati</h2>
    <p class="muted">${n} titoli, ${eps.toLocaleString('it-IT')} episodi visti, ${Object.keys(S.meta.items).length} schede TMDB in cache.</p>
    <button class="btn ghost wide" data-act="set-meta" ${S.metaJob ? 'disabled' : ''}>${S.metaJob ? `Aggiorno da TMDB: ${S.metaJob.done} di ${S.metaJob.total}` : 'Aggiorna tutti i dati da TMDB'}</button>
  </section>
  <section class="set-sec">
    <h2>Backup</h2>
    <p class="muted">La libreria è il file <b>library.json</b> nella tua repo privata ${DATA_REPO}: puoi scaricarlo anche dal sito di GitHub, senza passare dall’app. Ogni modifica è un commit, quindi c’è anche ogni versione precedente.</p>
    <button class="btn ghost wide" data-act="set-download">Scarica la libreria (JSON completo)</button>
    <button class="btn ghost wide" data-act="set-csv">Scarica per Numbers o Excel (CSV)</button>
    <a class="btn ghost wide" href="https://github.com/${OWNER}/${DATA_REPO}/blob/main/library.json" target="_blank" rel="noopener">Apri library.json su GitHub</a>
    <a class="btn ghost wide" href="https://github.com/${OWNER}/${DATA_REPO}/commits/main/library.json" target="_blank" rel="noopener">Storia delle modifiche</a>
  </section>
  <section class="set-sec">
    <h2>Questo dispositivo</h2>
    <button class="btn danger-ghost wide" data-act="set-forget">Scollega questo dispositivo</button>
  </section>` : ''}
  <p class="tmdb-note">Dati e immagini da TMDB. Questa app usa l'API di TMDB ma non è approvata né certificata da TMDB.<br>vistidisimo ${VERSION}</p>`;
}

export const settingsActions = {
  'set-save': async (el, { rerender, go }) => {
    const ghIn = document.getElementById('gh-token').value.trim();
    const tmIn = document.getElementById('tmdb-token').value.trim();
    if (!ghIn && !tmIn) { note = 'Incolla almeno un token.'; rerender(); return; }
    busy = true; note = ''; rerender();
    const prevGh = localStorage.getItem('vds.ghToken');
    try {
      if (ghIn) {
        localStorage.setItem('vds.ghToken', ghIn);
        const ok = await pull();
        if (!ok) {
          if (prevGh) localStorage.setItem('vds.ghToken', prevGh); else localStorage.removeItem('vds.ghToken');
          throw new Error(`Il token GitHub non funziona: ${S.sync.msg} Controlla che abbia accesso a ${DATA_REPO} con permesso Contents in lettura e scrittura.`);
        }
      }
      if (tmIn) {
        try { await tm('/configuration', {}, tmIn); } catch (e) { throw new Error(`La chiave TMDB non funziona (${e.message}). Serve l'API Read Access Token, quello lungo.`); }
        localStorage.setItem('vds.tmdbToken', tmIn);
        if (hasGhToken()) { try { await saveConfig({ tmdb: tmIn }); } catch (e) { console.warn(e); } }
      }
      busy = false;
      if (!tmdbToken()) { note = 'GitHub collegato. Ora serve la chiave TMDB per locandine ed episodi.'; rerender(); return; }
      toast('Collegato');
      go('#/home');
      refreshMeta();
    } catch (e) {
      busy = false; note = e.message; rerender();
    }
  },
  'set-sync': async (el, { rerender }) => { await pull(); await flush(); rerender(); toast(S.sync.state === 'error' ? 'Sincronizzazione non riuscita' : 'Sincronizzato'); },
  'set-meta': (el, { rerender }) => { refreshMeta({ force: true }); setTimeout(rerender, 50); },
  'set-download': () => download(`vistidisimo-${today()}.json`, serialize(lib()), 'application/json'),
  'set-csv': () => exportCsv(),
  'set-forget': async (el, { go }) => {
    const pending = S.ops.length;
    const ok = await confirmSheet('Scollegare questo dispositivo?', pending ? `Attenzione: ci sono ${pending} modifiche non ancora salvate che andrebbero perse.` : 'Cancello token e dati salvati su questo dispositivo. La libreria su GitHub non cambia.', 'Scollega', { danger: true });
    if (!ok) return;
    forgetDevice();
    location.hash = '#/impostazioni';
    location.reload();
    void go;
  },
};
