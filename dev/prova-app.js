// Comportamento da app: nessuna schermata deve essere più larga del telefono (niente scorrimento di lato).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8130', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  if (fs.existsSync(path.join(DATA, 'meta.json'))) { M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'm0'; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = 'http://127.0.0.1:8130/vistidisimo/';
  const routes = ['#/home', '#/libreria', '#/cerca', '#/prossimi', '#/liste', '#/t/tv/31910', '#/t/movie/129', '#/impostazioni', '#/raccolta/serie', '#/ep/73223/1/4', '#/ep/73223/2/3', '#/ripasso/73223/1', '#/ripasso/70523', '#/persona/777', '#/t/movie/157336'];
  for (const r of routes) {
    await page.goto(base + r);
    await page.waitForTimeout(1200);
    const w = await page.evaluate(() => {
      const wide = [...document.querySelectorAll('#view *')].filter((el) => {
        if (el.closest('.scroller, .chips.scroll-x')) return false; // le righe orizzontali scorrono dentro di sé
        const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1);
      }).slice(0, 3).map((el) => el.className || el.tagName);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, wide };
    });
    console.log(r, w.sw <= w.iw ? 'ok' : `LARGA ${w.sw}>${w.iw}`, w.wide.length ? 'fuori: ' + w.wide.join(', ') : '');
  }
  const vp = await page.$eval('meta[name=viewport]', (m) => m.content);
  console.log('viewport:', vp);
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
