// Lettura e scrittura dei file nella repo privata dei dati, tramite l'API di GitHub.

export const OWNER = 'corrsimone1-maker';
export const DATA_REPO = 'vistidisimo-dati';
const API = 'https://api.github.com';
const BRANCH = 'main';

export class GhError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.conflict = status === 409 || status === 422;
    this.auth = status === 401 || status === 403;
  }
}

function token() {
  try { return localStorage.getItem('vds.ghToken') || ''; } catch { return ''; }
}

function headers(accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const url = (path) => `${API}/repos/${OWNER}/${DATA_REPO}/contents/${path}`;

async function failure(r) {
  let msg = `GitHub ha risposto ${r.status}`;
  try { const j = await r.json(); if (j.message) msg += `: ${j.message}`; } catch { /* niente */ }
  return new GhError(r.status, msg);
}

// Restituisce { sha, data } oppure { sha: null, data: null } se il file non esiste.
export async function ghGet(path) {
  const r = await fetch(`${url(path)}?ref=${BRANCH}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw await failure(r);
  const j = await r.json();
  let text;
  if (j.encoding === 'base64' && j.content) {
    text = b64decode(j.content);
  } else {
    // File oltre 1 MB: l'API non include il contenuto, va chiesto in formato grezzo.
    const r2 = await fetch(`${url(path)}?ref=${BRANCH}&t=${Date.now()}`, { headers: headers('application/vnd.github.raw+json'), cache: 'no-store' });
    if (!r2.ok) throw await failure(r2);
    text = await r2.text();
  }
  return { sha: j.sha, data: text.trim() ? JSON.parse(text) : null };
}

// Scrive il file (testo già serializzato). Restituisce il nuovo sha.
export async function ghPut(path, text, sha, message) {
  const body = { message, content: b64encode(text), branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(url(path), {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) throw await failure(r);
  const j = await r.json();
  return j.content.sha;
}

// Serializza un oggetto { chiave: valore } con una voce per riga: i diff dei commit restano leggibili.
export function serialize(doc) {
  const parts = [];
  for (const [k, v] of Object.entries(doc)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'items')) {
      const rows = Object.entries(v).map(([ik, iv]) => `${JSON.stringify(ik)}:${JSON.stringify(iv)}`);
      parts.push(`${JSON.stringify(k)}:{\n${rows.join(',\n')}\n}`);
    } else if (Array.isArray(v) && k === 'lists') {
      parts.push(`${JSON.stringify(k)}:[\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`);
    } else {
      parts.push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
    }
  }
  return `{${parts.join(',\n')}}\n`;
}
