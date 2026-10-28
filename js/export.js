// Esportazione verso altre app: CSV di Letterboxd (film) e di Simkl (film, serie e anime).
// Il backup completo resta library.json (ogni episodio con la sua data): questi file servono
// solo a riportare la libreria in un'app fatta da altri.
import { lib, metaOf, putMeta, scheduleMetaSave } from './store.js';
import { fetchTvIds, pool, nonLatin, tmdbToken } from './tmdb.js';
import { isAnime, watchedCount, furthest, lastWatchDate } from './derive.js';
import { today } from './ui.js';

// ---- Letterboxd ----
// Formato: letterboxd.com/about/importing-data. Virgole come separatore, valori con virgole tra
// virgolette, virgolette interne precedute da una barra. Voto: Rating10 intero da 1 a 10.
function lbCell(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '\\"').replace(/\n/g, ' ')}"` : s;
}
const lbRow = (cells) => cells.map(lbCell).join(',');

// Titolo da usare fuori dall'app: quello originale se è in caratteri latini, se no quello che vediamo.
function plainTitle(key, it, m) {
  if (m?.ot && !nonLatin(m.ot)) return m.ot;
  return m?.t && !nonLatin(m.t) ? m.t : it.title;
}

export function letterboxdCsv({ watched }) {
  const L = lib();
  const rows = [watched ? 'tmdbID,imdbID,Title,Year,WatchedDate,Rating10,Rewatch' : 'tmdbID,imdbID,Title,Year'];
  const films = Object.entries(L.items)
    .filter(([, it]) => it.type === 'movie' && (watched ? it.status === 'completed' : it.status === 'planned'))
    .sort((a, b) => (a[1].seen || a[1].added || '').localeCompare(b[1].seen || b[1].added || ''));
  for (const [k, it] of films) {
    const m = metaOf(k);
    const base = [it.id, it.imdb || m?.im || '', plainTitle(k, it, m), m?.y || it.year || ''];
    if (!watched) { rows.push(lbRow(base)); continue; }
    const r10 = it.rating == null ? '' : Math.min(10, Math.max(1, Math.round(it.rating)));
    rows.push(lbRow([...base, (it.seen || '').slice(0, 10), r10, 'false']));
  }
  return rows.join('\n') + '\n';
}

// ---- Simkl ----
// Intestazione del CSV che accetta simkl.com/apps/import/csv (una riga per titolo, l'ultimo
// episodio visto come s2e4). Stati: completed, watching, plantowatch, dropped.
const SIMKL_HEAD = 'simkl_id,TVDB_ID,TMDB,IMDB_ID,MAL_ID,Type,Title,Year,LastEpWatched,Watchlist,WatchedDate,Rating,Memo';
const SIMKL_STATUS = { completed: 'completed', watching: 'watching', uptodate: 'watching', planned: 'plantowatch', dropped: 'dropped' };
function csvCell(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""').replace(/\n/g, ' ')}"` : s;
}

// Prima di Simkl servono gli id TVDB delle serie: quelli che meta.json non ha si chiedono a TMDB
// (6 per volta) e si salvano in meta.json, così la volta dopo non serve.
export const tvIdsMissing = () => Object.entries(lib().items)
  .filter(([k, it]) => it.type === 'tv' && metaOf(k) && !metaOf(k).tvdb && !metaOf(k).noIds)
  .map(([k]) => k);

export async function ensureTvIds(onProgress = () => {}) {
  if (!tmdbToken()) return;
  const todo = tvIdsMissing();
  let done = 0;
  onProgress(done, todo.length);
  await pool(todo, 6, async (k) => {
    const ids = await fetchTvIds(Number(k.split(':')[1]));
    const m = metaOf(k);
    if (m) putMeta(k, { ...m, ...(ids.im ? { im: ids.im } : {}), ...(ids.tvdb ? { tvdb: ids.tvdb } : { noIds: 1 }) });
    onProgress(++done, todo.length);
  });
  if (todo.length) scheduleMetaSave();
}

export function simklCsv() {
  const L = lib();
  const rows = [SIMKL_HEAD];
  for (const [k, it] of Object.entries(L.items)) {
    const m = metaOf(k);
    const type = it.type === 'movie' ? 'movie' : (isAnime(it, m) ? 'anime' : 'tv');
    let last = ''; let when = '';
    if (it.type === 'tv') {
      if (watchedCount(it)) { const [s, e] = furthest(it); last = `s${s}e${e}`; when = lastWatchDate(it).slice(0, 10); }
    } else if (it.status === 'completed') when = (it.seen || '').slice(0, 10);
    const rating = it.rating == null ? '' : Math.min(10, Math.max(1, Math.round(it.rating)));
    rows.push([
      '', it.type === 'tv' ? (m?.tvdb || '') : '', it.id, it.imdb || m?.im || '', '', type,
      plainTitle(k, it, m), m?.y || it.year || '', last, SIMKL_STATUS[it.status] || 'plantowatch', when, rating, '',
    ].map(csvCell).join(','));
  }
  return rows.join('\n') + '\n';
}

export const exportName = (what) => `vistidisimo-${what}-${today()}.csv`;
