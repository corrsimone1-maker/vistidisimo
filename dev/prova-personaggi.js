// Prova della Collezione per «stessi personaggi» (4/11/2026), con TMDB finto (cast con i nomi dei personaggi):
// - Berlino ↔ La casa di carta ↔ Berlino e la dama con l'ermellino (Pedro Alonso è Berlino in tutte e tre);
// - Vis a vis ↔ El oasis (Najwa Nimri è Zulema, Alba Flores è Saray), ma Vis a vis NON va con La casa di carta
//   (stesse attrici, personaggi diversi: Alicia Sierra, Nairobi);
// - niente comparsate di un episodio, niente talk show, niente altri ruoli dello stesso attore (Gran Hotel);
// - anime: Naruto Shippuden → Naruto, Boruto e i film (Naruto Uzumaki), non Hunter × Hunter (Gon);
// - confronto dei nomi dei personaggi (sameCharacter) su casi veri; seconda apertura dalla memoria del telefono.
// Regole più strette (4/11/2026, Simo: «in jujutsu kaisen c'è una roba di un duca che non c'entra niente, e in
// tokyo ghoul ci sono due film non anime»):
// - Jujutsu Kaisen: non entra «Il duca della morte» (un doppiatore con un nome solo uguale, «Panda», e un altro
//   con «Narration» fatto di passaggio), né un anime che Wikidata dà come seguito (fascia oraria) senza nessuna
//   conferma; entra un seguito di Wikidata confermato da un personaggio, entra Jujutsu Kaisen 0 (Satoru Gojo) con
//   la sua saga;
// - Tokyo Ghoul: niente film dal vero (né dal nome, né da Wikidata, né dalla loro saga); Jack sì, e Pinto (in
//   libreria ma con pochi voti e senza ancora i dati di TMDB) sì;
// - il film dal vero vede la sua saga ma non l'anime; vecchie copie sul telefono con le regole larghe non
//   mostrano più niente di non confermato.
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
  // come su TMDB, Pedro Alonso (Berlino) ha meno episodi di una decina di altri attori: deve entrare lo stesso
  71446: [[1, 'Silene Oliveira / Tokyo', 41], [2, 'Sergio Marquina / El Profesor', 41], [3, 'Raquel Murillo / Lisboa', 41], [7, 'Aníbal Cortés / Río', 41], [8, 'Mirko Dragić / Helsinki', 41], [11, 'Daniel Ramos / Denver', 41], [12, 'Mónica Gaztambide / Estocolmo', 41], [13, 'Arturo Román', 38], [14, 'Ángel Rubio', 30], [15, 'Luis Tamayo', 34], [5, 'Ágata Jiménez / Nairobi', 32], [4, 'Andrés de Fonollosa / Berlín', 31], [6, 'Alicia Sierra', 16], [16, 'Guardia', 3], [10, 'Self', 2]],
  146176: [[4, "Andrés de Fonollosa 'Berlín'", 8], [9, 'Keila', 8], [21, 'Damián', 8]],
  308014: [[4, 'Berlín', 8], [9, 'Keila', 8]],
  62455: [[30, 'Macarena Ferreiro', 40], [6, 'Zulema Zahir', 40], [5, 'Saray Vargas', 40]],
  97951: [[6, 'Zulema Zahir', 8], [5, 'Saray Vargas', 8]],
  31910: [[50, 'Naruto Uzumaki (voice)', 500], [51, 'Sakura Haruno (voice)', 480], [52, 'Sasuke Uchiha (voice)', 300]],
  // Jujutsu Kaisen: Uchida ha anche «Narration» in pochi episodi (ruolo di passaggio)
  95479: [[60, 'Yuji Itadori (voice)', 59], [61, [['Megumi Fushiguro (voice)', 59], ['Narration', 6]], 59], [62, 'Nobara Kugisaki (voice)', 40], [63, 'Satoru Gojo (voice)', 50], [64, 'Panda (voice)', 30]],
  61374: [[70, 'Ken Kaneki (voice)', 48], [71, 'Touka Kirishima (voice)', 48], [72, 'Shuu Tsukiyama (voice)', 30]],
  1396: [[81, 'Walter White', 62], [80, 'Jesse Pinkman', 62]],
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
  'tv:117992': T('tv', 117992, 'The Duke of Death and His Maid', '2021-07-04', { genre_ids: [16, 35], original_language: 'ja', origin_country: ['JP'] }),
  'tv:999401': T('tv', 999401, 'Anime della stessa fascia oraria', '2021-04-02', { genre_ids: [16], original_language: 'ja', origin_country: ['JP'] }),
  'tv:999402': T('tv', 999402, 'Jujutsu Kaisen: seguito confermato', '2027-01-01', { genre_ids: [16], original_language: 'ja', origin_country: ['JP'] }),
  'movie:559969': T('movie', 559969, 'El Camino - Il film di Breaking Bad', '2019-10-11', { original_language: 'en' }),
  'movie:810693': T('movie', 810693, 'Jujutsu Kaisen 0 - Il film', '2021-12-24', { genre_ids: [16, 28, 14], original_language: 'ja' }),
  'movie:99000003': T('movie', 99000003, 'Girls und Panzer: un film', '2023-01-01', { genre_ids: [16], original_language: 'ja' }),
  'movie:1000002': T('movie', 1000002, 'Jujutsu Kaisen: Hidden Inventory', '2025-05-30', { genre_ids: [16, 28], original_language: 'ja' }),
  'tv:999403': T('tv', 999403, 'Una serie spagnola con Gojo', '2022-01-01', { genre_ids: [18], original_language: 'es' }),
  'movie:99433422': T('movie', 99433422, 'Tokyo ghoul - Il film', '2017-07-29', { genre_ids: [27, 28], original_language: 'ja', original_title: '東京喰種 トーキョーグール', belongs_to_collection: { id: 1000001, name: 'Tokyo Ghoul (live action) - Collezione' } }),
  'movie:99572154': T('movie', 99572154, "Tokyo Ghoul 'S'", '2019-07-19', { genre_ids: [27, 28], original_language: 'ja', belongs_to_collection: { id: 1000001, name: 'Tokyo Ghoul (live action) - Collezione' } }),
  'movie:483685': T('movie', 483685, 'Tokyo Ghoul: Jack', '2015-09-05', { genre_ids: [16, 27], original_language: 'ja' }),
  'movie:483686': T('movie', 483686, 'Tokyo Ghoul: Pinto', '2015-09-05', { genre_ids: [16], original_language: 'ja', vote_count: 3 }),
  'tv:60059': T('tv', 60059, 'Better Call Saul', '2015-02-08', { original_language: 'en' }),
  'tv:72812': T('tv', 72812, 'Metástasis', '2014-06-01', { original_language: 'es' }),
  'movie:99000001': T('movie', 99000001, 'Tokyo Ghoul: una parodia per adulti', '2016-01-01', { genre_ids: [16], original_language: 'ja', adult: true }),
  'movie:99000002': T('movie', 99000002, 'Breaking Bad XXX: A Porn Parody', '2013-01-01', { original_language: 'en', adult: true }),
  'tv:61374': T('tv', 61374, 'Tokyo Ghoul', '2014-07-04', { genre_ids: [16, 18], original_language: 'ja', origin_country: ['JP'] }),
};
// Wikidata finto: id TMDB -> [[chiave, w]] (0 spin-off, 2 famiglia, 1 seguito)
const WD = {
  95479: [['tv:999401', 1], ['tv:999402', 1]],
  61374: [['movie:99572154', 2], ['movie:483685', 2], ['movie:99433422', 2], ['movie:99000001', 2]],
  99433422: [['tv:61374', 2], ['movie:99572154', 2]],
  // Breaking Bad: Better Call Saul (spin-off) sì; El Camino (famiglia) sì perché confermato da un personaggio;
  // il rifacimento colombiano e una parodia (famiglia, senza conferma) no
  1396: [['tv:60059', 0], ['movie:559969', 2], ['tv:72812', 2], ['movie:99000002', 2]],
};
// saghe di TMDB
const SAGAS = {
  1529614: { name: 'Jujutsu Kaisen - Collezione', films: ['movie:810693', 'movie:1000002'] },
  1000001: { name: 'Tokyo Ghoul (live action) - Collezione', films: ['movie:99433422', 'movie:99572154'] },
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
  // Jujutsu Kaisen
  61: [['tv:95479', 'Megumi Fushiguro (voice)', 59], ['tv:117992', 'Walter (voice)', 36], ['tv:999401', 'Narration', 12]],
  63: [['tv:95479', 'Satoru Gojo (voice)', 50], ['movie:810693', 'Satoru Gojo (voice)'], ['tv:999403', 'Satoru Gojo', 8]],
  64: [['tv:95479', 'Panda (voice)', 30], ['tv:117992', 'Panda', 12], ['tv:999402', 'Panda (voice)', 12], ['movie:810693', 'Panda (voice)']],
  // un ruolo sbagliato su TMDB (come Asami Seto «Nobara Kugisaki» in Girls und Panzer): un attore solo, non basta
  62: [['tv:95479', 'Nobara Kugisaki (voice)', 40], ['movie:99000003', 'Nobara Kugisaki (voice)']],
  // Tokyo Ghoul
  72: [['tv:61374', 'Shuu Tsukiyama (voice)', 30], ['movie:483686', 'Shuu Tsukiyama (voice)']],
  // Breaking Bad: Aaron Paul è Jesse Pinkman anche in El Camino
  80: [['tv:1396', 'Jesse Pinkman', 62], ['movie:559969', 'Jesse Pinkman']],
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8155', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8155/vistidisimo/';
  const M = makeMocks(path.join(DATA, 'library.json'), { animeKeys: new Set(['tv:31910', 'tv:46260', 'tv:70881', 'tv:95479', 'movie:810693', 'tv:61374', 'movie:483685', 'movie:483686']) });
  M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'); M.shas['meta.json'] = 'meta0';
  const log = { agg: 0, person: 0 };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.route('https://query.wikidata.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('query') || '';
    const id = (q.match(/wdt:P(?:4983|4947) "(\d+)"/) || [])[1];
    const bindings = (WD[id] || []).map(([k, w]) => ({ [k.startsWith('tv:') ? 'tv' : 'mv']: { value: k.split(':')[1] }, w: { value: String(w) } }));
    return route.fulfill({ status: 200, contentType: 'application/sparql-results+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ head: { vars: ['tv', 'mv', 'w'] }, results: { bindings } }) });
  });
  await ctx.route('https://api.themoviedb.org/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/3/, '');
    let m;
    if (p === '/search/multi' && /tokyo ghoul/i.test(u.searchParams.get('query') || '')) {
      return ok(route, { results: ['movie:99433422', 'movie:483685', 'movie:483686', 'tv:61374'].map((k) => NAMES[k]) });
    }
    if (p === '/search/multi') return ok(route, { results: [] });
    if ((m = p.match(/^\/tv\/(\d+)\/aggregate_credits$/))) {
      log.agg++;
      return ok(route, { id: Number(m[1]), cast: (SHOWS[m[1]] || []).map(([id, ch, n], i) => ({ id, name: `Attore ${id}`, roles: Array.isArray(ch) ? ch.map(([c, e]) => ({ character: c, episode_count: e })) : [{ character: ch, episode_count: n }], total_episode_count: n, order: i })) });
    }
    if ((m = p.match(/^\/person\/(\d+)\/combined_credits$/))) {
      log.person++;
      return ok(route, { id: Number(m[1]), cast: (PEOPLE[m[1]] || []).map(([k, ch, n]) => ({ ...NAMES[k], character: ch, ...(n != null ? { episode_count: n } : {}) })) });
    }
    if ((m = p.match(/^\/collection\/(\d+)$/)) && SAGAS[m[1]]) {
      const sg = SAGAS[m[1]];
      return ok(route, { id: Number(m[1]), name: sg.name, poster_path: null, parts: sg.films.map((k) => { const r = NAMES[k] || { id: Number(k.split(':')[1]), title: M.lib.items[k]?.title, release_date: '2021-12-24', genre_ids: [16], original_language: 'ja' }; return { ...r, poster_path: r.poster_path || `/p_${k}.jpg` }; }) });
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
      ['Walter', 'Megumi Fushiguro', false], ['Narration', 'Narration', false], ['Male Student', 'Male Villager', false],
    ];
    const out = t.map(([a, b, want]) => [a, b, want, C.sameCharacter(a, b)]);
    // quanto: level 2 nome e cognome, 1 un nome solo, 0 no; title: il nome sta nei titoli dati
    const lv = [
      ['Panda (voice)', 'Panda', [], '1'], ['Rob', 'Rob', [], '1'], ['Tokyo', 'Silene Oliveira / Tokyo', [], '1'],
      ['Berlín', 'Andrés de Fonollosa / Berlín', ['Berlín'], '1t'], ['Berlín', 'Andrés de Fonollosa / Berlín', ['Berlino e la Dama con l\'ermellino'], '1t'],
      ['Satoru Gojo (voice)', 'Satoru Gojo', [], '2'], ['Satoru Gojo (voice)', 'Satoru Gojo', ['Jujutsu Kaisen 0'], '2'],
      ['Jimmy McGill / Saul Goodman', 'Saul Goodman', ['Better Call Saul'], '2t'], ['Nobara Kugisaki', 'Nobara Kugisaki', ['Girls und Panzer'], '2'],
      ['Megumi Fushiguro / Narration', 'Narration', [], '0'],
    ];
    for (const [a, b, ts, want] of lv) { const m = C.compareChars(a, b, C.titleWords(...ts)); out.push([`${a}» ~ «${b}`, ts.join(', ') || '—', want, `${m.level}${m.title ? 't' : ''}`]); }
    return out;
  });
  for (const [a, b, want, got] of pairs) check(`«${a}» e «${b}»: ${got === true ? 'stesso personaggio' : got === false ? 'diversi' : got}`, got === want);

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

  // ---- Jujutsu Kaisen: niente «Il duca della morte» ----
  k = await col('#/t/tv/95479', 3);
  await page.waitForTimeout(800);
  k = await rowKeys();
  console.log('     Jujutsu Kaisen:', k.join(', '));
  check('Jujutsu Kaisen: niente «Il duca della morte» (un solo doppiatore con un nome solo uguale, «Narration» di passaggio)', !k.includes('tv:117992'));
  check('Jujutsu Kaisen: niente seguito di Wikidata senza conferma (fascia oraria)', !k.includes('tv:999401'));
  check('Jujutsu Kaisen: seguito di Wikidata confermato da un personaggio', k.includes('tv:999402'));
  check('Jujutsu Kaisen: il film 0 (Satoru Gojo) e la sua saga', k.includes('movie:810693') && k.includes('movie:1000002'));
  check('Jujutsu Kaisen: niente serie in un\'altra lingua con lo stesso personaggio', !k.includes('tv:999403'));
  check('Jujutsu Kaisen: niente titolo con un ruolo sbagliato di un attore solo (Girls und Panzer)', !k.includes('movie:99000003'));
  const jjk = await page.evaluate(() => JSON.parse(localStorage.getItem('vds.col.cast'))['tv:95479']);
  check(`il duca resta tra i collegamenti deboli (k ${jjk.k.join(', ')} · w ${jjk.w.join(', ')})`, jjk.v === 2 && jjk.w.includes('tv:117992') && !jjk.k.includes('tv:117992'));
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'pg-3-jujutsu.png') });

  // ---- Tokyo Ghoul: niente film dal vero ----
  k = await col('#/t/tv/61374', 3);
  await page.waitForTimeout(1200);
  k = await rowKeys();
  console.log('     Tokyo Ghoul:', k.join(', '));
  check('Tokyo Ghoul: niente film dal vero (dal nome, da Wikidata, dalla loro saga)', !k.includes('movie:99433422') && !k.includes('movie:99572154'));
  check('Tokyo Ghoul: Jack e Pinto (Pinto in libreria, pochi voti, senza dati di TMDB)', k.includes('movie:483685') && k.includes('movie:483686'));
  check('Tokyo Ghoul: niente film per adulti', !k.includes('movie:99000001'));
  await page.$eval('.d-fr', (e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'pg-4-tokyo-ghoul.png') });
  k = await col('#/t/movie/99433422', 2);
  await page.waitForTimeout(1200);
  k = await rowKeys();
  console.log('     Tokyo Ghoul dal vero:', k.join(', '));
  check('il film dal vero: la sua saga sì, l\'anime no', k.includes('movie:99572154') && !k.includes('tv:61374') && !k.includes('movie:483685'));

  // ---- Breaking Bad: il rifacimento in un'altra lingua no ----
  k = await col('#/t/tv/1396', 3);
  await page.waitForTimeout(800);
  k = await rowKeys();
  check(`Breaking Bad: Better Call Saul ed El Camino, non Metástasis né la parodia (${k.join(', ')})`, k.includes('tv:60059') && k.includes('movie:559969') && !k.includes('tv:72812') && !k.includes('movie:99000002'));

  // ---- seconda apertura: dalla memoria del telefono ----
  const before = { ...log };
  await page.reload();
  await page.waitForSelector('#view');
  k = await col('#/t/tv/146176', 3);
  check(`riaperta: nessuna richiesta di cast (${log.agg - before.agg} + ${log.person - before.person})`, log.agg === before.agg && log.person === before.person && k.includes('tv:71446'));
  check('niente esce dallo schermo', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // ---- vecchie copie sul telefono (regole larghe): il non confermato sparisce subito ----
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('vds.col.cast') || '{}');
    c['tv:95479'] = { k: ['tv:117992', 'movie:810693'], at: Date.now() };
    localStorage.setItem('vds.col.cast', JSON.stringify(c));
    const w = JSON.parse(localStorage.getItem('vds.wd') || '{}');
    w['tv:95479'] = { k: ['tv:117992', 'tv:999401'], at: Date.now() };
    localStorage.setItem('vds.wd', JSON.stringify(w));
  });
  // il TMDB finto risponde piano: si guarda la riga prima che arrivino le fonti nuove
  await ctx.route('https://api.themoviedb.org/3/tv/95479/aggregate_credits*', async (route) => { await new Promise((r) => setTimeout(r, 4000)); route.fallback(); });
  await page.reload();
  await page.waitForSelector('#view');
  await page.goto(base + '#/t/tv/95479');
  await page.waitForSelector('.d-head', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.d-fr a.pc').length >= 2, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  k = await rowKeys();
  check(`copia vecchia: niente duca né fascia oraria mentre si rifà (${k.join(', ')})`, !k.includes('tv:117992') && !k.includes('tv:999401'));
  await ctx.unroute('https://api.themoviedb.org/3/tv/95479/aggregate_credits*');


  console.log(errors.length ? `\n${errors.length} problemi:\n` + errors.join('\n') : '\ntutto a posto');
  await browser.close();
  srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
