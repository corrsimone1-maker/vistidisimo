// Prova (15/11/2026): pagina di una lista (ricerca, «Modifica» accanto alla percentuale, Rinomina ed Elimina
// nel menu ⋯) e paese di produzione nella scheda del titolo (a sinistra di «Trailer»; film in spagnolo ma
// argentino → «Argentina»). Libreria finta.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2] || os.tmpdir();

const NOW = '2026-11-01T10:00:00.000Z';
const mk = (type, id, title, status, extra = {}) => ({ type, id, title, year: 2015, status, rating: null, added: NOW, last: NOW, fav: null, rewatch: 0, ...extra });
const lib = {
  v: 1,
  items: {
    'movie:129': mk('movie', 129, 'La città incantata', 'completed', { seen: '2026-10-01' }),
    'movie:130': mk('movie', 130, 'Film da vedere', 'planned'),
    'tv:100': mk('tv', 100, 'Serie in corso', 'watching', { eps: { 1: { 1: '2026-10-01', 2: '2026-10-02' } } }),
    'movie:132': mk('movie', 132, 'Film sovietico', 'completed', { seen: '2026-10-05' }),
    'tv:101': mk('tv', 101, 'Anime finito', 'completed', { eps: { 1: { 1: '2026-09-01', 2: '2026-09-02' } } }),
  },
  lists: [{ id: 'l1', title: 'Mista', added: NOW, items: [
    { key: 'movie:129', title: 'La città incantata', year: 2015 }, { key: 'movie:130', title: 'Film da vedere', year: 2015 },
    { key: 'tv:100', title: 'Serie in corso', year: 2015 }, { key: 'tv:101', title: 'Anime finito', year: 2015 },
  ] }],
};
const LIB = path.join(os.tmpdir(), 'vds-prova-liste-paese.json');
fs.writeFileSync(LIB, JSON.stringify(lib));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8142', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB, { animeKeys: new Set(['tv:101']), countries: { 'movie:129': ['US', 'GB', 'CA'], 'tv:100': ['CN', 'JP'], 'movie:132': ['SU'] } });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  // paesi veri per due titoli: un film in spagnolo ma argentino, e una serie coprodotta da tre paesi
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await ctx.route(/api\.themoviedb\.org\/3\/movie\/130(\?|$)/, (route) => json(route, {
    id: 130, title: 'Film da vedere', original_title: 'Película', release_date: '2019-05-01', poster_path: '/p_movie_130.jpg', backdrop_path: '/b_movie_130.jpg',
    overview: 'Un film argentino.', genres: [{ id: 18, name: 'Dramma' }], original_language: 'es', origin_country: ['AR'], runtime: 100, status: 'Released',
  }));
  // un trailer finto per i film 129 e 130, per provare dove sta il paese rispetto al tasto
  await ctx.route(/api\.themoviedb\.org\/3\/movie\/(129|130)\/videos/, (route) => json(route, { results: [{ site: 'YouTube', type: 'Trailer', key: 'abcdefghijk', name: 'Trailer', official: true, published_at: '2020-01-01T00:00:00.000Z', iso_639_1: 'it' }] }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const remoteList = () => JSON.parse(M.files['library.json']).lists;
  const base = 'http://127.0.0.1:8142/vistidisimo/';
  const sheet = () => page.$('.sheet-wrap.in .sheet').then((x) => !!x);
  const cards = () => page.$$eval('#list-grid .pc .pc-title', (e) => e.map((x) => x.textContent.trim()));

  // ---------- pagina di una lista ----------
  await page.goto(base + '#/lista/l1');
  await page.waitForSelector('#list-grid .pc');
  check('lista: 4 titoli', (await cards()).length === 4);
  check('lista: niente più Rinomina/Elimina/Modifica in fondo (barra .list-tools)', !(await page.$('.list-tools')));
  check('lista: niente Rinomina né Elimina nella pagina', !(await page.$('.list-head [data-act=list-rename], .list-head [data-act=list-delete]')));
  check('lista: barra di ricerca', !!(await page.$('.list-head input[data-input=list-q]')));
  const pct = await page.$eval('.list-pct b', (e) => e.getBoundingClientRect().toJSON());
  const mod = await page.$eval('.list-pct [data-act=list-edit]', (e) => e.getBoundingClientRect().toJSON());
  const vw = 393;
  check('lista: «Modifica» sulla riga di «xx% completato», a destra', Math.abs((mod.top + mod.height / 2) - (pct.top + pct.height / 2)) < 14 && mod.left > pct.right + 60 && mod.right <= vw);
  const searchTop = await page.$eval('.list-search', (e) => e.getBoundingClientRect().top);
  const tubeTop = await page.$eval('.list-head .tube', (e) => e.getBoundingClientRect().top);
  check('lista: la ricerca sta sotto la barra', searchTop > tubeTop);
  await page.screenshot({ path: path.join(OUT, '70-lista-ricerca.png') });

  await page.click('input[data-input=list-q]');
  await page.keyboard.type('serie', { delay: 40 });
  check('ricerca: il campo resta attivo mentre scrivi', await page.evaluate(() => document.activeElement?.dataset?.input === 'list-q'));
  check('ricerca «serie» → solo «Serie in corso»', JSON.stringify(await cards()) === '["Serie in corso"]');
  check('ricerca: sotto il titolo «ne vedi 1»', /ne vedi 1/.test(await page.$eval('#list-sub', (e) => e.textContent)));
  await page.screenshot({ path: path.join(OUT, '71-lista-ricerca-serie.png') });
  await page.fill('input[data-input=list-q]', 'citta');
  check('ricerca senza accenti: «citta» trova «La città incantata»', JSON.stringify(await cards()) === '["La città incantata"]');
  await page.fill('input[data-input=list-q]', 'zzz');
  check('ricerca senza risultati: «Nessun titolo corrisponde»', /Nessun titolo corrisponde/.test(await page.$eval('#list-grid', (e) => e.textContent)));
  await page.fill('input[data-input=list-q]', '');
  check('ricerca svuotata: di nuovo 4 titoli e niente «ne vedi»', (await cards()).length === 4 && !/ne vedi/.test(await page.$eval('#list-sub', (e) => e.textContent)));

  // Modifica con la ricerca accesa
  await page.fill('input[data-input=list-q]', 'film');
  await page.click('.list-pct [data-act=list-edit]');
  check('Modifica: il tasto diventa «Fine» e la ricerca resta', (await page.$eval('.list-pct [data-act=list-edit]', (e) => e.textContent.trim())) === 'Fine'
    && (await page.$eval('input[data-input=list-q]', (e) => e.value)) === 'film' && (await cards()).length === 1);
  check('Modifica: la × compare sui titoli', !!(await page.$('#list-grid [data-act=list-remove]')));
  await page.click('.list-pct [data-act=list-edit]');
  await page.fill('input[data-input=list-q]', '');

  // menu ⋯: Rinomina ed Elimina
  await page.click('[data-act=list-filters]');
  await page.waitForSelector('.lf-sheet');
  check('⋯: ci sono Rinomina ed Elimina', !!(await page.$('.lf-sheet [data-act=list-rename]')) && !!(await page.$('.lf-sheet [data-act=list-delete]')));
  await page.screenshot({ path: path.join(OUT, '72-lista-menu.png') });
  await page.click('.lf-sheet [data-act=list-rename]');
  await page.waitForSelector('.sheet-wrap.in input');
  await page.waitForTimeout(400);
  check('Rinomina: il menu si chiude e si apre la richiesta del nome', (await page.$$('.sheet-wrap')).length === 1 && (await page.$eval('.sheet-wrap input', (e) => e.value)) === 'Mista');
  await page.fill('.sheet-wrap input', 'Mista 2');
  await page.click('.sheet-wrap [data-ok]');
  await page.waitForTimeout(2500);
  check('Rinomina: titolo cambiato in pagina e su GitHub', (await page.$eval('.page-top h1', (e) => e.textContent.trim())) === 'Mista 2' && remoteList()[0].title === 'Mista 2');
  await page.click('[data-act=list-filters]');
  await page.waitForSelector('.lf-sheet');
  await page.click('.lf-sheet [data-act=list-delete]');
  await page.waitForSelector('.sheet-wrap.in [data-ok]');
  await page.click('.sheet-wrap [data-ok]');
  await page.waitForTimeout(2500);
  check('Elimina: lista tolta (su GitHub) e si torna indietro', remoteList().length === 0);

  // ---------- paese ----------
  const chipOf = async () => page.$eval('.country-chip', (e) => e.textContent.trim()).catch(() => '');
  await page.goto(base + '#/t/movie/130');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('.country-chip', { timeout: 8000 }).catch(() => {});
  check('film in spagnolo ma argentino: «Argentina», non «Spagna»', /Argentina/.test(await chipOf()) && !/Spagna/.test(await chipOf()));
  await page.screenshot({ path: path.join(OUT, '73-paese-film.png') });
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('.country-chip', { timeout: 8000 }).catch(() => {});
  check('tre paesi: solo il primo, «USA» e non «Stati Uniti», con «+2»', /^\W*USA\s*\+2$/.test(await chipOf()));
  check('tre paesi: gli altri sono nascosti (non ci sono UK né Canada nella pagina)', !/UK|Canada/.test(await page.$eval('.d-head', (e) => e.textContent)));
  await page.waitForSelector('.trailer-btn', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  {
    // pressione lunga: compare il fumetto con gli altri paesi, e sparisce
    const cb = await page.$eval('.country-chip', (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    check('tocco breve: ancora nessun fumetto', !(await page.$('.country-peek')));
    await page.waitForTimeout(600);
    check('pressione lunga: fumetto con «UK · Canada»', (await page.$eval('.country-peek', (e) => e.textContent).catch(() => '')) === 'UK · Canada');
    await page.screenshot({ path: path.join(OUT, '75-paese-pressione.png') });
    await page.mouse.up();
    await page.waitForTimeout(2300);
    check('dopo aver lasciato il fumetto sparisce', !(await page.$('.country-peek')));
  }
  const tr = await page.$('.trailer-btn');
  if (tr) {
    const c = await page.$eval('.country-chip', (e) => e.getBoundingClientRect().toJSON());
    const t = await tr.evaluate((e) => e.getBoundingClientRect().toJSON());
    check('il paese sta a sinistra di «Trailer», sulla stessa riga', c.right <= t.left && Math.abs(c.top - t.top) < 4);
  } else check('c\'è il tasto «Trailer» per provare la posizione', false);
  await page.screenshot({ path: path.join(OUT, '74-paese-usa.png') });
  await page.goto(base + '#/t/tv/101');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('.country-chip', { timeout: 8000 }).catch(() => {});
  check('anime: «Giappone», senza «+» (un solo paese)', /Giappone$/.test(await chipOf()) && !/\+/.test(await chipOf()));
  await page.goto(base + '#/t/tv/100');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('.country-chip', { timeout: 8000 }).catch(() => {});
  check('Cina e Giappone: «Cina» (non «Cina continentale»), Giappone nascosto', /^\W*Cina\s*\+1$/.test(await chipOf()) && !/Giappone/.test(await page.$eval('.d-head', (e) => e.textContent)));
  await page.goto(base + '#/t/movie/132');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('.country-chip', { timeout: 8000 }).catch(() => {});
  check('codice «SU» (Stalker): «Russia» con la bandiera 🇷🇺, non 🇸🇺', /Russia/.test(await chipOf()) && (await page.$eval('.country-chip .flags', (e) => e.textContent)) === '\u{1F1F7}\u{1F1FA}');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check('nessuna pagina più larga del telefono', !wide);

  console.log(errors.length ? '\nERRORI:\n' + errors.join('\n') : '\ntutto ok');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})();
