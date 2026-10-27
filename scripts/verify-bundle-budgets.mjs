import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const REQUIRED_HEADROOM = 0.05
const budgets = [
  // The main entry is platform-sensitive by a few hundred bytes (Windows
  // source-map/path normalization). Keep a narrow 4 KiB headroom so a valid
  // release is not rejected by runner-specific output while still catching
  // accidental multi-KB regressions.
  // 936 KiB since the MCP app tools and the agent runtime (2026-10): about 96 tools with their descriptions and
  // the agent state engine took the entry from 777 to 882 kB; the 5% headroom rule still holds.
  // 952 KiB since organization policy (roadmap C1, 2026-10): the policy reader and its enforcement in MCP sync and
  // Thread launches brought the entry to 890 kB, under 5% headroom at 936.
  { label: 'main process entry', dir: 'out/main', match: /^index\.js$/, max: 952 * 1024 },
  { label: 'preload entry', dir: 'out/preload', match: /^index\.cjs$/, max: 40 * 1024 },
  { label: 'renderer entry', dir: 'out/renderer/assets', match: /^index-.*\.js$/, max: 500 * 1024 },
  { label: 'renderer base CSS', dir: 'out/renderer/assets', match: /^index-.*\.css$/, max: 500 * 1024 },
  // OxeQuery loads on demand; its worker bundles pg, mongodb and ssh2, so it has its own ceiling.
  { label: 'OxeQuery worker', dir: 'out/main', match: /^oxequery-worker\.js$/, max: 3 * 1024 * 1024 },
  { label: 'OxeQuery view chunk', dir: 'out/renderer/assets', match: /^OxeQueryView-.*\.js$/, max: 320 * 1024 },
  { label: 'OxeQuery CSS', dir: 'out/renderer/assets', match: /^OxeQuery-.*\.css$/, max: 64 * 1024 }
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
  const headroom = 1 - bytes / budget.max
  console.log(`[bundle] ${budget.label}: ${actualKb} kB / ${limitKb} kB · ${(headroom * 100).toFixed(1)}% headroom`)
  if (bytes > budget.max * (1 - REQUIRED_HEADROOM)) {
    console.error(`[bundle] ${budget.label}: requires at least ${REQUIRED_HEADROOM * 100}% headroom`)
    failed = true
  }
}

if (failed) {
  console.error('[bundle] One or more production artifacts exceeded their budget.')
  process.exit(1)
}
