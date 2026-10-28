// Prova degli export per altre app (Letterboxd e Simkl) con i dati veri, e di altri controlli:
// stati riallineati, scroll che torna solo andando indietro.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8137', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(path.join(DATA, 'library.json'));
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8');
  M.shas['meta.json'] = 'meta0';
  const lib = JSON.parse(M.files['library.json']).items;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8137/vistidisimo/';
  const grab = async (click) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), click()]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
  };
  // CSV semplice: virgolette doppie ("") o con barra (\") come in Letterboxd
  const parse = (text) => text.trim().split('\n').map((line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  });

  await page.goto(base + '#/impostazioni');
  await page.waitForSelector('[data-act=set-lb]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'x01-impostazioni.png'), fullPage: true });

  // 1. Letterboxd, film visti
  const lb = await grab(() => page.click('[data-act=set-lb][data-v=visti]'));
  const lbRows = parse(lb.text);
  const films = Object.values(lib).filter((it) => it.type === 'movie' && it.status === 'completed');
  console.log('   ', lb.name, lbRows.length - 1, 'righe |', lbRows[0].join(','), '|', lbRows[1].join(' | '));
  check('Letterboxd: intestazione giusta', lbRows[0].join(',') === 'tmdbID,imdbID,Title,Year,WatchedDate,Rating10,Rewatch');
  check(`Letterboxd: un film visto per riga (${films.length})`, lbRows.length - 1 === films.length);
  check('Letterboxd: tmdbID numerici, date YYYY-MM-DD, voti interi 1–10', lbRows.slice(1).every((r) => /^\d+$/.test(r[0]) && /^\d{4}-\d{2}-\d{2}$/.test(r[4]) && (r[5] === '' || (/^\d+$/.test(r[5]) && +r[5] >= 1 && +r[5] <= 10))));
  check('Letterboxd: niente BOM e meno di 1 MB', !lb.text.startsWith('﻿') && Buffer.byteLength(lb.text) < 1e6);
  const howl = lbRows.find((r) => r[0] === '4935');
  check(`Letterboxd: voto di Howl ${lib['movie:4935'].rating} → ${howl?.[5]}`, howl && (lib['movie:4935'].rating == null ? howl[5] === '' : +howl[5] === Math.round(lib['movie:4935'].rating)));
  // 2. Letterboxd, da vedere
  const lw = await grab(() => page.click('[data-act=set-lb][data-v=da-vedere]'));
  const lwRows = parse(lw.text);
  check(`Letterboxd da vedere: ${lwRows.length - 1} film`, lwRows[0].join(',') === 'tmdbID,imdbID,Title,Year' && lwRows.length - 1 === Object.values(lib).filter((it) => it.type === 'movie' && it.status === 'planned').length);

  // 3. Simkl: prima chiede gli id TVDB a TMDB, poi «Scarica» dall'avviso
  await page.click('[data-act=set-simkl]');
  await page.waitForTimeout(300);
  console.log('    bottone mentre prepara:', await page.$eval('[data-act=set-simkl]', (e) => e.textContent.trim()));
  await page.waitForSelector('.toast button', { timeout: 60000 });
  const sk = await grab(() => page.click('.toast button'));
  const skRows = parse(sk.text);
  const head = skRows[0];
  const col = (r, n) => r[head.indexOf(n)];
  console.log('   ', sk.name, skRows.length - 1, 'righe |', skRows.slice(1, 3).map((r) => r.join(',')).join(' || '));
  check('Simkl: intestazione', head.join(',') === 'simkl_id,TVDB_ID,TMDB,IMDB_ID,MAL_ID,Type,Title,Year,LastEpWatched,Watchlist,WatchedDate,Rating,Memo');
  check(`Simkl: un titolo per riga (${Object.keys(lib).length})`, skRows.length - 1 === Object.keys(lib).length);
  const tvRows = skRows.slice(1).filter((r) => col(r, 'Type') !== 'movie');
  check('Simkl: serie con id TVDB (tranne quelle che TMDB non ha)', tvRows.filter((r) => !col(r, 'TVDB_ID')).length === (lib['tv:1399'] ? 1 : 0));
  check('Simkl: ultimo episodio come s2e4 per le serie iniziate', tvRows.filter((r) => col(r, 'LastEpWatched')).every((r) => /^s\d+e\d+$/.test(col(r, 'LastEpWatched'))));
  check('Simkl: stati validi', skRows.slice(1).every((r) => ['completed', 'watching', 'plantowatch', 'dropped'].includes(col(r, 'Watchlist'))));
  check('Simkl: tipi validi (movie, tv, anime)', skRows.slice(1).every((r) => ['movie', 'tv', 'anime'].includes(col(r, 'Type'))));
  const bc = skRows.find((r) => col(r, 'TMDB') === '73223');
  console.log('    Black Clover:', bc.join(','));
  // la seconda volta gli id ci sono già: scarica subito, senza avviso
  const sk2 = await grab(() => page.click('[data-act=set-simkl]'));
  check('Simkl la seconda volta: subito, stesso file', sk2.text === sk.text);
  await page.waitForTimeout(9000); // meta.json salvato su GitHub con gli id
  const savedMeta = JSON.parse(M.files['meta.json']).items;
  check('id TVDB salvati in meta.json', !!savedMeta['tv:73223']?.tvdb);

  // 4. scroll: tornando indietro si ritrova, riaprendo andando avanti no
  await page.goto(base + '#/libreria');
  await page.waitForSelector('#lib-grid .pc');
  await page.click('#lib-grid a[href="#/t/tv/73223"]').catch(async () => { await page.goto(base + '#/t/tv/73223'); });
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(600);
  await page.click('[data-act=d-season][data-s="1"]');
  await page.waitForSelector('.eps .ep-t');
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(200);
  const y0 = await page.evaluate(() => window.scrollY);
  // il tocco senza far scorrere la pagina (l'episodio 20 è già sullo schermo)
  await page.evaluate(() => document.querySelector('.eps .ep-t[href="#/ep/73223/1/20"]').click());
  await page.waitForSelector('.epd-head');
  await page.click('.hero-bar [data-act=back]');
  await page.waitForSelector('.season.open');
  await page.waitForTimeout(400);
  const y1 = await page.evaluate(() => window.scrollY);
  check(`indietro dall'episodio: scroll ritrovato (${y0} → ${y1})`, y0 > 1000 && Math.abs(y1 - y0) < 40);
  // Home e poi la stessa serie toccando la sua locandina: è andare avanti, quindi dall'alto
  await page.click('#tabs a[data-tab=home]');
  await page.waitForSelector('.wordmark');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('a.pc[href="#/t/tv/73223"]').click());
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(400);
  const y2 = await page.evaluate(() => window.scrollY);
  check(`riaperta andando avanti: parte dall'alto (${y2})`, y2 === 0);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(150);
  await page.goBack();
  await page.waitForSelector('.wordmark');
  await page.goForward();
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(400);
  const y3 = await page.evaluate(() => window.scrollY);
  check(`«avanti» della cronologia ritrova lo scroll (${y3})`, Math.abs(y3 - 900) < 40);

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
