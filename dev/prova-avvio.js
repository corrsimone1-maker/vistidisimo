// Prova dell'avvio: i moduli devono arrivare con ?v=N (mappa degli import) e, se un modulo
// è rotto o vecchio, dopo 7 secondi deve comparire «Ripara e riapri».
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');
const OUT = process.argv[2] || require('os').tmpdir();
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8129', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB);
  const browser = await chromium.launch();
  const base = 'http://127.0.0.1:8129/vistidisimo/';
  for (const broken of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true });
    await ctx.route('https://api.github.com/**', M.github);
    await ctx.route('https://api.themoviedb.org/**', M.tmdb);
    await ctx.route('https://image.tmdb.org/**', M.image);
    await ctx.addInitScript(() => { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); });
    if (broken) {
      // simula un modulo vecchio in cache che non esporta più quello che serve
      await ctx.route(/\/js\/store\.js/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const S = {};' }));
    }
    const page = await ctx.newPage();
    const urls = [];
    page.on('request', (r) => { if (r.url().includes('/js/')) urls.push(r.url().replace(base, '')); });
    await page.goto(base + '#/home');
    await page.waitForTimeout(broken ? 8000 : 2500);
    if (!broken) {
      console.log('moduli senza versione:', urls.filter((u) => !/\?v=\d+$/.test(u)));
      console.log('home ok:', !!(await page.$('.wordmark')));
    } else {
      const t = await page.$eval('#view', (e) => e.innerText.slice(0, 160)).catch(() => '');
      console.log('modulo rotto ->', t.replace(/\n+/g, ' / '));
      await page.screenshot({ path: path.join(OUT, '71-ripara.png') });
    }
    await ctx.close();
  }
  await browser.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
