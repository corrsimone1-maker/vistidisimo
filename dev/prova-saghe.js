// Prova di saghe, film e OVA degli anime, «Mancano» e trailer, con i dati veri della libreria e TMDB/AniList finti:
// - saghe: campo `co` in meta.json (film riscaricati una volta), riga della saga nella pagina del film (come
//   «Film e OVA»), pagina della saga (ordine di uscita, visti su usciti, in uscita), elenco «Saghe» dal menu ≡
//   (prima quelle a metà);
// - anime: Naruto Shippuden → film, OVA e spin-off da AniList, senza allargarsi a Naruto e Boruto (altre serie
//   TMDB), collegati a TMDB quando c'è (stato dalla libreria), link ad AniList quando no, uno spin-off con due
//   voci AniList → una carta, una storia parallela che è la serie stessa → niente carta, seconda apertura dalla
//   cache, AniList che chiede di aspettare;
// - filler: «Filler: Sì» da MyAnimeList (Jikan finto) solo se ce ne sono, con il link alla lista degli episodi;
// - «Mancano N episodi · tempo» per una serie in corso; tasto Trailer (italiano, poi inglese) con il video in un foglio.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

// ---- TMDB finto: saghe, video, ricerca di film e serie anime ----
const COLL = {
  556: { name: 'Spider-Man - Collezione', parts: [[557, 'Spider-Man', '2002-05-01'], [558, 'Spider-Man 2', '2004-06-25'], [559, 'Spider-Man 3', '2007-05-01']] },
  531241: { name: 'Spider-Man (Avengers) - Collezione', parts: [[634649, 'Spider-Man: No Way Home', '2021-12-15'], [315635, 'Spider-Man: Homecoming', '2017-07-05'], [969681, 'Spider-Man: Brand New Day', '2026-07-29'], [429617, 'Spider-Man: Far From Home', '2019-07-02'], [990001, 'Spider-Man 5 finto', '2028-06-01']] },
  119: { name: 'Il Signore degli Anelli - Collezione', parts: [[120, 'La Compagnia dell’Anello', '2001-12-18'], [121, 'Le due torri', '2002-12-18'], [122, 'Il ritorno del re', '2003-12-17']] },
};
const COLL_OF = {};
for (const [cid, c] of Object.entries(COLL)) for (const [id] of c.parts) COLL_OF[id] = Number(cid);

// anime su TMDB (id, tipo, titolo italiano, originale, data)
const TM = [
  ['tv', 31910, 'Naruto Shippuden', 'NARUTO -ナルト- 疾風伝', '2007-02-15'],
  ['tv', 46260, 'Naruto', 'NARUTO -ナルト-', '2002-10-03'],
  ['tv', 70881, 'Boruto: Naruto Next Generations', 'BORUTO-ボルト- NARUTO NEXT GENERATIONS', '2017-04-05'],
  ['movie', 880001, 'Naruto Shippuden: Il film', '劇場版 NARUTO-ナルト- 疾風伝', '2007-08-04'],
  ['movie', 880002, 'Naruto Shippuden: I guardiani del Regno della Luna Crescente', '劇場版 NARUTO -ナルト- 疾風伝 絆', '2008-08-02'],
  ['movie', 880003, 'Naruto Shippuden: Eredi della volontà del fuoco', '劇場版 NARUTO-ナルト- 疾風伝 火の意志を継ぐ者', '2009-08-01'],
  ['movie', 880007, 'The Last: Naruto the Movie', 'THE LAST -NARUTO THE MOVIE-', '2014-12-06'],
  ['movie', 880008, 'Boruto: Naruto the Movie', 'BORUTO -NARUTO THE MOVIE-', '2015-08-07'],
  ['movie', 880009, 'Naruto: Il film', '劇場版 NARUTO 大活劇! 雪姫忍法帖だってばよ!!', '2004-08-21'],
  ['movie', 880010, 'Un film qualunque', 'NARUTO ナルト', '2007-08-04', [18]], // non animazione: da scartare
  ['tv', 880020, 'Naruto SD: Rock Lee', 'NARUTO SD ロック・リーの青春フルパワー忍伝', '2012-04-03'], // spin-off
];

// AniList finto: id → { format, y, native, english, romaji, rel: [[tipo, id]] }
const AL = {
  1735: { format: 'TV', y: 2007, native: 'NARUTO -ナルト- 疾風伝', english: 'Naruto Shippuden', romaji: 'Naruto: Shippuuden', mal: 1735, rel: [['PREQUEL', 20], ['SEQUEL', 97938], ['SIDE_STORY', 1736], ['SPIN_OFF', 12980], ['SIDE_STORY', 2472], ['SIDE_STORY', 4437], ['SIDE_STORY', 6325], ['SIDE_STORY', 13667], ['SIDE_STORY', 7001], ['SPIN_OFF', 12979], ['CHARACTER', 21], ['OTHER', 999], ['SUMMARY', 7002], ['ADAPTATION', 5000]] },
  // una seconda parte che AniList tiene a sé ma su TMDB è la stessa serie: si allarga e non si mostra
  1736: { format: 'TV', y: 2010, native: 'NARUTO -ナルト- 疾風伝', english: 'Naruto Shippuden', romaji: 'Naruto: Shippuuden 2', mal: 1736, rel: [['PREQUEL', 1735]] },
  20: { format: 'TV', y: 2002, native: 'NARUTO -ナルト-', english: 'Naruto', romaji: 'Naruto', mal: 20, rel: [['SEQUEL', 1735], ['SIDE_STORY', 442]] },
  97938: { format: 'TV', y: 2017, native: 'BORUTO-ボルト- NARUTO NEXT GENERATIONS', english: 'Boruto: Naruto Next Generations', romaji: 'Boruto: Naruto Next Generations', rel: [['PREQUEL', 1735], ['SIDE_STORY', 8888]] },
  2472: { format: 'MOVIE', y: 2007, native: '劇場版 NARUTO -ナルト- 疾風伝', english: 'Naruto Shippuden the Movie', romaji: 'Naruto: Shippuuden Movie 1', rel: [['PARENT', 1735], ['SEQUEL', 4437]] },
  4437: { format: 'MOVIE', y: 2008, native: '劇場版 NARUTO -ナルト- 疾風伝 絆', english: 'Naruto Shippuden the Movie: Bonds', romaji: 'Naruto: Shippuuden Movie 2 - Kizuna', rel: [['PARENT', 1735], ['PREQUEL', 2472], ['SEQUEL', 6325]] },
  6325: { format: 'MOVIE', y: 2009, native: '劇場版 NARUTO -ナルト- 疾風伝 火の意志を継ぐ者', english: 'Naruto Shippuden the Movie: The Will of Fire', romaji: 'Naruto: Shippuuden Movie 3', rel: [['PARENT', 1735], ['PREQUEL', 4437]] },
  13667: { format: 'MOVIE', y: 2014, native: 'THE LAST -NARUTO THE MOVIE-', english: 'The Last: Naruto the Movie', romaji: 'The Last: Naruto the Movie', rel: [['PARENT', 1735], ['SEQUEL', 21220]] },
  21220: { format: 'MOVIE', y: 2015, native: 'BORUTO -NARUTO THE MOVIE-', english: 'Boruto: Naruto the Movie', romaji: 'Boruto: Naruto the Movie', rel: [['PREQUEL', 13667], ['SIDE_STORY', 7003]] },
  7001: { format: 'OVA', y: 2010, native: 'NARUTO 疾風伝 OVA', english: null, romaji: 'Naruto: Shippuuden - Sunny Side Battle', rel: [['PARENT', 1735]] },
  7002: { format: 'SPECIAL', y: 2009, native: 'NARUTO 疾風伝 総集編', english: null, romaji: 'Naruto Shippuuden: Recap', rel: [] },
  7003: { format: 'ONA', y: 2016, native: 'BORUTO ミニ', english: null, romaji: 'Boruto Mini', rel: [] },
  12979: { format: 'TV', y: 2012, native: 'NARUTO SD ロック・リーの青春フルパワー忍伝', english: 'Naruto Spin-Off: Rock Lee', romaji: 'Naruto SD', rel: [] },
  12980: { format: 'TV', y: 2013, native: 'NARUTO SD ロック・リーの青春フルパワー忍伝 2', english: 'Naruto Spin-Off: Rock Lee 2', romaji: 'Naruto SD 2', rel: [] },
  442: { format: 'MOVIE', y: 2004, native: '劇場版 NARUTO 大活劇! 雪姫忍法帖だってばよ!!', english: 'Naruto the Movie: Ninja Clash', romaji: 'Naruto Movie 1', rel: [] },
  8888: { format: 'MOVIE', y: 2023, native: 'BORUTO 劇場版', english: 'Boruto Movie', romaji: 'Boruto Movie', rel: [] },
  21: { format: 'TV', y: 1999, native: 'ONE PIECE', english: 'One Piece', romaji: 'One Piece', rel: [] },
  999: { format: 'MUSIC', y: 2010, native: 'MV', english: 'MV', romaji: 'MV', rel: [] },
};
const alMedia = (id, withRel) => {
  const a = AL[id];
  const m = { id: Number(id), idMal: a.mal ? 100000 + a.mal : null, type: 'ANIME', format: a.format, isAdult: false, startDate: { year: a.y, month: 8, day: 1 }, title: { romaji: a.romaji, english: a.english, native: a.native }, coverImage: { large: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/c_${id}.jpg` }, siteUrl: `https://anilist.co/anime/${id}` };
  if (withRel) m.relations = { edges: a.rel.filter(([, t]) => AL[t] || t === 5000).map(([r, t]) => ({ relationType: r, node: t === 5000 ? { id: 5000, type: 'MANGA', format: 'MANGA', isAdult: false } : { id: t, type: 'ANIME', format: AL[t].format, isAdult: false } })) };
  return m;
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8144', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8144/vistidisimo/';

  const M = makeMocks(path.join(DATA, 'library.json'), { animeKeys: new Set(['tv:31910', 'tv:73223', 'tv:46260', 'tv:70881']) });
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  // un film di Naruto in libreria (visto), per vedere lo stato nella riga «Film e OVA»
  { const d = JSON.parse(M.files['library.json']); d.items['movie:880003'] = { type: 'movie', id: 880003, title: 'Naruto Shippuden: Eredi della volontà del fuoco', year: 2009, status: 'completed', rating: null, added: '2020-01-01T10:00:00Z', last: '2020-01-02T10:00:00Z', fav: null, rewatch: 0, seen: '2020-01-02' }; M.files['library.json'] = JSON.stringify(d); }
  const log = { al: 0, alBody: [], videos: [], search: 0, jikan: [] };
  let alMode = 'ok';

  const tmdbExtra = async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    const lang = u.searchParams.get('language');
    const ok = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    let m;
    if ((m = p.match(/^\/collection\/(\d+)$/))) {
      const c = COLL[m[1]];
      if (!c) return route.fulfill({ status: 404, body: '{}' });
      return ok({ id: Number(m[1]), name: c.name, poster_path: `/p_coll_${m[1]}.jpg`, backdrop_path: `/b_coll_${m[1]}.jpg`, parts: c.parts.map(([id, t, d]) => ({ id, title: t, original_title: t, release_date: d, poster_path: `/p_movie_${id}.jpg`, genre_ids: [28], original_language: 'en' })) });
    }
    if ((m = p.match(/^\/(movie|tv)\/(\d+)\/videos$/))) {
      log.videos.push(`${m[1]}:${m[2]}:${lang}`);
      const id = Number(m[2]);
      const v = (key, type, official, d, iso = 'en') => ({ key, site: 'YouTube', type, official, published_at: d, name: `${type} ${key}`, iso_639_1: iso });
      let results = [];
      if (id === 557 && lang === 'en-US') results = [v('teaser557', 'Teaser', true, '2002-01-01'), v('trailer557', 'Trailer', true, '2001-06-01'), v('clip', 'Clip', true, '2002-02-01'), { ...v('vimeo', 'Trailer', true, '2003-01-01'), site: 'Vimeo' }];
      if (id === 31910 && lang === 'it-IT') results = [v('vecchio', 'Trailer', true, '2007-01-01', 'it'), v('nuovo', 'Trailer', true, '2009-01-01', 'it'), v('fan', 'Trailer', false, '2012-01-01', 'it')];
      return ok({ id, results });
    }
    if ((m = p.match(/^\/search\/(movie|tv)$/))) {
      log.search++;
      const q = (u.searchParams.get('query') || '').toLowerCase();
      const words = q.split(/[^a-zぁ-んァ-ン一-龯]+/).filter((w) => w.length >= 3);
      const res = TM.filter(([t]) => t === m[1]).filter(([, , ti, ot]) => words.some((w) => (ti + ' ' + ot).toLowerCase().includes(w)))
        .map(([t, id, ti, ot, d, g]) => (t === 'movie' ? { id, title: ti, original_title: ot, release_date: d, poster_path: `/p_movie_${id}.jpg`, genre_ids: g || [16, 28], original_language: 'ja' } : { id, name: ti, original_name: ot, first_air_date: d, poster_path: `/p_tv_${id}.jpg`, genre_ids: g || [16, 10759], original_language: 'ja' }));
      return ok({ results: res });
    }
    if ((m = p.match(/^\/movie\/(\d+)$/)) && COLL_OF[m[1]]) {
      // dettagli veri del mock più la saga
      const fake = { request: () => route.request(), fulfill: async (o) => { const b = JSON.parse(o.body); b.belongs_to_collection = { id: COLL_OF[m[1]], name: COLL[COLL_OF[m[1]]].name, poster_path: null }; return route.fulfill({ ...o, body: JSON.stringify(b) }); } };
      return M.tmdb(fake);
    }
    return M.tmdb(route);
  };
  // Jikan (MyAnimeList): Naruto Shippuden ha un filler a pagina 2, la seconda parte e Naruto nessuno
  const jikan = async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/^\/v4\/anime\/(\d+)\/episodes$/);
    const n = Number(u.searchParams.get('page') || 1);
    log.jikan.push(`${m && m[1]}:${n}`);
    const mal = Number(m && m[1]);
    const pages = mal === 101735 ? 3 : 1;
    const data = Array.from({ length: n <= pages ? 100 : 0 }, (_, i) => {
      const ep = (n - 1) * 100 + i + 1;
      return { mal_id: ep, url: `https://myanimelist.net/anime/${mal}/Nome_Finto/episode/${ep}`, title: `Ep ${ep}`, filler: mal === 101735 && ep === 157, recap: false };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ pagination: { last_visible_page: pages, has_next_page: n < pages }, data }) });
  };
  const anilist = async (route) => {
    log.al++;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,accept', 'access-control-allow-methods': 'POST' } });
    if (alMode === '429') return route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"errors":[{"message":"Too Many Requests."}]}' });
    const body = JSON.parse(route.request().postData());
    log.alBody.push(body.variables);
    let media = [];
    if (body.variables.q != null) {
      const q = body.variables.q.toLowerCase();
      media = Object.keys(AL).filter((id) => AL[id].format === 'TV' && [AL[id].native, AL[id].english, AL[id].romaji].some((t) => t && (t.toLowerCase().includes(q) || q.includes(t.toLowerCase().slice(0, 6))))).map((id) => alMedia(id, false));
    } else {
      media = body.variables.ids.filter((id) => AL[id]).map((id) => alMedia(id, true));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { media } } }) });
  };

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', tmdbExtra);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://graphql.anilist.co/**', anilist);
  await ctx.route('https://api.jikan.moe/**', jikan);
  await ctx.route('https://s4.anilist.co/**', (route) => M.image({ request: () => ({ url: () => 'https://x/p_' + route.request().url().split('/').pop() }), fulfill: (o) => route.fulfill(o) }));
  await ctx.route(/youtube(-nocookie)?\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<body style="background:#111;color:#eee;font:16px sans-serif;display:grid;place-items:center;height:100vh;margin:0">▶ video</body>' }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = async (name, full = false) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); };
  const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '(manca)');
  const texts = (sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const fact = (k) => page.$$eval('.facts div', (ds, k2) => { const d = ds.find((x) => x.querySelector('dt')?.textContent.trim() === k2); return d ? d.querySelector('dd').textContent.replace(/\s+/g, ' ').trim() : null; }, k);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const metaSaved = () => JSON.parse(M.files['meta.json']).items;

  // 1. all'avvio i film senza `co` si riscaricano una volta e meta.json salva la saga
  await page.goto(base + '#/home');
  await page.waitForSelector('#view .pc');
  // tutti i film della libreria e delle liste (in meta.json possono restare titoli tolti: quelli non contano)
  await page.waitForFunction(async () => { const s = await import('./js/store.js'); return !s.S.metaJob && s.allKeys().filter((k) => k.startsWith('movie:')).every((k) => s.S.meta.items[k]?.co !== undefined); }, null, { timeout: 60000, polling: 500 });
  await page.waitForTimeout(9000); // salvataggio di meta.json
  const ms = metaSaved();
  check(`meta.json su GitHub con la saga (557: ${JSON.stringify(ms['movie:557']?.co)}, 27205: ${JSON.stringify(ms['movie:27205']?.co)})`, JSON.stringify(ms['movie:557']?.co) === JSON.stringify([556, 'Spider-Man - Collezione']) && ms['movie:27205']?.co === 0);

  // 2. pagina del film: riga della saga (come «Film e OVA») e trailer in inglese (in italiano non c'è)
  await page.goto(base + '#/t/movie/557');
  await page.waitForSelector('.facts');
  await page.waitForSelector('.d-saga .pc', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.trailer-btn', { timeout: 5000 }).catch(() => {});
  check('niente più il dato «Saga» nella tabella', (await fact('Saga')) == null);
  check(`riga della saga: ${await text('.d-saga .row-head')}`, (await text('.d-saga .sg-name')) === 'Spider-Man' && (await text('.d-saga .fr-count')) === '3/3' && (await text('.d-saga .row-all')) === 'Tutti 3');
  check(`film della saga in ordine: ${(await texts('.d-saga .pc-title')).join(' → ')}`, (await texts('.d-saga .pc-title')).join('|') === 'Spider-Man|Spider-Man 2|Spider-Man 3');
  check('la riga scorre in orizzontale', await page.$eval('.d-saga .scroller', (e) => getComputedStyle(e).overflowX === 'auto' || getComputedStyle(e).overflowX === 'scroll'));
  check('niente esce dallo schermo', await noOverflow());
  check('tasto Trailer', (await page.$('.trailer-btn')) != null);
  check(`video chiesti in italiano e poi in inglese (${log.videos.filter((x) => x.startsWith('movie:557')).join(', ')})`, log.videos.filter((x) => x.startsWith('movie:557')).join(',') === 'movie:557:it-IT,movie:557:en-US');
  await page.$eval('.d-saga', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('sg01-film');
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('.trailer-btn');
  await page.waitForSelector('.tr-frame iframe');
  const src = await page.$eval('.tr-frame iframe', (f) => f.src);
  check(`trailer ufficiale, non teaser né clip (${src})`, /youtube-nocookie\.com\/embed\/trailer557\?/.test(src));
  check('«Apri su YouTube» fuori dall’app', await page.$eval('.tr-sheet a.btn', (a) => a.target === '_blank' && a.href === 'https://www.youtube.com/watch?v=trailer557'));
  await shot('sg02-trailer');
  await page.click('.tr-sheet [data-close]');
  await page.waitForSelector('.sheet-wrap', { state: 'detached' });

  // 3. pagina della saga: ordine di uscita, visti su usciti, quello in uscita in fondo
  await page.click('.d-saga .row-all');
  await page.waitForSelector('.person-grid .pc');
  check(`titolo: ${await text('.page-top h1')}`, (await text('.page-top h1')) === 'Spider-Man');
  check(`conteggio: ${await text('.person-count')}`, (await text('.person-count')) === '3 visti su 3');
  await page.goto(base + '#/saga/531241');
  await page.waitForSelector('.person-grid .pc');
  const order = await texts('.person-grid .pc-title');
  check(`saga in ordine di uscita: ${order.join(' → ')}`, order.join('|') === 'Spider-Man: Homecoming|Spider-Man: Far From Home|Spider-Man: No Way Home|Spider-Man: Brand New Day|Spider-Man 5 finto');
  check(`conteggio con un film in uscita: ${await text('.person-count')}`, (await text('.person-count')) === '3 visti su 4 · 1 in uscita');
  // la stessa saga nella pagina di un suo film: visti su usciti, «Tutti» con tutti i film; nome lungo tagliato
  await page.goto(base + '#/t/movie/315635');
  await page.waitForSelector('.d-saga .pc', { timeout: 8000 });
  check(`riga della saga lunga: ${await text('.d-saga .row-head')}`, (await text('.d-saga .fr-count')) === '3/4' && (await text('.d-saga .row-all')) === 'Tutti 5');
  check('nome della saga su una riga sola', await page.$eval('.d-saga .sg-name', (e) => e.scrollHeight <= e.clientHeight + 2));
  check('niente esce dallo schermo', await noOverflow());
  await page.goto(base + '#/saga/531241');
  await page.waitForSelector('.person-grid .pc');
  check(`anni: ${(await texts('.person-grid .pc-year')).join(', ')}`, (await texts('.person-grid .pc-year')).join(',') === '2017,2019,2021,2026,in uscita 2028');
  check('stato per i film in libreria', (await page.$$('.person-grid .pc .tube')).length === 3);
  check('niente esce dallo schermo', await noOverflow());
  await shot('sg03-saga');

  // 4. elenco delle saghe dal menu ≡ della Libreria: prima quelle a metà
  await page.goto(base + '#/libreria');
  await page.waitForSelector('[data-act=lib-menu]');
  await page.click('[data-act=lib-menu]');
  await page.waitForSelector('.pz [data-m=saghe]');
  await shot('sg04-menu');
  await page.click('.pz [data-m=saghe]');
  await page.waitForSelector('.list-grid .lc');
  await page.waitForTimeout(800);
  check('scheda Libreria accesa', await page.$eval('#tabs a[data-tab=libreria]', (a) => a.classList.contains('on')));
  const sagas = await texts('.list-grid .lc');
  console.log('    saghe:', sagas.join(' | '));
  // con meta.json vero le saghe sono tante: TMDB finto conosce solo le tre di COLL, le altre restano «N in libreria»
  const nSaghe = await page.evaluate(async () => { const s = await import("./js/store.js"); return new Set(Object.keys(s.lib().items).filter((k) => k.startsWith('movie:')).map((k) => s.metaOf(k)?.co?.[0]).filter(Boolean)).size; });
  check(`saghe dei film in libreria (${sagas.length} su ${nSaghe})`, sagas.length === nSaghe && ['Spider-Man (Avengers)', 'Il Signore degli Anelli', 'Spider-Man'].every((n) => sagas.some((x) => x.startsWith(n + ' '))));
  check('prima quella a metà', sagas[0].startsWith('Spider-Man (Avengers)') && sagas[0].includes('3 di 4') && sagas[0].includes('75%'));
  check('le finite dopo', sagas.slice(1).filter((x) => x.includes('%')).every((x) => x.includes('100%')) && sagas.filter((x) => x.includes('100%')).length === 2);
  check('niente esce dallo schermo', await noOverflow());
  await shot('sg05-saghe');

  // 5. anime: Naruto Shippuden → film e OVA da AniList
  log.al = 0;
  await page.goto(base + '#/t/tv/31910');
  await page.waitForSelector('.d-fr .pc', { timeout: 20000 });
  const row = await texts('.d-fr .pc-title');
  console.log('    film e OVA:', row.join(' | '));
  const labels = await texts('.d-fr .pc-year');
  check(`in ordine di uscita: ${labels.join(', ')}`, labels.join(',') === 'Film · 2007,Film · 2008,Film · 2009,Speciale · 2009,OVA · 2010,Spin-off · 2012,Film · 2014,Film · 2015,ONA · 2016');
  check('niente film di Naruto (altra serie) né del seguito Boruto', !row.some((t) => /Ninja Clash|Boruto Movie|Il film$/.test(t) && !/Shippuden/.test(t)) && !row.includes('Naruto: Il film'));
  check('niente musica, personaggi né la seconda parte (che è la serie stessa)', !row.some((t) => /One Piece|MV|Shippuuden 2/.test(t)) && !row.includes('Naruto Shippuden'));
  check('spin-off (serie TV) con una carta sola anche se AniList ne ha due voci', row.filter((t) => /Rock Lee/.test(t)).length === 1);
  check(`titolo italiano di TMDB quando c'è: ${row[0]}`, row[0] === 'Naruto Shippuden: Il film');
  check(`conteggio: ${await text('.d-fr .fr-count')}`, (await text('.d-fr .fr-count')) === '1/9');
  check('il film in libreria mostra lo stato', (await page.$$('.d-fr .pc .tube')).length === 1);
  const hrefs = await page.$$eval('.d-fr .pc', (as) => as.map((a) => [a.getAttribute('href'), a.target]));
  check('film su TMDB aperti nell’app', hrefs[0][0] === '#/t/movie/880001' && !hrefs[0][1]);
  check('spin-off collegato alla serie TMDB', hrefs.some(([h, t]) => h === '#/t/tv/880020' && !t));
  check('OVA che TMDB non ha → AniList, fuori dall’app', hrefs.some(([h, t]) => h === 'https://anilist.co/anime/7001' && t === '_blank'));
  check('niente film sbagliato (non animazione)', !hrefs.some(([h]) => h === '#/t/movie/880010'));
  check(`AniList: ${log.al} richieste (≤ 8)`, log.al <= 8);
  const asked = log.alBody.flatMap((v) => v.ids || []);
  check('Naruto e Boruto non si allargano', !asked.includes(442) && !asked.includes(8888));
  check('niente esce dallo schermo', await noOverflow());
  // filler da MyAnimeList: la serie e la sua seconda parte, ci si ferma al primo filler (pagina 2)
  await page.waitForFunction(() => [...document.querySelectorAll('.facts dt')].some((d) => d.textContent.trim() === 'Filler'), null, { timeout: 10000 }).catch(() => {});
  check(`«Filler: ${await fact('Filler')}»`, (await fact('Filler')) === 'Sì');
  check(`Jikan sfogliato fino al primo filler (${log.jikan.join(', ')})`, log.jikan.join(',') === '101735:1,101735:2');
  check('il «Sì» apre la lista degli episodi di MyAnimeList fuori dall’app', await page.$$eval('.facts dd a', (as) => as.some((a) => a.href === 'https://myanimelist.net/anime/101735/Nome_Finto/episode' && a.target === '_blank')));
  await page.$eval('.facts', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('sg06b-filler');
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('sg06-anime-riga');
  await page.click('.d-fr .row-all');
  await page.waitForSelector('.person-grid .pc');
  check(`pagina «Tutti»: ${await text('.page-top h1')} · ${await text('.person-count')}`, (await text('.person-count')) === '1 visto su 9');
  await shot('sg07-anime-tutti');

  // 6. riaprendo: dalla cache, niente AniList
  log.al = 0;
  await page.reload();
  await page.waitForSelector('.person-grid .pc');
  await page.goto(base + '#/t/tv/31910');
  await page.waitForSelector('.d-fr .pc');
  check(`seconda apertura senza AniList (${log.al} richieste)`, log.al === 0);
  log.jikan = [];
  await page.waitForTimeout(800);
  check(`seconda apertura senza Jikan (${log.jikan.length} richieste) e «Filler» ancora lì`, log.jikan.length === 0 && (await fact('Filler')) === 'Sì');

  // 7. trailer della serie: italiano, il più recente ufficiale
  await page.waitForSelector('.trailer-btn');
  await page.click('.trailer-btn');
  await page.waitForSelector('.tr-frame iframe');
  check('trailer della serie: italiano ufficiale più recente', /embed\/nuovo\?/.test(await page.$eval('.tr-frame iframe', (f) => f.src)));
  await page.click('.tr-sheet [data-close]');

  // 8. «Mancano» per una serie in corso (Black Clover): episodi e tempo
  await page.goto(base + '#/t/tv/73223');
  await page.waitForSelector('.facts');
  await page.waitForTimeout(600);
  const want = await page.evaluate(async () => {
    const D = await import('./js/derive.js'); const s = await import('./js/store.js');
    return D.unwatchedAired(s.item('tv:73223'), s.metaOf('tv:73223')).length;
  });
  const left = await fact('Mancano');
  check(`«Mancano»: ${left} (episodi attesi ${want})`, want > 0 && new RegExp(`^${want} episod(i|io) · (\\d+ h( \\d+ min)?|\\d+ min)$`).test(left || ''));
  await page.$eval('.facts', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('sg08-mancano');
  // una serie completata non lo mostra
  await page.goto(base + '#/t/tv/46260');
  await page.waitForSelector('.facts');
  check('serie completata: niente «Mancano»', (await fact('Mancano')) == null);
  await page.waitForSelector('.d-fr .pc', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('vds.filler') || '{}')['tv:46260']; } catch { return false; } }, null, { timeout: 10000 }).catch(() => {});
  check(`Naruto senza filler su MyAnimeList: nessun dato (${log.jikan.join(', ')})`, (await fact('Filler')) == null && log.jikan.includes('100020:1'));

  // 9. AniList che chiede di aspettare: la riga non c'è, la pagina «Tutti» lo dice
  alMode = '429';
  await page.evaluate(() => { localStorage.removeItem('vds.al.fr'); });
  await page.goto(base + '#/t/tv/73223');
  await page.reload();
  await page.waitForSelector('.facts');
  await page.waitForTimeout(1500);
  check('AniList occupato: nessuna riga e nessun errore in pagina', (await page.$('.d-fr')) == null);
  await page.goto(base + '#/extra/73223');
  await page.waitForTimeout(800);
  check(`pagina «Tutti» con AniList occupato: ${await text('.empty-title')}`, (await text('.empty-title')) === 'AniList chiede di aspettare un minuto');

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
