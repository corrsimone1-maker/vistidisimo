const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const OUT = process.argv[2] || require('os').tmpdir();
// Le due repo devono stare una accanto all'altra (…/vistidisimo e …/vistidisimo-dati).
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const lib0 = require(LIB);
  const animeList = lib0.lists.find((l) => l.title === 'Anime');
  const animeKeys = new Set(animeList.items.map((e) => e.key));
  for (const k of ['movie:372058', 'movie:129']) animeKeys.add(k);
  const M = makeMocks(LIB, { animeKeys });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  const shot = async (name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); };
  const base = 'http://127.0.0.1:8123/vistidisimo/';

  // 1. primo avvio
  await page.goto(base);
  await page.waitForSelector('#gh-token');
  await shot('01-benvenuto');
  await page.fill('#gh-token', 'github_pat_FINTO');
  await page.fill('#tmdb-token', 'eyJFINTO');
  await page.click('[data-act=set-save]');
  await page.waitForSelector('.wordmark');
  await page.waitForTimeout(400);
  await shot('02-home-durante-download');
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('03-home');
  await shot('03b-home-intera', true);

  // 2. libreria
  await page.click('#tabs a[data-tab=libreria]');
  await page.waitForSelector('#lib-grid');
  await shot('04-libreria');
  await page.click('[data-act=lib-kind][data-v=anime]');
  await shot('05-libreria-anime');
  await page.click('[data-act=lib-status][data-v=watching]');
  await shot('05b-libreria-anime-incorso');
  await page.click('[data-act=lib-kind][data-v=all]');
  await page.click('[data-act=lib-status][data-v=all]');
  await page.fill('[data-input=lib-q]', 'dark');
  await page.waitForTimeout(200);
  await shot('06-libreria-filtro');
  await page.fill('[data-input=lib-q]', '');

  // 3. cerca
  await page.click('#tabs a[data-tab=cerca]');
  await page.waitForSelector('.sr');
  await shot('07-cerca');
  await page.fill('[data-input=search-q]', 'nuov');
  await page.waitForTimeout(900);
  await shot('08-cerca-risultati');

  // 4. prossimi
  await page.click('#tabs a[data-tab=prossimi]');
  await page.waitForSelector('.up-body');
  await page.waitForTimeout(1200);
  await shot('09-prossimi');
  const firstShow = await page.$eval('.ep-card .ep-show', (e) => e.textContent);
  const firstCode = await page.$eval('.ep-card .ep-code', (e) => e.textContent);
  await page.click('.ep-card .check-btn');
  await page.waitForTimeout(900);
  const afterCode = await page.$eval('.ep-card .ep-code', (e) => e.textContent);
  console.log('prossimi:', firstShow, '|', firstCode, '->', afterCode);
  await shot('10-prossimi-dopo-check');
  await page.click('[data-act=up-tab][data-v=air]');
  await shot('11-in-uscita', true);
  await page.click('[data-act=up-tab][data-v=next]');

  // 5. dettaglio serie in corso
  await page.click('.ep-card .ep-body');
  await page.waitForSelector('.season');
  await page.waitForTimeout(600);
  await shot('12-dettaglio-serie');
  const seasons = await page.$$('.season-head');
  await seasons[seasons.length - 1].click();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('.season.open')?.scrollIntoView());
  await shot('13-stagione-aperta');
  // segna un episodio più avanti per far comparire "precedenti"
  const btns = await page.$$('.season.open .ep:not(.on) .check-btn:not([disabled])');
  if (btns.length > 1) { await btns[btns.length - 1].click(); await page.waitForTimeout(500); await shot('14-toast-precedenti'); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[data-act=d-rate]');
  await page.waitForSelector('.rate-big');
  await page.waitForTimeout(300);
  await page.click('.rate-ctl [data-d="1"]'); await page.click('.rate-ctl [data-d="1"]'); await page.click('.rate-ctl [data-d="1"]');
  await shot('15-voto');
  await page.click('[data-ok]');
  await page.waitForTimeout(500);
  await page.click('[data-act=d-status]');
  await shot('16-stato');
  await page.click('.sheet-bg');
  await page.waitForTimeout(300);

  // 6. dettaglio film anime
  await page.goto(base + '#/t/movie/372058');
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(800);
  await shot('17-dettaglio-film');
  await page.click('[data-act=d-lists]');
  await shot('18-liste-foglio');
  await page.click('.sheet [data-close]');
  await page.waitForTimeout(300);

  // 7. liste
  await page.goto(base + '#/liste');
  await page.waitForSelector('.list-grid');
  await page.waitForTimeout(600);
  await shot('19-liste');
  await page.click('.list-grid .lc');
  await page.waitForSelector('.list-head');
  await page.waitForTimeout(600);
  await shot('20-lista');

  // 8. impostazioni
  await page.goto(base + '#/impostazioni');
  await page.waitForSelector('.set-sec');
  await shot('21-impostazioni');

  // 9. conflitto: un altro dispositivo scrive nel frattempo
  await page.waitForTimeout(2500);
  const before = JSON.parse(M.files['library.json']);
  before.items['tv:48866'].rating = 4.2; // modifica "remota"
  M.files['library.json'] = JSON.stringify(before);
  M.shas['library.json'] = 'remota-1';
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(500);
  await page.click('[data-act=d-fav]');
  await page.waitForTimeout(3500);
  const after = JSON.parse(M.files['library.json']);
  console.log('conflitto: voto remoto mantenuto =', after.items['tv:48866'].rating, '| preferito locale =', !!after.items['movie:129'].fav);
  console.log('PUT:', M.log.puts.map((p) => `${p.path}${p.conflict ? ' (409)' : ''}: ${p.message}`).join('\n  '));
  console.log('meta.json voci:', M.files['meta.json'] ? Object.keys(JSON.parse(M.files['meta.json']).items).length : 0);
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close();
  srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
