// Prova della «Collezione» (3/11/2026) e dell'ordine dei risultati in Cerca, con i dati veri della libreria e
// TMDB/Wikidata finti:
// - Wikidata: La casa di carta → Berlino (spin-off) e La casa di carta: Corea (non in libreria), in tutte e due
//   le direzioni (il Wikidata finto risponde come la query SPARQL, provata a parte con dev/prova-wikidata.py);
// - stesso nome prima del separatore: Vis a vis → Vis a vis: El oasis, ma non un film francese «Vis-à-vis»;
// - collegamenti a mano dal menu ⋯ (Berlino ↔ Berlino e la dama con l'ermellino), visti dai due lati, tolti
//   dall'altro lato; collegamento automatico nascosto (sparisce dai due lati) e rimesso da «Nascosti»;
// - pagina «Tutti» (#/collezione/…), «Modifica» solo per i titoli in libreria, vecchio #/extra/;
// - Cerca «berlino»: prima i titoli conosciuti (come nelle altre app), il film sconosciuto «Berlino» più giù.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

// Wikidata finto: chiave → chiavi collegate
const WD = {
  'tv:71446': ['tv:146176', 'tv:113036'],
  'tv:146176': ['tv:71446', 'tv:113036'],
  'tv:113036': ['tv:71446', 'tv:146176'],
};
// risultati di /search/multi come li darebbe TMDB per «berlino» (prima quelli che corrispondono di più)
const R = (t, id, title, d, pop, votes, poster = true, lang = 'it') => ({ media_type: t, id, [t === 'tv' ? 'name' : 'title']: title, [t === 'tv' ? 'original_name' : 'original_title']: title, [t === 'tv' ? 'first_air_date' : 'release_date']: d, popularity: pop, vote_count: votes, poster_path: poster ? `/p_${t}_${id}.jpg` : null, genre_ids: [18], original_language: lang });
const BERLINO = [
  R('movie', 700001, 'Berlino', '1999-01-01', 0.6, 1, false, 'de'),
  R('movie', 700002, "Berlino '39", '1994-01-01', 1.1, 3),
  R('movie', 700003, 'Berlinoises', '2019-01-01', 0.5, 2, true, 'fr'),
  R('movie', 700004, 'Berlinoskop', '2008-01-01', 0.4, 0, true, 'de'),
  R('movie', 700005, "Berlino estate '42", '2024-01-01', 8, 60, true, 'de'),
  R('movie', 700006, 'Berlino: codice rosso', '2016-01-01', 5, 100, true, 'en'),
  R('movie', 2144, 'Il cielo sopra Berlino', '1987-10-29', 12, 1800, true, 'de'),
  { ...R('tv', 308014, "Berlino e la Dama con l'ermellino", '2026-05-15', 180, 250, true, 'es'), original_name: 'Berlín y la dama del armiño' },
  { ...R('tv', 146176, 'Berlino e i gioielli di Parigi', '2023-12-29', 60, 300, true, 'es'), original_name: 'Berlín' },
];
const VIS = [
  { ...R('tv', 62455, 'Vis a vis - Il prezzo del riscatto', '2015-04-20', 40, 900, true, 'es'), original_name: 'Vis a vis' },
  { ...R('tv', 97951, "Vis a vis: L'oasi", '2020-04-20', 20, 120, true, 'es'), original_name: 'Vis a vis: El oasis' },
  { ...R('movie', 700010, 'Vis-à-vis', '2012-01-01', 3, 40, true, 'fr') },
];
// Madoka: la serie trova il film «Parte 3» per il nome; il film porta la saga (Parte 1, 2, 3, Walpurgis)
const MADOKA = [
  { ...R('tv', 39218, 'Puella Magi Madoka Magica', '2011-01-07', 80, 1500, true, 'ja'), original_name: '魔法少女まどか☆マギカ', genre_ids: [16, 18], origin_country: ['JP'] },
  { ...R('movie', 212162, 'Puella Magi Madoka Magica: Parte 3 - La storia della ribellione', '2013-10-26', 20, 400, true, 'ja'), original_title: '劇場版 魔法少女まどか☆マギカ[新編]叛逆の物語', genre_ids: [16, 18] },
  // lo spin-off: su TMDB e Wikidata non è collegato, lo trova il titolo di Madoka dentro il suo
  { ...R('tv', 94523, 'Magia Record: Puella Magi Madoka Magica Side Story', '2020-01-05', 30, 300, true, 'ja'), original_name: 'マギアレコード 魔法少女まどか☆マギカ外伝', genre_ids: [16, 18], origin_country: ['JP'] },
  // e uno che non c'entra (stesse parole ma non dopo un separatore)
  { ...R('tv', 700020, 'Puella Magi Madoka Magica Fan Club', '2015-01-01', 1, 20, true, 'ja'), genre_ids: [16] },
];
const MADOKA_SAGA = { id: 212166, name: 'Puella Magi Madoka Magica - Collezione', parts: [
  { id: 212164, title: 'Puella Magi Madoka Magica: Parte 1 - Inizio', release_date: '2012-10-06', poster_path: '/p_movie_212164.jpg', genre_ids: [16], original_language: 'ja' },
  { id: 212165, title: 'Puella Magi Madoka Magica: Parte 2 - Storia infinita', release_date: '2012-10-13', poster_path: '/p_movie_212165.jpg', genre_ids: [16], original_language: 'ja' },
  { id: 212162, title: 'Puella Magi Madoka Magica: Parte 3 - La storia della ribellione', release_date: '2013-10-26', poster_path: '/p_movie_212162.jpg', genre_ids: [16], original_language: 'ja' },
  { id: 822653, title: 'Puella Magi Madoka Magica the Movie - Il risveglio di Walpurgis', release_date: '2026-08-28', poster_path: '/p_movie_822653.jpg', genre_ids: [16], original_language: 'ja' },
] };
const DETAILS = {
  'tv:39218': { name: 'Puella Magi Madoka Magica', original_name: '魔法少女まどか☆マギカ', first_air_date: '2011-01-07', original_language: 'ja', origin_country: ['JP'], genres: [{ id: 16, name: 'Animazione' }, { id: 18, name: 'Dramma' }] },
  'movie:212162': { title: 'Puella Magi Madoka Magica: Parte 3 - La storia della ribellione', original_title: '劇場版 魔法少女まどか☆マギカ[新編]叛逆の物語', release_date: '2013-10-26', original_language: 'ja', origin_country: ['JP'], genres: [{ id: 16, name: 'Animazione' }, { id: 18, name: 'Dramma' }], belongs_to_collection: { id: 212166, name: 'Puella Magi Madoka Magica - Collezione' } },
  'tv:113036': { name: 'La casa di carta: Corea', original_name: '종이의 집: 공동경제구역', first_air_date: '2022-06-24', original_language: 'ko', origin_country: ['KR'] },
  'tv:71446': { name: 'La casa di carta', original_name: 'La casa de papel', first_air_date: '2017-05-02', original_language: 'es', origin_country: ['ES'] },
  'tv:146176': { name: 'Berlino e i gioielli di Parigi', original_name: 'Berlín', first_air_date: '2023-12-29', original_language: 'es', origin_country: ['ES'] },
  'tv:308014': { name: "Berlino e la Dama con l'ermellino", original_name: 'Berlín y la dama del armiño', first_air_date: '2026-05-15', original_language: 'es', origin_country: ['ES'] },
  'tv:62455': { name: 'Vis a vis - Il prezzo del riscatto', original_name: 'Vis a vis', first_air_date: '2015-04-20', original_language: 'es', origin_country: ['ES'] },
  'tv:97951': { name: "Vis a vis: L'oasi", original_name: 'Vis a vis: El oasis', first_air_date: '2020-04-20', original_language: 'es', origin_country: ['ES'] },
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8153', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8153/vistidisimo/';
  const M = makeMocks(path.join(DATA, 'library.json'), {});
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  const log = { wd: [], wdHeaders: [] };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://api.jikan.moe/**', (route) => ok(route, { pagination: { has_next_page: false }, data: [] }));
  await ctx.route('https://query.wikidata.org/**', (route) => {
    const u = new URL(route.request().url());
    const q = u.searchParams.get('query') || '';
    log.wd.push(q);
    log.wdHeaders.push(route.request().headers());
    const m = q.match(/wdt:(P4947|P4983) "(\d+)" \./);
    const key = m ? `${m[1] === 'P4947' ? 'movie' : 'tv'}:${m[2]}` : '';
    const bindings = (WD[key] || []).map((k) => { const [t, id] = k.split(':'); return t === 'tv' ? { tv: { type: 'literal', value: id } } : { mv: { type: 'literal', value: id } }; });
    return route.fulfill({ status: 200, contentType: 'application/sparql-results+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ head: { vars: ['tv', 'mv'] }, results: { bindings } }) });
  });
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    const q = (u.searchParams.get('query') || '').toLowerCase();
    if (p === '/search/multi') {
      if (u.searchParams.get('page') === '2') return ok(route, { results: [] });
      if (q === 'berlino' || q === 'berlín' || q === 'berlin') return ok(route, { results: BERLINO });
      if (q.startsWith('vis a vis')) return ok(route, { results: VIS });
      if (q === 'puella magi madoka magica') return ok(route, { results: MADOKA });
      return ok(route, { results: [] });
    }
    if (p === '/collection/212166') return ok(route, MADOKA_SAGA);
    const m = p.match(/^\/(tv|movie)\/(\d+)$/);
    if (m && DETAILS[`${m[1]}:${m[2]}`]) {
      const extra = DETAILS[`${m[1]}:${m[2]}`];
      return M.tmdb({ request: () => route.request(), fulfill: (o) => { const b = JSON.parse(o.body); Object.assign(b, { genres: [{ id: 18, name: 'Dramma' }, { id: 80, name: 'Crime' }] }, extra, { poster_path: `/p_${m[1]}_${m[2]}.jpg` }); return route.fulfill({ ...o, body: JSON.stringify(b) }); } });
    }
    return M.tmdb(route);
  });
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const texts = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
  const text = (sel) => page.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' ')).catch(() => null);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = (n) => page.screenshot({ path: path.join(OUT, `col-${n}.png`) });
  const rowTitles = () => texts('.d-fr .pc-title');
  const savedLib = () => JSON.parse(M.files['library.json']);
  const flush = () => page.waitForTimeout(2600); // il salvataggio parte 1,5 s dopo l'ultima azione

  await page.goto(base + '#/home');
  await page.waitForSelector('#tabs a', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ---- Wikidata: La casa di carta ----
  await page.goto(base + '#/t/tv/71446');
  await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('1-casa-di-carta');
  check(`riga «Collezione»: ${await text('.d-fr .row-head')}`, (await text('.d-fr .row-head h2')) === 'Collezione 2/3' && (await text('.d-fr .row-all')) === 'Tutti 3');
  check(`in ordine di uscita, compresa la serie stessa: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === 'La casa di carta|La casa di carta: Corea|Berlino e i gioielli di Parigi');
  check(`etichette: ${(await texts('.d-fr .pc-year')).join(', ')}`, (await texts('.d-fr .pc-year')).join(',') === 'Serie · 2017,Serie · 2022,Serie · 2023');
  check('la serie che stai guardando è segnata', await page.$eval('.d-fr .pc.here', (a) => a.getAttribute('href')) === '#/t/tv/71446');
  check('un titolo non in libreria si apre nell’app, senza barra di stato', await page.$$eval('.d-fr .pc', (as) => { const a = as.find((x) => x.getAttribute('href') === '#/t/tv/113036'); return !!a && !a.querySelector('.tube i[style]'); }));
  const q0 = log.wd.find((x) => x.includes('"71446"')) || '';
  check('query a Wikidata con id TMDB, spin-off e franchise', /wdt:P4983 "71446"/.test(q0) && /P2512/.test(q0) && /P8345/.test(q0) && /HAVING \(COUNT\(DISTINCT \?m\) <= 40\)/.test(q0));
  check('richiesta a Wikidata senza intestazioni che chiedono il permesso (CORS)', log.wdHeaders.every((h) => !h['api-user-agent'] && !h['content-type']));
  check('niente esce dallo schermo', await noOverflow());

  await page.goto(base + '#/t/tv/146176');
  await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
  check(`dall’altro lato (Berlino): ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === 'La casa di carta|La casa di carta: Corea|Berlino e i gioielli di Parigi');

  // ---- stesso nome prima del separatore ----
  await page.goto(base + '#/t/tv/62455');
  await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
  await page.waitForTimeout(400);
  check(`Vis a vis → El oasis, non il film francese: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === "Vis a vis - Il prezzo del riscatto|Vis a vis: L'oasi");
  await page.goto(base + '#/t/tv/97951');
  await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
  check(`e da El oasis a Vis a vis: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === "Vis a vis - Il prezzo del riscatto|Vis a vis: L'oasi");
  check('El oasis non è in libreria: niente «Modifica la collezione» nel menu ⋯', await (async () => { await page.click('[data-act=d-more]'); await page.waitForSelector('.sheet'); const n = await page.$('.sheet [data-col]'); await page.click('.sheet-bg'); await page.waitForTimeout(300); return n == null; })());

  // ---- pagina «Tutti» ----
  await page.goto(base + '#/t/tv/71446');
  await page.waitForSelector('.d-fr .pc');
  await page.$eval('.d-fr .row-all', (a) => a.click());
  await page.waitForSelector('.person-grid .pc');
  await shot('2-tutti');
  const hash = await page.evaluate(() => location.hash);
  check(`pagina: ${hash}`, hash === '#/collezione/tv/71446');
  check(`titolo «${await text('.page-top h1')}» · «${await text('.col-of')}» · «${await text('.person-count')}»`, (await text('.page-top h1')) === 'Collezione' && (await text('.col-of')) === 'La casa di carta' && (await text('.person-count')) === '2 visti su 3');
  check('«Modifica» per un titolo in libreria', (await page.$('.page-top [data-act=col-edit]')) != null);
  check('scheda Home ancora accesa', await page.$eval('#tabs a.on', (a) => !!a.dataset.tab));
  await page.goto(base + '#/collezione/tv/113036');
  await page.waitForSelector('.person-grid .pc', { timeout: 10000 });
  check(`titolo non in libreria: niente «Modifica», ${(await texts('.person-grid .pc-title')).join(' → ')}`, (await page.$('.page-top [data-act=col-edit]')) == null && (await texts('.person-grid .pc-title')).join('|') === 'La casa di carta|La casa di carta: Corea|Berlino e i gioielli di Parigi');
  await page.goto(base + '#/extra/71446');
  await page.waitForSelector('.person-grid .pc', { timeout: 10000 });
  check('il vecchio indirizzo #/extra/ apre la collezione', (await text('.page-top h1')) === 'Collezione');

  // ---- collegamento a mano ----
  await page.goto(base + '#/t/tv/146176');
  await page.waitForSelector('.d-fr .pc');
  await page.click('[data-act=d-more]');
  await page.waitForSelector('.sheet [data-col]');
  await page.click('.sheet [data-col]');
  await page.waitForSelector('.ce-sheet .pz-row', { timeout: 5000 });
  await page.waitForTimeout(350);
  await shot('3-modifica');
  check(`foglio: collegati ${(await texts('.ce-list .pz-txt b')).join(', ')}`, (await texts('.ce-list .pz-txt b')).join('|') === 'La casa di carta|La casa di carta: Corea');
  await page.fill('[data-ce-q]', 'berlino');
  await page.waitForSelector('.ce-list [data-ce=add]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const found = await texts('.ce-list .pz-txt b');
  check(`ricerca nel foglio: prima i titoli conosciuti (${found.slice(0, 3).join(', ')})`, found[0] === "Berlino e la Dama con l'ermellino" && !found.includes('Berlino e i gioielli di Parigi'));
  await page.click('.ce-list [data-k="tv:308014"]');
  await page.waitForTimeout(200);
  check('subito segnato come collegato', await page.$eval('.ce-list [data-k="tv:308014"]', (b) => b.dataset.ce === 'rm' && b.classList.contains('on')));
  await shot('4-collegato');
  await page.click('.ce-sheet [data-close]');
  await page.waitForTimeout(400);
  check(`riga con il titolo collegato: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === "La casa di carta|La casa di carta: Corea|Berlino e i gioielli di Parigi|Berlino e la Dama con l'ermellino");
  await flush();
  let L = savedLib();
  check(`su GitHub: links ${JSON.stringify(L.items['tv:146176'].links)}`, JSON.stringify(L.items['tv:146176'].links) === '["tv:308014"]');
  check(`commit leggibile: «${M.log.puts.filter((x) => x.path === 'library.json').pop()?.message}»`, /collega Berlino e la Dama con l'ermellino alla collezione/.test(M.log.puts.filter((x) => x.path === 'library.json').pop()?.message || ''));
  await page.goto(base + '#/t/tv/308014');
  await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
  check(`dall’altro lato: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).includes('Berlino e i gioielli di Parigi'));
  // si toglie dall'altro lato
  await page.click('[data-act=d-more]');
  await page.click('.sheet [data-col]');
  await page.waitForSelector('.ce-sheet [data-k="tv:146176"]');
  await page.click('.ce-sheet [data-k="tv:146176"]');
  await page.waitForTimeout(200);
  check('tolto dal foglio', (await page.$('.ce-sheet [data-k="tv:146176"]')) == null);
  await page.click('.ce-sheet [data-close]');
  await page.waitForTimeout(400);
  check('la riga sparisce (niente altro collegato)', (await page.$('.d-fr')) == null);
  await flush();
  L = savedLib();
  check('su GitHub il collegamento non c’è più', L.items['tv:146176'].links == null && L.items['tv:308014'].links == null);

  // ---- collegamento automatico nascosto e rimesso ----
  await page.goto(base + '#/t/tv/146176');
  await page.waitForSelector('.d-fr .pc');
  await page.click('[data-act=d-more]');
  await page.click('.sheet [data-col]');
  await page.waitForSelector('.ce-sheet [data-k="tv:71446"]');
  await page.click('.ce-sheet [data-k="tv:71446"]');
  await page.waitForTimeout(200);
  check(`nascosto: «${(await texts('.ce-sheet .ce-label')).join('')}» ${(await texts('.ce-list .pz-txt b')).join(', ')}`, (await texts('.ce-sheet .ce-label')).join('') === 'Nascosti' && (await page.$('.ce-sheet [data-ce=show][data-k="tv:71446"]')) != null);
  await shot('5-nascosto');
  await page.click('.ce-sheet [data-close]');
  await page.waitForTimeout(400);
  check(`Berlino senza La casa di carta: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === 'La casa di carta: Corea|Berlino e i gioielli di Parigi');
  await page.goto(base + '#/t/tv/71446');
  await page.waitForSelector('.d-fr .pc');
  check(`e La casa di carta senza Berlino: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === 'La casa di carta|La casa di carta: Corea');
  await flush();
  check('su GitHub: nolinks', JSON.stringify(savedLib().items['tv:146176'].nolinks) === '["tv:71446"]');
  await page.goto(base + '#/t/tv/146176');
  await page.waitForSelector('.d-head');
  await page.click('[data-act=d-more]');
  await page.click('.sheet [data-col]');
  await page.waitForSelector('.ce-sheet [data-ce=show]');
  await page.click('.ce-sheet [data-ce=show]');
  await page.waitForTimeout(200);
  await page.click('.ce-sheet [data-close]');
  await page.waitForTimeout(400);
  check(`rimesso: ${(await rowTitles()).join(' → ')}`, (await rowTitles()).join('|') === 'La casa di carta|La casa di carta: Corea|Berlino e i gioielli di Parigi');
  await flush();
  check('su GitHub niente più nolinks', savedLib().items['tv:146176'].nolinks == null);
  check('niente esce dallo schermo', await noOverflow());

  // ---- Madoka: la serie e il film hanno la stessa collezione (la saga del film entra tutta) ----
  const colOf = async (hash) => {
    await page.goto(base + hash);
    await page.waitForSelector('.d-fr .pc', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.d-fr .pc').length >= 6, null, { timeout: 8000 }).catch(() => {});
    return rowTitles();
  };
  const mS = await colOf('#/t/tv/39218');
  const mF = await colOf('#/t/movie/212162');
  console.log('    serie:', mS.join(' | '));
  console.log('    film: ', mF.join(' | '));
  check(`Madoka: serie e film con la stessa collezione (${mS.length} e ${mF.length})`, mS.length === 6 && mS.join('|') === mF.join('|') && mS.some((t) => /Walpurgis/.test(t)));
  check('Madoka: Magia Record (il titolo di Madoka sta nel suo, dopo i due punti), non «Fan Club»', mS.some((t) => /Magia Record/.test(t)) && !mS.some((t) => /Fan Club/.test(t)));
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await shot('7-madoka-film');

  // ---- Cerca «berlino» ----
  await page.goto(base + '#/cerca');
  await page.fill('[data-input=search-q]', 'berlino');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('#search-results')?.textContent.includes('Cerco'), null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const order = await texts('.sr .sr-title');
  await shot('6-cerca-berlino');
  console.log('   ' + order.join(' | '));
  const at = (t) => order.indexOf(t);
  check('prima «Berlino e la Dama con l’ermellino», poi «Berlino e i gioielli di Parigi»', at("Berlino e la Dama con l'ermellino") === 0 && at('Berlino e i gioielli di Parigi') === 1);
  check('«Il cielo sopra Berlino» tra i primi quattro', at('Il cielo sopra Berlino') >= 0 && at('Il cielo sopra Berlino') <= 3);
  check('il film sconosciuto «Berlino» (senza locandina) dopo quelli conosciuti', at('Berlino') > at("Berlino estate '42") && at('Berlino') > at('Berlino: codice rosso'));
  check('«Berlinoises» e «Berlinoskop» in fondo', at('Berlinoises') >= order.length - 2 && at('Berlinoskop') >= order.length - 2);

  console.log(errors.length ? `\n${errors.length} problemi:\n` + errors.join('\n') : '\ntutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
