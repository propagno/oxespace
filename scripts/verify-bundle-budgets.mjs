import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
  // 1000 KiB since the 1.4 batch (was 960; env scrubbing and the network rule added 9 kB more) (2026-10-30): MCP coverage, config guard and MCP quarantine, memory control, the problem
  // report, the upgrade rehearsal hooks and the idle CodeGraph close brought the readable, unminified entry to 926 kB,
  // under 5% headroom at 952 KiB. Each of them already loads its heavy parts lazily; minifying the main process is the
  // follow-up that would give this back.
  // 620 KiB since the main process is minified (B8.1, 2026-10-30): esbuild with keepNames took the entry from 914 to
  // 575 kB. Its source maps are written beside it but never referenced or packaged; see scripts/symbolicate-stack.mjs.
  { label: 'main process entry', dir: 'out/main', match: /^index\.js$/, max: 620 * 1024 },
  { label: 'preload entry', dir: 'out/preload', match: /^index\.cjs$/, max: 40 * 1024 },
  // 320 KiB since the renderer is minified (2026-10): the entry went from 474 kB readable to 246 kB.
  { label: 'renderer entry', dir: 'out/renderer/assets', match: /^index-.*\.js$/, max: 320 * 1024 },
  { label: 'renderer base CSS', dir: 'out/renderer/assets', match: /^index-.*\.css$/, max: 500 * 1024 },
  // OxeQuery loads on demand; its worker bundles pg, mongodb and ssh2, so it has its own ceiling.
  // 1.6 MiB since the main process is minified (2026-10-30): the worker went from 2.5 MB to 1.4 MB.
  { label: 'OxeQuery worker', dir: 'out/main', match: /^oxequery-worker\.js$/, max: 1.6 * 1024 * 1024 },
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

// The main process's source maps are private: every chunk has its .map for reading a reported stack, and no chunk
// may point at one (a sourceMappingURL would have the app, or anyone holding the package, look for it).
const mainFiles = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? (entry.name === 'chunks' ? mainFiles(join(dir, entry.name)) : [])
  : /\.js$/.test(entry.name) ? [join(dir, entry.name)] : [])
const mainChunks = mainFiles('out/main')
const withoutMap = mainChunks.filter(file => !existsSync(join(root, `${file}.map`)))
const referencing = mainChunks.filter(file => /[#@] sourceMappingURL=/.test(readFileSync(join(root, file), 'utf8')))
console.log(`[bundle] main source maps: ${mainChunks.length - withoutMap.length} of ${mainChunks.length} chunks, ${referencing.length} referencing one`)
if (!mainChunks.length || withoutMap.length || referencing.length) {
  if (withoutMap.length) console.error(`[bundle] main chunks without a source map: ${withoutMap.join(', ')}`)
  if (referencing.length) console.error(`[bundle] main chunks that reference their source map, which must stay private: ${referencing.join(', ')}`)
  failed = true
}

// What the first paint loads: the entry plus every chunk index.html preloads with it. Monaco (4.5 MB) once
// slipped in here through Vite's preload helper; this keeps it, and anything like it, out of the boot path.
const BOOT_BUDGET = 1600 * 1024
const html = readFileSync(join(root, 'out/renderer/index.html'), 'utf8')
const boot = [...html.matchAll(/<(?:script[^>]*src|link[^>]*rel="modulepreload"[^>]*href)="\.\/(assets\/[^"]+\.js)"/g)].map(match => match[1])
const bootBytes = boot.reduce((sum, file) => sum + statSync(join(root, 'out/renderer', file)).size, 0)
const bootNames = boot.map(file => file.replace(/^assets\//, '').replace(/-[\w-]+\.js$/, '')).join(', ')
console.log(`[bundle] renderer boot (${bootNames}): ${Math.round(bootBytes / 1024)} kB / ${BOOT_BUDGET / 1024} kB · ${((1 - bootBytes / BOOT_BUDGET) * 100).toFixed(1)}% headroom`)
if (!boot.length || bootBytes > BOOT_BUDGET * (1 - REQUIRED_HEADROOM)) {
  console.error(`[bundle] renderer boot: requires at least ${REQUIRED_HEADROOM * 100}% headroom`)
  failed = true
}

if (failed) {
  console.error('[bundle] One or more production artifacts exceeded their budget.')
  process.exit(1)
}
