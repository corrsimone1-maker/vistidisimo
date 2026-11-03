// Jikan: accesso pubblico e gratuito ai dati di MyAnimeList (api.jikan.moe, senza chiave, risponde
// anche dal browser). Lo usano «Film e OVA» (js/mal.js) e i filler (js/filler.js).
//
// Limiti di Jikan: 3 richieste al secondo e 60 al minuto. Tutte le richieste dell'app passano da una
// sola fila che le distanzia (almeno 400 ms, al massimo 55 in un minuto), così non si superano mai.

const API = 'https://api.jikan.moe/v4';
const GAP = 400;
const WINDOW = 60 * 1000;
const MAX_IN_WINDOW = 55;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class JikanError extends Error {}

let chain = Promise.resolve();
const stamps = [];

// Aspetta il proprio turno nella fila.
function slot() {
  const turn = chain.then(async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > WINDOW) stamps.shift();
      let wait = stamps.length ? stamps[stamps.length - 1] + GAP - now : 0;
      if (stamps.length >= MAX_IN_WINDOW) wait = Math.max(wait, stamps[0] + WINDOW - now + 50);
      if (wait <= 0) break;
      await sleep(wait);
    }
    stamps.push(Date.now());
  });
  chain = turn.catch(() => {});
  return turn;
}

// GET su Jikan: il JSON, null se MyAnimeList non ha quella voce (404), altrimenti JikanError.
export async function jikan(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot();
    let r;
    try {
      r = await fetch(API + path, { headers: { Accept: 'application/json' } });
    } catch {
      if (attempt === 2) throw new JikanError('MyAnimeList non è raggiungibile');
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (r.status === 404) return null;
    // troppe richieste: si riprova una volta dopo un attimo, poi si lascia stare
    if (r.status === 429) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw new JikanError('MyAnimeList chiede di aspettare un minuto');
    }
    if (r.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new JikanError(`MyAnimeList ha risposto ${r.status}`);
    try { return await r.json(); } catch { throw new JikanError('Risposta di MyAnimeList non valida'); }
  }
  throw new JikanError('MyAnimeList non risponde');
}
