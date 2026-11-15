#!/usr/bin/env node
/**
 * Adapted from wip/oxe-49-full-unbridge:scripts/design/unbridge-tokens.mjs (OXE-49) for OXE-137 (F4 T17/T18).
 *
 * Mode "bridge" (T17): plain aliases of src/styles/tokens.css whose chain ends at a generated token (the one the
 * snapshot names) leave the bridge: every var(--old) becomes var(--target), the declaration line is dropped, and the
 * name is recorded in src/design/tokens/retired.ts. Literals, compounds, names declared more than once, names whose
 * chain ends at another bridge name, and names mentioned outside a var() in code are left alone and reported.
 *
 * Mode "rename" (T18): --map <json> {old: new}; every var(--old) / declaration / quoted '--old' in the allowed files
 * becomes the new name. Mentions outside the allowed files are reported, never written.
 *
 *   node scripts/design/unbridge-tokens.mjs [--root <worktree>] --files <json array of allowed paths> [--exclude-families fs,tx,bd,dot]
 *                            [--map <json>] [--dry-run] [--report <out.json>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const root = opt('--root', join(import.meta.dirname, '..', '..'))
const allowed = new Set(JSON.parse(readFileSync(opt('--files'), 'utf8')))
const excluded = new Set((opt('--exclude-families', '') || '').split(',').filter(Boolean))
const mapPath = opt('--map')
const dryRun = args.includes('--dry-run')
const reportPath = opt('--report')

const BRIDGE = 'src/styles/tokens.css'
const RETIRED = 'src/design/tokens/retired.ts'
const OUT_OF_SCOPE = /^(playground\/|docs\/plans\/)/
const familyOf = name => name.slice(2).split('-')[0]
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const read = rel => readFileSync(join(root, rel), 'utf8')

const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const textFiles = tracked.filter(path => /\.(css|tsx?|mjs|cjs|js|md|json)$/.test(path) && !OUT_OF_SCOPE.test(path) && existsSync(join(root, path)))
const contents = new Map(textFiles.map(path => [path, read(path)]))

function declarations(css) {
  const out = []
  for (const [, name, value] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:\s*([^;{}]+);/g)) out.push({ name, value: value.trim() })
  return out
}

/** Where a name is mentioned: var() reads, and every other mention (declarations, quoted strings, comments). */
function mentions(name) {
  const any = new RegExp(`(?<![\\w-])${esc(name)}(?![\\w-])`, 'g')
  const asRead = new RegExp(`var\\(\\s*${esc(name)}(?![\\w-])`, 'g')
  const out = []
  for (const [path, text] of contents) {
    if (path === BRIDGE || path === 'src/styles/tokens.generated.css' || path === RETIRED || path === 'tests/fixtures/token-bridge-snapshot.json') continue
    const total = (text.match(any) || []).length
    if (!total) continue
    const reads = (text.match(asRead) || []).length
    out.push({ path, reads, other: total - reads })
  }
  return out
}

const report = { mode: mapPath ? 'rename' : 'bridge', moved: {}, skipped: [], outsideAllowed: [], otherMentions: [], written: [] }
const edits = new Map()
const edit = (path, fn) => { const before = edits.get(path) ?? contents.get(path) ?? read(path); const after = fn(before); if (after !== before) edits.set(path, after) }

if (!mapPath) {
  const bridge = read(BRIDGE)
  const decl = declarations(bridge)
  const counts = new Map()
  for (const d of decl) counts.set(d.name, (counts.get(d.name) || 0) + 1)
  const value = new Map(decl.map(d => [d.name, d.value]))
  const snapshot = JSON.parse(read('tests/fixtures/token-bridge-snapshot.json')).names
  const plain = v => /^var\((--[\w-]+)\)$/.exec(v)?.[1]
  for (const [name, v] of value) {
    if (excluded.has(familyOf(name))) continue
    const why = reason => report.skipped.push({ name, declared: v, reason })
    if (counts.get(name) > 1) { why('declared more than once in the bridge (density/variant)'); continue }
    let target = plain(v)
    if (!target) { why(`${snapshot[name]?.kind ?? 'not-alias'}: not a plain alias`); continue }
    const seen = new Set([name])
    while (value.has(target) && !seen.has(target)) { seen.add(target); const next = plain(value.get(target)); if (!next) break; target = next }
    if (value.has(target)) { why(`chain ends at the bridge name ${target}, which is not a plain alias`); continue }
    const expected = snapshot[name]?.generated?.[0]
    if (snapshot[name]?.kind !== 'alias' || expected !== target) { why(`resolves to ${target}; the snapshot says ${snapshot[name]?.kind}/${expected}`); continue }
    const where = mentions(name)
    // Prose (docs .md) outside the task that only names the token is reported, not blocking: nothing reads it.
    for (const m of where.filter(m => !allowed.has(m.path) && /\.md$/.test(m.path) && !m.reads)) report.otherMentions.push({ name, ...m, note: 'prose outside the task, left as is' })
    const outside = where.filter(m => !allowed.has(m.path) && !(/\.md$/.test(m.path) && !m.reads))
    const code = where.filter(m => m.other > 0 && /^src\//.test(m.path))
    if (outside.length) { report.outsideAllowed.push({ name, files: outside }); why('mentioned in files outside the task'); continue }
    if (code.length) { why(`mentioned outside var() in ${code.map(m => m.path).join(', ')}`); continue }
    for (const m of where.filter(m => m.other > 0)) report.otherMentions.push({ name, ...m })
    report.moved[name] = target
  }
  const moved = report.moved
  for (const [path] of contents) {
    if (!allowed.has(path) || !/^src\//.test(path) || path === BRIDGE || path === 'src/styles/tokens.generated.css') continue
    edit(path, text => text.replace(/var\(\s*(--[\w-]+)(?=[\s,)])/g, (match, name) => moved[name] ? `var(${moved[name]}` : match))
  }
  edit(BRIDGE, text => text.split('\n').filter(line => { const m = /^\s*(--[\w-]+)\s*:/.exec(line); return !(m && moved[m[1]]) }).join('\n'))
  report.retired = moved
} else {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'))
  for (const [from, to] of Object.entries(map)) {
    for (const m of mentions(from)) if (!allowed.has(m.path)) report.outsideAllowed.push({ name: from, files: [m] })
  }
  const names = Object.keys(map).sort((a, b) => b.length - a.length)
  const any = new RegExp(`(?<![\\w-])(${names.map(esc).join('|')})(?![\\w-])`, 'g')
  for (const [path] of contents) {
    if (!allowed.has(path) || path === RETIRED || path === 'tests/fixtures/token-bridge-snapshot.json') continue
    edit(path, text => text.replace(any, name => map[name]))
  }
  report.retired = map
}

// RETIRED_TOKEN_NAMES (src/design/tokens/retired.ts): the entries already there, plus this run's.
if (allowed.has(RETIRED) && Object.keys(report.retired).length) {
  const previous = existsSync(join(root, RETIRED)) ? Object.fromEntries([...read(RETIRED).matchAll(/^\s*'(--[\w-]+)':\s*'([^']*)',?$/gm)].map(m => [m[1], m[2]])) : {}
  const all = { ...previous, ...report.retired }
  const lines = Object.entries(all).map(([from, to]) => `  '${from}': '${to}'`).join(',\n')
  edits.set(RETIRED, `/**
 * Token names that left the compatibility bridge (src/styles/tokens.css) or the generator, OXE-137 (1.5.2): each legacy
 * name maps to the custom property, or the CSS value, that replaced it, so tests/unit/token-bridge.test.ts can check
 * that no value changed. Written by the unbridge codemod; a name never comes back to the bridge.
 */
export const RETIRED_TOKEN_NAMES: Readonly<Record<string, string>> = {
${lines}
}
`)
}

const notAllowed = [...edits.keys()].filter(path => !allowed.has(path))
if (notAllowed.length) throw new Error(`refusing: would write outside the task files: ${notAllowed.join(', ')}`)
for (const [path, text] of edits) { report.written.push(path); if (!dryRun) writeFileSync(join(root, path), text) }
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`${report.mode}: ${Object.keys(report.retired).length} names, ${report.written.length} files${dryRun ? ' (dry run)' : ''}, ${report.skipped.length} skipped, ${report.outsideAllowed.length} outside`)
