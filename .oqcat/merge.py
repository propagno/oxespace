import json, glob, os, re

def deep(target, source, where):
    for key, value in source.items():
        if isinstance(value, dict):
            node = target.setdefault(key, {})
            if not isinstance(node, dict): raise SystemExit(f'conflict at {where}.{key}')
            deep(node, value, f'{where}.{key}')
        else:
            if key in target and target[key] != value: raise SystemExit(f'different value at {where}.{key}: {target[key]!r} vs {value!r}')
            target[key] = value

def add_many(node):
    for key in list(node.keys()):
        value = node[key]
        if isinstance(value, dict): add_many(value)
        elif key.endswith('_other'):
            base = key[:-6]
            node.setdefault(base + '_many', value)

def ordered(node):
    return {k: ordered(v) if isinstance(v, dict) else v for k, v in node.items()}

def write(path, data):
    with open(path, 'w', encoding='utf8', newline='\n') as handle:
        handle.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

for lang, folder in [('en', 'en'), ('pt-BR', 'pt')]:
    merged = {}
    for fragment in sorted(glob.glob(f'.oqcat/{folder}/*.json')):
        deep(merged, json.load(open(fragment, encoding='utf8')), os.path.basename(fragment))
    if lang == 'pt-BR': add_many(merged)
    write(f'shared/locales/{lang}/oxequery.json', merged)
    common_path = f'shared/locales/{lang}/common.json'
    common = json.load(open(common_path, encoding='utf8'))
    extra = json.load(open(f'.oqcat/common-{folder}.json', encoding='utf8'))
    common.update(extra)
    if lang == 'pt-BR': add_many(common)
    write(common_path, common)
    print(lang, sum(1 for _ in re.finditer(r'": "', json.dumps(merged, ensure_ascii=False))))

REMOVE = ['activity.loadFailed', 'activity.noneForFilter', 'containers.emptyText', 'details.inspectFailed', 'logs.pauseTitle', 'logs.failed', 'run.failed', 'shell.failed', 'engineBar.switchFailed', 'resources.failed', 'resources.empty', 'newDatabase.failed', 'compose.title']
for lang in ['en', 'pt-BR']:
    path = f'shared/locales/{lang}/oxequery.json'
    data = json.load(open(path, encoding='utf8'))
    for key in REMOVE:
        *parents, last = key.split('.')
        node = data
        for part in parents: node = node[part]
        del node[last]
    write(path, data)
print('pruned')
