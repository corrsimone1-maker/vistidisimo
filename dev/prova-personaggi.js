// Prova della Collezione per «stessi personaggi» (4/11/2026), con TMDB finto (cast con i nomi dei personaggi):
// - Berlino ↔ La casa di carta ↔ Berlino e la dama con l'ermellino (Pedro Alonso è Berlino in tutte e tre);
// - Vis a vis ↔ El oasis (Najwa Nimri è Zulema, Alba Flores è Saray), ma Vis a vis NON va con La casa di carta
//   (stesse attrici, personaggi diversi: Alicia Sierra, Nairobi);
// - niente comparsate di un episodio, niente talk show, niente altri ruoli dello stesso attore (Gran Hotel);
// - anime: Naruto Shippuden → Naruto, Boruto e i film (Naruto Uzumaki), non Hunter × Hunter (Gon);
// - confronto dei nomi dei personaggi (sameCharacter) su casi veri; seconda apertura dalla memoria del telefono.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

// aggregate_credits delle serie: [idAttore, personaggio, episodi]
const SHOWS = {
  71446: [[1, 'Silene Oliveira / Tokyo', 41], [2, 'Sergio Marquina / El Profesor', 41], [3, 'Raquel Murillo / Lisboa', 41], [7, 'Aníbal Cortés / Río', 41], [8, 'Mirko Dragić / Helsinki', 41], [5, 'Ágata Jiménez / Nairobi', 32], [4, 'Andrés de Fonollosa / Berlín', 31], [6, 'Alicia Sierra', 16], [10, 'Self', 2]],
  146176: [[4, "Andrés de Fonollosa 'Berlín'", 8], [9, 'Keila', 8], [21, 'Damián', 8]],
  308014: [[4, 'Berlín', 8], [9, 'Keila', 8]],
  62455: [[30, 'Macarena Ferreiro', 40], [6, 'Zulema Zahir', 40], [5, 'Saray Vargas', 40]],
  97951: [[6, 'Zulema Zahir', 8], [5, 'Saray Vargas', 8]],
  31910: [[50, 'Naruto Uzumaki (voice)', 500], [51, 'Sakura Haruno (voice)', 480], [52, 'Sasuke Uchiha (voice)', 300]],
};
const T = (type, id, title, d, extra = {}) => ({ media_type: type, id, [type === 'tv' ? 'name' : 'title']: title, [type === 'tv' ? 'first_air_date' : 'release_date']: d, poster_path: `/p_${type}_${id}.jpg`, genre_ids: [18], original_language: 'es', popularity: 20, vote_count: 100, ...extra });
const NAMES = {
  'tv:71446': T('tv', 71446, 'La casa di carta', '2017-05-02'), 'tv:146176': T('tv', 146176, 'Berlino e i gioielli di Parigi', '2023-12-29'),
  'tv:308014': T('tv', 308014, "Berlino e la Dama con l'ermellino", '2026-05-15'), 'tv:62455': T('tv', 62455, 'Vis a vis - Il prezzo del riscatto', '2015-04-20'),
  'tv:97951': T('tv', 97951, "Vis a vis: L'oasi", '2020-04-20'), 'tv:999100': T('tv', 999100, 'Gran Hotel', '2011-10-04'),
  'tv:999101': T('tv', 999101, 'Un talk show', '2019-01-01', { genre_ids: [10767] }), 'tv:999103': T('tv', 999103, 'Una serie con una comparsata', '2020-01-01'),
  'tv:46260': T('tv', 46260, 'Naruto', '2002-10-03', { genre_ids: [16], original_language: 'ja' }), 'tv:31910': T('tv', 31910, 'Naruto Shippuden', '2007-02-15', { genre_ids: [16], original_language: 'ja' }),
  'tv:70881': T('tv', 70881, 'Boruto: Naruto Next Generations', '2017-04-05', { genre_ids: [16], original_language: 'ja' }),
  'movie:16907': T('movie', 16907, 'Naruto il film: La primavera nel paese della neve', '2004-08-21', { genre_ids: [16], original_language: 'ja' }),
  'movie:317442': T('movie', 317442, 'The Last: Naruto the Movie', '2014-12-06', { genre_ids: [16], original_language: 'ja' }),
  'tv:999300': T('tv', 999300, 'Hunter × Hunter (1999)', '1999-10-16', { genre_ids: [16], original_language: 'ja' }),
};
// ruoli degli attori (combined_credits): [chiave, personaggio, episodi]
const PEOPLE = {
  1: [['tv:71446', 'Silene Oliveira / Tokyo', 41], ['tv:999103', 'Tokyo', 1]],
  4: [['tv:71446', 'Andrés de Fonollosa / Berlín', 31], ['tv:146176', "Andrés de Fonollosa 'Berlín'", 8], ['tv:308014', 'Berlín', 8], ['tv:999100', 'Diego Murquía', 30], ['tv:999101', 'Self', 1]],
  5: [['tv:71446', 'Ágata Jiménez / Nairobi', 32], ['tv:62455', 'Saray Vargas', 40], ['tv:97951', 'Saray Vargas', 8]],
  6: [['tv:71446', 'Alicia Sierra', 16], ['tv:62455', 'Zulema Zahir', 40], ['tv:97951', 'Zulema Zahir', 8]],
  9: [['tv:146176', 'Keila', 8], ['tv:308014', 'Keila', 8]],
  50: [['tv:46260', 'Naruto Uzumaki (voice)', 220], ['tv:31910', 'Naruto Uzumaki (voice)', 500], ['tv:70881', 'Naruto Uzumaki (voice)', 150], ['movie:16907', 'Naruto Uzumaki (voice)'], ['movie:317442', 'Naruto Uzumaki (voice)'], ['tv:999300', 'Gon Freecss (voice)', 62]],
  51: [['tv:46260', 'Sakura Haruno (voice)', 200], ['movie:317442', 'Sakura Haruno (voice)']],
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8155', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8155/vistidisimo/';
  const M = makeMocks(path.join(DATA, 'library.json'), { animeKeys: new Set(['tv:31910', 'tv:46260', 'tv:70881']) });
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  const log = { agg: 0, person: 0 };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://query.wikidata.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/sparql-results+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ head: { vars: ['tv', 'mv'] }, results: { bindings: [] } }) }));
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    let m;
    if (p === '/search/multi') return ok(route, { results: [] });
    if ((m = p.match(/^\/tv\/(\d+)\/aggregate_credits$/))) {
      log.agg++;
      return ok(route, { id: Number(m[1]), cast: (SHOWS[m[1]] || []).map(([id, ch, n], i) => ({ id, name: `Attore ${id}`, roles: [{ character: ch, episode_count: n }], total_episode_count: n, order: i })) });
    }
    if ((m = p.match(/^\/person\/(\d+)\/combined_credits$/))) {
      log.person++;
      return ok(route, { id: Number(m[1]), cast: (PEOPLE[m[1]] || []).map(([k, ch, n]) => ({ ...NAMES[k], character: ch, ...(n != null ? { episode_count: n } : {}) })) });
    }
    if ((m = p.match(/^\/(tv|movie)\/(\d+)$/)) && NAMES[`${m[1]}:${m[2]}`] && !M.lib.items[`${m[1]}:${m[2]}`]) {
      const r = NAMES[`${m[1]}:${m[2]}`];
      return ok(route, { ...r, genres: r.genre_ids.map((id) => ({ id, name: 'x' })) });
    }
    return M.tmdb(route);
  });
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const rowKeys = () => page.$$eval('.d-fr a.pc', (as) => as.map((a) => a.dataset.key));
  const col = async (hash, min) => {
    await page.goto(base + hash);
    await page.waitForSelector('.d-head', { timeout: 15000 });
    await page.waitForFunction((n) => document.querySelectorAll('.d-fr a.pc').length >= n, min, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    return rowKeys();
  };

  await page.goto(base + '#/home');
  await page.waitForSelector('#view .pc', { timeout: 15000 });

  // ---- confronto dei nomi dei personaggi ----
  const pairs = await page.evaluate(async () => {
    const C = await import('./js/collection.js');
    const t = [
      ['Andrés de Fonollosa / Berlín', "Andrés de Fonollosa 'Berlín'", true], ['Berlín', 'Andrés de Fonollosa / Berlín', true],
      ['Jimmy McGill / Saul Goodman', 'Saul Goodman', true], ['Naruto Uzumaki (voice)', 'Naruto Uzumaki', true], ['Mike Ehrmantraut', 'Mike Ehrmantraut', true],
      ['Saray Vargas', 'Ágata Jiménez / Nairobi', false], ['Zulema Zahir', 'Alicia Sierra', false], ['Michael', 'Michael', false],
      ['Michael Scott', 'Michael Weston', false], ['Self', 'Self', false], ['Young Mike', 'Mike', false], ['Narrator (voice)', 'Narrator', false],
      ['Walter White', 'Skyler White', false], ['Tokyo', 'Silene Oliveira / Tokyo', true],
    ];
    return t.map(([a, b, want]) => [a, b, want, C.sameCharacter(a, b)]);
  });
  for (const [a, b, want, got] of pairs) check(`«${a}» e «${b}»: ${got ? 'stesso personaggio' : 'diversi'}`, got === want);

  // ---- La casa di carta, Berlino, la Dama ----
  let k = await col('#/t/tv/146176', 3);
  check(`Berlino: ${k.join(', ')}`, k.includes('tv:71446') && k.includes('tv:308014') && !k.includes('tv:62455') && !k.includes('tv:999100'));
  k = await col('#/t/tv/71446', 3);
  check(`La casa di carta: ${k.join(', ')}`, k.includes('tv:146176') && k.includes('tv:308014') && !k.includes('tv:62455') && !k.includes('tv:97951'));
  check('niente comparsate di un episodio né talk show', !k.includes('tv:999103') && !k.includes('tv:999101'));
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'pg-1-casa-di-carta.png') });
  k = await col('#/t/tv/62455', 2);
  check(`Vis a vis: ${k.join(', ')} (El oasis sì, La casa di carta no)`, k.includes('tv:97951') && !k.includes('tv:71446'));
  k = await col('#/t/tv/308014', 3);
  check(`la Dama: ${k.join(', ')}`, k.includes('tv:146176') && k.includes('tv:71446'));

  // ---- anime ----
  k = await col('#/t/tv/31910', 5);
  check(`Naruto Shippuden: ${k.join(', ')}`, ['tv:46260', 'tv:70881', 'movie:16907', 'movie:317442'].every((x) => k.includes(x)) && !k.includes('tv:999300'));
  const titles = await page.$$eval('.d-fr .pc-title', (els) => els.map((e) => e.textContent));
  console.log('    ', titles.join(' | '));
  check('titoli dei film non in libreria presi dai ruoli (senza altre richieste)', titles.includes('The Last: Naruto the Movie'));
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'pg-2-naruto.png') });

  // ---- seconda apertura: dalla memoria del telefono ----
  const before = { ...log };
  await page.reload();
  await page.waitForSelector('#view');
  k = await col('#/t/tv/146176', 3);
  check(`riaperta: nessuna richiesta di cast (${log.agg - before.agg} + ${log.person - before.person})`, log.agg === before.agg && log.person === before.person && k.includes('tv:71446'));
  check('niente esce dallo schermo', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  console.log(errors.length ? `\n${errors.length} problemi:\n` + errors.join('\n') : '\ntutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
