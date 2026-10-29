"""Warnings per rule in each changed OxeQuery file, at the base commit and now."""
import json, subprocess, glob
BASE = 'origin/feat/v9-i18n-base'
def counts(source, name):
    out = subprocess.run(['npx.cmd', 'eslint', '--stdin', '--stdin-filename', name, '-f', 'json'], input=source, capture_output=True, text=True, encoding='utf8').stdout
    rules = {}
    for message in json.loads(out)[0]['messages']: rules[message['ruleId']] = rules.get(message['ruleId'], 0) + 1
    return rules
for path in sorted(glob.glob('src/components/OxeQuery/*.ts*')) + ['src/i18n/index.ts']:
    path = path.replace('\\', '/')
    now = counts(open(path, encoding='utf8').read(), path)
    shown = subprocess.run(['git', 'show', f'{BASE}:{path}'], capture_output=True, text=True, encoding='utf8')
    base = counts(shown.stdout, path) if shown.returncode == 0 else {}
    worse = {rule: n for rule, n in now.items() if n > base.get(rule, 0)}
    if worse: print('NEW', path, worse, 'base', base)
print('checked')
