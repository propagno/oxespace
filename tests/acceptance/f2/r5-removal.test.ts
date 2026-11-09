// Frozen acceptance test for the 1.5.0 cockpit removal R5 (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/services/memory","electron/main/ipc/memory.ipc.ts","electron/main/ipc/memory-manage.ipc.ts","electron/main/mcp-internal/memory-tool-handlers.ts","resources/memory/agent-hook.cjs"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R5 · Remove AI Memory (services/memory, its IPC and MCP tools, the agent hook); migrations 047/082 and memory_projects stay", () => {
  test("R5: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R5: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*services/memory/[^'\"]*['\"]","memory-tool-handlers","memory(-manage)?\\.ipc","IPC_CHANNELS\\.memory\\b","window\\.oxe\\.memory\\b"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R5: its MCP tools are gone from the app, the bridge and the coverage", () => {
    const tools: string[] = ["oxespace_memory_search","oxespace_memory_remember","oxespace_memory_sessions","oxespace_memory_handoffs","oxespace_memory_accept_handoff"]
    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(`['"\`]${tool}(?![a-z_])`).test(text)).map(tool => `${file}: ${tool}`) })
    expect(offenders).toEqual([])
  })
  test("R5: its IPC channel groups are gone", async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(["memory"].filter(group => group in IPC_CHANNELS)).toEqual([])
  })
  test("R5: what it keeps is still there", () => {
    expect(["electron/main/db/migrations/047_project_memory.sql","electron/main/db/migrations/082_memory_notes.sql"].filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R5: its data is covered by the one-time export", () => {
    const exporter = 'electron/main/services/data-export/removed-features-export.ts'
    expect(existsSync(join(ROOT, exporter))).toBe(true)
    expect(read(exporter)).toMatch("memories")
  })
})
