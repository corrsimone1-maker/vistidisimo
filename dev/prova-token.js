// Terza prova: token scaduto, ripresa con token nuovo, esportazione CSV, niente voti sulle locandine.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const OUT = process.argv[2] || require('os').tmpdir();
// Le due repo devono stare una accanto all'altra (…/vistidisimo e …/vistidisimo-dati).
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8125', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB);
  let expired = false;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await ctx.route('https://api.github.com/**', (route) => {
    const auth = route.request().headers()['authorization'] || '';
    if (expired && auth.includes('VECCHIO')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Bad credentials' }) });
    return M.github(route);
  });
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'github_pat_VECCHIO'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = 'http://127.0.0.1:8125/vistidisimo/';
  await page.goto(base + '#/home');
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log('voti sulle locandine:', await page.$$eval('.pc-rate', (e) => e.length));
  // il token scade
  expired = true;
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  await page.click('[data-act=d-fav]');
  await page.waitForTimeout(2500);
  await page.goto(base + '#/home');
  await page.waitForSelector('.banner.bad');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '40-token-scaduto.png') });
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('vds.ops') || '[]').length);
  console.log('modifiche in attesa sul dispositivo:', pending, '| preferito già su GitHub:', !!JSON.parse(M.files['library.json']).items['movie:129'].fav);
  // ricarica dell'app con token scaduto: la coda resta
  await page.reload();
  await page.waitForTimeout(2000);
  console.log('dopo ricarica, in attesa:', await page.evaluate(() => JSON.parse(localStorage.getItem('vds.ops') || '[]').length));
  // token nuovo
  await page.goto(base + '#/impostazioni');
  await page.waitForSelector('#gh-token');
  await page.fill('#gh-token', 'github_pat_NUOVO');
  await page.click('[data-act=set-save]');
  await page.waitForTimeout(3500);
  console.log('dopo token nuovo: preferito su GitHub =', !!JSON.parse(M.files['library.json']).items['movie:129'].fav, '| in attesa:', await page.evaluate(() => JSON.parse(localStorage.getItem('vds.ops') || '[]').length), '| banner errore:', await page.$$eval('.banner.bad', (e) => e.length));
  // esportazione
  await page.goto(base + '#/impostazioni');
  await page.waitForSelector('[data-act=set-csv]');
  await page.screenshot({ path: path.join(OUT, '41-impostazioni.png'), fullPage: true });
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.click('[data-act=set-csv]');
  await page.waitForTimeout(1500);
  for (const d of downloads) {
    const p = path.join(OUT, d.suggestedFilename());
    await d.saveAs(p);
    const txt = fs.readFileSync(p, 'utf8');
    console.log(d.suggestedFilename(), txt.split('\r\n').length - 2, 'righe |', txt.split('\r\n')[1].slice(0, 120));
  }
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
