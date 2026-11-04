// Se un anime ha episodi filler, secondo MyAnimeList (tramite Jikan, vedi js/jikan.js).
//
// Solo «sì»: quali episodi siano, Simo li guarda da sé (il «Sì» nella pagina della serie apre la lista
// degli episodi su MyAnimeList, dove i filler sono segnati). Nessun episodio viene segnato nell'app:
// la numerazione di TMDB e quella di MyAnimeList spesso non coincidono (scelta di Simo, 3/11/2026).
//
// Gli id MyAnimeList arrivano da «Film e OVA» (`mal` in fetchFranchise, js/mal.js): la serie e le sue
// parti che su TMDB sono la stessa serie. Si sfogliano gli episodi 100 alla volta e ci si ferma al primo
// filler. Risultato sul telefono (`vds.filler`): { f: true, u } oppure { f: false }, con `ids` e `at`.
import { LS } from './store.js';
import { jikan, jikanDown } from './jikan.js';

const DAY = 24 * 3600 * 1000;
const TTL_YES = 90 * DAY;
const TTL_NO = 30 * DAY; // una serie in corso può avere filler nuovi
const MAX_PAGES = 15; // 1500 episodi per parte

const tried = new Set(); // una prova per serie a ogni apertura dell'app, anche se va male

const all = () => LS.get('vds.filler', {}) || {};
export function fillerInfo(key) { return all()[key] || null; }

function save(key, v) {
  const a = all();
  a[key] = v;
  LS.set('vds.filler', a);
}

// { f: true, u } al primo filler, { f: false } se non ce ne sono, null se MyAnimeList non risponde.
async function scan(key, ids) {
  for (const id of ids) {
    for (let n = 1; n <= MAX_PAGES; n++) {
      let j;
      try { j = await jikan(`/anime/${id}/episodes?page=${n}`, { key }); } catch { return null; }
      if (!j) break; // MyAnimeList non ha questa voce
      const f = (j.data || []).find((e) => e && e.filler === true);
      if (f) {
        const list = typeof f.url === 'string' && /^https:\/\/myanimelist\.net\/anime\/\d+\//.test(f.url)
          ? f.url.replace(/\/episode\/\d+\/?$/, '/episode') : `https://myanimelist.net/anime/${id}`;
        return { f: true, u: list };
      }
      if (!j.pagination?.has_next_page) break;
    }
  }
  return { f: false };
}

const sameIds = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// Controlla (una volta, poi ogni tanto) se la serie `key` ha filler; `done` ridisegna.
export function checkFiller(key, ids, done) {
  if (!ids?.length || tried.has(key)) return;
  const c = fillerInfo(key);
  if (c && sameIds(c.ids, ids) && Date.now() - (c.at || 0) < (c.f ? TTL_YES : TTL_NO)) return;
  if (jikanDown()) return; // MyAnimeList spento o che non risponde: resta quello che si sapeva
  tried.add(key);
  scan(key, ids)
    .then((r) => { if (r) { save(key, { ...r, ids, at: Date.now() }); done(); } })
    .catch(() => {});
}
