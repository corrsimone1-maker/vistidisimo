// Prova di scheda episodio, ripasso e rivisioni (titoli, stagioni, singoli episodi) con i dati veri.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();
const BC = 73223; // Black Clover: 170 episodi visti, in pari, pausa lunga
const DARK = 70523; // Dark: rivista 3 volte, ogni episodio visto 4 volte
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8135', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8');
  M.shas['meta.json'] = 'meta0';
  const remote = () => JSON.parse(M.files['library.json']).items;
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
  const base = 'http://127.0.0.1:8135/vistidisimo/';

  // 1. pagina della serie: «Dove eravamo rimasti» e rivisioni
  await page.goto(base + `#/t/tv/${BC}`);
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(1500);
  check('riquadro «Dove eravamo rimasti» dopo una pausa lunga', await page.$('.resume') != null);
  console.log('   ', await text('.resume'));
  console.log('   ', await text('.rw-box'));
  await shot('e01-serie');
  await page.click(`[data-act=d-season][data-s="1"]`);
  await page.waitForSelector('.eps .ep-t[href]');
  await page.waitForTimeout(600);
  check('episodi rivisti segnati nella lista', (await page.$$('.rw-tag')).length === 3);
  await page.evaluate(() => document.querySelector('.rw-tag').scrollIntoView({ block: 'center' }));
  await shot('e02-stagione');

  // 2. scheda episodio: trama italiana, fotogrammi, regia
  const yBefore = await page.evaluate(() => window.scrollY);
  const href = await page.$eval('.rw-tag', (e) => e.closest('a').getAttribute('href'));
  await page.click(`.ep-t[href="${href}"]`);
  await page.waitForSelector('.epd-ov p');
  await page.waitForTimeout(800);
  console.log('   ', href, '|', await text('.epd-head h1'), '|', await text('.rw-box'));
  check('trama italiana senza avviso di lingua', (await page.$('.epd-lang')) == null || /italiano/.test(await text('.epd-lang')));
  check('fotogrammi mostrati', (await page.$$('.still')).length >= 3);
  check('regia e sceneggiatura', /Regista Finto/.test(await text('.facts')) && /Autrice Finta/.test(await text('.facts')));
  await shot('e03-episodio');
  await shot('e03b-episodio-intero', true);

  // visioni in più dell'episodio
  const parts = href.replace('#/ep/', '').split('/').map(Number);
  const rw0 = remote()[`tv:${BC}`].rw?.[parts[1]]?.[parts[2]] || 0;
  await page.click('[data-act=ep-rw][data-d="1"]');
  await page.waitForTimeout(2600);
  const rw1 = remote()[`tv:${BC}`].rw?.[parts[1]]?.[parts[2]] || 0;
  check(`+1 visione all'episodio salvato su GitHub (${rw0} → ${rw1})`, rw1 === rw0 + 1);
  await page.click('[data-act=ep-rw][data-d="-1"]');
  await page.waitForTimeout(2600);
  check('−1 torna com’era', (remote()[`tv:${BC}`].rw?.[parts[1]]?.[parts[2]] || 0) === rw0);

  // visore a tutto schermo
  await page.click('.still:nth-child(2)');
  await page.waitForSelector('.viewer.in');
  await page.waitForTimeout(400);
  console.log('    visore:', await text('.viewer-n'));
  await shot('e04-visore');
  await page.$eval('.viewer-track', (t) => { t.scrollLeft = t.clientWidth * 2; });
  await page.waitForTimeout(300);
  check('visore scorre (3 / N)', /^3 \//.test(await text('.viewer-n')));
  await page.click('[data-viewer-close]');
  await page.waitForTimeout(300);
  check('visore chiuso', (await page.$('.viewer')) == null);

  // 3. indietro: la lista degli episodi torna dov'era
  await page.click('.hero-bar [data-act=back]');
  await page.waitForSelector('.season.open');
  await page.waitForTimeout(500);
  const yAfter = await page.evaluate(() => window.scrollY);
  check(`indietro mantiene lo scroll (${yBefore} → ${yAfter})`, Math.abs(yAfter - yBefore) < 40);

  // 4. lingue della trama
  for (const [e, want] of [[3, 'inglese'], [15, 'spagnolo'], [21, null], [4, 'it']]) {
    await page.goto(base + `#/ep/${BC}/1/${e}`);
    await page.waitForSelector('.epd-plot p');
    await page.waitForFunction(() => !/Carico la trama/.test(document.querySelector('.epd-plot').textContent), null, { timeout: 8000 });
    const plot = await text('.epd-plot');
    const h1 = await text('.epd-head h1');
    if (want === null) check(`E${e}: nessuna trama (solo francese su TMDB)`, /non ha una trama/.test(plot));
    else if (want === 'it') check(`E${e}: titolo vero in inglese al posto del segnaposto «Episodio 4» (${h1})`, h1 === 'English title 4');
    else check(`E${e}: trama in ${want}`, plot.includes(`Trama in ${want}`));
    if (e === 3) await shot('e05-trama-inglese');
  }

  // 5. episodio non ancora visto: trama e immagini nascoste finché non tocchi
  await page.goto(base + `#/ep/${BC}/2/3`);
  await page.waitForSelector('.epd-head');
  await page.waitForTimeout(1200);
  check('episodio non visto: velo sopra trama e immagini', (await page.$('.veil')) != null && (await page.$('.still')) == null);
  await shot('e06-non-visto');
  await page.click('.veil');
  await page.waitForTimeout(500);
  check('dopo il tocco si vedono', (await page.$('.veil')) == null && (await page.$$('.still')).length > 0);

  // 6. ripasso
  await page.goto(base + `#/ripasso/${BC}/1`);
  await page.waitForSelector('.rp-card');
  await page.waitForFunction(() => !/Carico la trama/.test(document.querySelector('.rp-list').textContent), null, { timeout: 15000 });
  const cards = (await page.$$('.rp-card')).length;
  check(`ripasso: ${cards} episodi visti della stagione 1`, cards === Object.keys(remote()[`tv:${BC}`].eps['1']).length);
  const langs = await page.$$eval('.rp-lang', (e) => [...new Set(e.map((x) => x.textContent))]);
  console.log('    lingue di ripiego nel ripasso:', langs.join(', '));
  check('ripasso usa inglese e spagnolo dove manca l’italiano', langs.some((l) => /inglese/.test(l)) && langs.some((l) => /spagnolo/.test(l)));
  check('ripasso: E21 senza trama', /Nessuna trama/.test(await page.$eval('.rp-card:nth-child(21)', (e) => e.textContent)));
  await shot('e07-ripasso');
  await page.click('[data-act=rp-end]');
  await page.waitForTimeout(1200);
  check('«Vai all’ultimo visto» porta all’ultimo episodio', await page.$eval('.rp-card:last-child', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; }));
  await shot('e08-ripasso-fondo');

  // 7. rivisione di tutta la serie (Dark): − e + aggiornano anche gli episodi
  await page.goto(base + `#/t/tv/${DARK}`);
  await page.waitForSelector('.rw-box');
  await page.waitForTimeout(800);
  console.log('   ', await text('.rw-box'));
  const ep11 = () => remote()[`tv:${DARK}`].rw['1']['1'];
  const before = { t: remote()[`tv:${DARK}`].rewatch, e: ep11() };
  await page.click('[data-act=d-rw][data-d="-1"]');
  await page.waitForTimeout(2600);
  check(`Dark −1: serie ${before.t}→${remote()[`tv:${DARK}`].rewatch}, S1E1 ${before.e}→${ep11()}`, remote()[`tv:${DARK}`].rewatch === before.t - 1 && ep11() === before.e - 1);
  await page.click('[data-act=d-rw][data-d="1"]');
  await page.waitForTimeout(2600);
  check('Dark +1 torna com’era', remote()[`tv:${DARK}`].rewatch === before.t && ep11() === before.e);
  await shot('e09-dark');
  // stagione rivista e «Annulla»
  await page.click(`[data-act=d-season][data-s="1"]`);
  await page.waitForSelector('[data-act=d-season-rw]');
  await page.click('[data-act=d-season-rw]');
  await page.waitForTimeout(2600);
  check('stagione rivista: +1 a S1E1', ep11() === before.e + 1);
  await page.click('.toast button');
  await page.waitForTimeout(2600);
  check('«Annulla» la toglie', ep11() === before.e);

  // 8. film: il castello errante di Howl
  await page.goto(base + '#/t/movie/4935');
  await page.waitForSelector('.rw-box');
  console.log('   ', await text('.rw-box'));
  const r0 = remote()['movie:4935'].rewatch;
  await page.click('[data-act=d-rw][data-d="1"]');
  await page.waitForTimeout(2600);
  check(`film +1 (${r0} → ${remote()['movie:4935'].rewatch})`, remote()['movie:4935'].rewatch === r0 + 1);
  await shot('e10-film');
  await page.click('[data-act=d-rw][data-d="-1"]');
  await page.waitForTimeout(2600);

  // 9. togliere un episodio rivisto chiede conferma e toglie anche le rivisioni
  await page.goto(base + `#/ep/${DARK}/1/2`);
  await page.waitForSelector('[data-act=ep-check]');
  await page.click('[data-act=ep-check]');
  await page.waitForSelector('.sheet [data-ok]');
  await page.click('.sheet [data-ok]');
  await page.waitForTimeout(2600);
  const dk = remote()[`tv:${DARK}`];
  check('episodio tolto: niente più visione né rivisioni', !('2' in dk.eps['1']) && !('2' in (dk.rw['1'] || {})));

  // 10. serie non ancora in libreria: dalla scheda episodio la si aggiunge col titolo giusto
  await page.goto(base + '#/t/tv/999001');
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(800);
  await page.click('[data-act=d-season][data-s="1"]');
  await page.waitForSelector('.ep-t[href="#/ep/999001/1/1"]');
  await page.click('.ep-t[href="#/ep/999001/1/1"]');
  await page.waitForSelector('.epd-head');
  await page.waitForTimeout(600);
  check('serie nuova: nome della serie in testa', (await text('.epd-show')) === 'Serie 999001');
  await page.click('[data-act=ep-check]');
  await page.waitForTimeout(2600);
  const nuova = remote()['tv:999001'];
  check('segnato dalla scheda episodio: serie aggiunta col suo titolo', nuova && nuova.title === 'Serie 999001' && '1' in nuova.eps['1']);

  console.log('commit:', M.log.puts.filter((p) => p.path === 'library.json' && !p.conflict).map((p) => p.message).join(' | '));
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
