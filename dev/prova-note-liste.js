// Prova (15/11/2026): immagini nella pagina di un film, filtri nel menu ⋯ delle liste (stessi della
// Libreria) e post-it giallo. Usa una libreria finta (non servono i dati veri).
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
const lib = {
  v: 1,
  items: {
    'movie:129': mk('movie', 129, 'La città incantata', 'completed', { seen: '2026-10-01' }),
    'movie:130': mk('movie', 130, 'Film da vedere', 'planned'),
    'tv:100': mk('tv', 100, 'Serie in corso', 'watching', { eps: { 1: { 1: '2026-10-01', 2: '2026-10-02' } } }),
    'tv:101': mk('tv', 101, 'Anime finito', 'completed', { eps: { 1: { 1: '2026-09-01', 2: '2026-09-02' } } }),
  },
  lists: [{ id: 'l1', title: 'Mista', added: NOW, items: [
    { key: 'movie:129', title: 'La città incantata', year: 2015 }, { key: 'movie:130', title: 'Film da vedere', year: 2015 },
    { key: 'tv:100', title: 'Serie in corso', year: 2015 }, { key: 'tv:101', title: 'Anime finito', year: 2015 },
  ] }],
};
const LIB = path.join(os.tmpdir(), 'vds-prova-note-liste.json');
fs.writeFileSync(LIB, JSON.stringify(lib));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8141', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB, { animeKeys: new Set(['tv:101']) });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8141' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const remote = (k) => JSON.parse(M.files['library.json']).items[k];
  const base = 'http://127.0.0.1:8141/vistidisimo/';
  const sheet = () => page.$('.sheet-wrap.in .sheet').then((x) => !!x);

  // ---------- immagini del film ----------
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  await page.waitForSelector('[data-act=mv-view]', { timeout: 8000 }).catch(() => {});
  const shots = await page.$$eval('[data-act=mv-view]', (e) => e.length);
  check('film: sezione «Immagini» con le foto', shots >= 3);
  check('film: titolo «Immagini» con il conteggio', /Immagini\s*\d+/.test(await page.$eval('.d-sec h2 .count', (e) => e.parentElement.textContent).catch(() => '')));
  await page.click('[data-act=mv-view] >> nth=1');
  await page.waitForSelector('.viewer.in');
  check('film: il visore si apre sulla foto toccata', (await page.$eval('.viewer-n', (e) => e.textContent.trim())) === '2 / ' + shots);
  await page.screenshot({ path: path.join(OUT, '60-film-visore.png') });
  await page.click('[data-viewer-close]');
  await page.waitForSelector('.viewer', { state: 'detached' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '61-film-immagini.png') });
  await page.goto(base + '#/t/tv/100');
  await page.waitForSelector('.d-head');
  await page.waitForTimeout(600);
  check('serie: nessuna sezione di foto del film', (await page.$$('[data-act=mv-view]')).length === 0);

  // ---------- filtri nelle liste ----------
  await page.goto(base + '#/lista/l1');
  await page.waitForSelector('.grid .pc');
  const cards = () => page.$$eval('.grid .pc .pc-title', (e) => e.map((x) => x.textContent.trim()));
  check('lista: 4 titoli e nessun filtro acceso', (await cards()).length === 4 && !(await page.$('.lf-dot')));
  check('lista: ⋯ in alto a destra', !!(await page.$('.page-top [data-act=list-filters]')));
  await page.screenshot({ path: path.join(OUT, '62-lista.png') });
  await page.click('[data-act=list-filters]');
  await page.waitForSelector('.lf-sheet');
  const chips = await page.$$eval('.lf-sheet .chip', (e) => e.map((x) => x.textContent.trim().replace(/\s+/g, ' ')));
  console.log('    chip:', chips.join(' | '));
  check('filtri: Tutto, Serie, Film, Anime e gli stati della Libreria', chips.length === 4 + 6 && chips.includes('Film 2') && chips.includes('Serie 1') && chips.includes('Anime 1'));
  await page.click('[data-lf-kind=film]');
  await page.waitForTimeout(300);
  check('filtri: solo film; il foglio resta aperto', JSON.stringify(await cards()) === JSON.stringify(['La città incantata', 'Film da vedere']) && (await sheet()));
  await page.click('[data-lf-status=completed]');
  await page.waitForTimeout(300);
  check('filtri: film + completati = 1', JSON.stringify(await cards()) === JSON.stringify(['La città incantata']));
  await page.screenshot({ path: path.join(OUT, '63-filtri.png') });
  await page.click('.lf-sheet [data-close]');
  await page.waitForSelector('.sheet-wrap', { state: 'detached' });
  check('filtri accesi: pallino sul ⋯ e «ne vedi 1»', !!(await page.$('.lf-dot')) && /ne vedi 1/.test(await page.$eval('.list-sub', (e) => e.textContent)));
  check('filtri: la percentuale resta quella di tutta la lista', (await page.$eval('.list-pct b', (e) => e.textContent)) !== '');
  await page.screenshot({ path: path.join(OUT, '64-lista-filtrata.png') });
  // ricordati dopo aver riaperto la pagina
  await page.goto(base + '#/home');
  await page.goto(base + '#/lista/l1');
  await page.waitForSelector('.grid .pc');
  check('filtri: restano dopo essere usciti e rientrati', (await cards()).length === 1 && !!(await page.$('.lf-dot')));
  // anime
  await page.click('[data-act=list-filters]');
  await page.click('[data-lf-status=all]');
  await page.click('[data-lf-kind=anime]');
  await page.waitForTimeout(300);
  // come in Libreria: da una scelta parziale il tipo toccato si aggiunge (film + anime)
  check('filtri: dopo «Film», «Anime» si aggiunge', (await cards()).length === 3);
  await page.click('[data-lf-kind=all]');
  await page.click('[data-lf-kind=anime]');
  await page.waitForTimeout(300);
  check('filtri: da «Tutto», «Anime» resta da solo', JSON.stringify(await cards()) === JSON.stringify(['Anime finito']));
  await page.click('[data-lf-kind=all]');
  await page.waitForTimeout(300);
  check('filtri: «Tutto» li riaccende tutti', (await cards()).length === 4);
  await page.click('.lf-sheet [data-close]');
  await page.waitForSelector('.sheet-wrap', { state: 'detached' });
  check('nessun filtro: pallino spento', !(await page.$('.lf-dot')));
  // nessun risultato
  await page.click('[data-act=list-filters]');
  await page.click('[data-lf-kind=serie]');
  await page.click('[data-lf-status=planned]');
  await page.waitForTimeout(300);
  check('filtri senza risultati: «Niente qui»', !!(await page.$('.empty')));
  check('esporta: senza titoli il tasto è spento', await page.$eval('[data-lf-copy]', (b) => b.disabled));
  await page.click('[data-lf-status=all]');
  await page.click('[data-lf-kind=all]');
  // ---------- esporta come testo ----------
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  check('esporta: il tasto dice quanti titoli copia', /Copia 4 titoli/.test(await page.$eval('[data-lf-copy]', (b) => b.textContent)));
  await page.screenshot({ path: path.join(OUT, '69-esporta.png') });
  await page.click('[data-lf-copy]');
  await page.waitForSelector('.toast.in');
  const all = (await clip()).split('\n');
  console.log('    appunti (tutti):', JSON.stringify(all));
  check('esporta: tutti i titoli, uno per riga, con l’anno', all.length === 4 && all.every((r) => /\(\d{4}\)$/.test(r)) && all.includes('La città incantata (2015)'));
  check('esporta: il foglio si chiude e l’avviso dice quanti', !(await sheet()) && /Copiati 4 titoli/.test(await page.$eval('.toast', (e) => e.textContent)));
  await page.click('[data-act=list-filters]');
  await page.click('[data-lf-kind=film]');
  await page.click('[data-lf-status=planned]');
  await page.waitForTimeout(200);
  check('esporta: il tasto segue i filtri («Copia 1 titolo»)', /Copia 1 titolo$/.test(await page.$eval('[data-lf-copy]', (b) => b.textContent.trim())));
  await page.click('[data-lf-copy]');
  await page.waitForTimeout(300);
  check('esporta: solo i film da guardare', (await clip()) === 'Film da vedere (2015)');
  await page.click('[data-act=list-filters]');
  await page.click('[data-lf-status=all]');
  await page.click('[data-lf-kind=anime]');
  await page.click('[data-lf-kind=all]');
  await page.click('[data-lf-kind=anime]');
  await page.click('[data-lf-copy]');
  await page.waitForTimeout(300);
  check('esporta: solo gli anime', (await clip()) === 'Anime finito (2015)');
  await page.click('[data-act=list-filters]');
  await page.click('[data-lf-kind=all]');
  await page.click('.lf-sheet [data-close]');
  await page.waitForSelector('.sheet-wrap', { state: 'detached' });

  // ---------- post-it ----------
  await page.goto(base + '#/t/movie/129');
  await page.waitForSelector('.d-head');
  const lastBefore = remote('movie:129').last;
  check('post-it: nessun cerchietto prima', !(await page.$('.note-chip')));
  await page.click('[data-act=d-more]');
  await page.waitForSelector('[data-note]');
  check('post-it: la voce è nel menu ⋯', /Lascia un post-it/.test(await page.$eval('[data-note]', (e) => e.textContent)));
  await page.click('[data-note]');
  await page.waitForSelector('.note-field');
  await page.fill('.note-field', 'Quello con la strega e il treno sul mare.\nChiedere a Marta.');
  await page.screenshot({ path: path.join(OUT, '65-nota-scrivi.png') });
  await page.click('[data-ok]');
  await page.waitForSelector('.note-chip');
  check('post-it: compare il cerchietto (!) accanto ai tasti dello stato', (await page.$eval('.note-chip', (e) => e.textContent.trim())) === '!' && !!(await page.$('.d-status-row .rw-chip + .note-chip')));
  await page.screenshot({ path: path.join(OUT, '66-nota-chip.png') });
  await page.waitForTimeout(2600);
  check('post-it: salvato su GitHub, senza toccare «last»', remote('movie:129').note === 'Quello con la strega e il treno sul mare.\nChiedere a Marta.' && remote('movie:129').last === lastBefore);
  await page.click('.note-chip');
  await page.waitForSelector('.note-sheet');
  check('post-it: toccando il cerchietto appare la nota', /treno sul mare/.test(await page.$eval('.note-text', (e) => e.textContent)));
  await page.screenshot({ path: path.join(OUT, '67-nota-aperta.png') });
  const bg = await page.$eval('.note-sheet', (e) => getComputedStyle(e).backgroundColor);
  check('post-it: foglio giallo', bg === 'rgb(247, 229, 138)');
  await page.click('.note-sheet [data-edit]');
  await page.waitForSelector('.note-field');
  check('post-it: «Modifica» riapre il testo', /Marta/.test(await page.$eval('.note-field', (e) => e.value)));
  await page.fill('.note-field', 'Solo questo.');
  await page.click('[data-ok]');
  await page.waitForTimeout(2600);
  check('post-it: modificato', remote('movie:129').note === 'Solo questo.');
  // sopravvive alla ricarica (viene da GitHub)
  await page.reload();
  await page.waitForSelector('.d-head');
  check('post-it: resta dopo la ricarica', !!(await page.$('.note-chip')));
  // toglierlo
  await page.click('[data-act=d-more]');
  check('post-it: nel menu ora dice «Modifica»', /Modifica il post-it/.test(await page.$eval('[data-note]', (e) => e.textContent)));
  await page.click('[data-note]');
  await page.waitForSelector('[data-clear]');
  await page.click('[data-clear]');
  await page.waitForTimeout(2600);
  check('post-it: tolto, il cerchietto sparisce', !(await page.$('.note-chip')) && !('note' in remote('movie:129')));
  // titolo non in libreria: niente voce nel menu
  await page.goto(base + '#/t/movie/999002');
  await page.waitForSelector('.d-head');
  await page.click('[data-act=d-more]');
  await page.waitForSelector('.sheet [data-close], .sheet a.btn');
  check('post-it: titolo non in libreria, niente voce', !(await page.$('[data-note]')));
  // una serie
  await page.goto(base + '#/t/tv/100');
  await page.waitForSelector('.d-head');
  await page.click('[data-act=d-more]');
  await page.click('[data-note]');
  await page.fill('.note-field', 'Ripartire dalla S1.');
  await page.click('[data-ok]');
  await page.waitForSelector('.note-chip');
  await page.screenshot({ path: path.join(OUT, '68-serie-nota.png') });
  check('post-it: vale anche per le serie', !!(await page.$('.note-chip')));

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
