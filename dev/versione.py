#!/usr/bin/env python3
"""Imposta il numero di versione dell'app in tutti i posti dove serve.

Uso:  python3 dev/versione.py 8

- index.html: mappa degli import (ogni modulo JS con ?v=N), app.css, main.js e manifest con ?v=N
- sw.js: nome della cache
- js/views/settings.js: versione mostrata in Impostazioni

Con la mappa degli import ogni file JS ha un indirizzo nuovo a ogni versione: il telefono non può
mischiare file vecchi in cache con file nuovi (era il motivo per cui l'app a volte non partiva).
"""
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
n = int(sys.argv[1])

mods = sorted(p.relative_to(root).as_posix() for p in (root / 'js').rglob('*.js'))
imap = {'imports': {f'./{m}': f'./{m}?v={n}' for m in mods}}
block = '<script type="importmap">\n' + json.dumps(imap, indent=2) + '\n  </script>'

html = (root / 'index.html').read_text()
html = re.sub(r'<script type="importmap">.*?</script>', block, html, flags=re.S)
html = re.sub(r'(app\.css|js/main\.js|manifest\.webmanifest)\?v=\d+', lambda m: f'{m.group(1)}?v={n}', html)
(root / 'index.html').write_text(html)

sw = (root / 'sw.js').read_text()
(root / 'sw.js').write_text(re.sub(r"const CACHE = 'vistidisimo-v\d+';", f"const CACHE = 'vistidisimo-v{n}';", sw))

st = (root / 'js/views/settings.js').read_text()
(root / 'js/views/settings.js').write_text(re.sub(r"export const VERSION = '[^']*';", f"export const VERSION = '{n}';", st))
print(f'versione {n}: {len(mods)} moduli')
