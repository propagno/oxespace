// Scratch (never committed): assembles shared/locales/{en,pt-BR}/thread.json from one fragment per area.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const lists = {}
for (const [dir, lang] of [['en', 'en'], ['pt', 'pt-BR']]) {
  const out = {}
  const base = join(here, dir)
  lists[dir] = readdirSync(base).filter(f => f.endsWith('.json')).sort()
  for (const file of lists[dir]) {
    // Each fragment holds one or more top-level groups.
    try {
      for (const [group, value] of Object.entries(JSON.parse(readFileSync(join(base, file), 'utf8')))) {
        if (group in out) { console.error('DUP group', dir, file, group); process.exitCode = 1 }
        out[group] = value
      }
    } catch (e) { console.error('BAD', dir, file, e.message); process.exitCode = 1 }
  }
  const sorted = Object.fromEntries(Object.keys(out).sort().map(key => [key, out[key]]))
  writeFileSync(join(root, 'shared/locales', lang, 'thread.json'), JSON.stringify(sorted, null, 2) + '\n')
}
if (lists.en.join() !== lists.pt.join()) { console.error('fragment mismatch', lists.en.filter(f => !lists.pt.includes(f)), lists.pt.filter(f => !lists.en.includes(f))); process.exitCode = 1 }
else console.log(`merged ${lists.en.length} fragments`)
