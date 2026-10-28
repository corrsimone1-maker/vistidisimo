// Finti GitHub e TMDB per provare l'app senza rete.
const fs = require('fs');
const crypto = require('crypto');

function makeMocks(libPath, { animeKeys = new Set() } = {}) {
  const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  const files = { 'library.json': fs.readFileSync(libPath, 'utf8') };
  const shas = { 'library.json': 'sha0' };
  const log = { puts: [], gets: 0 };
  const today = new Date();
  const day = (off) => { const d = new Date(today.getTime() + off * 86400000); return d.toISOString().slice(0, 10); };

  async function github(route) {
    const req = route.request();
    const u = new URL(req.url());
    const m = u.pathname.match(/\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: '{}' });
    const path = decodeURIComponent(m[1]);
    if (req.method() === 'GET') {
      log.gets++;
      if (!(path in files)) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ sha: shas[path], encoding: 'base64', content: Buffer.from(files[path]).toString('base64') }) });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      if ((shas[path] || null) !== (body.sha || null)) {
        log.puts.push({ path, conflict: true, message: body.message });
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'sha mismatch' }) });
      }
      files[path] = Buffer.from(body.content, 'base64').toString('utf8');
      shas[path] = crypto.createHash('sha1').update(files[path]).digest('hex');
      log.puts.push({ path, message: body.message, size: files[path].length });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: shas[path] } }) });
    }
    return route.fulfill({ status: 405, body: '{}' });
  }

  function tvDetails(id) {
    const key = `tv:${id}`;
    const it = lib.items[key];
    const anime = animeKeys.has(key);
    const seasons = [];
    let status = 'Ended';
    let le = null; let ne = null;
    if (it) {
      const eps = it.eps || {};
      const nums = Object.keys(eps).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
      const maxS = nums.length ? nums[nums.length - 1] : 1;
      const absolute = nums.some((n) => n > 1 && Math.min(...Object.keys(eps[String(n)]).map(Number)) > 1);
      let cum = 0;
      for (let s = 1; s <= Math.max(maxS, it.status === 'planned' ? 2 : maxS); s++) {
        const watched = Object.keys(eps[String(s)] || {}).map(Number);
        let cnt = watched.length ? Math.max(...watched) : 10;
        if (absolute) cnt = Math.max(watched.length, cnt - cum);
        if (s === maxS && (it.status === 'watching' || it.status === 'dropped')) cnt += 4;
        seasons.push({ season_number: s, episode_count: cnt, air_date: `${2015 + s}-01-10`, name: `Stagione ${s}`, first: absolute ? cum + 1 : 1 });
        cum += cnt;
      }
      if (eps['0']) seasons.unshift({ season_number: 0, episode_count: Object.keys(eps['0']).length + 1, name: 'Speciali', air_date: '2016-01-01' });
      const last = seasons[seasons.length - 1];
      if (it.status === 'watching' || it.status === 'uptodate') {
        status = 'Returning Series';
        le = { season_number: last.season_number, episode_number: (last.first || 1) - 1 + last.episode_count, air_date: day(-4) };
        if (it.status === 'uptodate') {
          last.episode_count += 2;
          ne = { season_number: last.season_number, episode_number: le.episode_number + 1, air_date: day(3), name: 'Il ritorno' };
        } else {
          ne = { season_number: last.season_number, episode_number: le.episode_number + 1, air_date: day(id % 9), name: 'Prossimamente' };
          last.episode_count += 1;
        }
      } else {
        le = { season_number: last.season_number, episode_number: (last.first || 1) - 1 + last.episode_count, air_date: '2020-05-01' };
      }
    } else {
      seasons.push({ season_number: 1, episode_count: 8, air_date: '2024-01-01', name: 'Stagione 1' });
      le = { season_number: 1, episode_number: 8, air_date: '2024-02-01' };
    }
    return {
      id, name: it ? it.title : `Serie ${id}`, original_name: it ? it.title : `Serie ${id}`, first_air_date: `${it?.year || 2020}-03-01`,
      poster_path: `/p_tv_${id}.jpg`, backdrop_path: `/b_tv_${id}.jpg`, overview: 'Una trama di prova per vedere come sta il testo nella pagina: due o tre righe che raccontano di cosa parla la serie senza svelare troppo.',
      genres: anime ? [{ id: 16, name: 'Animazione' }, { id: 10759, name: 'Action & Adventure' }] : [{ id: 18, name: 'Dramma' }, { id: 9648, name: 'Mistero' }],
      original_language: anime ? 'ja' : 'en', origin_country: anime ? ['JP'] : ['US'], episode_run_time: [anime ? 24 : 44], status,
      seasons, last_episode_to_air: le, next_episode_to_air: ne,
    };
  }
  function movieDetails(id) {
    const key = `movie:${id}`;
    const it = lib.items[key];
    let title = it ? it.title : null;
    if (!title) for (const l of lib.lists) for (const e of l.items) if (e.key === key) title = e.title;
    const anime = animeKeys.has(key);
    const future = it && it.status === 'planned' && id % 3 === 0;
    return {
      id, title: title || `Film ${id}`, original_title: title || `Film ${id}`, release_date: future ? day(12) : `${it?.year || 2010}-05-01`,
      poster_path: `/p_movie_${id}.jpg`, backdrop_path: `/b_movie_${id}.jpg`, overview: 'Trama di prova del film.',
      genres: anime ? [{ id: 16, name: 'Animazione' }, { id: 14, name: 'Fantasy' }] : [{ id: 18, name: 'Dramma' }],
      original_language: anime ? 'ja' : 'en', origin_country: anime ? ['JP'] : ['US'], runtime: 90 + (id % 50), status: 'Released',
    };
  }

  // Testi finti di un episodio per lingua, per provare il ripiego italiano → inglese → spagnolo:
  // italiano se e non è multiplo di 3; inglese se non è multiplo né di 5 né di 7; spagnolo se non è multiplo di 7.
  // Così E3 ha solo inglese e spagnolo, E15 solo spagnolo, E21 nessuna delle tre (solo francese).
  // Il titolo italiano dei multipli di 4 è il segnaposto "Episodio N" (quello vero è in inglese).
  function epText(id, s, e, l) {
    const has = { it: e % 3 !== 0, en: e % 5 !== 0 && e % 7 !== 0, es: e % 7 !== 0, fr: true }[l];
    const word = { it: 'Trama', en: 'Plot', es: 'Trama en español', fr: 'Résumé' }[l];
    const name = l === 'it' ? (e % 4 === 0 ? `Episodio ${e}` : `Episodio di prova numero ${e}`) : (l === 'en' ? `English title ${e}` : '');
    return { name, ov: has ? `${word} dell'episodio ${e} della stagione ${s}: qualcuno parte, qualcuno torna e alla fine niente è come prima.\nUn secondo paragrafo per vedere come vanno a capo le trame lunghe su TMDB.` : '' };
  }

  async function tmdb(route) {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    let body = null; let m;
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
    if ((m = p.match(/^\/(tv|movie)\/(\d+)\/images$/))) {
      // copertine e banner in più lingue, come su TMDB
      const t = m[1]; const id = m[2];
      const mk = (kind, langs) => langs.map((l, i) => ({ file_path: `/${kind}_${t}_${id}_${l || 'x'}${i}.jpg`, iso_639_1: l, vote_average: 5 + ((i * 7) % 5), vote_count: 10 - i }));
      body = { posters: mk('p', ['it', 'it', 'en', 'en', 'en', 'ja', 'ja', null, 'fr']), backdrops: mk('b', [null, null, null, 'en', 'it']), logos: [] };
    } else if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)\/episode\/(\d+)\/images$/))) {
      // fotogrammi di un episodio, in più lingue e senza testo
      const [, id, s, e] = m;
      const n = 3 + (Number(e) % 5);
      body = { id: Number(e), stills: Array.from({ length: n }, (_, i) => ({ file_path: `/s_${id}_${s}_${e}_${i}.jpg`, iso_639_1: i === 2 ? 'en' : null, vote_average: (i * 3) % 7, vote_count: i, width: 1920, height: 1080 })) };
    } else if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)\/episode\/(\d+)$/))) {
      // dettagli di un episodio in italiano, con tutte le traduzioni (regole di epText)
      const id = Number(m[1]); const s = Number(m[2]); const e = Number(m[3]);
      const it = epText(id, s, e, 'it');
      const translations = ['en', 'es', 'fr'].map((l) => ({ l, t: epText(id, s, e, l) })).filter((x) => x.t.ov || x.t.name)
        .map(({ l, t }) => ({ iso_639_1: l, iso_3166_1: { en: 'US', es: 'ES', fr: 'FR' }[l], name: l, english_name: l, data: { name: t.name, overview: t.ov } }));
      body = {
        id: e * 1000 + s, season_number: s, episode_number: e, name: it.name, overview: it.ov, air_date: `${2015 + s}-02-1${e % 9}`, runtime: 24,
        still_path: `/s_${id}_${s}_${e}.jpg`, crew: [{ job: 'Director', name: 'Regista Finto' }, { job: 'Writer', name: 'Autrice Finta' }, { job: 'Screenplay', name: 'Autrice Finta' }],
        translations: { translations },
      };
    } else if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) {
      const id = Number(m[1]); const s = Number(m[2]);
      const lang = (u.searchParams.get('language') || 'it-IT').slice(0, 2);
      const d = tvDetails(id); const se = d.seasons.find((x) => x.season_number === s);
      const le = d.last_episode_to_air;
      const first = se?.first || 1;
      body = { name: se ? se.name : `Stagione ${s}`, episodes: Array.from({ length: se ? se.episode_count : 0 }, (_, i) => {
        const aired = s === 0 || !le || s < le.season_number || (s === le.season_number && first + i <= le.episode_number);
        const t = epText(id, s, first + i, lang);
        return { episode_number: first + i, name: t.name || `Episodio ${first + i}`, overview: t.ov, air_date: aired ? `${2015 + s}-0${1 + (i % 9)}-1${i % 9}` : day(3 + i * 7), still_path: `/s_${id}_${s}_${i + 1}.jpg`, runtime: 44 };
      }) };
    } else if ((m = p.match(/^\/tv\/(\d+)$/))) body = tvDetails(Number(m[1]));
    else if ((m = p.match(/^\/movie\/(\d+)$/))) body = movieDetails(Number(m[1]));
    else if (p === '/configuration') body = { images: {} };
    else if (p === '/trending/all/week' || p === '/search/multi') {
      const q = (u.searchParams.get('query') || '').toLowerCase();
      const keys = Object.keys(lib.items).filter((k) => !q || lib.items[k].title.toLowerCase().includes(q)).slice(0, 9);
      const en = u.searchParams.get('language') === 'en-US';
      const results = keys.map((k) => {
        const [t, id] = k.split(':'); const it = lib.items[k]; const anime = animeKeys.has(k);
        // come TMDB: senza traduzione italiana gli anime tornano col titolo giapponese
        const name = anime && !en ? `アニメ ${it.title.slice(0, 6)}` : it.title;
        return { media_type: t, id: Number(id), title: t === 'movie' ? name : undefined, name: t === 'tv' ? name : undefined, original_title: t === 'movie' ? `アニメ ${it.title.slice(0, 6)}` : undefined, original_name: t === 'tv' ? (anime ? `アニメ ${it.title.slice(0, 6)}` : it.title) : undefined, release_date: t === 'movie' ? `${it.year}-01-01` : undefined, first_air_date: t === 'tv' ? `${it.year}-01-01` : undefined, overview: en || !anime ? `Trama di ${it.title}.` : '', poster_path: `/p_${t}_${id}.jpg`, genre_ids: anime ? [16] : [18], original_language: anime ? 'ja' : 'en' };
      });
      if (!q || q.startsWith('nuov')) results.push({ media_type: 'tv', id: 999001, name: 'Una serie nuova di zecca', poster_path: '/p_tv_999001.jpg', genre_ids: [18] }, { media_type: 'movie', id: 999002, title: 'Un film mai visto', poster_path: null, genre_ids: [16], original_language: 'ja' }, { media_type: 'person', id: 5, name: 'Persona' });
      body = { results: u.searchParams.get('page') === '2' ? [] : results };
    }
    if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  }

  function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  async function image(route) {
    const u = new URL(route.request().url());
    const name = u.pathname.split('/').pop();
    const h = hue(name);
    const wide = name.startsWith('b_') || name.startsWith('s_');
    const [w, hh] = wide ? [780, 439] : [342, 513];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,42%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},60%,18%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${hh * 0.3}" r="${w * 0.22}" fill="hsla(${(h + 180) % 360},70%,70%,.35)"/><rect x="${w * 0.1}" y="${hh * 0.72}" width="${w * 0.8}" height="${hh * 0.05}" fill="rgba(255,255,255,.55)"/><rect x="${w * 0.1}" y="${hh * 0.8}" width="${w * 0.5}" height="${hh * 0.035}" fill="rgba(255,255,255,.35)"/></svg>`;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  }

  return { github, tmdb, image, files, shas, log, lib };
}
module.exports = { makeMocks };
