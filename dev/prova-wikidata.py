#!/usr/bin/env python3
"""Prova della query SPARQL di js/wikidata.js su un piccolo grafo finto, con rdflib (SPARQL 1.1).

Dal container Wikidata non si raggiunge: così almeno la sintassi e il significato della query sono
controllati (percorsi, sottoquery con HAVING, OPTIONAL/BOUND). Serve rdflib:
    pip install --break-system-packages rdflib
    python3 dev/prova-wikidata.py
"""
import json, pathlib, subprocess, sys
from rdflib import Graph, Namespace, Literal

JS = pathlib.Path(__file__).resolve().parent.parent / 'js' / 'wikidata.js'

def queries(pairs):
    """wdQuery di js/wikidata.js (eseguita con node, senza store.js) per ogni (tipo, id)."""
    src = JS.read_text().replace("import { LS } from './store.js';", 'const LS = { get: () => ({}), set() {} };')
    code = src + '\nconsole.log(JSON.stringify(' + json.dumps(pairs) + '.map(([t, i]) => wdQuery(t, i))));'
    out = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def keys_from(rows, self_key):
    """Come keysFromResults: { chiave: 0 spin-off | 2 famiglia | 1 seguito }, il più sicuro vince (in
    quest'ordine)."""
    order = {0: 0, 2: 1, 1: 2}
    best = {}
    for row in rows:
        w = int(row.w)
        for v, typ in ((row.tv, 'tv'), (row.mv, 'movie')):
            if v is None: continue
            k = f'{typ}:{v}'
            if k == self_key: continue
            if k not in best or order[w] < order[best[k]]: best[k] = w
    return best

WD = Namespace('http://www.wikidata.org/entity/')
WDT = Namespace('http://www.wikidata.org/prop/direct/')
g = Graph()
def t(s, p, o): g.add((WD[s], WDT[p], o if isinstance(o, Literal) else WD[o]))
def tv(q, i): t(q, 'P4983', Literal(str(i)))
def mv(q, i): t(q, 'P4947', Literal(str(i)))
# La casa di carta: spin-off Berlino e Corea (Corea vede anche Berlino, tramite la serie madre)
tv('Q1', 71446); tv('Q2', 146176); tv('Q3', 113036); t('Q1', 'P2512', 'Q2'); t('Q1', 'P2512', 'Q3')
# Vis a vis -> spin-off El oasis
tv('Q4', 62455); tv('Q5', 97951); t('Q4', 'P2512', 'Q5')
# Breaking Bad: El Camino parte della serie, Better Call Saul spin-off, episodi senza id TMDB
tv('Q10', 1396); mv('Q11', 559969); t('Q11', 'P179', 'Q10'); tv('Q12', 60059); t('Q10', 'P2512', 'Q12')
for k in range(5): t(f'Q13{k}', 'P179', 'Q10')
# catena di film (anche al contrario)
mv('Q20', 1); mv('Q21', 2); mv('Q22', 3); t('Q20', 'P156', 'Q21'); t('Q22', 'P155', 'Q21')
# franchise enorme (41 titoli con id TMDB: non si allarga) e piccolo (3)
for k in range(41): mv(f'Q30{k}', 3000 + k); t(f'Q30{k}', 'P8345', 'Q30')
for k in range(3): mv(f'Q40{k}', 4000 + k); t(f'Q40{k}', 'P8345', 'Q40')
# catena con un anello senza id TMDB
mv('Q50', 50); t('Q50', 'P156', 'Q51'); t('Q51', 'P156', 'Q52'); mv('Q52', 52)
# «basato su»: remake, e due film tratti dallo stesso romanzo (stessa fonte: solo se confermati)
mv('Q60', 60); mv('Q61', 61); t('Q61', 'P144', 'Q60')
mv('Q70', 70); mv('Q71', 71); t('Q70', 'P144', 'Q79'); t('Q71', 'P144', 'Q79')
# anime tratto da un manga, film anime e film dal vero dallo stesso manga (il manga elenca le opere derivate)
tv('Q80', 800); mv('Q81', 801); mv('Q82', 802); t('Q80', 'P144', 'Q89'); t('Q81', 'P144', 'Q89'); t('Q89', 'P4969', 'Q82')
# fascia oraria: P155/P156 tra due anime diversi; un contenitore (P179) con un id TMDB e uno senza (gli altri
# titoli dello stesso contenitore non si prendono più: query troppo lenta sul servizio vero)
tv('Q83', 830); t('Q80', 'P156', 'Q83')
tv('Q84', 840); t('Q80', 'P179', 'Q91'); t('Q84', 'P179', 'Q91')
tv('Q85', 850); tv('Q86', 860); t('Q85', 'P179', 'Q86')

S, F, W = 0, 2, 1  # spin-off, famiglia, seguito
cases = [
    ('tv', 71446, {'tv:146176': S, 'tv:113036': S}), ('tv', 113036, {'tv:71446': S, 'tv:146176': S}), ('tv', 146176, {'tv:71446': S, 'tv:113036': S}),
    ('tv', 62455, {'tv:97951': S}), ('tv', 97951, {'tv:62455': S}),
    ('tv', 1396, {'movie:559969': F, 'tv:60059': S}), ('movie', 559969, {'tv:1396': W}), ('tv', 60059, {'tv:1396': S}),
    ('movie', 3, {'movie:1': W, 'movie:2': W}), ('movie', 1, {'movie:2': W, 'movie:3': W}),
    ('movie', 3005, {}), ('movie', 4001, {'movie:4000': F, 'movie:4002': F}),
    ('movie', 50, {'movie:52': W}), ('movie', 60, {'movie:61': F}), ('movie', 61, {'movie:60': F}), ('movie', 70, {'movie:71': F}),
    ('tv', 800, {'movie:801': F, 'movie:802': F, 'tv:830': W}), ('movie', 801, {'tv:800': F, 'movie:802': F}),
    ('tv', 850, {'tv:860': W}), ('tv', 860, {'tv:850': F}),
    ('movie', 999999, {}),
]
bad = 0
qs = queries([[typ, i] for typ, i, _ in cases])
for (typ, i, want), q in zip(cases, qs):
    got = keys_from(g.query(q), f'{typ}:{i}')
    ok = got == want
    bad += not ok
    print('ok ' if ok else 'NO ', f'{typ}:{i}', dict(sorted(got.items())), '' if ok else f'atteso {dict(sorted(want.items()))}')

# keysFromResults di js/wikidata.js sulla stessa forma di risposta
js_check = JS.read_text().replace("import { LS } from './store.js';", 'const LS = { get: () => ({}), set() {} };') + """
const b = (tv, w) => ({ tv: { value: String(tv) }, w: { value: String(w) } });
const r = keysFromResults({ results: { bindings: [b(1, 1), b(1, 0), b(2, 1), b(2, 2), b(3, 1), b(4, 2), b(9, 0)] } }, 'tv:9');
console.log(JSON.stringify(r));"""
r = json.loads(subprocess.run(['node', '--input-type=module', '-e', js_check], capture_output=True, text=True, check=True).stdout)
ok = r == {'k': ['tv:1'], 'f': ['tv:2', 'tv:4'], 's': ['tv:3']}
bad += not ok
print('ok ' if ok else 'NO ', 'keysFromResults: il collegamento più sicuro vince', r)
print('\ntutto a posto' if not bad else f'\n{bad} problemi')
sys.exit(1 if bad else 0)
