// Frozen acceptance test for the 1.5.0 cockpit removal R1 (OXE program, phase F2). Written by the planner; the executor must not edit it.
// Generated from scripts/removals/items.mjs (spec: .claude/roadmap-1.4/team/plans/1.5.0-cockpit-direction.md §3). Static checks only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', 'out', 'dist', 'release', '.git'])
/** Source files under the app's folders, minus what this item removes. */
function sources(dirs: string[], excluded: string[]): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (SKIP.has(name)) continue
      const rel = `${dir}/${name}`
      if (excluded.some(root => rel === root || rel.startsWith(`${root}/`))) continue
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
      else if (/\.(ts|tsx|js|cjs|mjs|json)$/.test(name)) files.push(rel)
    }
  }
  for (const dir of dirs) if (existsSync(join(ROOT, dir))) walk(dir)
  return files
}
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const GONE: string[] = ["electron/main/vendor/codegraph","electron/main/services/codegraph.service.ts","electron/main/mcp-internal/code-graph-tools.ts"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R1 · Remove the vendored CodeGraph (vendor/codegraph, codegraph.service, oxespace_code_*); web-tree-sitter stays for shell parsing", () => {
  test("R1: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R1: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*vendor/codegraph[^'\"]*['\"]","import\\(['\"][^'\"]*vendor/codegraph","codegraph\\.service","code-graph-tools"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R1: its MCP tools are gone from the app, the bridge and the coverage", () => {
    const tools: string[] = ["oxespace_code_search","oxespace_code_node","oxespace_code_callers","oxespace_code_callees","oxespace_code_impact","oxespace_code_status"]
    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(`['"\`]${tool}(?![a-z_])`).test(text)).map(tool => `${file}: ${tool}`) })
    expect(offenders).toEqual([])
  })
  test("R1: package.json drops its packages and keeps the ones still used", () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }
    expect([].filter(name => name in all)).toEqual([])
    expect(["web-tree-sitter","tree-sitter-wasms"].filter(name => !(name in all))).toEqual([])
  })
  test("R1: what it keeps is still there", () => {
    expect(["electron/main/services/conversation/shell-parse.ts"].filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
