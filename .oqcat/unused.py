import json, glob, re
code = ''
for path in glob.glob('src/**/*.ts*', recursive=True):
    code += open(path, encoding='utf8').read()
def flat(node, prefix=''):
    for k, v in node.items():
        p = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict): yield from flat(v, p)
        else: yield p
cat = json.load(open('shared/locales/en/oxequery.json', encoding='utf8'))
unused = []
for key in flat(cat):
    base = re.sub(r'_(zero|one|two|few|many|other)$', '', key)
    if f"'{base}'" in code or f'"{base}"' in code: continue
    parts = base.split('.')
    if any(f"`{'.'.join(parts[:i])}.${{" in code for i in range(1, len(parts))): continue
    unused.append(key)
print('\n'.join(unused))
