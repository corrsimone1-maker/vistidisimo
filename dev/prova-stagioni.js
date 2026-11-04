// Prova della finestra «Nuova stagione»: quali stagioni contano (newSeason, casi limite), la finestra con
// più serie e con una sola, «Ok» e «Apri», `announced` salvato su GitHub e mai abbassato, niente finestra
// dopo averla chiusa (anche su un altro dispositivo), attesa mentre è aperto un foglio.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();

const pad = (n) => String(n).padStart(2, '0');
// giorni di calendario (non 24 h × n: dopo il cambio dell'ora, tra le 23 e mezzanotte, 31 × 24 h erano solo 30 giorni)
const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Tre serie vere della libreria (in pari, completata, in corso) a cui si dà una stagione nuova.
function pick(lib) {
  const tv = Object.entries(lib.items).filter(([, it]) => it.type === 'tv' && (it.added || '') < '2026-09-01' && Object.keys(it.eps || {}).some((s) => s !== '0'))
    .sort((a, b) => (b[1].last || '').localeCompare(a[1].last || ''));
  return ['uptodate', 'completed', 'watching'].map((st) => tv.find(([, it]) => it.status === st)[0]);
}

// meta.json vero con tutte le date di aggiornamento a «adesso» (niente richieste a TMDB) e, per le
// serie in `fresh`, una stagione nuova: { key: { off: giorni fa, k: episodi usciti, cnt } }.
function metaWith(lib, fresh) {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
  for (const m of Object.values(meta.items)) m.at = Date.now();
  for (const [key, f] of Object.entries(fresh)) {
    const it = lib.items[key];
    const maxS = Math.max(...Object.keys(it.eps).map(Number));
    const n = maxS + 1;
    const ss = [];
    for (let s = 1; s <= maxS; s++) ss.push([s, Math.max(...Object.keys(it.eps[String(s)] || { 10: 1 }).map(Number)), `${2015 + s}-01-10`]);
    ss.push([n, f.cnt, day(-f.off)]);
    const old = meta.items[key] || {};
    meta.items[key] = {
      ...old, t: old.t || it.title, p: old.p || `/p_tv_${it.id}.jpg`, b: `/b_tv_${it.id}.jpg`, st: 'Returning Series', ss,
      le: [n, f.k, day(-Math.max(0, f.off - f.k + 1))], ne: f.k < f.cnt ? [n, f.k + 1, day(7), 'Prossimo'] : null, at: Date.now(),
    };
  }
  return JSON.stringify(meta);
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8143', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const base = 'http://127.0.0.1:8143/vistidisimo/';

  // Un «dispositivo»: contesto nuovo con i suoi mock (o quelli di un altro dispositivo, per condividere GitHub).
  async function device(M, { holdGithub = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT' });
    await ctx.route('https://api.github.com/**', async (route) => { if (holdGithub) await holdGithub; return M.github(route); });
    await ctx.route('https://api.themoviedb.org/**', M.tmdb);
    await ctx.route('https://image.tmdb.org/**', M.image);
    await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    return { ctx, page };
  }
  const shot = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '(manca)');
  const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.ns *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));

  const lib = JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8'));
  const [kUp, kDone, kWatch] = pick(lib);
  console.log('    serie usate:', [kUp, kDone, kWatch].map((k) => `${lib.items[k].title} (${lib.items[k].status})`).join(', '));

  // 1. quali stagioni contano
  {
    const M = makeMocks(path.join(DATA, 'library.json'), { newSeasons: true });
    const { ctx, page } = await device(M);
    await page.goto(base + '#/home');
    await page.waitForSelector('#view .pc, #view h1, #view .home');
    const res = await page.evaluate(async ([d0, d1, d2, d5, d30, d31, f7]) => {
      const { newSeason } = await import('./js/derive.js');
      const it = (o = {}) => ({ type: 'tv', status: 'uptodate', added: '2025-01-01T10:00:00Z', eps: { 1: { 1: '', 2: '' }, 2: { 1: '', 2: '' } }, ...o });
      const m = (o = {}) => ({ ss: [[0, 3, '2015-01-01'], [1, 2, '2023-01-01'], [2, 2, '2024-01-01'], [3, 8, d2]], le: [3, 1, d2], ne: [3, 2, f7, ''], st: 'Returning Series', ...o });
      const r = (a, b) => JSON.stringify(newSeason(a, b));
      return {
        base: r(it(), m()),
        oggi: r(it(), m({ ss: [[1, 2, '2023-01-01'], [2, 2, '2024-01-01'], [3, 8, d0]], le: [3, 1, d0] })),
        tutti: r(it(), m({ le: [3, 8, d1], ne: null })),
        dopoAncora: r(it(), m({ ss: [[1, 2, '2023-01-01'], [2, 2, '2024-01-01'], [3, 8, d5], [4, 6, '2027-01-01']], le: [3, 3, d1], ne: [3, 4, f7, ''] })),
        giaAnnunciata: r(it({ announced: 3 }), m()),
        annunciataPrima: r(it({ announced: 2 }), m()),
        giaIniziata: r(it({ eps: { 1: { 1: '' }, 3: { 1: '' } } }), m()),
        trentaGiorni: r(it(), m({ ss: [[1, 2, '2023-01-01'], [3, 8, d30]], le: [3, 4, d1] })),
        trentunoGiorni: r(it(), m({ ss: [[1, 2, '2023-01-01'], [3, 8, d31]], le: [3, 4, d1] })),
        aggiuntaDopo: r(it({ added: `${d1}T10:00:00Z` }), m()),
        aggiuntaPrima: r(it({ added: `${d5}T10:00:00Z` }), m()),
        daGuardare: r(it({ status: 'planned', eps: {} }), m()),
        abbandonata: r(it({ status: 'dropped' }), m()),
        completata: r(it({ status: 'completed' }), m()),
        inCorso: r(it({ status: 'watching', eps: { 1: { 1: '' } } }), m()),
        film: r({ ...it(), type: 'movie' }, m()),
        primaStagione: r(it({ eps: {} , status: 'watching' }), { ss: [[1, 8, d2]], le: [1, 1, d2], ne: [1, 2, f7, ''] }),
        dataPassataMaNonUscita: r(it(), m({ le: [2, 2, '2024-02-01'], ne: [3, 1, f7, ''] })),
        dataFutura: r(it(), m({ ss: [[1, 2, '2023-01-01'], [2, 2, '2024-01-01'], [3, 8, f7]], le: [2, 2, '2024-02-01'], ne: [3, 1, f7, ''] })),
        senzaLe: r(it(), m({ le: null, ne: null })),
        ultimoSpeciale: r(it(), m({ le: [0, 3, d1] })),
        senzaData: r(it(), m({ ss: [[1, 2, '2023-01-01'], [2, 2, '2024-01-01'], [3, 8, null]] })),
        assoluta: r(it({ eps: { 1: { 1: '' }, 2: { 30: '' } } }), { ss: [[1, 25, '2020-01-01'], [2, 25, '2021-01-01'], [3, 12, d2]], le: [3, 57, d1], ne: [3, 58, f7, ''], st: 'Returning Series' }),
        senzaMeta: r(it(), null),
      };
    }, [day(0), day(-1), day(-2), day(-5), day(-30), day(-31), day(7)]);
    const want = {
      base: { n: 3, d: day(-2), k: 1, cnt: 8 },
      oggi: { n: 3, d: day(0), k: 1, cnt: 8 },
      tutti: { n: 3, d: day(-2), k: 8, cnt: 8 },
      dopoAncora: { n: 3, d: day(-5), k: 3, cnt: 8 },
      giaAnnunciata: null,
      annunciataPrima: { n: 3, d: day(-2), k: 1, cnt: 8 },
      giaIniziata: null,
      trentaGiorni: { n: 3, d: day(-30), k: 4, cnt: 8 },
      trentunoGiorni: null,
      aggiuntaDopo: null,
      aggiuntaPrima: { n: 3, d: day(-2), k: 1, cnt: 8 },
      daGuardare: null,
      abbandonata: null,
      completata: { n: 3, d: day(-2), k: 1, cnt: 8 },
      inCorso: { n: 3, d: day(-2), k: 1, cnt: 8 },
      film: null,
      primaStagione: null,
      dataPassataMaNonUscita: null,
      dataFutura: null,
      senzaLe: { n: 3, d: day(-2), k: null, cnt: 8 },
      ultimoSpeciale: { n: 3, d: day(-2), k: null, cnt: 8 },
      senzaData: null,
      assoluta: { n: 3, d: day(-2), k: 7, cnt: 12 },
      senzaMeta: null,
    };
    for (const [k, v] of Object.entries(want)) check(`newSeason ${k}: ${res[k]}`, res[k] === JSON.stringify(v));
    await ctx.close();
  }

  // 2. tre serie con una stagione nuova: una finestra sola con tre schede, dalla più recente
  const fresh3 = { [kUp]: { off: 0, k: 1, cnt: 8 }, [kDone]: { off: 3, k: 8, cnt: 8 }, [kWatch]: { off: 12, k: 2, cnt: 10 } };
  const M = makeMocks(path.join(DATA, 'library.json'), { newSeasons: true });
  M.files['meta.json'] = metaWith(lib, fresh3); M.shas['meta.json'] = 'meta0';
  const remote = () => JSON.parse(M.files['library.json']).items;
  {
    const { ctx, page } = await device(M);
    await page.goto(base + '#/home');
    await page.waitForSelector('.ns-wrap.in .ns');
    check('titolo «Nuove stagioni»', (await text(page, '.ns-k')) === 'Nuove stagioni');
    const cards = await texts(page, '.ns-card');
    console.log('    schede:', cards.join(' | '));
    check('tre schede', cards.length === 3);
    check('dalla più recente', cards[0].includes(lib.items[kUp].title) && cards[2].includes(lib.items[kWatch].title));
    const smalls = await texts(page, '.ns-card small');
    check(`righe: ${smalls.join(' / ')}`, smalls[0] === 'Uscita oggi · 1 episodio su 8' && smalls[1].startsWith('Uscita ') && smalls[1].endsWith(' · 8 episodi su 8') && smalls[2].endsWith('2 episodi su 10'));
    check('stagioni giuste', (await texts(page, '.ns-s')).join(',') === Object.keys(fresh3).map((k) => `Stagione ${Math.max(...Object.keys(lib.items[k].eps).map(Number)) + 1}`).join(','));
    check('solo «Ok» con più serie', (await page.$$('.ns-actions .btn')).length === 1);
    check('banner caricati', await page.$$eval('.ns-img img', (is) => is.every((i) => i.complete && i.naturalWidth > 0)));
    check('niente esce dallo schermo', await noOverflow(page));
    check('la finestra sta nello schermo', await page.$eval('.ns', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    await shot(page, 'ns1-tre-stagioni');
    await page.click('[data-ns-ok]');
    await page.waitForSelector('.ns-wrap', { state: 'detached' });
    await page.waitForTimeout(2600);
    const r = remote();
    check(`announced su GitHub (${Object.keys(fresh3).map((k) => r[k].announced).join(', ')})`, Object.keys(fresh3).every((k) => r[k].announced === Math.max(...Object.keys(lib.items[k].eps).map(Number)) + 1));
    const msg = M.log.puts.filter((p) => p.path === 'library.json' && !p.conflict).map((p) => p.message).join(' | ');
    console.log('    commit:', msg);
    check('commit leggibile', /avviso della stagione/.test(msg));
    // riaprendo l'app non ricompare
    await page.reload();
    await page.waitForSelector('#view .pc');
    await page.waitForTimeout(1500);
    check('riaperta: nessuna finestra', (await page.$('.ns-wrap')) == null);
    // un «ann» vecchio (stagione più bassa) non abbassa announced
    const after = await page.evaluate(async (k) => { const s = await import('./js/store.js'); s.dispatch({ op: 'ann', key: k, n: 1 }); return s.item(k).announced; }, kUp);
    check('un avviso vecchio non abbassa announced', after === r[kUp].announced);
    await ctx.close();
    // un altro dispositivo, che non ha mai visto la finestra, scarica announced e non la mostra
    const other = await device(M);
    await other.page.goto(base + '#/home');
    await other.page.waitForSelector('#view .pc');
    await other.page.waitForTimeout(1500);
    check('altro dispositivo: nessuna finestra', (await other.page.$('.ns-wrap')) == null);
    await other.ctx.close();
  }

  // 3. una serie sola: «Apri» porta alla serie e la segna
  {
    const M1 = makeMocks(path.join(DATA, 'library.json'), { newSeasons: true });
    M1.files['meta.json'] = metaWith(lib, { [kUp]: { off: 1, k: 3, cnt: 10 } }); M1.shas['meta.json'] = 'meta0';
    const { ctx, page } = await device(M1);
    await page.goto(base + '#/libreria');
    await page.waitForSelector('.ns-wrap.in .ns');
    check('titolo «Nuova stagione»', (await text(page, '.ns-k')) === 'Nuova stagione');
    check(`riga: ${await text(page, '.ns-card small')}`, (await text(page, '.ns-card small')) === 'Uscita ieri · 3 episodi su 10');
    check('«Ok» e «Apri»', (await texts(page, '.ns-actions .btn')).join(',') === 'Ok,Apri');
    check('niente esce dallo schermo', await noOverflow(page));
    await shot(page, 'ns2-una-stagione');
    await page.click('.ns-actions [data-ns-go]');
    await page.waitForSelector('.ns-wrap', { state: 'detached' });
    await page.waitForSelector('.detail');
    check('aperta la pagina della serie', page.url().endsWith(`#/t/tv/${lib.items[kUp].id}`));
    await page.waitForTimeout(2600);
    check('announced su GitHub', JSON.parse(M1.files['library.json']).items[kUp].announced === Math.max(...Object.keys(lib.items[kUp].eps).map(Number)) + 1);
    await shot(page, 'ns3-serie-aperta');
    await ctx.close();
  }

  // 4. con un foglio aperto aspetta; toccare fuori chiude come «Ok»
  {
    const M2 = makeMocks(path.join(DATA, 'library.json'), { newSeasons: true });
    M2.files['meta.json'] = metaWith(lib, { [kDone]: { off: 2, k: 8, cnt: 8 } }); M2.shas['meta.json'] = 'meta0';
    let release; const hold = new Promise((r) => { release = r; });
    const { ctx, page } = await device(M2, { holdGithub: hold });
    await page.goto(base + '#/home');
    await page.waitForTimeout(400);
    await page.evaluate(async () => { const ui = await import('./js/ui.js'); ui.openSheet('<h3 class="sheet-title">Un foglio</h3><button class="btn ghost wide" data-close>Chiudi</button>'); });
    release();
    await page.waitForTimeout(2500);
    check('con un foglio aperto la finestra aspetta', (await page.$('.ns-wrap')) == null);
    await page.click('.sheet [data-close]');
    await page.waitForSelector('.ns-wrap.in .ns', { timeout: 4000 });
    check('chiuso il foglio, la finestra arriva', true);
    await page.mouse.click(196, 20);
    await page.waitForSelector('.ns-wrap', { state: 'detached' });
    await page.waitForTimeout(2600);
    check('toccare fuori la chiude e la segna', JSON.parse(M2.files['library.json']).items[kDone].announced > 0);
    await ctx.close();
  }

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
