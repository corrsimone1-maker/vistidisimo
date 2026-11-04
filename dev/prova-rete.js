// Prova della rete che non risponde (4/11/2026: all'apertura «Non riesco a raggiungere GitHub (Load failed)» e
// tutte le locandine con l'icona rotta di Safari, e restava così finché non riaprivi l'app):
// 1. primo avvio senza rete per GitHub e immagini: avviso senza «Apri Impostazioni», niente icone rotte;
//    quando GitHub e le immagini tornano, l'app riprova da sola (dopo 3 s): avviso via, locandine caricate;
// 2. quando il telefono dice che la rete è tornata (evento «online») riprova subito;
// 3. una modifica fatta mentre GitHub non risponde arriva su GitHub quando torna.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const OUT = process.argv[2] || require('os').tmpdir();
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8158', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB);
  let down = true; // GitHub e le immagini non rispondono
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', (route) => (down ? route.abort('failed') : M.github(route)));
  await ctx.route('https://image.tmdb.org/**', (route) => (down ? route.abort('failed') : M.image(route)));
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://query.wikidata.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":{"bindings":[]}}' }));
  await ctx.addInitScript((sc) => {
    if (!localStorage.getItem('vds.ghToken')) {
      localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y');
      localStorage.setItem('vds.news.scan', JSON.stringify(sc));
    }
  }, M.newsScanned());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const shot = (n) => page.screenshot({ path: path.join(OUT, `rete-${n}.png`) });
  const base = 'http://127.0.0.1:8158/vistidisimo/';
  const banner = () => page.$eval('.banner.bad', (b) => b.textContent.trim().replace(/\s+/g, ' ')).catch(() => '');
  const imgs = () => page.$$eval('#view img', (els) => ({
    n: els.length,
    off: els.filter((e) => e.classList.contains('img-off')).length,
    loaded: els.filter((e) => e.complete && e.naturalWidth > 0).length,
    visibleBroken: els.filter((e) => e.complete && e.naturalWidth === 0 && getComputedStyle(e).visibility !== 'hidden' && e.getAttribute('src')).length,
  }));

  // ---- 1. un avvio buono (per avere la copia sul dispositivo), poi uno senza GitHub né immagini ----
  down = false;
  await page.goto(base + '#/home');
  await page.waitForSelector('.pc', { timeout: 60000 });
  await page.waitForTimeout(1500);
  down = true;
  await page.reload();
  await page.waitForSelector('.banner.bad', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const b1 = await banner();
  check(`avviso di rete: «${b1}»`, /Non riesco a raggiungere GitHub/.test(b1) && /riprovo da solo/.test(b1));
  check('niente «Apri Impostazioni» per un errore di rete', !/Apri Impostazioni/.test(b1) && !(await page.$('a.banner.bad')));
  const i1 = await imgs();
  // (quelle fuori schermo con loading="lazy" non sono ancora state chieste)
  check(`immagini non arrivate nascoste (${i1.off} di ${i1.n}, rotte visibili ${i1.visibleBroken})`, i1.n > 5 && i1.off > 20 && i1.visibleBroken === 0);
  await shot('1-senza-rete');
  check('la libreria si vede lo stesso (copia sul dispositivo)', (await page.$$('.pc')).length > 5);
  // la rete torna: al primo tentativo automatico (3 s) riparte tutto
  down = false;
  await page.waitForFunction(() => !document.querySelector('.banner.bad'), null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('torna la rete: l\'avviso sparisce da solo', !(await banner()));
  const i2 = await imgs();
  check(`le locandine si ricaricano da sole (${i2.loaded} di ${i2.n}, nascoste ${i2.off}, rotte ${i2.visibleBroken})`, i2.off === 0 && i2.visibleBroken === 0 && i2.loaded >= i1.off);
  await shot('2-rete-tornata');

  // ---- 2. telefono offline, poi l'evento «online» ----
  down = true;
  await page.reload();
  await page.waitForSelector('.banner.bad', { timeout: 15000 });
  down = false;
  const t0 = Date.now();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.querySelector('.banner.bad'), null, { timeout: 5000 }).catch(() => {});
  check(`evento «online»: riprova subito (${Date.now() - t0} ms)`, !(await banner()) && Date.now() - t0 < 2500);

  // ---- 3. modifica mentre GitHub non risponde ----
  down = true;
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  const favBefore = !!JSON.parse(M.files['library.json']).items['movie:129']?.fav;
  await page.click('[data-act=d-fav]');
  await page.waitForTimeout(2500);
  check('modifica in coda mentre GitHub non risponde', await page.evaluate(() => JSON.parse(localStorage.getItem('vds.ops') || '[]').length > 0));
  down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(3500);
  const favAfter = !!JSON.parse(M.files['library.json']).items['movie:129']?.fav;
  check(`arrivata su GitHub quando la rete torna (preferito ${favBefore} → ${favAfter})`, favAfter !== favBefore);
  check('coda vuota', await page.evaluate(() => JSON.parse(localStorage.getItem('vds.ops') || '[]').length === 0));

  console.log(errors.length ? 'ERRORI:\n' + errors.join('\n') : 'tutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})();
