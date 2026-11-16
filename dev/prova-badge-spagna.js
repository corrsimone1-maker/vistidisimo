// Prova (16/11/2026): rettangolino giallo e rosso sulle locandine delle serie e dei film spagnoli (Spagna +
// lingua spagnola/catalana/galiziana/basca), con la stessa iconcina film/serie; non per Argentina, coproduzioni
// in inglese e anime. Libreria finta.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2] || os.tmpdir();

const NOW = '2026-11-01T10:00:00.000Z';
const mk = (type, id, title, status, extra = {}) => ({ type, id, title, year: 2019, status, rating: null, added: NOW, last: NOW, fav: null, rewatch: 0, ...extra });
const E = { 1: { 1: '2026-10-01', 2: '2026-10-02' } };
const lib = {
  v: 1,
  items: {
    'tv:200': mk('tv', 200, 'Serie spagnola', 'watching', { eps: E }),
    'movie:201': mk('movie', 201, 'Film spagnolo', 'completed', { seen: '2026-10-01' }),
    'movie:202': mk('movie', 202, 'Film argentino', 'completed', { seen: '2026-10-01' }),
    'movie:203': mk('movie', 203, 'Coproduzione inglese', 'completed', { seen: '2026-10-01' }),
    'tv:204': mk('tv', 204, 'Serie catalana', 'completed', { eps: E }),
    'tv:205': mk('tv', 205, 'Anime normale', 'completed', { eps: E }),
    'tv:206': mk('tv', 206, 'Serie americana', 'completed', { eps: E }),
    'movie:207': mk('movie', 207, 'Anime film', 'completed', { seen: '2026-10-01' }),
  },
  lists: [],
};
const LIB = path.join(os.tmpdir(), 'vds-prova-badge-spagna.json');
fs.writeFileSync(LIB, JSON.stringify(lib));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8143', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB, {
    animeKeys: new Set(['tv:205', 'movie:207']),
    countries: { 'tv:200': ['ES'], 'movie:201': ['ES'], 'movie:202': ['AR'], 'movie:203': ['ES', 'US'], 'tv:204': ['ES'] },
    langs: { 'tv:200': 'es', 'movie:201': 'es', 'movie:202': 'es', 'movie:203': 'en', 'tv:204': 'ca' },
  });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); localStorage.setItem('vds.libf', JSON.stringify({ kinds: ['serie', 'film', 'anime'], status: 'all', sort: 'last' })); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8143/vistidisimo/';
  await page.goto(base + '#/libreria');
  await page.waitForSelector('.pc');
  await page.waitForTimeout(2500);   // meta.json costruito dai dettagli finti
  const kinds = async () => page.$$eval('.pc', (cs) => Object.fromEntries(cs.map((c) => [c.dataset.key, c.querySelector('.kind')?.className || ''])));
  const k = await kinds();
  console.log(k);
  check('serie spagnola: is-es', k['tv:200'].includes('is-es'));
  check('film spagnolo: is-es', k['movie:201'].includes('is-es'));
  check('serie catalana: is-es', k['tv:204'].includes('is-es'));
  check('film argentino: niente', !k['movie:202'].includes('is-es'));
  check('coproduzione in inglese: niente', !k['movie:203'].includes('is-es'));
  check('serie americana: niente', !k['tv:206'].includes('is-es'));
  check('anime: rosa, non giallo-rosso', k['tv:205'].includes('is-anime') && !k['tv:205'].includes('is-es') && k['movie:207'].includes('is-anime') && !k['movie:207'].includes('is-es'));
  // l'iconcina film/serie resta
  const svgs = await page.$$eval('.pc', (cs) => Object.fromEntries(cs.map((c) => [c.dataset.key, c.querySelector('.kind svg')?.outerHTML.length || 0])));
  check('stessa iconcina di serie e film (film ≠ serie)', svgs['tv:200'] === svgs['tv:204'] && svgs['tv:200'] !== svgs['movie:201']);
  await page.screenshot({ path: path.join(OUT, 'badge-spagna-libreria.png') });
  const box = await page.$eval('[data-key="tv:200"] .kind', (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, bg: cs.backgroundColor, color: cs.color }; });
  console.log(box);
  await page.screenshot({ path: path.join(OUT, 'badge-spagna-zoom.png'), clip: { x: 0, y: Math.max(0, box.y - 60), width: 393, height: 280 } });

  await page.goto(base + '#/t/tv/200');
  await page.waitForSelector('.chip-s');
  await page.waitForTimeout(800);
  check('scheda: chip senza riquadro colorato ma con icona gialla', await page.$eval('.chip-s .kind', (e) => e.classList.contains('is-es') && getComputedStyle(e).boxShadow === 'none'));
  await page.screenshot({ path: path.join(OUT, 'badge-spagna-scheda.png') });
  check('nessuna pagina più larga del telefono', await page.evaluate(() => document.documentElement.scrollWidth <= 393));
  check('nessun errore di pagina', errors.length === 0);
  await browser.close(); srv.kill();
  if (errors.length) { console.log(errors); process.exit(1); }
})();
