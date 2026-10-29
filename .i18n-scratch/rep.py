# Scratch: apply exact (old, new) replacements from a JSON file to one source file, keeping its line endings.
import io, json, sys
path, spec = sys.argv[1], sys.argv[2]
s = io.open(path, encoding='utf8', newline='').read()
crlf = '\r\n' in s
pairs = json.load(io.open(spec, encoding='utf8'))
bad = 0
for a, b in pairs:
    if crlf:
        a = a.replace('\r\n', '\n').replace('\n', '\r\n'); b = b.replace('\r\n', '\n').replace('\n', '\r\n')
    n = s.count(a)
    if n != 1:
        print('MISS', n, a[:90]); bad += 1; continue
    s = s.replace(a, b)
io.open(path, 'w', encoding='utf8', newline='').write(s)
print('applied', len(pairs) - bad, 'of', len(pairs))
sys.exit(1 if bad else 0)
