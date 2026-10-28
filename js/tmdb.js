// Accesso a TMDB: catalogo, locandine, stagioni, episodi.

const API = 'https://api.themoviedb.org/3';
const LANG = 'it-IT';

export function tmdbToken() {
  try { return localStorage.getItem('vds.tmdbToken') || ''; } catch { return ''; }
}

export class TmdbError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tm(path, params = {}, tokenOverride) {
  const u = new URL(API + path);
  // language: assente = italiano; null = nessuna lingua (serve per avere le immagini in tutte le lingue)
  const lang = params.language === undefined ? LANG : params.language;
  if (lang) u.searchParams.set('language', lang);
  for (const [k, v] of Object.entries(params)) if (k !== 'language' && v != null) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await fetch(u, { headers: { Authorization: `Bearer ${tokenOverride || tmdbToken()}`, Accept: 'application/json' } });
    } catch (e) {
      if (attempt === 3) throw new TmdbError(0, 'TMDB non raggiungibile');
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new TmdbError(r.status, `TMDB ha risposto ${r.status}`);
    return r.json();
  }
  throw new TmdbError(429, 'TMDB: troppe richieste');
}

const year = (d) => (d ? Number(d.slice(0, 4)) : null);

// id IMDb e TVDB, solo se ci sono (per tenere piccolo meta.json)
const ids = (imdb, tvdb) => ({ ...(imdb ? { im: imdb } : {}), ...(tvdb ? { tvdb } : {}) });

// Riassunto compatto di un titolo, salvato in meta.json.
export function metaFromDetails(type, d) {
  if (type === 'movie') {
    return {
      t: d.title, ot: d.original_title, y: year(d.release_date), p: d.poster_path || null, b: d.backdrop_path || null,
      g: (d.genres || []).map((g) => g.id), l: d.original_language,
      c: d.origin_country?.length ? d.origin_country : (d.production_countries || []).map((c) => c.iso_3166_1),
      rt: d.runtime || null, rd: d.release_date || null, st: d.status || null, ...ids(d.imdb_id, null), at: Date.now(),
    };
  }
  const rt = d.episode_run_time?.length ? Math.round(d.episode_run_time.reduce((a, b) => a + b, 0) / d.episode_run_time.length)
    : (d.last_episode_to_air?.runtime || d.next_episode_to_air?.runtime || null);
  const le = d.last_episode_to_air;
  const ne = d.next_episode_to_air;
  return {
    t: d.name, ot: d.original_name, y: year(d.first_air_date), p: d.poster_path || null, b: d.backdrop_path || null,
    g: (d.genres || []).map((g) => g.id), l: d.original_language, c: d.origin_country || [],
    rt, st: d.status || null, ad: d.first_air_date || null,
    ss: (d.seasons || []).map((s) => [s.season_number, s.episode_count || 0, s.air_date || null]),
    le: le ? [le.season_number, le.episode_number, le.air_date || null] : null,
    ne: ne ? [ne.season_number, ne.episode_number, ne.air_date || null, ne.name || ''] : null,
    ...ids(d.external_ids?.imdb_id, d.external_ids?.tvdb_id),
    at: Date.now(),
  };
}

// Titoli in scrittura non latina (giapponese, coreano, cinese, cirillico…): succede quando TMDB
// non ha la traduzione italiana e restituisce il titolo originale.
const NON_LATIN = /[\u0400-\u04ff\u0590-\u06ff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
export const nonLatin = (s) => !!s && NON_LATIN.test(s);

// Dettagli in italiano; se il titolo non è leggibile (o manca la trama e serve) ripiega sull'inglese.
export async function fetchDetails(type, id, { overview = false, credits = false } = {}) {
  // per le serie anche gli id esterni (TVDB, IMDb): servono per esportare verso altre app
  const extra = [credits && 'credits', type === 'tv' && 'external_ids'].filter(Boolean).join(',');
  const d = await tm(`/${type}/${id}`, extra ? { append_to_response: extra } : {});
  if (!d) return d;
  const k = type === 'movie' ? 'title' : 'name';
  if (nonLatin(d[k]) || (overview && !d.overview)) {
    const en = await tm(`/${type}/${id}`, { language: 'en-US' }).catch(() => null);
    if (en?.[k] && nonLatin(d[k]) && !nonLatin(en[k])) d[k] = en[k];
    if (!d.overview && en?.overview) d.overview = en.overview;
  }
  return d;
}

// Tutte le copertine e tutti i banner di un titolo, in ogni lingua. I loghi non servono (l'app usa una scritta).
// Ogni immagine: { p: percorso, l: lingua ISO 639-1 o null (senza testo), v: voto, n: numero di voti }
export async function fetchImages(type, id) {
  const d = await tm(`/${type}/${id}/images`, { language: null });
  const pick = (arr) => (arr || [])
    .map((x) => ({ p: x.file_path, l: x.iso_639_1 || null, v: x.vote_average || 0, n: x.vote_count || 0 }))
    .sort((a, b) => b.v - a.v || b.n - a.n);
  return { posters: pick(d?.posters), backdrops: pick(d?.backdrops) };
}

// Una stagione con i suoi episodi. language: 'it-IT' (predefinita), 'en-US' o 'es-ES' per le trame mancanti.
export async function fetchSeason(id, n, language) {
  const d = await tm(`/tv/${id}/season/${n}`, language ? { language } : {});
  if (!d) return null;
  return {
    name: d.name,
    eps: (d.episodes || []).map((e) => ({ n: e.episode_number, name: e.name, air: e.air_date || null, still: e.still_path || null, rt: e.runtime || null, ov: (e.overview || '').trim() })),
  };
}

// Lingue delle trame, in ordine di preferenza: italiano, poi inglese, poi spagnolo. Le altre no.
export const PLOT_LANGS = [
  { l: 'it', regions: ['IT'], label: 'italiano' },
  { l: 'en', regions: ['US', 'GB'], label: 'inglese' },
  { l: 'es', regions: ['ES', 'MX'], label: 'spagnolo' },
];

// Sceglie titolo e trama tra le traduzioni di TMDB: { name, ov, lang } (lang: 'it'|'en'|'es'|null).
// Titoli segnaposto che TMDB mette quando manca quello vero ("Episodio 5", "Episode 5", "Episodio 5" in spagnolo).
export const genericName = (s) => /^\s*(episodio|episode|episódio|capitolo|cap[ií]tulo)\s*\d+\s*$/i.test(s || '');

export function pickPlot(translations) {
  const list = [].concat(translations || []);
  const best = (l, regions, field) => {
    const cand = list.filter((t) => t.iso_639_1 === l && (t.data?.[field] || '').trim() && !(field === 'name' && genericName(t.data.name)));
    cand.sort((a, b) => {
      const ia = regions.indexOf(a.iso_3166_1); const ib = regions.indexOf(b.iso_3166_1);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return cand[0]?.data?.[field]?.trim() || '';
  };
  let ov = ''; let lang = null; let name = '';
  for (const { l, regions } of PLOT_LANGS) {
    if (!ov) { const t = best(l, regions, 'overview'); if (t) { ov = t; lang = l; } }
    if (!name) name = best(l, regions, 'name');
  }
  return { name, ov, lang };
}

// Tutto quello che TMDB sa di un episodio: titolo e trama (it → en → es) e tutti i fotogrammi
// (stills) in ogni lingua, ordinati per voto.
export async function fetchEpisode(id, s, e) {
  const base = `/tv/${id}/season/${s}/episode/${e}`;
  const [d, im] = await Promise.all([
    tm(base, { append_to_response: 'translations' }),
    tm(`${base}/images`, { language: null }).catch(() => null),
  ]);
  if (!d) return null;
  const tr = [...(d.translations?.translations || (Array.isArray(d.translations) ? d.translations : []))];
  // la versione italiana arriva anche nei campi principali (la richiesta è in it-IT)
  if ((d.overview || '').trim() || (d.name || '').trim()) tr.unshift({ iso_639_1: 'it', iso_3166_1: 'IT', data: { name: d.name || '', overview: d.overview || '' } });
  const plot = pickPlot(tr);
  const stills = (im?.stills || [])
    .map((x) => ({ p: x.file_path, v: x.vote_average || 0, n: x.vote_count || 0, w: x.width || 0 }))
    .sort((a, b) => b.v - a.v || b.n - a.n || b.w - a.w)
    .map((x) => x.p);
  if (d.still_path && !stills.includes(d.still_path)) stills.unshift(d.still_path);
  else if (d.still_path) { stills.splice(stills.indexOf(d.still_path), 1); stills.unshift(d.still_path); }
  return {
    name: plot.name || d.name || '', ov: plot.ov, lang: plot.lang,
    air: d.air_date || null, rt: d.runtime || null,
    stills,
  };
}

// ---- registi ----
// Chi ha diretto un film, dai crediti di TMDB: [{ id, name }]
export function movieDirectors(d) {
  const out = new Map();
  for (const c of d?.credits?.crew || []) if (c.job === 'Director' && !out.has(c.id)) out.set(c.id, { id: c.id, name: c.name });
  return [...out.values()];
}

// Un cortometraggio dura 40 minuti o meno, titoli di coda compresi (la soglia dell'Academy).
export const SHORT_MAX_MIN = 40;
const runtimes = new Map(); // id film -> minuti (0 = sconosciuta), per la sessione

// Tutti i film diretti da una persona, dal più recente al più vecchio (quelli annunciati senza data
// in cima). Fuori i cortometraggi e i contenuti «video» di TMDB (making of e simili). La durata
// dei film che non sono già in meta.json (knownRuntime) si chiede a TMDB, 6 richieste per volta.
// I titoli in scrittura non latina si prendono in inglese.
export async function fetchDirector(id, knownRuntime = () => null) {
  const d = await tm(`/person/${id}`, { append_to_response: 'movie_credits' });
  if (!d) return null;
  let crew = (d.movie_credits?.crew || []).filter((c) => c.job === 'Director' && !c.video);
  if (crew.some((c) => nonLatin(c.title))) {
    const en = await tm(`/person/${id}/movie_credits`, { language: 'en-US' }).catch(() => null);
    const t = new Map((en?.crew || []).map((c) => [c.id, c.title]));
    crew = crew.map((c) => (nonLatin(c.title) && t.get(c.id) && !nonLatin(t.get(c.id)) ? { ...c, title: t.get(c.id) } : c));
  }
  const films = new Map();
  for (const c of crew) {
    if (films.has(c.id)) continue;
    films.set(c.id, { id: c.id, t: c.title || c.original_title || '', d: c.release_date || '', p: c.poster_path || null, genre_ids: c.genre_ids || [], original_language: c.original_language });
  }
  const list = [...films.values()];
  const todo = list.filter((f) => !runtimes.has(f.id) && !knownRuntime(f.id));
  await pool(todo, 6, async (f) => {
    const m = await tm(`/movie/${f.id}`);
    runtimes.set(f.id, m?.runtime || 0);
  });
  for (const f of list) f.rt = knownRuntime(f.id) || runtimes.get(f.id) || 0;
  // durata sconosciuta (0) = si tiene: meglio un film in più che uno vero nascosto
  const kept = list.filter((f) => !(f.rt > 0 && f.rt <= SHORT_MAX_MIN));
  kept.sort((a, b) => (b.d || '9999').localeCompare(a.d || '9999') || a.t.localeCompare(b.t));
  return { name: d.name || '', films: kept, shorts: list.length - kept.length };
}

// Id esterni di una serie (per gli export, quando meta.json non li ha ancora): { im, tvdb }
export async function fetchTvIds(id) {
  const d = await tm(`/tv/${id}/external_ids`, { language: null });
  return { im: d?.imdb_id || null, tvdb: d?.tvdb_id || null };
}

// Esegue i lavori con al massimo `n` richieste contemporanee.
export async function pool(items, n, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); } catch (e) { console.warn('tmdb', items[idx], e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}
