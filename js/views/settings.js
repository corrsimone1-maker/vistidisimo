import { html, icon, toast, confirmSheet } from '../ui.js';
import { S, pull, flush, refreshMeta, saveConfig, forgetDevice, hasGhToken, lib } from '../store.js';
import { tm, tmdbToken } from '../tmdb.js';
import { OWNER, DATA_REPO, serialize } from '../github.js';
import { watchedCount } from '../derive.js';

export const VERSION = '1.0.0';
let busy = false;
let note = '';

function syncText() {
  if (!hasGhToken()) return 'Non collegato.';
  if (S.sync.state === 'error') return S.sync.msg;
  if (S.sync.state === 'offline') return S.sync.msg;
  if (S.ops.length) return `${S.ops.length} ${S.ops.length === 1 ? 'modifica' : 'modifiche'} in attesa di salvataggio.`;
  return 'Tutto salvato su GitHub.';
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
    <button class="btn ghost wide" data-act="set-sync">Sincronizza ora</button>
  </section>
  <section class="set-sec">
    <h2>Dati</h2>
    <p class="muted">${n} titoli, ${eps.toLocaleString('it-IT')} episodi visti, ${Object.keys(S.meta.items).length} schede TMDB in cache.</p>
    <button class="btn ghost wide" data-act="set-meta" ${S.metaJob ? 'disabled' : ''}>${S.metaJob ? `Aggiorno da TMDB: ${S.metaJob.done} di ${S.metaJob.total}` : 'Aggiorna tutti i dati da TMDB'}</button>
    <button class="btn ghost wide" data-act="set-download">Scarica una copia della libreria</button>
    <a class="btn ghost wide" href="https://github.com/${OWNER}/${DATA_REPO}/commits/main/library.json" target="_blank" rel="noopener">Storia delle modifiche su GitHub</a>
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
  'set-download': () => {
    const blob = new Blob([serialize(lib())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vistidisimo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
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
