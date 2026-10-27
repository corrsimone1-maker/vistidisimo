// Apre l'app con library.json e meta.json veri della repo dati (TMDB finto) e cerca errori.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8128', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8');
  M.shas['meta.json'] = 'meta0';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const base = 'http://127.0.0.1:8128/vistidisimo/';
  for (const r of ['#/home', '#/libreria', '#/cerca', '#/prossimi', '#/liste', '#/t/tv/31910', '#/t/tv/37854', '#/impostazioni']) {
    await page.goto(base + r);
    await page.waitForTimeout(1500);
    const ok = await page.evaluate(() => document.getElementById('view').children.length);
    console.log(r, ok ? 'ok' : 'VUOTA');
  }
  await page.goto(base + '#/home');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '70-dati-veri-home.png') });
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
