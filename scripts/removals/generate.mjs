// Generates, from items.mjs: the frozen static tests tests/acceptance/f2/<id>-removal.test.ts and the task list
// .claude/roadmap-1.4/team/plans/f2-removals-BACKEND.json (written to the path given as argv[2]).
// Run from the repo root: node scripts/removals/generate.mjs <tasks-json-path>
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ITEMS } from './items.mjs'

const HOT = ['electron/main/index.ts', 'electron/main/ipc/thread.ipc.ts', 'electron.vite.config.ts']
const SEARCH = ['electron', 'src', 'shared', 'resources', 'scripts', 'tests', 'e2e', 'package.json', 'electron.vite.config.ts', 'electron-builder.yml']
const slug = id => id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const testFile = item => `tests/acceptance/f2/${slug(item.id)}-removal.test.ts`

function grep(regex) {
  try {
    return execFileSync('git', ['grep', '-lE', regex, '--', ...SEARCH], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch { return [] }
}
const within = (file, roots) => roots.some(root => file === root || file.startsWith(`${root.replace(/\/$/, '')}/`))

function titles(item) {
  const t = []
  if (item.gone?.length) t.push(`${item.id}: the removed paths are gone`)
  if (item.imports?.length) t.push(`${item.id}: nothing under electron, src, shared or resources imports what was removed`)
  if (item.tools?.length && item.custom !== 'r13') t.push(`${item.id}: its MCP tools are gone from the app, the bridge and the coverage`)
  if (item.ipc?.length) t.push(`${item.id}: its IPC channel groups are gone`)
  if (item.deps?.length || item.keepDeps?.length) t.push(`${item.id}: package.json drops its packages and keeps the ones still used`)
  if (item.keep?.length) t.push(`${item.id}: what it keeps is still there`)
  if (item.exists) t.push(`${item.id}: the moved or new modules exist and export their names`)
  if (item.data) t.push(`${item.id}: its data is covered by the one-time export`)
  return t
}

function staticTest(item) {
  const j = JSON.stringify
  const lines = [
    `// Frozen acceptance test for the 1.5.0 cockpit removal ${item.id} (OXE program, phase F2). Written by the planner; the executor must not edit it.`,
    `// Generated from scripts/removals/items.mjs (spec: .claude/roadmap-1.4/team/plans/1.5.0-cockpit-direction.md §3). Static checks only.`,
    `import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    `import { describe, expect, test } from 'vitest'`,
    '',
    `const ROOT = process.cwd()`,
    `const SKIP = new Set(['node_modules', 'out', 'dist', 'release', '.git'])`,
    `/** Source files under the app's folders, minus what this item removes. */`,
    `function sources(dirs: string[], excluded: string[]): string[] {`,
    `  const files: string[] = []`,
    `  const walk = (dir: string): void => {`,
    `    for (const name of readdirSync(join(ROOT, dir))) {`,
    `      if (SKIP.has(name)) continue`,
    `      const rel = \`\${dir}/\${name}\``,
    `      if (excluded.some(root => rel === root || rel.startsWith(\`\${root}/\`))) continue`,
    `      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)`,
    `      else if (/\\.(ts|tsx|js|cjs|mjs|json)$/.test(name)) files.push(rel)`,
    `    }`,
    `  }`,
    `  for (const dir of dirs) if (existsSync(join(ROOT, dir))) walk(dir)`,
    `  return files`,
    `}`,
    `const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')`,
    '',
    `const GONE: string[] = ${j(item.gone ?? [])}`,
    `const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)`,
    '',
    `describe(${j(`${item.id} · ${item.title}`)}, () => {`
  ]
  const [tGone, tImports, tTools, tIpc, tDeps, tKeep, tExists, tData] = [
    `${item.id}: the removed paths are gone`, `${item.id}: nothing under electron, src, shared or resources imports what was removed`,
    `${item.id}: its MCP tools are gone from the app, the bridge and the coverage`, `${item.id}: its IPC channel groups are gone`,
    `${item.id}: package.json drops its packages and keeps the ones still used`, `${item.id}: what it keeps is still there`,
    `${item.id}: the moved or new modules exist and export their names`, `${item.id}: its data is covered by the one-time export`]
  if (item.gone?.length) lines.push(
    `  test(${j(tGone)}, () => {`,
    `    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])`,
    `  })`)
  if (item.imports?.length) lines.push(
    `  test(${j(tImports)}, () => {`,
    `    const patterns = ${j(item.imports)}.map(source => new RegExp(source))`,
    `    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => \`\${file}: \${pattern.source}\`) })`,
    `    expect(offenders).toEqual([])`,
    `  })`)
  if (item.tools?.length && item.custom !== 'r13') lines.push(
    `  test(${j(tTools)}, () => {`,
    `    const tools: string[] = ${j(item.tools)}`,
    `    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(\`['"\\\`]\${tool}(?![a-z_])\`).test(text)).map(tool => \`\${file}: \${tool}\`) })`,
    `    expect(offenders).toEqual([])`,
    `  })`)
  if (item.ipc?.length) lines.push(
    `  test(${j(tIpc)}, async () => {`,
    `    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')`,
    `    expect(${j(item.ipc)}.filter(group => group in IPC_CHANNELS)).toEqual([])`,
    `  })`)
  if (item.deps?.length || item.keepDeps?.length) lines.push(
    `  test(${j(tDeps)}, () => {`,
    `    const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>`,
    `    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }`,
    `    expect(${j(item.deps ?? [])}.filter(name => name in all)).toEqual([])`,
    `    expect(${j(item.keepDeps ?? [])}.filter(name => !(name in all))).toEqual([])`,
    `  })`)
  if (item.keep?.length) lines.push(
    `  test(${j(tKeep)}, () => {`,
    `    expect(${j(item.keep)}.filter(path => !existsSync(join(ROOT, path)))).toEqual([])`,
    `  })`)
  if (item.exists) lines.push(
    `  test(${j(tExists)}, () => {`,
    `    const modules: Record<string, string[]> = ${j(item.exists)}`,
    `    for (const [path, names] of Object.entries(modules)) {`,
    `      expect(existsSync(join(ROOT, path)), path).toBe(true)`,
    `      const text = read(path)`,
    `      for (const name of names) expect(new RegExp(\`export\\\\s+(async\\\\s+)?(function|const|class)\\\\s+\${name}\\\\b|export\\\\s*\\\\{[^}]*\\\\b\${name}\\\\b\`).test(text), \`\${path} exports \${name}\`).toBe(true)`,
    `    }`,
    `  })`)
  if (item.data) lines.push(
    `  test(${j(tData)}, () => {`,
    `    const exporter = 'electron/main/services/data-export/removed-features-export.ts'`,
    `    expect(existsSync(join(ROOT, exporter))).toBe(true)`,
    `    expect(read(exporter)).toMatch(${j({ R8: 'automations', R5: 'memories', 'R14-be': 'oxepostCollections' }[item.id] ?? item.id)})`,
    `  })`)
  lines.push(`})`, '')
  return lines.join('\n')
}

const tasks = []
mkdirSync('tests/acceptance/f2', { recursive: true })
for (const item of ITEMS) {
  const roots = (item.gone ?? []).filter(path => existsSync(path) && !path.includes('.'))
  const refs = [...new Set((item.refs ?? []).flatMap(grep))]
    .filter(file => !file.startsWith('tests/token-bench/results/') && !file.startsWith('scripts/removals/') && !within(file, roots))
    .filter(file => item.id === 'R1' || !file.startsWith('electron/main/vendor/'))
  // Backend-only (TECH LEAD, 08/11): FE's paired task (FE-<id>) owns every renderer file except the window.oxe typing.
  const backend = file => !file.startsWith('src/') || file === 'src/types/window.d.ts'
  const files = [...new Set([...(item.gone ?? []).map(path => roots.includes(path) ? `${path}/` : path), ...Object.keys(item.exists ?? {}), ...refs, ...(item.extra ?? [])])].filter(backend).sort()
  const hot = HOT.filter(path => files.includes(path))
  const governance = [
    ...(item.tools?.length || files.includes('shared/mcp-coverage.ts') ? ['tests/mcp-coverage.test.ts'] : []),
    ...(item.ipc?.length || files.includes('shared/types/ipc.ts') || files.includes('electron/preload/api.ts') ? ['tests/integration/ipc-contracts.test.ts', 'tests/integration/preload-api.test.ts'] : []),
    ...(files.includes('tests/integration/fs-allowlist.test.ts') ? ['tests/integration/fs-allowlist.test.ts'] : []),
    ...(files.some(file => file.startsWith('shared/locales/')) ? ['tests/i18n-catalog.test.ts'] : []),
    ...(files.includes('tests/remote-ipc-contract.test.ts') || item.ipc?.length ? ['tests/remote-ipc-contract.test.ts'] : [])
  ]
  const suites = [...new Set([...files.filter(file => /^(tests|e2e)\/.*\.(test|spec)\.tsx?$/.test(file) && !(item.gone ?? []).includes(file)), ...governance])].sort()
  const frozen = item.custom && !item.gone && !item.imports ? [] : [testFile(item)]
  const extraFrozen = { R0b: ['tests/acceptance/f2/r0b-removed-features-export.native.test.ts'], R5: ['tests/acceptance/f2/r5-v58-upgrade.native.test.ts'], R0d: ['tests/acceptance/f2/r0d-delegation-enrich.test.ts'], R3: ['tests/acceptance/f2/r3-mcp-instructions.test.ts'], R13: ['tests/acceptance/f2/r13-work-aliases.test.ts'], 'R15-be': ['tests/acceptance/f2/r15-oxepod-backend-kept.test.ts'], 'R11-be': ['tests/acceptance/f2/r11-be-no-write-file.test.ts'], 'R14-be': ['tests/acceptance/f2/r14-be-user-files-kept.test.ts'] }[item.id] ?? []
  const run = file => file.includes('.native.') || /migrations|db-|oxepost-service|automations\.test|team-ipc/.test(file) ? `npm run test:electron -- ${file}` : `npx vitest run ${file}`
  const verify = [...frozen, ...extraFrozen].map(run).concat(suites.filter(file => file.startsWith('tests/')).map(run))
  tasks.push({
    id: item.id, title: item.title, criteria: ['A48'], depends_on: item.depends_on,
    files, ...(hot.length ? { hot_files: hot } : {}),
    affected_suites: suites, verify: [...new Set(verify)],
    proves: Object.fromEntries([
      ...(frozen.length ? [[testFile(item), titles(item)]] : []),
      ...extraFrozen.map(file => [file, existsSync(file) ? [...readFileSync(file, 'utf8').matchAll(/^\s*test\('((?:[^'\\]|\\.)*)'/gm)].map(match => match[1].replace(/\\'/g, "'")) : ['(missing: write the hand-made test first)']])
    ]),
    complexity: item.complexity,
    notes: `${item.notes} Pairing: FE's ${item.id.startsWith('R0') ? 'FE-' + item.id : 'FE-' + item.id.replace(/-be$/, '')} owns the renderer files (src/**, except src/types/window.d.ts). The frozen static test also scans src/ and lists src paths in GONE, so both halves land in one PR (or back to back on the train) to keep it green.`
  })
  if (frozen.length) writeFileSync(testFile(item), staticTest(item))
}
writeFileSync(process.argv[2], JSON.stringify(tasks, null, 2) + '\n')
console.log(tasks.map(task => `${task.id}: ${task.files.length} files${task.hot_files ? ` (hot: ${task.hot_files.join(', ')})` : ''}, ${task.verify.length} checks`).join('\n'))
