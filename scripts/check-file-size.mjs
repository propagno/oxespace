// Keeps source files from growing past a size where they are hard to review and to change safely.
//
// No tracked .ts/.tsx file outside a vendor folder may pass LIMIT lines. Files that already did when this
// check arrived are listed in scripts/file-size-baseline.json with their size then, and may not grow past it.
// When one shrinks, `node scripts/check-file-size.mjs --update` lowers its entry; a file back under LIMIT
// leaves the list. Run by `npm run lint`.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LIMIT = 1000
const root = process.cwd()
const baselinePath = join(root, 'scripts', 'file-size-baseline.json')

const lineCount = text => text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

function sizes() {
  const listed = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.tsx'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const result = new Map()
  for (const file of listed.split('\0')) {
    if (!file || file.endsWith('.d.ts') || /(^|\/)vendor\//.test(file)) continue
    let text
    try { text = readFileSync(join(root, file), 'utf8') } catch { continue } // deleted in the working tree
    result.set(file, lineCount(text))
  }
  return result
}

const current = sizes()
let baseline
try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) } catch { baseline = {} }

if (process.argv.includes('--update')) {
  const next = {}
  for (const [file, lines] of [...current].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines <= LIMIT) continue
    // Lowering only: --update never lets a listed file grow, and never admits a new one.
    if (!(file in baseline)) continue
    next[file] = Math.min(lines, baseline[file])
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`file-size baseline: ${Object.keys(next).length} file(s) over ${LIMIT} lines`)
  process.exit(0)
}

const problems = []
const shrunk = []
for (const [file, lines] of current) {
  const allowed = baseline[file]
  if (allowed === undefined) {
    if (lines > LIMIT) problems.push(`${file}: ${lines} lines; the limit is ${LIMIT}. Split it.`)
  } else if (lines > allowed) {
    problems.push(`${file}: ${lines} lines; it may not grow past ${allowed}. Move code out before adding to it.`)
  } else if (lines < allowed) {
    shrunk.push(`${file}: ${allowed} -> ${lines}`)
  }
}
if (shrunk.length) console.log(`Smaller than the baseline; run node scripts/check-file-size.mjs --update to lock it in:\n  ${shrunk.join('\n  ')}`)
if (problems.length) {
  console.error(`File size check failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`file sizes: ${current.size} files checked, ${Object.keys(baseline).length} on the baseline`)
