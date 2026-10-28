// Quarta prova: riordino delle liste trascinando, ordine in Home e su GitHub.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { makeMocks } = require('./mock.js');
const OUT = process.argv[2] || require('os').tmpdir();
// Le due repo devono stare una accanto all'altra (…/vistidisimo e …/vistidisimo-dati).
const ROOT = path.resolve(__dirname, '..', '..');
const LIB = process.env.VDS_LIB || path.join(ROOT, 'vistidisimo-dati', 'library.json');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8126', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const M = makeMocks(LIB);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://api.github.com/**', M.github);
  await ctx.route('https://api.themoviedb.org/**', M.tmdb);
  await ctx.route('https://image.tmdb.org/**', M.image);
  await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = 'http://127.0.0.1:8126/vistidisimo/';
  await page.goto(base + '#/home');
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 });
  await page.goto(base + '#/liste');
  await page.waitForSelector('[data-act=lists-reorder]');
  await page.click('[data-act=lists-reorder]');
  await page.waitForSelector('.ro-row');
  await page.waitForTimeout(400);
  const names = async () => page.$$eval('.ro-name', (e) => e.map((x) => x.firstChild.textContent.trim().slice(0, 18)));
  console.log('prima:', (await names()).join(' | '));
  await page.screenshot({ path: path.join(OUT, '50-riordina.png') });
  // trascina "Anime" (5ª) in cima
  const handles = await page.$$('.ro-handle');
  const hb = await handles[4].boundingBox();
  const tb = await handles[0].boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + (tb.y - hb.y) * i / 12, { steps: 2 });
  await page.screenshot({ path: path.join(OUT, '51-trascinamento.png') });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('dopo :', (await names()).join(' | '));
  await page.click('[data-act=lists-reorder]');
  await page.waitForTimeout(2500);
  const remote = JSON.parse(M.files['library.json']).lists.map((l) => l.title.slice(0, 18));
  console.log('su GitHub:', remote.join(' | '));
  await page.goto(base + '#/home');
  await page.waitForTimeout(600);
  const home = await page.$$eval('.scroller.lists .lc-name', (e) => e.map((x) => x.textContent.slice(0, 18)));
  console.log('in Home :', home.join(' | '));
  // ordine dentro le liste: dal visto più di recente, i non visti in fondo nell'ordine della lista
  const lib1 = JSON.parse(M.files['library.json']);
  const when = (it) => {
    if (!it) return '';
    if (it.type === 'movie') return it.status === 'completed' ? [it.seen || '', (it.last || '').slice(0, 10)].sort().pop() : '';
    const ds = Object.values(it.eps || {}).flatMap((x) => Object.values(x));
    if (!ds.length) return '';
    return ds.filter(Boolean).sort().pop() || (it.last || '').slice(0, 10);
  };
  for (const l of lib1.lists) {
    await page.goto(base + '#/lista/' + encodeURIComponent(l.id));
    await page.waitForSelector('.list-head');
    await page.waitForTimeout(300);
    const keys = await page.$$eval('.grid .pc', (e) => e.map((x) => x.dataset.key));
    const dates = keys.map((k) => when(lib1.items[k]));
    const seen = dates.filter(Boolean);
    const sorted = seen.every((d, i) => i === 0 || seen[i - 1] >= d);
    const firstEmpty = dates.indexOf('');
    const unseenAtEnd = firstEmpty === -1 || dates.slice(firstEmpty).every((d) => !d);
    const unseenKeys = keys.filter((k, i) => !dates[i]);
    const listOrderUnseen = l.items.map((e) => e.key).filter((k) => unseenKeys.includes(k));
    const ok = keys.length === l.items.length && sorted && unseenAtEnd && unseenKeys.join() === listOrderUnseen.join();
    console.log(`lista «${l.title.slice(0, 18)}»: ${keys.length} titoli, ${seen.length} visti dal più recente (${seen[0] || '-'} … ${seen[seen.length - 1] || '-'}), ${unseenKeys.length} non visti in fondo: ${ok ? 'ok' : 'NO'}`);
    if (!ok) errors.push('ordine sbagliato nella lista ' + l.title);
    if (l.title === 'Anime') await page.screenshot({ path: path.join(OUT, '52-lista-ordinata.png') });
  }
  await page.goto(base + '#/home');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '53-home-liste.png') });
  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
