#!/usr/bin/env python3
"""Prova della query SPARQL di js/wikidata.js su un piccolo grafo finto, con rdflib (SPARQL 1.1).

Dal container Wikidata non si raggiunge: così almeno la sintassi e il significato della query sono
controllati (percorsi, sottoquery con HAVING, OPTIONAL/BOUND). Serve rdflib:
    pip install --break-system-packages rdflib
    python3 dev/prova-wikidata.py
"""
import pathlib, re, sys
from rdflib import Graph, Namespace, Literal

src = (pathlib.Path(__file__).resolve().parent.parent / 'js' / 'wikidata.js').read_text()
tmpl = re.search(r'export function wdQuery\(type, id\) \{.*?return `(.*?)`;', src, re.S).group(1)
max_group = re.search(r'const MAX_GROUP = (\d+);', src).group(1)

def query(typ, i):
    P = 'P4947' if typ == 'movie' else 'P4983'
    return tmpl.replace('${P}', P).replace('${lit}', f'"{i}"').replace('${MAX_GROUP}', max_group)

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
# «basato su»: remake, e due film tratti dallo stesso romanzo (non collegati tra loro)
mv('Q60', 60); mv('Q61', 61); t('Q61', 'P144', 'Q60')
mv('Q70', 70); mv('Q71', 71); t('Q70', 'P144', 'Q79'); t('Q71', 'P144', 'Q79')

cases = [
    ('tv', 71446, {'tv:146176', 'tv:113036'}), ('tv', 113036, {'tv:71446', 'tv:146176'}), ('tv', 146176, {'tv:71446', 'tv:113036'}),
    ('tv', 62455, {'tv:97951'}), ('tv', 97951, {'tv:62455'}),
    ('tv', 1396, {'movie:559969', 'tv:60059'}), ('movie', 559969, {'tv:1396'}), ('tv', 60059, {'tv:1396'}),
    ('movie', 3, {'movie:1', 'movie:2'}), ('movie', 1, {'movie:2', 'movie:3'}),
    ('movie', 3005, set()), ('movie', 4001, {'movie:4000', 'movie:4002'}),
    ('movie', 50, {'movie:52'}), ('movie', 60, {'movie:61'}), ('movie', 61, {'movie:60'}), ('movie', 70, set()),
    ('movie', 999999, set()),
]
bad = 0
for typ, i, want in cases:
    got = set()
    for row in g.query(query(typ, i)):
        if row.tv is not None: got.add(f'tv:{row.tv}')
        if row.mv is not None: got.add(f'movie:{row.mv}')
    got.discard(f'{typ}:{i}')
    ok = got == want
    bad += not ok
    print('ok ' if ok else 'NO ', f'{typ}:{i}', sorted(got), '' if ok else f'atteso {sorted(want)}')
print('\ntutto a posto' if not bad else f'\n{bad} problemi')
sys.exit(1 if bad else 0)
