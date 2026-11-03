// Se un anime ha episodi filler, secondo MyAnimeList (tramite Jikan, API pubblica senza chiave).
//
// Solo «sì»: quali episodi siano, Simo li guarda da sé (il «Sì» nella pagina della serie apre la lista
// degli episodi su MyAnimeList, dove i filler sono segnati). Nessun episodio viene segnato nell'app:
// la numerazione di TMDB e quella di MyAnimeList spesso non coincidono (scelta di Simo, 3/11/2026).
//
// Gli id MyAnimeList arrivano da AniList (`mal` in fetchFranchise): la serie e le sue parti che su TMDB
// sono la stessa serie. Si sfogliano gli episodi 100 alla volta e ci si ferma al primo filler.
// Risultato sul telefono (`vds.filler`): { f: true, u } oppure { f: false }, con `ids` e `at`.
import { LS } from './store.js';

const API = 'https://api.jikan.moe/v4';
const DAY = 24 * 3600 * 1000;
const TTL_YES = 90 * DAY;
const TTL_NO = 30 * DAY; // una serie in corso può avere filler nuovi
const MAX_PAGES = 15; // 1500 episodi per parte
const GAP = 450; // Jikan: al massimo 3 richieste al secondo e 60 al minuto

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tried = new Set(); // una prova per serie a ogni apertura dell'app, anche se va male

const all = () => LS.get('vds.filler', {}) || {};
export function fillerInfo(key) { return all()[key] || null; }

function save(key, v) {
  const a = all();
  a[key] = v;
  LS.set('vds.filler', a);
}

// Una pagina di episodi, oppure null se Jikan non risponde (allora non si sa niente).
async function page(id, n) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await fetch(`${API}/anime/${id}/episodes?page=${n}`, { headers: { Accept: 'application/json' } }); } catch { return null; }
    if (r.status === 429 && attempt === 0) { await sleep(2000); continue; }
    if (r.status === 404) return { data: [], pagination: { has_next_page: false } };
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }
  return null;
}

async function scan(ids) {
  for (const id of ids) {
    for (let n = 1; n <= MAX_PAGES; n++) {
      const j = await page(id, n);
      if (!j) return null;
      const f = (j.data || []).find((e) => e && e.filler === true);
      if (f) {
        const list = typeof f.url === 'string' && /^https:\/\/myanimelist\.net\/anime\/\d+\//.test(f.url)
          ? f.url.replace(/\/episode\/\d+\/?$/, '/episode') : `https://myanimelist.net/anime/${id}`;
        return { f: true, u: list };
      }
      if (!j.pagination?.has_next_page) break;
      await sleep(GAP);
    }
    await sleep(GAP);
  }
  return { f: false };
}

const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// Controlla (una volta, poi ogni tanto) se la serie `key` ha filler; `done` ridisegna.
export function checkFiller(key, ids, done) {
  if (!ids?.length || tried.has(key)) return;
  const c = fillerInfo(key);
  if (c && sameIds(c.ids, ids) && Date.now() - (c.at || 0) < (c.f ? TTL_YES : TTL_NO)) return;
  tried.add(key);
  scan(ids)
    .then((r) => { if (r) { save(key, { ...r, ids, at: Date.now() }); done(); } })
    .catch(() => {});
}
