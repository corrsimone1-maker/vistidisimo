// Prova della regia nei film e della pagina con tutti i film di un regista.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');
const OUT = process.argv[2] || require('os').tmpdir();
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8136', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '(manca)');
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8136/vistidisimo/';

  // 1. pagina di un film: solo la regia, col nome toccabile
  await page.goto(base + '#/t/movie/157336');
  await page.waitForSelector('.facts a.person');
  await page.waitForTimeout(500);
  const facts = await text('.facts');
  console.log('   ', facts);
  check('regia nel film', /Regia\s*Regista Finta/.test(facts));
  check('niente sceneggiatura', !/Sceneggiatura/.test(facts));
  await shot('p01-film');

  // 2. tocco sul regista: i suoi film dal più recente, senza corti, contenuti video e film solo scritti
  await page.click('.facts a.person[href="#/persona/777"]');
  await page.waitForSelector('.person-grid .pc');
  await page.waitForTimeout(600);
  const titles = await page.$$eval('.person-grid .pc', (e) => e.map((x) => `${x.querySelector('.pc-title').textContent} ${x.querySelector('.pc-year').textContent}`.trim()));
  console.log('    regia:', titles.join(' | '));
  check('nome in testa', (await text('.page-top h1')) === 'Regista Finta');
  check('dal più recente, annunciati senza data in cima', titles.join('|') === 'Progetto annunciato senza data|Tenet 2020|Interstellar 2014|Inception 2010|The Japanese One 2005|Mediometraggio di 41 minuti 2001');
  check('fuori i corti (12 e 40 minuti), il «video» e i film solo scritti', !titles.some((t) => /cortometraggio|Corto di 40|Dietro le quinte|Scritto e basta/.test(t)));
  check('niente interruttore regia/sceneggiatura', (await page.$('.seg')) == null);
  check('«visti su» conta i film della libreria visti', /visti su 6/.test(await text('.person-count')));
  check('i film in libreria hanno la barra di stato', (await page.$$('.person-grid .pc .tube')).length >= 3);
  await shot('p02-regia');

  // 3. vecchio indirizzo con /regia: funziona lo stesso
  await page.goto(base + '#/persona/777/regia');
  await page.waitForSelector('.person-grid .pc');
  check('indirizzo vecchio ok', (await page.$$('.person-grid .pc')).length === 6);
  // finestra bassa, così la pagina del film scorre e si vede se lo scroll torna
  await page.setViewportSize({ width: 393, height: 520 });
  await page.goto(base + '#/t/movie/157336');
  await page.waitForSelector('.facts a.person');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 300));
  const y0 = await page.evaluate(() => window.scrollY);
  await page.click('.facts a.person[href="#/persona/777"]');
  await page.waitForSelector('.person-grid .pc');

  // 4. da un film della lista e ritorno; poi indietro al film di partenza
  await page.click('.person-grid a[href="#/t/movie/27205"]');
  await page.waitForSelector('.d-head');
  check('apre il film', (await text('.d-titles h1')) === 'Inception');
  await page.click('.hero-bar [data-act=back]');
  await page.waitForSelector('.person-grid');
  await page.click('.page-top [data-act=back]');
  await page.waitForSelector('.facts a.person');
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => window.scrollY);
  check(`tornando al film lo scroll resta (${y0} → ${y1})`, y0 > 100 && Math.abs(y1 - y0) < 40);
  await page.setViewportSize({ width: 393, height: 852 });

  // 5. gli episodi non hanno più regia e sceneggiatura
  await page.goto(base + '#/ep/70523/1/1');
  await page.waitForSelector('.epd-head');
  await page.waitForTimeout(800);
  check('scheda episodio senza regia e sceneggiatura', !/Regia|Sceneggiatura/.test(await text('#view')));

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
