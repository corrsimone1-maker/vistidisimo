// Prova dell'animazione del cerchio in Prossimi → Da vedere, con i dati veri:
// l'episodio scorre via e arriva il prossimo, la scheda non cambia posto, «Annulla»,
// la scheda che si chiude quando non ci sono altri episodi, «Da iniziare», movimento ridotto.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeMocks } = require('./mock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'vistidisimo-dati');
const OUT = process.argv[2] || require('os').tmpdir();
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8138', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  const check = (label, ok) => { console.log(`${ok ? 'ok ' : 'NO '} ${label}`); if (!ok) errors.push('fallita: ' + label); };
  const open = async (opts = {}) => {
    const M = makeMocks(path.join(DATA, 'library.json'));
    M.files['meta.json'] = fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8');
    M.shas['meta.json'] = 'meta0';
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
    await ctx.route('https://api.github.com/**', M.github);
    await ctx.route('https://api.themoviedb.org/**', M.tmdb);
    await ctx.route('https://image.tmdb.org/**', M.image);
    await ctx.addInitScript(() => { if (!localStorage.getItem('vds.ghToken')) { localStorage.setItem('vds.ghToken', 'x'); localStorage.setItem('vds.tmdbToken', 'y'); localStorage.setItem('vds.upTab', '"next"'); } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto('http://127.0.0.1:8138/vistidisimo/#/prossimi');
    await page.waitForSelector('.ep-card');
    await page.waitForTimeout(1500);
    return { M, ctx, page, remote: () => JSON.parse(M.files['library.json']).items };
  };
  const cards = (page, sec = 'next') => page.$$eval(`.ep-card[data-sec=${sec}]`, (e) => e.map((c) => {
    const b = c.querySelector('[data-act=up-check]');
    return { key: b.dataset.key, s: +b.dataset.s, e: +b.dataset.e, code: c.querySelector('.ep-code').textContent.trim(), left: c.querySelector('.ep-left').textContent.trim(), cls: c.className };
  }));

  // 1. tocco sulla terza scheda: l'episodio scorre via e arriva il prossimo, la scheda resta terza
  let { M, ctx, page, remote } = await open();
  const before = await cards(page);
  console.log('    prima:', before.slice(0, 4).map((c) => `${c.key} ${c.code}`).join(' | '));
  const t = before[2];
  const sel = `.ep-card[data-sec=next] [data-act=up-check][data-key="${t.key}"]`;
  const box = await (await page.$(sel)).boundingBox();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click(sel);
  for (const ms of [60, 230, 330, 480, 900]) {
    await page.waitForTimeout(ms === 60 ? 60 : ms - [60, 230, 330, 480, 900][[60, 230, 330, 480, 900].indexOf(ms) - 1]);
    await page.screenshot({ path: path.join(OUT, `pr-${String(ms).padStart(3, '0')}ms.png`), clip: { x: 0, y: Math.max(0, box.y - 110), width: 393, height: 300 } });
  }
  const after = await cards(page);
  const a3 = after[2];
  console.log('    dopo :', after.slice(0, 4).map((c) => `${c.key} ${c.code}`).join(' | '));
  check('la scheda resta al suo posto (terza)', a3.key === t.key);
  check(`arriva l'episodio dopo (${t.code} → ${a3.code})`, a3.s * 10000 + a3.e > t.s * 10000 + t.e);
  const settled = await page.evaluate((k) => {
    const c = document.querySelector(`.ep-card[data-sec=next] [data-key="${k}"]`).closest('.ep-card');
    const b = getComputedStyle(c.querySelector('.ep-body'));
    return { op: b.opacity, tr: b.transform, hold: document.body.classList.contains('hold-render') };
  }, t.key);
  check(`animazione finita: contenuto fermo e visibile, ridisegni non bloccati (${JSON.stringify(settled)})`, settled.op === '1' && (settled.tr === 'none' || settled.tr === 'matrix(1, 0, 0, 1, 0, 0)') && !settled.hold);
  check('avviso con «Annulla»', /Visto S\d+ · E\d+/.test(await page.$eval('.toast', (e) => e.textContent)) && (await page.$('.toast button')) != null);
  await page.waitForTimeout(2200);
  const rItem = remote()[t.key];
  check('episodio salvato su GitHub', !!rItem.eps[String(t.s)]?.[String(t.e)] !== undefined && String(t.e) in (rItem.eps[String(t.s)] || {}));

  // 2. «Annulla»: torna l'episodio di prima (da sinistra), stato e ultima attività come prima
  const lib0 = JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8')).items;
  await page.click(sel); // un altro episodio, poi annulla questo
  await page.waitForTimeout(900);
  const mid = (await cards(page))[2];
  await page.click('.toast button');
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, 'pr-annulla.png'), clip: { x: 0, y: Math.max(0, box.y - 110), width: 393, height: 300 } });
  await page.waitForTimeout(600);
  const undone = (await cards(page))[2];
  check(`«Annulla» riporta l'episodio (${mid.code} → ${undone.code})`, undone.key === t.key && undone.s === a3.s && undone.e === a3.e);
  await page.waitForTimeout(2200);
  const r2 = remote()[t.key];
  check('su GitHub tolto l\'episodio annullato', !(String(a3.e) in (r2.eps[String(a3.s)] || {})));
  check('stato come prima dell\'ultimo tocco', r2.status === remote()[t.key].status && r2.last >= lib0[t.key].last);

  // 3. doppio tocco veloce: un solo episodio
  const b4 = (await cards(page))[0];
  await page.click(`.ep-card[data-sec=next] [data-act=up-check][data-key="${b4.key}"]`);
  await page.click(`.ep-card[data-sec=next] [data-act=up-check][data-key="${b4.key}"]`, { timeout: 500 }).catch(() => {});
  await page.waitForTimeout(3000);
  const eps = (k, s) => Object.keys(remote()[k].eps[String(s)] || {}).length;
  const b4after = (await cards(page)).find((c) => c.key === b4.key);
  check(`doppio tocco: un episodio solo (${b4.code} → ${b4after?.code})`, b4after && (b4after.e === b4.e + 1 || b4after.s === b4.s + 1));

  // 4. l'ultimo episodio uscito: la scheda esce e la lista si chiude
  const all = await cards(page);
  const few = all.slice().sort((a, b) => Number(a.left.match(/\d+/)?.[0] || 0) - Number(b.left.match(/\d+/)?.[0] || 0))[0];
  console.log(`    serie da finire: ${few.key} ${few.code} (${few.left})`);
  const n0 = all.length;
  let shotGone = false;
  for (let i = 0; i < 20; i++) {
    const c = (await cards(page)).find((x) => x.key === few.key);
    if (!c) break;
    const last = /ultimo uscito/.test(c.left);
    await page.click(`.ep-card[data-sec=next] [data-act=up-check][data-key="${few.key}"]`);
    if (last && !shotGone) {
      const bb = await (await page.$(`.ep-card[data-sec=next] [data-act=up-check][data-key="${few.key}"]`)).boundingBox();
      await page.waitForTimeout(420);
      await page.screenshot({ path: path.join(OUT, 'pr-chiude.png'), clip: { x: 0, y: Math.max(0, bb.y - 160), width: 393, height: 340 } });
      shotGone = true;
    }
    await page.waitForTimeout(900);
  }
  const allAfter = await cards(page);
  check(`scheda finita sparita (${n0} → ${allAfter.length})`, !allAfter.some((c) => c.key === few.key) && allAfter.length === n0 - 1);
  check('nessuna scheda a metà animazione', await page.$$eval('.ep-card', (e) => e.every((c) => getComputedStyle(c).opacity === '1')));
  await page.waitForTimeout(2200);
  console.log(`    stato su GitHub: ${remote()[few.key].status}`);
  check('stato in pari o completata', ['uptodate', 'completed'].includes(remote()[few.key].status));

  // 5. «Da iniziare»: la serie esce da lì ed entra in cima a «Da vedere»
  const st = (await cards(page, 'start'))[0];
  await page.evaluate((k) => document.querySelector(`.ep-card[data-sec=start] [data-key="${k}"]`).scrollIntoView({ block: 'center' }), st.key);
  await page.click(`.ep-card[data-sec=start] [data-act=up-check][data-key="${st.key}"]`);
  await page.waitForTimeout(1200);
  const top = (await cards(page))[0];
  check(`da «Da iniziare» in cima a «Da vedere» (${st.key})`, top.key === st.key && top.code.startsWith('S1 · E2') && !(await cards(page, 'start')).some((c) => c.key === st.key));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, 'pr-iniziata.png') });

  // 6. tornando da un'altra scheda l'ordine si rifà (la serie toccata per prima va in cima)
  await page.click('#tabs a[data-tab=home]');
  await page.waitForSelector('.wordmark');
  await page.click('#tabs a[data-tab=prossimi]');
  await page.waitForSelector('.ep-card');
  await page.waitForTimeout(400);
  const reorder = await cards(page);
  check('di nuovo in Prossimi: l\'ultima serie toccata è in cima', reorder[0].key === st.key);
  await ctx.close();

  // 7. movimento ridotto: tutto subito, senza animazioni
  ({ page, ctx } = await open({ reducedMotion: 'reduce' }));
  const r0 = (await cards(page))[0];
  await page.click(`.ep-card[data-sec=next] [data-act=up-check][data-key="${r0.key}"]`);
  await page.waitForTimeout(150);
  const r1 = (await cards(page))[0];
  check(`movimento ridotto: subito il prossimo (${r0.code} → ${r1.code})`, r1.key === r0.key && r1.code !== r0.code);
  await ctx.close();

  console.log('ERRORI:', errors.length ? errors.join('\n') : 'nessuno');
  await browser.close(); srv.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
