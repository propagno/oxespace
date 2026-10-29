"""Applies exact (old, new) replacements from a JSON-like python file to one source file, asserting each is found."""
import sys, runpy
spec = runpy.run_path(sys.argv[1])
path = spec['PATH']
s = open(path, encoding='utf8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
s = s.replace('\r\n', '\n')
missing = []
for old, new in spec['R']:
    if old not in s:
        missing.append(old[:100])
        continue
    s = s.replace(old, new)
if 'POST' in spec:
    s = spec['POST'](s)
open(path, 'w', encoding='utf8', newline='').write(s.replace('\n', nl))
print('missing:', missing if missing else 'none')
