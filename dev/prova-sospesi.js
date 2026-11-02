// Prova di «Dove mi sono fermato»: menu ≡ della Libreria, scelta di titolo → episodio → minuto,
// pallino rosso sulle locandine, «Fermo a» nelle schede, pulizia automatica quando segni visto
// l'episodio o il film, reset (× e «Azzera tutti») con «Annulla», salvataggio su GitHub.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8141', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  if (fs.existsSync(path.join(DATA, 'meta.json'))) { M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0'; }
  const remote = () => JSON.parse(M.files['library.json']).items;
  const lib0 = remote();
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
  const shot = async (name, full = false) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }); };
  const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '(manca)');
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const saved = () => page.waitForTimeout(2600);
  const sheetGone = () => page.waitForSelector('.sheet-wrap', { state: 'detached' });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.sheet *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1 || e.closest('.scroll-x, .pz-eps')));
  const base = 'http://127.0.0.1:8141/vistidisimo/';

  // 0. il minutaggio: cosa si può scrivere
  await page.goto(base + '#/libreria');
  await page.waitForSelector('#lib-grid .pc');
  const parsed = await page.evaluate(async () => {
    const { parseClock, fmtClock } = await import('./js/ui.js');
    return ['23', '23:14', '23,14', '23.14', '1:34:20', '1,34,20', '94', '23,5', '23:60', '1:60:00', '', 'abc', '0']
      .map((s) => [s, parseClock(s), parseClock(s) == null ? null : fmtClock(parseClock(s))]);
  });
  const want = { 23: '23:00', '23:14': '23:14', '23,14': '23:14', '23.14': '23:14', '1:34:20': '1:34:20', '1,34,20': '1:34:20', 94: '1:34:00', '23,5': null, '23:60': null, '1:60:00': null, '': null, abc: null, 0: '0:00' };
  check(`minutaggio: ${parsed.map(([s, , f]) => `«${s}»→${f}`).join(' ')}`, parsed.every(([s, , f]) => f === want[s]));

  // 1. Libreria: tre lineette in alto a destra, nessun pallino finché non c'è niente in sospeso
  check('tasto ≡ in alto a destra nella Libreria', await page.$eval('.page-top [data-act=lib-menu]', (b) => b.getBoundingClientRect().right > innerWidth - 40));
  check('nessun pallino all’inizio', (await page.$('.menu-dot')) == null && (await page.$('.pc-pause')) == null);
  await shot('s00-libreria');
  await page.click('[data-act=lib-menu]');
  await page.waitForSelector('.pz [data-m=pick]');
  console.log('    menu:', await text('.pz'));
  await shot('s01-menu-vuoto');

  // 2. serie: scegli il titolo, l'episodio proposto è il prossimo da vedere, scrivi il minuto
  await page.click('.pz [data-m=pick]');
  await page.waitForSelector('.pz-pick .pz-item');
  check('elenco dei titoli dal più recente', (await text('.pz-pick .pz-item b')) === 'The 100');
  await shot('s02-scegli-titolo');
  await page.fill('[data-pz-q]', 'naru');
  await page.waitForTimeout(200);
  check('filtro per titolo', (await page.$$('.pz-pick .pz-item')).length === 1 && (await text('.pz-pick .pz-item b')) === 'Naruto Shippuden');
  await page.fill('[data-pz-q]', '100');
  await page.waitForTimeout(200);
  await page.click('.pz-pick [data-k="tv:48866"]');
  await page.waitForSelector('.pz-eps .pz-ep');
  await page.waitForTimeout(500);
  check('proposto il prossimo da vedere (S2 · E6)', (await text('.pz-seasons .chip.on')) === 'Stagione 2' && (await text('.pz-ep.on')) === '6');
  check('episodi visti distinti', (await page.$$('.pz-ep.seen')).length === 5);
  check('Salva spento senza minuto', await page.$eval('[data-m=save]', (b) => b.disabled));
  console.log('    nome:', await text('.pz-epname'));
  await shot('s03-episodio');
  await page.fill('.pz-time', '23,14');
  check('«Salva 23:14»', (await text('[data-m=save]')) === 'Salva 23:14' && !(await page.$eval('[data-m=save]', (b) => b.disabled)));
  check('nessun elemento esce dallo schermo nel foglio', await noOverflow());
  await shot('s04-minuto');
  await page.click('[data-m=save]');
  await sheetGone();
  console.log('    avviso:', await text('.toast'));
  await saved();
  const p1 = remote()['tv:48866'].pause;
  check(`salvato su GitHub: ${JSON.stringify(p1)}`, p1 && p1.s === 2 && p1.e === 6 && p1.t === 23 * 60 + 14 && /^\d{4}-\d\d-\d\d$/.test(p1.d));
  check('commit leggibile', M.log.puts.some((p) => p.message === 'The 100: fermo a S2E6 23:14'));
  check('pallino sul ≡ e sulla locandina', (await page.$('.menu-dot')) != null && (await page.$$('#lib-grid .pc-pause')).length === 1 && (await page.$('#lib-grid .pc[data-key="tv:48866"] .pc-pause')) != null);
  await shot('s05-libreria-pallino');

  // 3. film: «94» = un'ora e 34
  await page.click('[data-act=lib-menu]');
  await page.click('.pz [data-m=pick]');
  await page.fill('[data-pz-q]', 'incep');
  await page.waitForTimeout(200);
  await page.click('.pz-pick [data-k="movie:27205"]');
  await page.waitForSelector('.pz-time');
  check('film: niente episodi, solo il minuto', (await page.$('.pz-eps')) == null);
  await page.fill('.pz-time', '94');
  check('«Salva 1:34:00»', (await text('[data-m=save]')) === 'Salva 1:34:00');
  await shot('s06-film');
  await page.press('.pz-time', 'Enter');
  await sheetGone();
  await saved();
  check('film salvato', remote()['movie:27205'].pause?.t === 94 * 60 && remote()['movie:27205'].pause.s == null);

  // 4. il menu con i titoli in sospeso
  await page.click('[data-act=lib-menu]');
  await page.waitForSelector('.pz-row');
  console.log('    in sospeso:', await text('.pz-list'));
  check('due titoli in sospeso, con episodio e minuto', (await page.$$('.pz-row')).length === 2 && (await text('.pz-list')).includes('S2 · E6 · 23:14 · oggi') && (await text('.pz-list')).includes('1:34:00'));
  check('«Azzera tutti» con più di un titolo', (await page.$('[data-m=clear-all]')) != null);
  await shot('s07-menu-sospesi');
  await page.click('.sheet-bg');
  await sheetGone();

  // 5. Home: pallini sulle locandine
  await page.click('#tabs a[data-tab=home]');
  await page.waitForSelector('.scroller .pc');
  check('Home: pallino su The 100 e su Inception', (await page.$('.pc[data-key="tv:48866"] .pc-pause')) != null && (await page.$('.pc[data-key="movie:27205"] .pc-pause')) != null);
  await shot('s08-home');

  // 6. pagina della serie: «Fermo a» nei dati e sull'episodio; toccandolo si cambia
  await page.goto(base + '#/t/tv/48866');
  await page.waitForSelector('.pz-fact');
  await page.waitForTimeout(600);
  check('dato «Fermo a S2 · E6 · 23:14»', (await text('.facts')).includes('Fermo aS2 · E6 · 23:14'));
  await page.click('[data-act=d-season][data-s="2"]');
  await page.waitForSelector('.ep.paused');
  check('episodio 6 segnato «fermo a 23:14»', (await page.$eval('.ep.paused .ep-n', (e) => e.textContent)) === '6' && (await text('.ep.paused .pz-tag')) === 'fermo a 23:14');
  await page.evaluate(() => document.querySelector('.ep.paused').scrollIntoView({ block: 'center' }));
  await shot('s09-serie-episodio');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('s09b-serie-dati');
  await page.click('.pz-fact');
  await page.waitForSelector('.pz-time');
  check('si apre col minuto già scritto e «Togli»', (await page.$eval('.pz-time', (i) => i.value)) === '23:14' && (await page.$('[data-m=remove]')) != null && (await page.$('.pz-head .back')) == null);
  await page.click('.pz-seasons [data-s="1"]');
  check('cambiando stagione l’episodio va scelto', await page.$eval('[data-m=save]', (b) => b.disabled));
  await page.click('.pz-seasons [data-s="2"]');
  check('tornando sulla stagione ritrova l’episodio', (await text('.pz-ep.on')) === '6');
  await page.fill('.pz-time', '25:40');
  await shot('s10-modifica');
  await page.click('[data-m=save]');
  await sheetGone();
  await saved();
  check('minuto cambiato (25:40)', remote()['tv:48866'].pause.t === 25 * 60 + 40);

  // 7. scheda dell'episodio
  await page.goto(base + '#/ep/48866/2/6');
  await page.waitForSelector('.epd-seen');
  await page.waitForTimeout(500);
  check('scheda episodio: «Fermo a 25:40»', (await text('.epd-seen')).includes('Fermo a 25:40'));
  await shot('s11-scheda-episodio');

  // 8. Prossimi: al posto di «Poi ne restano…» il minuto; il cerchio lo toglie, «Annulla» lo rimette
  await page.goto(base + '#/prossimi');
  await page.waitForSelector('.ep-card');
  await page.waitForTimeout(800);
  const card = await page.$('.ep-card:has([data-key="tv:48866"])');
  check('Prossimi: «Fermo a 25:40» e pallino', (await card.$eval('.ep-left', (e) => e.textContent)) === 'Fermo a 25:40' && (await card.$('.ep-still .pc-pause')) != null);
  await shot('s12-prossimi');
  await card.$eval('.check-btn', (b) => b.click());
  await page.waitForTimeout(900);
  await saved();
  check('segnato visto S2E6 → punto in sospeso tolto da solo', remote()['tv:48866'].pause == null && '6' in remote()['tv:48866'].eps['2']);
  await page.click('.toast button');
  await saved();
  check('«Annulla» rimette episodio e punto in sospeso', !('6' in remote()['tv:48866'].eps['2']) && remote()['tv:48866'].pause?.t === 25 * 60 + 40);

  // 9. il film: segnandolo visto il punto in sospeso sparisce
  await page.goto(base + '#/t/movie/27205');
  await page.waitForSelector('.pz-fact');
  check('film: «Fermo a 1:34:00»', (await text('.pz-fact')) === '1:34:00');
  await shot('s13-film-pagina');
  await page.click('[data-act=d-more]');
  await page.waitForSelector('.sheet [data-pause]');
  check('menu ⋯: «Cambia dove mi sono fermato»', (await text('.sheet [data-pause]')) === 'Cambia dove mi sono fermato');
  await shot('s14-menu-altro');
  await page.click('.sheet-bg');
  await sheetGone();
  await page.click('[data-act=d-status]');
  await page.waitForSelector('.sheet .opt[data-v=completed]');
  await page.click('.sheet .opt[data-v=completed]');
  await saved();
  check('film visto → niente più in sospeso', remote()['movie:27205'].status === 'completed' && remote()['movie:27205'].pause == null);

  // 10. anime con numerazione assoluta: la stagione 2 parte dal 33
  await page.goto(base + '#/libreria');
  await page.waitForSelector('[data-act=lib-menu]');
  await page.click('[data-act=lib-menu]');
  await page.click('.pz [data-m=pick]');
  await page.fill('[data-pz-q]', 'naruto');
  await page.waitForTimeout(200);
  await page.click('.pz-pick [data-k="tv:31910"]');
  await page.waitForSelector('.pz-ep.on');
  await page.waitForTimeout(300);
  const nums = await page.$$eval('.pz-ep', (b) => b.map((x) => Number(x.textContent)));
  check(`numerazione assoluta: stagione 2 da ${nums[0]} a ${nums[nums.length - 1]}, proposto E${await text('.pz-ep.on')}`, nums[0] === 33 && (await text('.pz-ep.on')) === '41');
  check('episodio scelto visibile nella griglia', await page.$eval('.pz-ep.on', (b) => { const g = b.closest('.pz-eps').getBoundingClientRect(); const r = b.getBoundingClientRect(); return r.top >= g.top - 1 && r.bottom <= g.bottom + 1; }));
  await shot('s15-anime');
  await page.click('.pz-seasons [data-s="1"]');
  await page.waitForTimeout(200);
  await shot('s15b-anime-stagione-1');
  await page.click('.pz-ep[data-e="12"]');
  await page.fill('.pz-time', '1:02:03');
  await page.click('[data-m=save]');
  await sheetGone();

  // 11. ricaricando prima del salvataggio non si perde niente (coda in localStorage)
  await page.reload();
  await page.waitForSelector('.menu-dot');
  await saved();
  check('dopo il ricaricamento: salvato S1E12 1:02:03', remote()['tv:31910'].pause?.e === 12 && remote()['tv:31910'].pause.t === 3723);

  // 12. reset: × su uno (con «Annulla»), poi «Azzera tutti»
  await page.click('[data-act=lib-menu]');
  await page.waitForSelector('.pz-row');
  check('due in sospeso (The 100 e Naruto)', (await page.$$('.pz-row')).length === 2);
  await page.click('.pz-row [data-m=clear][data-k="tv:31910"]');
  await page.waitForTimeout(200);
  check('× toglie la riga', (await page.$$('.pz-row')).length === 1);
  console.log('    avviso:', await text('.toast'));
  await shot('s16-tolto');
  await page.click('.toast button');
  await page.waitForTimeout(300);
  check('«Annulla» la rimette', (await page.$$('.pz-row')).length === 2);
  await page.click('[data-m=clear-all]');
  await page.waitForTimeout(200);
  check('«Azzera tutti» svuota l’elenco', (await page.$$('.pz-row')).length === 0 && (await page.$('[data-m=pick]')) != null);
  await page.click('.sheet-bg');
  await sheetGone();
  await saved();
  const left = Object.entries(remote()).filter(([, it]) => it.pause).map(([k]) => k);
  check(`su GitHub non resta niente in sospeso (${left.join(', ') || 'nessuno'})`, !left.length);
  check('niente pallini', (await page.$('.menu-dot')) == null && (await page.$('.pc-pause')) == null);
  check('nient’altro cambiato nella libreria', Object.keys(remote()).length === Object.keys(lib0).length && remote()['tv:48866'].status === lib0['tv:48866'].status && JSON.stringify(remote()['tv:70523']) === JSON.stringify(lib0['tv:70523']));

  // 13. da una scheda episodio già visto: «L'ho rivisto» toglie il punto in sospeso di quell'episodio
  await page.goto(base + '#/t/tv/70523');
  await page.waitForSelector('[data-act=d-more]');
  await page.click('[data-act=d-more]');
  await page.click('.sheet [data-pause]');
  await page.waitForSelector('.pz-ep.on');
  check('serie completata: proposto S1 · E1', (await text('.pz-seasons .chip.on')) === 'Stagione 1' && (await text('.pz-ep.on')) === '1');
  await page.click('.pz-ep[data-e="3"]');
  await page.fill('.pz-time', '41:00');
  await page.click('[data-m=save]');
  await sheetGone();
  await page.goto(base + '#/ep/70523/1/3');
  await page.waitForSelector('[data-act=ep-check]');
  await page.click('[data-act=ep-check]');
  await page.click('.sheet [data-o=rw]');
  await saved();
  check('rivisto S1E3 → punto in sospeso tolto', remote()['tv:70523'].pause == null && remote()['tv:70523'].rw['1']['3'] === 4);

  console.log('commit:', M.log.puts.filter((p) => p.path === 'library.json' && !p.conflict).map((p) => p.message).join(' | '));
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
