// Prova (18/11/2026): ordine di Libreria e liste (Ultimo visto, Voto più alto, Anno, Titolo, Ordine della lista…)
// e voto sulla locandina solo mentre si ordina per voto. Libreria finta.
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
const E = (d) => ({ 1: { 1: d } });
const lib = {
  v: 1,
  items: {
    'movie:301': mk('movie', 301, 'Alfa', 'completed', { seen: '2026-01-10', rating: 8.3, last: '2026-01-10T10:00:00.000Z', year: 2010 }),
    'movie:302': mk('movie', 302, 'Bravo', 'completed', { seen: '2026-09-20', rating: 10, last: '2026-09-20T10:00:00.000Z', year: 2020 }),
    'tv:303': mk('tv', 303, 'Charlie', 'completed', { eps: E('2026-05-05'), rating: 9.1, last: '2026-05-05T10:00:00.000Z', year: 2005 }),
    'movie:304': mk('movie', 304, 'Delta', 'completed', { seen: '2026-07-07', rating: null, last: '2026-07-07T10:00:00.000Z', year: 2018 }),
    'movie:305': mk('movie', 305, 'Echo', 'planned', { rating: null, last: '2026-11-10T10:00:00.000Z', year: 2024 }),
    'tv:306': mk('tv', 306, 'Foxtrot', 'completed', { eps: E('2026-10-10'), rating: 7.0, last: '2026-10-10T10:00:00.000Z', year: 2001 }),
  },
  // ordine della lista: quello in cui sono stati messi
  lists: [{ id: 'l1', title: 'Mista', added: NOW, items: [
    { key: 'tv:303', title: 'Charlie', year: 2005 }, { key: 'movie:301', title: 'Alfa', year: 2010 }, { key: 'movie:305', title: 'Echo', year: 2024 },
    { key: 'movie:302', title: 'Bravo', year: 2020 }, { key: 'movie:999', title: 'Fuori libreria', year: 2000 }, { key: 'tv:306', title: 'Foxtrot', year: 2001 }, { key: 'movie:304', title: 'Delta', year: 2018 },
  ] }],
};
const LIB = path.join(os.tmpdir(), 'vds-prova-ordine.json');
fs.writeFileSync(LIB, JSON.stringify(lib));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8144', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB, {});
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8144/vistidisimo/';
  const keys = (sel) => page.$$eval(`${sel} .pc`, (cs) => cs.map((c) => c.dataset.key.split(':')[1]));
  const rates = (sel) => page.$$eval(`${sel} .pc-rate`, (cs) => cs.map((c) => c.textContent.trim()));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- Libreria ----------
  await page.goto(base + '#/libreria');
  await page.waitForSelector('#lib-grid .pc');
  await page.waitForTimeout(1200);
  check('Libreria: predefinito Ultima attività, nessun voto sulle locandine', same(await keys('#lib-grid'), ['305', '306', '302', '304', '303', '301']) && (await rates('#lib-grid')).length === 0);
  check('Libreria: opzioni', same(await page.$$eval('select[data-input="lib-sort"] option', (o) => o.map((x) => x.textContent)), ['Ultimo visto', 'Voto più alto', 'Ultima attività', 'Aggiunti di recente', 'Anno di uscita', 'Titolo A–Z']));
  await page.selectOption('select[data-input="lib-sort"]', 'watched');
  await page.waitForTimeout(300);
  // visti: 306 (10 ott), 302 (20 set), 304 (lug), 303 (mag), 301 (gen); poi il non visto 305
  check('Libreria: Ultimo visto, dal più recente; i non visti in fondo', same(await keys('#lib-grid'), ['306', '302', '304', '303', '301', '305']));
  await page.selectOption('select[data-input="lib-sort"]', 'rating');
  await page.waitForTimeout(300);
  check('Libreria: Voto più alto, senza voto in fondo', same(await keys('#lib-grid'), ['302', '303', '301', '306', '305', '304']) || same(await keys('#lib-grid'), ['302', '303', '301', '306', '304', '305']));
  check('Libreria: il voto sta sulle locandine (solo di chi ce l\'ha)', same(await rates('#lib-grid'), ['10', '9.1', '8.3', '7']));
  await page.screenshot({ path: path.join(OUT, 'ordine-libreria-voto.png') });
  await page.selectOption('select[data-input="lib-sort"]', 'year');
  await page.waitForTimeout(300);
  check('Libreria: Anno di uscita, nessun voto', same(await keys('#lib-grid'), ['305', '302', '304', '301', '303', '306']) && (await rates('#lib-grid')).length === 0);
  await page.selectOption('select[data-input="lib-sort"]', 'title');
  await page.waitForTimeout(300);
  check('Libreria: Titolo A–Z', same(await keys('#lib-grid'), ['301', '302', '303', '304', '305', '306']));
  await page.selectOption('select[data-input="lib-sort"]', 'last');

  // ---------- Lista ----------
  await page.goto(base + '#/lista/l1');
  await page.waitForSelector('#list-grid .pc');
  await page.waitForTimeout(1200);
  check('Lista: predefinito Ultimo visto (come prima), nessun voto', same(await keys('#list-grid'), ['306', '302', '304', '303', '301', '305', '999']) && (await rates('#list-grid')).length === 0);
  check('Lista: nessun pallino sul ⋯ con l\'ordine predefinito', !(await page.$('.lf-dot')));
  await page.click('[data-act="list-filters"]');
  await page.waitForSelector('.lf-sheet');
  check('Foglio: titolo «Filtri e ordine» e 7 ordini', (await page.$eval('.lf-sheet .sheet-title', (e) => e.textContent)) === 'Filtri e ordine' && (await page.$$('[data-lf-sort]')).length === 7);
  const sortBtn = (v) => page.click(`[data-lf-sort="${v}"]`).then(() => page.waitForTimeout(250));
  await sortBtn('rating');
  check('Lista: Voto più alto (non in libreria e senza voto in fondo, nell\'ordine «ultimo visto»)', same(await keys('#list-grid'), ['302', '303', '301', '306', '304', '305', '999']));
  check('Lista: il voto sulle locandine', same(await rates('#list-grid'), ['10', '9.1', '8.3', '7']));
  check('Foglio resta aperto, pallino sul ⋯', !!(await page.$('.lf-sheet')) && !!(await page.$('.lf-dot')));
  await page.screenshot({ path: path.join(OUT, 'ordine-lista-foglio.png') });
  await sortBtn('order');
  check('Lista: Ordine della lista', same(await keys('#list-grid'), ['303', '301', '305', '302', '999', '306', '304']) && (await rates('#list-grid')).length === 0);
  await sortBtn('year');
  check('Lista: Anno di uscita', (await keys('#list-grid')).filter((k) => k !== '999').join() === '305,302,304,301,303,306');
  await sortBtn('title');
  check('Lista: Titolo A–Z', same(await keys('#list-grid'), ['301', '302', '303', '304', '305', '306', '999']) || (await keys('#list-grid'))[0] === '301');
  await sortBtn('rating');
  // «Copia N titoli» segue l'ordine che vedi
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8144' }).catch(() => {});
  await page.click('[data-lf-copy]');
  await page.waitForTimeout(400);
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check('Copia: nell\'ordine scelto', copied && copied.split('\n')[0].startsWith('Bravo') && copied.split('\n')[1].startsWith('Charlie'));
  // ricordato dopo la ricarica
  await page.reload();
  await page.waitForSelector('#list-grid .pc');
  await page.waitForTimeout(800);
  check('Ordine ricordato dopo la ricarica', same(await keys('#list-grid'), ['302', '303', '301', '306', '304', '305', '999']) && (await rates('#list-grid')).length === 4);
  await page.screenshot({ path: path.join(OUT, 'ordine-lista-voto.png') });
  check('nessuna pagina più larga del telefono', await page.evaluate(() => document.documentElement.scrollWidth <= 393));
  check('nessun errore di pagina', errors.length === 0);
  await browser.close(); srv.kill();
  if (errors.length) { console.log(errors); process.exit(1); }
})();
