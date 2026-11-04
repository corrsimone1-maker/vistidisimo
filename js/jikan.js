// Jikan: accesso pubblico e gratuito ai dati di MyAnimeList (api.jikan.moe, senza chiave, risponde
// anche dal browser). Lo usano la Collezione degli anime e il romaji (js/mal.js), i filler (js/filler.js)
// e la ricerca.
//
// Limiti di Jikan: 3 richieste al secondo e 60 al minuto. Tutte le richieste dell'app passano da una
// sola fila che le distanzia (almeno 400 ms, al massimo 50 in un minuto per quelle in sottofondo e 57 per
// la ricerca), così non si superano mai.
//
// La fila ha delle precedenze (3/11/2026: Simo trovava Cerca lento e «Film e OVA» fermo su «Cerco…»,
// perché le richieste aspettavano dietro a quelle delle serie aperte prima): prima la ricerca (prio 0),
// poi quelle del titolo che stai guardando (`focusJikan`), poi tutte le altre, in ordine di arrivo.

// L'API pubblica di Jikan è stata chiusa il 1° ottobre 2026 (github.com/jikan-me/jikan-rest/issues/613;
// già da fine agosto rispondeva 504): finché Simo non sceglie un sostituto resta spenta, così niente aspetta
// una risposta che non arriva. Con ENABLED = false jikan() fallisce subito e jikanDown() è vero; le cache
// sul telefono (romaji, collegamenti) restano valide. Le prove (con un Jikan finto) la riaccendono con
// `vds.jikanOn` = '1' in localStorage.
export const ENABLED = (() => { try { return localStorage.getItem('vds.jikanOn') === '1'; } catch { return false; } })();
const API = 'https://api.jikan.moe/v4';
const TIMEOUT = 12 * 1000; // una richiesta che non risponde in 12 s si considera fallita
const GAP = 400;
const WINDOW = 60 * 1000;
const MAX_BACKGROUND = 50;
const MAX_SEARCH = 57;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class JikanError extends Error {}

const queue = []; // { prio, key, seq, resolve }
const stamps = [];
let seqN = 0;
let pumping = false;
let focus = null;
// se MyAnimeList non risponde, per 5 minuti chi può farne a meno (la ricerca) non aspetta
let downUntil = 0;
export const jikanDown = () => !ENABLED || Date.now() < downUntil;

// Il titolo che stai guardando: le sue richieste passano prima delle altre.
export function focusJikan(key) { focus = key || null; }

const prioOf = (t) => (t.prio != null ? t.prio : t.key && t.key === focus ? 1 : 2);

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => prioOf(a) - prioOf(b) || a.seq - b.seq);
      const next = queue[0];
      const now = Date.now();
      while (stamps.length && now - stamps[0] > WINDOW) stamps.shift();
      const max = prioOf(next) === 0 ? MAX_SEARCH : MAX_BACKGROUND;
      let wait = stamps.length ? stamps[stamps.length - 1] + GAP - now : 0;
      if (stamps.length >= max) wait = Math.max(wait, stamps[stamps.length - max] + WINDOW - now + 50);
      // si riguarda la fila dopo l'attesa: nel frattempo può essere arrivata una ricerca
      if (wait > 0) { await sleep(Math.min(wait, 500)); continue; }
      queue.shift();
      stamps.push(Date.now());
      next.resolve();
    }
  } finally { pumping = false; }
}

// Aspetta il proprio turno nella fila.
function slot(prio, key) {
  return new Promise((resolve) => { queue.push({ prio, key, seq: seqN++, resolve }); pump(); });
}

// GET su Jikan: il JSON, null se MyAnimeList non ha quella voce (404), altrimenti JikanError.
// opts: { prio: 0 per la ricerca, key: il titolo per cui serve (precedenza se è quello aperto) }
export async function jikan(path, { prio = null, key = null } = {}) {
  if (!ENABLED) throw new JikanError('MyAnimeList non è disponibile');
  if (Date.now() < downUntil) throw new JikanError('MyAnimeList non risponde');
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot(prio, key);
    let r;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
    try {
      r = await fetch(API + path, { headers: { Accept: 'application/json' }, signal: ctl?.signal });
    } catch {
      clearTimeout(timer);
      if (attempt === 2) { downUntil = Date.now() + 5 * 60 * 1000; throw new JikanError('MyAnimeList non è raggiungibile'); }
      await sleep(1000 * (attempt + 1));
      continue;
    }
    clearTimeout(timer);
    if (r.status === 404) return null;
    // troppe richieste: si riprova una volta dopo un attimo, poi si lascia stare
    if (r.status === 429) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw new JikanError('MyAnimeList chiede di aspettare un minuto');
    }
    if (r.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) {
      if (r.status >= 500) downUntil = Date.now() + 5 * 60 * 1000;
      throw new JikanError(`MyAnimeList ha risposto ${r.status}`);
    }
    try { return await r.json(); } catch { throw new JikanError('Risposta di MyAnimeList non valida'); }
  }
  downUntil = Date.now() + 5 * 60 * 1000;
  throw new JikanError('MyAnimeList non risponde');
}
