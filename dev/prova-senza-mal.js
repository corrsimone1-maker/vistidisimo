// Prova con MyAnimeList spento, com'è nell'app dal 4/11/2026 (l'API pubblica di Jikan è stata chiusa il
// 1/10/2026): niente richieste a Jikan e niente attese, con TMDB finto:
// - Cerca «breaking» subito;
// - «shingeki no kyojin»: TMDB dà prima i film (li trova coi titoli alternativi), l'app guarda i titoli
//   alternativi e mette prima la serie;
// - errori di battitura: «shingeki no kiojin» e «l'attaco dei giganti» trovano la serie (nuova ricerca con le
//   parole più lunghe);
// - pagina di un anime: romaji dai titoli alternativi di TMDB, Collezione senza «Cerco…» infinito;
// - Home: nelle righe Serie e Film (e nelle loro pagine «Tutte») solo quello che hai guardato;
// - rivisioni: Madoka (vista 2 volte) ha la stagione «×2», il tasto della serie «×2» e la stagione finita
//   col rettangolo diverso.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

const AOT = { media_type: 'tv', id: 1429, name: "L'attacco dei giganti", original_name: '進撃の巨人', first_air_date: '2013-04-07', poster_path: '/p_tv_1429.jpg', genre_ids: [16, 10759], original_language: 'ja', origin_country: ['JP'], popularity: 150, vote_count: 7000 };
const FILMS = [
  { media_type: 'movie', id: 330081, title: "L'attacco dei giganti - Il film - Parte 2: Le ali della libertà", original_title: '劇場版「進撃の巨人」後編～自由の翼～', release_date: '2015-06-27', poster_path: '/p_movie_330081.jpg', genre_ids: [16], original_language: 'ja', popularity: 14, vote_count: 300 },
  { media_type: 'movie', id: 379088, title: "L'attacco dei giganti - Il film - Parte 1: L'arco e la freccia cremisi", original_title: '劇場版「進撃の巨人」前編〜紅蓮の弓矢〜', release_date: '2014-11-22', poster_path: '/p_movie_379088.jpg', genre_ids: [16], original_language: 'ja', popularity: 12, vote_count: 280 },
];
const ALT = {
  'tv:1429': [{ iso_3166_1: 'JP', title: 'Shingeki no Kyojin', type: 'Romaji' }, { iso_3166_1: 'US', title: 'Attack on Titan', type: '' }],
  'movie:330081': [{ iso_3166_1: 'JP', title: 'Shingeki no Kyojin Movie 2: Jiyuu no Tsubasa', type: '' }],
  'movie:379088': [{ iso_3166_1: 'JP', title: 'Shingeki no Kyojin Movie 1: Guren no Yumiya', type: '' }],
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8154', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8154/vistidisimo/';
  const M = makeMocks(path.join(DATA, 'library.json'), { animeKeys: new Set(['tv:1429', 'tv:39218', 'tv:31910']) });
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  const log = { jikan: 0, searches: [] };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://api.jikan.moe/**', (route) => { log.jikan++; return route.fulfill({ status: 504, body: '{}' }); });
  await ctx.route('https://query.wikidata.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/sparql-results+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ head: { vars: ['tv', 'mv'] }, results: { bindings: [] } }) }));
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    const q = (u.searchParams.get('query') || '').toLowerCase();
    let m;
    if (p === '/search/multi') {
      log.searches.push(q);
      if (u.searchParams.get('page') === '2') return ok(route, { results: [] });
      // TMDB trova i titoli anche coi nomi alternativi (che non restituisce): film prima della serie
      if (q === 'shingeki no kyojin' || q === 'shingeki') return ok(route, { results: [...FILMS, AOT] });
      if (q === 'giganti') return ok(route, { results: [AOT, FILMS[0]] });
      if (q === 'breaking') return ok(route, { results: [{ media_type: 'tv', id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20', genre_ids: [18], original_language: 'en', popularity: 400, vote_count: 15000, poster_path: '/p_tv_1396.jpg' }] });
      return ok(route, { results: [] });
    }
    if ((m = p.match(/^\/(tv|movie)\/(\d+)\/alternative_titles$/))) {
      const list = ALT[`${m[1]}:${m[2]}`] || [];
      return ok(route, m[1] === 'tv' ? { id: Number(m[2]), results: list } : { id: Number(m[2]), titles: list });
    }
    if ((m = p.match(/^\/tv\/(1429|39218)$/))) {
      const id = Number(m[1]);
      const extra = id === 1429 ? { name: "L'attacco dei giganti", original_name: '進撃の巨人' } : { name: 'Puella Magi Madoka Magica', original_name: '魔法少女まどか☆マギカ' };
      return M.tmdb({ request: () => route.request(), fulfill: (o) => { const b = JSON.parse(o.body); Object.assign(b, extra, { genres: [{ id: 16, name: 'Animazione' }], original_language: 'ja', origin_country: ['JP'] }); if ((u.searchParams.get('append_to_response') || '').includes('alternative_titles')) b.alternative_titles = { results: id === 1429 ? ALT['tv:1429'] : [{ iso_3166_1: 'JP', title: 'Mahou Shoujo Madoka★Magica', type: '' }] }; return route.fulfill({ ...o, body: JSON.stringify(b) }); } });
    }
    return M.tmdb(route);
  });
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const text = (sel) => page.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' ')).catch(() => null);
  const rows = () => page.$$eval('.sr', (els) => els.map((e) => [e.getAttribute('href'), e.querySelector('.sr-title').textContent, e.querySelector('.sr-orig')?.textContent || '']));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `sm-${n}.png`) });
  const search = async (q) => {
    await page.fill('[data-input=search-q]', '');
    await page.waitForTimeout(100);
    const t0 = Date.now();
    await page.fill('[data-input=search-q]', q);
    await page.waitForTimeout(450);
    await page.waitForFunction(() => !document.querySelector('#search-results')?.textContent.includes('Cerco'), null, { timeout: 10000 });
    return Date.now() - t0;
  };

  await page.goto(base + '#/home');
  await page.waitForSelector('#view .pc', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ---- Home: nelle righe Serie e Film solo quello che hai guardato (4/11/2026) ----
  const homeCheck = await page.evaluate(async () => {
    const s = await import('./js/store.js'); const D = await import('./js/derive.js');
    const keys = (sel) => [...document.querySelectorAll(`${sel} a.pc`)].map((a) => a.dataset.key);
    const rowS = keys('[data-scroll=h-serie]'); const rowF = keys('[data-scroll=h-film]');
    const bad = [...rowS, ...rowF].filter((k) => !D.hasWatched(s.item(k)));
    const planned = Object.entries(s.lib().items).filter(([, it]) => it.type === 'tv' && !D.hasWatched(it)).length;
    return { n: rowS.length + rowF.length, bad, planned };
  });
  check(`Home: ${homeCheck.n} locandine nelle righe Serie/Film, nessuna mai guardata (in libreria ${homeCheck.planned} serie mai iniziate)`, homeCheck.n > 0 && homeCheck.bad.length === 0 && homeCheck.planned > 0);
  await page.goto(base + '#/raccolta/serie');
  await page.waitForSelector('.grid .pc');
  const allBad = await page.evaluate(async () => { const s = await import('./js/store.js'); const D = await import('./js/derive.js'); return [...document.querySelectorAll('.grid a.pc')].filter((a) => !D.hasWatched(s.item(a.dataset.key))).length; });
  check('e così la pagina «Tutte» delle serie', allBad === 0);

  // ---- Cerca ----
  await page.goto(base + '#/cerca');
  await page.waitForSelector('[data-input=search-q]');
  const t1 = await search('breaking');
  check(`«breaking» in ${t1} ms (350 di attesa dopo l'ultimo tasto)`, t1 < 1500 && (await rows())[0]?.[1] === 'Breaking Bad');
  await search('shingeki no kyojin');
  let r = await rows();
  console.log('   ', r.map((x) => x.slice(1).join(' / ')).join(' | '));
  check('«shingeki no kyojin»: prima la serie (titoli alternativi di TMDB), col romaji sotto', r[0]?.[0] === '#/t/tv/1429' && r[0]?.[2] === 'Shingeki no Kyojin');
  await search('shingeki no kiojin');
  r = await rows();
  check(`«shingeki no kiojin» (sbagliato): ${r.map((x) => x[1]).join(' | ')}`, r[0]?.[0] === '#/t/tv/1429' && log.searches.includes('shingeki'));
  await shot('1-errore-romaji');
  await search("l'attaco dei giganti");
  r = await rows();
  check(`«l'attaco dei giganti» (sbagliato): ${r.map((x) => x[1]).join(' | ')}`, r[0]?.[0] === '#/t/tv/1429' && log.searches.includes('giganti'));
  await search('berlnio');
  check('una parola sola sbagliata e sconosciuta: «Nessun risultato», senza altre ricerche', (await text('.empty-title')) === 'Nessun risultato');

  // ---- pagina di un anime ----
  await page.goto(base + '#/t/tv/1429');
  await page.waitForSelector('.d-head h1');
  await page.waitForFunction(() => !!document.querySelector('.d-orig'), null, { timeout: 8000 }).catch(() => {});
  check(`romaji dai titoli alternativi di TMDB: ${await text('.d-orig')}`, (await text('.d-orig')) === 'Shingeki no Kyojin');
  await page.goto(base + '#/t/tv/31910');
  await page.waitForSelector('.facts');
  await page.waitForTimeout(2500);
  check('Naruto Shippuden: nessun «Cerco…» nella pagina', !(await page.$eval('#view', (e) => e.textContent)).includes('Cerco'));
  await page.goto(base + '#/collezione/tv/31910');
  await page.waitForTimeout(2500);
  const colText = await page.$eval('#view', (e) => e.textContent);
  check(`pagina Collezione senza attesa infinita né errori di MyAnimeList (${(await text('.empty-title')) || (await text('.person-count'))})`, !colText.includes('Cerco') && !colText.includes('MyAnimeList'));

  // ---- rivisioni di Madoka (vista 2 volte) ----
  await page.goto(base + '#/t/tv/39218');
  await page.waitForSelector('[data-act=d-season-all][data-s="1"]');
  await page.waitForTimeout(800);
  check(`stagione 1 «${await text('[data-act=d-season-all][data-s="1"]')}», serie «${await text('.rw-chip')}»`, (await text('[data-act=d-season-all][data-s="1"]')) === '×2' && (await text('.rw-chip')) === '×2');
  check('stagione finita col rettangolo diverso', await page.$eval('[data-act=d-season-all][data-s="1"]', (b) => b.closest('.season').classList.contains('done')));
  check(`romaji di Madoka: ${await text('.d-orig')}`, (await text('.d-orig')) === 'Mahou Shoujo Madoka★Magica');
  await page.$eval('.season', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('2-madoka');

  check(`nessuna richiesta a Jikan (${log.jikan})`, log.jikan === 0);
  check('niente esce dallo schermo', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(errors.length ? `\n${errors.length} problemi:\n` + errors.join('\n') : '\ntutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
