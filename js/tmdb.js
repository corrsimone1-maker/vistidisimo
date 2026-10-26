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
  u.searchParams.set('language', LANG);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
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

// Riassunto compatto di un titolo, salvato in meta.json.
export function metaFromDetails(type, d) {
  if (type === 'movie') {
    return {
      t: d.title, ot: d.original_title, y: year(d.release_date), p: d.poster_path || null, b: d.backdrop_path || null,
      g: (d.genres || []).map((g) => g.id), l: d.original_language,
      c: d.origin_country?.length ? d.origin_country : (d.production_countries || []).map((c) => c.iso_3166_1),
      rt: d.runtime || null, rd: d.release_date || null, st: d.status || null, at: Date.now(),
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
    at: Date.now(),
  };
}

export async function fetchDetails(type, id) {
  return tm(`/${type}/${id}`);
}

export async function fetchSeason(id, n) {
  const d = await tm(`/tv/${id}/season/${n}`);
  if (!d) return null;
  return {
    name: d.name,
    eps: (d.episodes || []).map((e) => ({ n: e.episode_number, name: e.name, air: e.air_date || null, still: e.still_path || null, rt: e.runtime || null })),
  };
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
