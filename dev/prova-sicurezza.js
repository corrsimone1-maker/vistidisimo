// Prova del collegamento con riempimento automatico (Password di Apple: token GitHub come nome utente,
// chiave TMDB come password), dell'invio senza ricaricare la pagina, del ripiego delle immagini senza
// codice nell'HTML e dell'assenza di gestori inline (onerror=, onclick=…) in tutte le schermate.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();
const TMDB = 'eyJ-chiave-tmdb-di-prova';

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8143', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  if (fs.existsSync(path.join(DATA, 'meta.json'))) { M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0'; }
  M.files['config.json'] = JSON.stringify({ tmdb: TMDB }); M.shas['config.json'] = 'cfg0';
  const lib0 = JSON.parse(M.files['library.json']).items;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const inline = () => page.evaluate(() => [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${e.tagName.toLowerCase()} ${a.name}`)));
  const base = 'http://127.0.0.1:8143/vistidisimo/';

  // 1. primo avvio: un modulo di accesso che Password di Apple riconosce
  await page.goto(base);
  await page.waitForSelector('#gh-token');
  const f = await page.evaluate(() => {
    const gh = document.getElementById('gh-token'); const tm = document.getElementById('tmdb-token');
    return {
      form: !!gh.closest('form') && gh.closest('form') === tm.closest('form'),
      ghType: gh.type, ghAuto: gh.getAttribute('autocomplete'), ghName: gh.name,
      ghMask: getComputedStyle(gh).webkitTextSecurity || getComputedStyle(gh).getPropertyValue('-webkit-text-security'),
      tmType: tm.type, tmAuto: tm.getAttribute('autocomplete'), tmName: tm.name,
      before: gh.compareDocumentPosition(tm) & Node.DOCUMENT_POSITION_FOLLOWING,
      submit: document.querySelector('form [data-act=set-save]').type,
    };
  });
  console.log('    modulo:', JSON.stringify(f));
  check('stesso <form>, GitHub prima di TMDB, tasto di invio', f.form && f.before && f.submit === 'submit');
  check('token GitHub = nome utente (autocomplete=username), nascosto coi pallini', f.ghType === 'text' && f.ghAuto === 'username' && f.ghName === 'username' && f.ghMask === 'disc');
  check('chiave TMDB = password (autocomplete=current-password)', f.tmType === 'password' && f.tmAuto === 'current-password');
  await page.evaluate(() => { window.__stessaPagina = true; });
  // come il riempimento automatico: i due campi pieni, poi Invio (sulla tastiera o «Vai»)
  await page.fill('#gh-token', 'github_pat_FINTO');
  await page.fill('#tmdb-token', TMDB);
  await shot('k01-modulo-pieno');
  await page.press('#tmdb-token', 'Enter');
  await page.waitForSelector('.wordmark', { timeout: 15000 });
  await page.waitForTimeout(1500);
  check('Invio collega senza ricaricare la pagina', await page.evaluate(() => window.__stessaPagina === true));
  check('token salvati sul dispositivo', await page.evaluate((t) => localStorage.getItem('vds.ghToken') === 'github_pat_FINTO' && localStorage.getItem('vds.tmdbToken') === t, TMDB));
  check('chiave TMDB uguale a quella della repo: nessun commit su config.json', !M.log.puts.some((p) => p.path === 'config.json'));
  check('libreria intatta', JSON.stringify(JSON.parse(M.files['library.json']).items) === JSON.stringify(lib0));

  // 2. Impostazioni: lo stesso modulo; una chiave TMDB davvero nuova si salva ancora nella repo
  await page.goto(base + '#/impostazioni');
  await page.waitForSelector('#tmdb-token');
  await shot('k02-impostazioni');
  await page.fill('#tmdb-token', 'eyJ-chiave-nuova');
  await page.click('[data-act=set-save]');
  await page.waitForSelector('.wordmark', { timeout: 15000 });
  await page.waitForTimeout(800);
  check('chiave TMDB nuova → salvata in config.json', JSON.parse(M.files['config.json']).tmdb === 'eyJ-chiave-nuova');

  // 3. fotogrammi: se w780 non c'è si passa da solo a original, senza codice nell'HTML
  await page.route('**/t/p/w780/**', (r) => r.fulfill({ status: 404, body: '' }));
  const ep = Object.entries(lib0).find(([, it]) => it.type === 'tv' && it.eps?.['1']?.['1'] !== undefined);
  const id = ep[0].split(':')[1];
  await page.goto(base + `#/ep/${id}/1/1`);
  await page.waitForSelector('.epd-hero img');
  await page.waitForFunction(() => /\/original\//.test(document.querySelector('.epd-hero img').src), null, { timeout: 8000 }).catch(() => {});
  const hero = await page.$eval('.epd-hero img', (i) => ({ src: i.src, ok: i.complete && i.naturalWidth > 0, fb: i.dataset.fallback || '' }));
  console.log('    fotogramma:', hero.src.replace(/^.*\/t\/p\//, ''), hero.ok ? '(caricato)' : '(non caricato)');
  check('ripiego su original quando w780 manca', /\/t\/p\/original\//.test(hero.src) && hero.ok && !hero.fb);
  await page.unroute('**/t/p/w780/**');

  // 4. nessun gestore inline in nessuna schermata
  const screens = ['#/home', '#/libreria', '#/cerca', '#/prossimi', `#/t/${ep[0].replace(':', '/')}`, `#/ep/${id}/1/1`, `#/ripasso/${id}/1`, '#/liste', '#/impostazioni'];
  const found = [];
  for (const h of screens) {
    await page.goto(base + h);
    await page.waitForTimeout(900);
    const a = await inline();
    if (a.length) found.push(`${h}: ${[...new Set(a)].join(', ')}`);
  }
  await page.goto(base + '#/libreria');
  await page.waitForSelector('[data-act=lib-menu]');
  await page.click('[data-act=lib-menu]');
  await page.click('.pz [data-m=pick]');
  await page.waitForSelector('.pz-pick .pz-item');
  const a = await inline();
  if (a.length) found.push(`menu ≡: ${[...new Set(a)].join(', ')}`);
  check(`nessun onerror=/onclick=… nelle schermate (${screens.length} + menu)${found.length ? ': ' + found.join(' | ') : ''}`, !found.length);

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
