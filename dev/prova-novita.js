// Prova delle «Novità» in Home (4/11/2026): titoli della Collezione di quello che hai guardato, usciti
// nell'ultimo anno o in uscita, che non hai in libreria. Dati veri della libreria, TMDB e Wikidata finti:
// - saga: Enola Holmes (e Enola Holmes 2) → «Enola Holmes 3» uscito 20 giorni fa; un film della saga del 2019
//   non è una novità;
// - stesso nome: La casa di carta → «La casa de papel: El regreso», in uscita fra 40 giorni (in blu, in fondo);
// - Wikidata: Vis a vis → uno spin-off uscito 100 giorni fa; Madoka (anime) → un film dal vero: fuori, come
//   nella Collezione; Magia Record (da guardare) e House of Cards (abbandonata) non portano novità;
// - la × lo toglie (newsOff su GitHub), «Annulla» lo rimette, ricaricando resta tolto;
// - pagina «Tutte» (#/novita); aggiungere il titolo alla libreria lo toglie dalle novità;
// - il giro in sottofondo controlla al massimo 12 titoli per apertura, prima quelli mai controllati.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

const day = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
const LIB = JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8'));
const TEST_SOURCES = ['movie:497582', 'movie:829280', 'tv:71446', 'tv:62455', 'tv:39218', 'tv:94523', 'tv:1425'];

const SAGA = { id: 829314, name: 'Enola Holmes - Collezione', parts: [
  { id: 497582, title: 'Enola Holmes', release_date: '2020-09-22', poster_path: '/p_movie_497582.jpg', genre_ids: [80, 18], original_language: 'en' },
  { id: 829280, title: 'Enola Holmes 2', release_date: '2022-11-03', poster_path: '/p_movie_829280.jpg', genre_ids: [80, 18], original_language: 'en' },
  { id: 99200001, title: 'Enola Holmes 3', release_date: day(-20), poster_path: '/p_movie_99200001.jpg', genre_ids: [80, 18], original_language: 'en' },
  { id: 99200002, title: 'Enola Holmes: il prologo', release_date: '2019-01-01', poster_path: '/p_movie_99200002.jpg', genre_ids: [80, 18], original_language: 'en' },
] };
const WD = {
  'tv:62455': [['tv:99200004', 0]],
  'tv:39218': [['movie:99200007', 0]],
  'tv:94523': [['tv:99200005', 0]],
  'tv:1425': [['tv:99200006', 0]],
};
const DETAILS = {
  'tv:99200003': { name: 'La casa de papel: El regreso', original_name: 'La casa de papel: El regreso', first_air_date: day(40), original_language: 'es', origin_country: ['ES'], genres: [{ id: 80, name: 'Crime' }] },
  'tv:99200004': { name: 'Vis a vis: La fuga', original_name: 'Vis a vis: La fuga', first_air_date: day(-100), original_language: 'es', origin_country: ['ES'], genres: [{ id: 18, name: 'Dramma' }] },
  'tv:99200005': { name: 'Magia Record: altro', original_name: 'Magia Record: altro', first_air_date: day(-10), original_language: 'ja', origin_country: ['JP'], genres: [{ id: 16, name: 'Animazione' }] },
  'tv:99200006': { name: 'House of Cards: spin-off', original_name: 'House of Cards: spin-off', first_air_date: day(-10), original_language: 'en', origin_country: ['US'], genres: [{ id: 18, name: 'Dramma' }] },
  'movie:99200007': { title: 'Madoka dal vero', original_title: 'まどか 実写', release_date: day(-30), original_language: 'ja', origin_country: ['JP'], genres: [{ id: 18, name: 'Dramma' }] },
  'movie:99200001': { title: 'Enola Holmes 3', original_title: 'Enola Holmes 3', release_date: day(-20), original_language: 'en', genres: [{ id: 80, name: 'Crime' }], belongs_to_collection: { id: 829314, name: 'Enola Holmes - Collezione' } },
};
const CASA = [
  { media_type: 'tv', id: 71446, name: 'La casa di carta', original_name: 'La casa de papel', first_air_date: '2017-05-02', original_language: 'es', genre_ids: [80], vote_count: 18000, popularity: 100, poster_path: '/p_tv_71446.jpg' },
  { media_type: 'tv', id: 99200003, name: 'La casa de papel: El regreso', original_name: 'La casa de papel: El regreso', first_air_date: day(40), original_language: 'es', genre_ids: [80], vote_count: 50, popularity: 30, poster_path: '/p_tv_99200003.jpg' },
];

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8156', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8156/vistidisimo/';
  const M = makeMocks(path.join(DATA, 'library.json'), {});
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  const log = { wd: [] };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://api.jikan.moe/**', (route) => route.fulfill({ status: 504, body: '{}' }));
  await ctx.route('https://query.wikidata.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('query') || '';
    const m = q.match(/wdt:(P4947|P4983) "(\d+)" \./);
    const key = m ? `${m[1] === 'P4947' ? 'movie' : 'tv'}:${m[2]}` : '';
    log.wd.push(key);
    const bindings = (WD[key] || []).map(([k, w]) => ({ [k.startsWith('tv:') ? 'tv' : 'mv']: { value: k.split(':')[1] }, w: { value: String(w) } }));
    return route.fulfill({ status: 200, contentType: 'application/sparql-results+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ head: { vars: ['tv', 'mv', 'w'] }, results: { bindings } }) });
  });
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    const q = (u.searchParams.get('query') || '').toLowerCase();
    if (p === '/search/multi') {
      if (u.searchParams.get('page') === '2') return ok(route, { results: [] });
      if (q === 'la casa de papel' || q === 'la casa di carta') return ok(route, { results: CASA });
      return ok(route, { results: [] });
    }
    if (p === '/collection/829314') return ok(route, SAGA);
    if (/\/(aggregate_credits|credits)$/.test(p)) return ok(route, { cast: [] });
    const m = p.match(/^\/(tv|movie)\/(\d+)$/);
    if (m && DETAILS[`${m[1]}:${m[2]}`]) {
      const extra = DETAILS[`${m[1]}:${m[2]}`];
      return M.tmdb({ request: () => route.request(), fulfill: (o) => { const b = JSON.parse(o.body); Object.assign(b, extra, { poster_path: `/p_${m[1]}_${m[2]}.jpg` }); return route.fulfill({ ...o, body: JSON.stringify(b) }); } });
    }
    return M.tmdb(route);
  });
  // gli altri titoli guardati risultano già controllati: il primo giro prende quelli della prova
  const scanned = {};
  for (const k of Object.keys(LIB.items)) if (!TEST_SOURCES.includes(k)) scanned[k] = Date.now();
  await ctx.addInitScript((sc) => {
    if (!localStorage.getItem('vds.ghToken')) {
      localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y');
      localStorage.setItem('vds.news.scan', JSON.stringify(sc));
    }
  }, scanned);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const texts = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')));
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = (n) => page.screenshot({ path: path.join(OUT, `nv-${n}.png`) });
  const savedLib = () => JSON.parse(M.files['library.json']);
  const flush = () => page.waitForTimeout(2600);
  const newsTitles = () => texts('.news .nv-t');

  await page.goto(base + '#/home');
  await page.waitForSelector('#tabs a', { timeout: 15000 });
  // il giro parte dopo l'aggiornamento dei dati di TMDB
  await page.waitForFunction(() => document.querySelectorAll('.news .nv').length >= 3, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('1-home');
  const titles = await newsTitles();
  check(`novità in Home: ${titles.join(' | ')}`, titles.join('|') === 'Enola Holmes 3|Vis a vis: La fuga|La casa de papel: El regreso');
  check('in cima alla Home, prima delle statistiche', await page.evaluate(() => { const n = document.querySelector('.news'); const s = document.querySelector('.stats'); return !!n && !!s && (n.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }));
  const whens = await texts('.news .nv-when');
  check(`date: ${whens.join(' | ')}`, /^Film · uscito il \d+ \w+/.test(whens[0]) && /^Serie · uscita il /.test(whens[1]) && /^Serie · esce il /.test(whens[2]));
  check('in uscita in blu', await page.$$eval('.news .nv-when', (els) => !els[0].classList.contains('soon') && els[2].classList.contains('soon')));
  const froms = await texts('.news .nv-from');
  check(`da dove: ${froms.join(' | ')}`, froms[0] === 'Collezione di Enola Holmes e di Enola Holmes 2' && froms[1] === 'Collezione di Vis a vis - Il prezzo del riscatto' && froms[2] === 'Collezione di La casa di carta');
  check('niente film della saga di prima di un anno fa', !titles.includes('Enola Holmes: il prologo'));
  check('anime solo con anime (Madoka → niente film dal vero)', !titles.includes('Madoka dal vero'));
  check('niente novità da titoli da guardare o abbandonati', !titles.includes('Magia Record: altro') && !titles.includes('House of Cards: spin-off'));
  check('«Tutte 3»', (await texts('.news .row-all'))[0] === 'Tutte 3');
  check('Home non più larga del telefono', await noOverflow());
  const scan = await page.evaluate(() => JSON.parse(localStorage.getItem('vds.news.scan') || '{}'));
  const sources = Object.keys(LIB.items).filter((k) => ['completed', 'uptodate', 'watching'].includes(LIB.items[k].status));
  const fresh = Object.keys(scan).filter((k) => scan[k] > Date.now() - 120000 && TEST_SOURCES.includes(k));
  check(`giro in sottofondo: controllati i titoli della prova (${fresh.length}), non quelli da guardare o abbandonati`, fresh.length === 5 && !fresh.includes('tv:94523') && !fresh.includes('tv:1425'));
  check(`al massimo 12 titoli per volta (Wikidata chiesto ${log.wd.length} volte)`, log.wd.length <= 12 && log.wd.length >= 5);
  void sources;

  // ---- la × ----
  await page.click('.news .nv[data-key="movie:99200001"] .nv-x');
  await page.waitForTimeout(400);
  check('la × toglie Enola Holmes 3', !(await newsTitles()).includes('Enola Holmes 3'));
  check('avviso con «Annulla»', (await texts('.toast')).some((t) => /Tolto dalle novità\s*Annulla/.test(t)));
  await shot('2-tolto');
  await flush();
  check('newsOff su GitHub', (savedLib().newsOff || []).includes('movie:99200001'));
  check('library.json resta nel formato di serialize', /^\{"v":/.test(M.files['library.json']) && /\n"newsOff":\["movie:99200001"\]/.test(M.files['library.json']));
  await page.click('.toast button').catch(() => {});
  await page.waitForTimeout(400);
  check('«Annulla» lo rimette', (await newsTitles()).includes('Enola Holmes 3'));
  await flush();
  check('e su GitHub newsOff sparisce', !('newsOff' in savedLib()));
  await page.click('.news .nv[data-key="movie:99200001"] .nv-x');
  await flush();
  await page.reload();
  await page.waitForSelector('.news .nv', { timeout: 15000 });
  await page.waitForTimeout(800);
  check(`ricaricando resta tolto: ${(await newsTitles()).join(' | ')}`, (await newsTitles()).join('|') === 'Vis a vis: La fuga|La casa de papel: El regreso');

  // ---- pagina «Tutte» ----
  await page.click('.news .row-all');
  await page.waitForSelector('.nv-list .nv');
  await page.waitForTimeout(300);
  await shot('3-tutte');
  check(`#/novita: ${(await texts('.nv-list .nv-t')).join(' | ')}`, (await texts('.nv-list .nv-t')).length === 2 && (await texts('.page-top .count'))[0] === '2');
  check('scheda della barra accesa: Home', await page.$eval('#tabs a.on', (a) => a.dataset.tab) === 'home');
  check('#/novita non più larga del telefono', await noOverflow());

  // ---- aggiunto alla libreria: sparisce ----
  await page.click('.nv-list .nv[data-key="tv:99200004"] .nv-t');
  await page.waitForSelector('[data-act="d-add"]', { timeout: 10000 });
  await page.click('[data-act="d-add"][data-st="planned"]');
  await page.waitForTimeout(500);
  await page.goto(base + '#/home');
  await page.waitForTimeout(800);
  check(`aggiunto alla libreria, non è più una novità: ${(await newsTitles()).join(' | ')}`, (await newsTitles()).join('|') === 'La casa de papel: El regreso');

  // ---- secondo giro: i titoli appena controllati non si richiedono ----
  const before = log.wd.length;
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.reload();
  await page.waitForTimeout(6000);
  check(`riaprendo l'app non si ricontrollano gli stessi titoli (Wikidata: ${log.wd.length - before} richieste)`, !log.wd.slice(before).some((k) => TEST_SOURCES.includes(k)));

  console.log(errors.length ? 'ERRORI:\n' + errors.join('\n') : 'tutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})();
