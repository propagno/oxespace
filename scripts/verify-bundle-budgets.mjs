import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const budgets = [
  { label: 'main process entry', dir: 'out/main', match: /^index\.js$/, max: 900 * 1024 },
  { label: 'preload entry', dir: 'out/preload', match: /^index\.cjs$/, max: 40 * 1024 },
  { label: 'renderer entry', dir: 'out/renderer/assets', match: /^index-.*\.js$/, max: 500 * 1024 },
  { label: 'renderer base CSS', dir: 'out/renderer/assets', match: /^index-.*\.css$/, max: 500 * 1024 }
]

let failed = false
for (const budget of budgets) {
  const directory = join(root, budget.dir)
  const matches = readdirSync(directory).filter((name) => budget.match.test(name))
  if (matches.length !== 1) {
    console.error(`[bundle] ${budget.label}: expected one artifact, found ${matches.length}`)
    failed = true
    continue
  }
  const bytes = statSync(join(directory, matches[0])).size
  const limitKb = Math.round(budget.max / 1024)
  const actualKb = Math.round(bytes / 1024)
  console.log(`[bundle] ${budget.label}: ${actualKb} kB / ${limitKb} kB`)
  if (bytes > budget.max) failed = true
}

if (failed) {
  console.error('[bundle] One or more production artifacts exceeded their budget.')
  process.exit(1)
}
