// @vitest-environment node
/**
 * The main process entry (out/main/index.js) has a byte budget (scripts/verify-bundle-budgets.mjs) and carries
 * everything electron/main/index.ts reaches through static imports. Features used on demand load behind
 * `await import(...)`, which Rollup emits as their own chunks. This walks the static import graph from the entry
 * and fails when one of those modules is reached eagerly again, before a build has to say so.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const ENTRY = join(ROOT, 'electron', 'main', 'index.ts')

/** Loaded on demand, each by the module named; the entry must not reach them statically. */
const ON_DEMAND: Array<{ module: string; loadedBy: string }> = [
  { module: 'electron/main/services/voice.service.ts', loadedBy: 'ipc/voice.ipc.ts, first voice request' },
  { module: 'electron/main/services/session-search/index.ts', loadedBy: 'ipc/session.ipc.ts, first session search' },
  { module: 'electron/main/services/oxe.service.ts', loadedBy: 'ipc/oxe.ipc.ts, first OXE request' },
  { module: 'electron/main/services/agent-hooks/installer.ts', loadedBy: 'ipc/agent-hooks.ipc.ts, Settings' },
  { module: 'electron/main/services/oxequery/agent-gateway.ts', loadedBy: 'services/oxequery/startup.ts, first OxeQuery request' },
  { module: 'electron/main/services/github/parsers.ts', loadedBy: 'ipc/github.ipc.ts, after the first window' },
  { module: 'electron/main/services/github.service.ts', loadedBy: 'index.ts, after the first window' },
  { module: 'electron/main/services/git.service.ts', loadedBy: 'index.ts, after the first window' },
  { module: 'electron/main/services/codegraph.service.ts', loadedBy: 'index.ts, after the first window' },
  { module: 'electron/main/services/delegation.service.ts', loadedBy: 'index.ts, after the database opens' },
  { module: 'electron/main/services/diagnostics/runtime.ts', loadedBy: 'ipc/diagnostics.ipc.ts, first measurement' },
  { module: 'electron/main/services/diagnostics/zip-writer.ts', loadedBy: 'ipc/diagnostics.ipc.ts, bundle export' },
  { module: 'electron/main/services/issue-report.ts', loadedBy: 'ipc/diagnostics.ipc.ts, problem report' },
  { module: 'electron/main/ipc/thread.ipc.ts', loadedBy: 'index.ts, after OxeQuery starts' },
  { module: 'electron/main/services/activity-store.ts', loadedBy: 'ipc/activity.ipc.ts, first activity request' },
  { module: 'shared/activity.ts', loadedBy: 'services/activity-store.ts, first activity request' },
  { module: 'electron/main/e2e/mock-ipc.ts', loadedBy: 'index.ts, E2E mock launches only' },
  { module: 'resources/memory/agent-hook.cjs', loadedBy: 'services/memory/agent-memory-adapter.ts, hook setup' },
  { module: 'resources/agent-hooks/oxespace-status-hook.cjs', loadedBy: 'ipc/agent-hooks.ipc.ts, Settings' },
  { module: 'resources/mcp-bridge/oxespace-mcp.cjs', loadedBy: 'mcp-internal/bootstrap.ts, internal MCP start' }
]

/** Static import specifiers of one module: `import … from`, `export … from` and bare `import '…'`, never `import type`. */
function staticImports(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/^(?:import|export)\s+(?!type\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm)) found.push(match[1])
  for (const match of source.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) found.push(match[1])
  return found
}

function resolveModule(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier.replace(/\?raw$/, ''))
  for (const candidate of [base, `${base}.ts`, `${base}.cts`, `${base}.mts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every file the entry reaches without a dynamic import, with the first path that reaches each. */
function staticGraph(entry: string): Map<string, string[]> {
  const reached = new Map<string, string[]>()
  const queue: Array<{ file: string; path: string[] }> = [{ file: entry, path: [] }]
  while (queue.length) {
    const { file, path } = queue.shift()!
    if (reached.has(file)) continue
    reached.set(file, path)
    if (!/\.[cm]?ts$/.test(file)) continue
    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      const target = resolveModule(file, specifier)
      if (target && !reached.has(target)) queue.push({ file: target, path: [...path, relative(ROOT, file).replace(/\\/g, '/')] })
    }
  }
  return reached
}

describe('main entry static imports', () => {
  const graph = staticGraph(ENTRY)
  const files = new Set([...graph.keys()].map(file => relative(ROOT, file).replace(/\\/g, '/')))

  test('reaches the modules boot does need', () => {
    expect(files).toContain('electron/main/db/index.ts')
    expect(files).toContain('electron/main/services/terminal.service.ts')
    expect(files).toContain('electron/main/mcp-internal/tool-registry.ts')
    expect(files.size).toBeGreaterThan(100)
  })

  test.each(ON_DEMAND)('$module stays off the entry chunk (loaded by $loadedBy)', ({ module }) => {
    const absolute = join(ROOT, module)
    expect(existsSync(absolute), `${module} exists`).toBe(true)
    const path = graph.get(absolute)
    expect(path, path ? `reached statically through ${path.join(' -> ')}` : '').toBeUndefined()
  })

  test('the walker sees through import type and multi-line imports', () => {
    expect(staticImports("import type { A } from './a'\nimport {\n  b,\n  c\n} from './b'\nimport './c'\nexport { d } from './d'\nexport type { E } from './e'"))
      .toEqual(['./b', './d', './c'])
  })
})
