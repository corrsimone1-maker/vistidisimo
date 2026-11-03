// Prova di Cerca in qualunque lingua e dei titoli romaji degli anime (3/11/2026), con TMDB e Jikan finti:
// - «attack on titan»: TMDB mette prima i film, l'app mette in cima la serie (titolo inglese uguale);
// - «shingeki no kyojin»: TMDB non trova niente, MyAnimeList sì → la serie compare, col romaji sotto;
// - una ricerca qualsiasi non si riempie di anime che non c'entrano;
// - titolo originale: per gli anime niente giapponese, il romaji (serie da «Film e OVA», film da una ricerca);
// - nella pagina della serie non c'è più «Il prossimo da vedere».
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = path.join(ROOT, 'vistidisimo-dati', 'library.json');
const OUT = process.argv[2] || require('os').tmpdir();

// TMDB finto
const AOT = { media_type: 'tv', id: 1429, name: "L'attacco dei giganti", original_name: '進撃の巨人', first_air_date: '2013-04-07', poster_path: '/p_tv_1429.jpg', genre_ids: [16, 10759], original_language: 'ja', origin_country: ['JP'], popularity: 300 };
const AOT_EN = { ...AOT, name: 'Attack on Titan' };
const FILMS = [
  { media_type: 'movie', id: 1234, title: 'Attack on Titan: The Last Attack', original_title: '劇場版「進撃の巨人」完結編THE LAST ATTACK', release_date: '2024-11-08', poster_path: '/p_movie_1234.jpg', genre_ids: [16], original_language: 'ja', popularity: 60 },
  { media_type: 'movie', id: 1235, title: "L'attacco dei giganti - Il film - Parte 1", original_title: '劇場版 進撃の巨人 前編', release_date: '2014-11-22', poster_path: '/p_movie_1235.jpg', genre_ids: [16], original_language: 'ja', popularity: 25 },
  { media_type: 'movie', id: 1236, title: 'Attack on Titan (live action)', original_title: '進撃の巨人 ATTACK ON TITAN', release_date: '2015-08-01', poster_path: '/p_movie_1236.jpg', genre_ids: [28], original_language: 'ja', popularity: 30 },
];
// MyAnimeList finto
const MAL = {
  16498: { type: 'TV', y: 2013, ja: '進撃の巨人', en: 'Attack on Titan', ro: 'Shingeki no Kyojin' },
  23775: { type: 'Movie', y: 2014, ja: '劇場版 進撃の巨人 前編', en: 'Attack on Titan Movie 1', ro: 'Shingeki no Kyojin Movie 1: Guren no Yumiya' },
  9999: { type: 'TV', y: 2010, ja: 'ブレイキング', en: 'Breaking Point Girls', ro: 'Breaking Shoujo' },
};
const malAnime = (id) => { const a = MAL[id]; return { mal_id: Number(id), url: `https://myanimelist.net/anime/${id}/X`, images: { jpg: { large_image_url: `https://cdn.myanimelist.net/c_${id}.jpg` } }, title: a.ro, title_english: a.en, title_japanese: a.ja, type: a.type, aired: { from: `${a.y}-04-01T00:00:00+00:00` }, year: a.y, rating: 'R - 17+', relations: [] }; };

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8152', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB, {});
  const log = { mal: [] };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://cdn.myanimelist.net/**', (route) => route.fulfill({ status: 404, body: '' }));
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    const q = (u.searchParams.get('query') || '').toLowerCase();
    const en = u.searchParams.get('language') === 'en-US';
    const page2 = u.searchParams.get('page') === '2';
    if (p === '/search/multi') {
      if (page2) return ok(route, { results: [] });
      if (q === 'attack on titan') return ok(route, { results: en ? [...FILMS, AOT_EN] : [...FILMS, AOT] }); // TMDB: film prima della serie
      if (q === 'breaking') return ok(route, { results: [{ media_type: 'tv', id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20', genre_ids: [18], original_language: 'en', popularity: 400 }] });
      return ok(route, { results: [] });
    }
    if (p === '/search/tv') return ok(route, { results: q.includes('進撃の巨人') ? [{ ...AOT }] : [] });
    if (p === '/search/movie') return ok(route, { results: q.includes('前編') ? [{ ...FILMS[1] }] : [] });
    if (p === '/tv/1429') return M.tmdb({ request: () => ({ url: () => route.request().url().replace('/tv/1429', '/tv/1429') }), fulfill: async (o) => { const b = JSON.parse(o.body || '{}'); Object.assign(b, { id: 1429, name: "L'attacco dei giganti", original_name: '進撃の巨人', genres: [{ id: 16, name: 'Animazione' }], original_language: 'ja', origin_country: ['JP'] }); return route.fulfill({ ...o, status: 200, body: JSON.stringify(b) }); } });
    if (p === '/movie/1235') return ok(route, { id: 1235, title: "L'attacco dei giganti - Il film - Parte 1", original_title: '劇場版 進撃の巨人 前編', release_date: '2014-11-22', genres: [{ id: 16, name: 'Animazione' }], original_language: 'ja', origin_country: ['JP'], overview: 'Trama.', runtime: 119, credits: { crew: [] }, poster_path: '/p_movie_1235.jpg' });
    return M.tmdb(route);
  });
  await ctx.route('https://api.jikan.moe/**', (route) => {
    const u = new URL(route.request().url());
    log.mal.push(u.pathname + u.search);
    if (u.pathname === '/v4/anime') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const ids = Object.keys(MAL).filter((id) => [MAL[id].ja, MAL[id].en, MAL[id].ro].some((t) => t.toLowerCase().includes(q) || q.includes(t.toLowerCase())));
      return ok(route, { pagination: { has_next_page: false }, data: ids.map(malAnime) });
    }
    const m = u.pathname.match(/^\/v4\/anime\/(\d+)\/full$/);
    if (m && MAL[m[1]]) return ok(route, { data: malAnime(m[1]) });
    if (/\/episodes$/.test(u.pathname)) return ok(route, { pagination: { has_next_page: false }, data: [] });
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const check = (label, good) => { console.log(`${good ? 'ok ' : 'NO '} ${label}`); if (!good) errors.push('fallita: ' + label); };
  const rows = () => page.$$eval('.sr', (els) => els.map((e) => [e.getAttribute('href'), e.querySelector('.sr-title').textContent, e.querySelector('.sr-orig')?.textContent || '']));
  const base = 'http://127.0.0.1:8152/vistidisimo/';
  const search = async (q) => {
    await page.fill('[data-input=search-q]', q);
    await page.waitForTimeout(500); // la ricerca parte 350 ms dopo l'ultimo tasto
    await page.waitForFunction(() => !document.querySelector('#search-results')?.textContent.includes('Cerco'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
  };

  await page.goto(base + '#/cerca');
  await page.waitForSelector('[data-input=search-q]');

  // 1. «attack on titan»: la serie in cima anche se TMDB dà prima i film
  await search('attack on titan');
  let r = await rows();
  console.log('   ', r.map((x) => x[1]).join(' | '));
  check(`la serie per prima: ${r[0]?.[1]}`, r[0]?.[0] === '#/t/tv/1429');
  check('il romaji sotto la serie al posto del giapponese', r[0]?.[2] === 'Shingeki no Kyojin');
  check('nessun titolo originale in giapponese (neanche del film dal vero)', !r.some((x) => /[぀-ヿ一-鿿]/.test(x[2])));
  await page.screenshot({ path: path.join(OUT, 'cl1-attack.png') });

  // 2. «shingeki no kyojin»: TMDB non lo trova, MyAnimeList sì
  await search('shingeki no kyojin');
  r = await rows();
  console.log('   ', r.map((x) => x.join(' / ')).join(' | '));
  check('trovata la serie col titolo romaji, e il romaji sotto', r[0]?.[0] === '#/t/tv/1429' && r[0]?.[1] === "L'attacco dei giganti" && r[0]?.[2] === 'Shingeki no Kyojin');
  await page.screenshot({ path: path.join(OUT, 'cl2-shingeki.png') });

  // 3. una ricerca qualsiasi: niente anime aggiunti che non c'entrano
  await search('breaking');
  r = await rows();
  check(`«breaking»: solo Breaking Bad (${r.map((x) => x[1]).join(', ')})`, r.length === 1 && r[0][1] === 'Breaking Bad');

  // 4. pagina della serie: titolo originale in romaji (dalla ricerca o da «Film e OVA»)
  await page.goto(base + '#/t/tv/1429');
  await page.waitForSelector('.d-head h1');
  await page.waitForFunction(() => !!document.querySelector('.d-orig'), null, { timeout: 8000 }).catch(() => {});
  const orig = await page.$eval('.d-orig', (e) => e.textContent).catch(() => '(manca)');
  check(`titolo originale della serie: ${orig}`, orig === 'Shingeki no Kyojin');
  await page.screenshot({ path: path.join(OUT, 'cl3-serie.png') });

  // 5. un film anime mai cercato prima: il romaji arriva da una ricerca su MyAnimeList
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('vds.mal.ro') || '{}'); delete r['movie:1235']; localStorage.setItem('vds.mal.ro', JSON.stringify(r)); });
  await page.reload();
  await page.goto(base + '#/t/movie/1235');
  await page.waitForSelector('.d-head h1');
  await page.waitForFunction(() => !!document.querySelector('.d-orig'), null, { timeout: 8000 }).catch(() => {});
  const orig2 = await page.$eval('.d-orig', (e) => e.textContent).catch(() => '(manca)');
  check(`titolo originale del film: ${orig2}`, orig2 === 'Shingeki no Kyojin Movie 1: Guren no Yumiya');
  check('mai il giapponese come titolo originale', !/[぀-ヿ一-鿿]/.test(orig2));

  // 6. One Piece (dati veri): niente «Il prossimo da vedere» nella tabella
  await page.goto(base + '#/t/tv/37854');
  await page.waitForSelector('.facts');
  const keys = await page.$$eval('.facts dt', (d) => d.map((x) => x.textContent.trim()));
  check(`tabella senza «Il prossimo da vedere» (${keys.join(', ')})`, !keys.includes('Il prossimo da vedere'));
  await page.screenshot({ path: path.join(OUT, 'cl4-onepiece.png') });

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
