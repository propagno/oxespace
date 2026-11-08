// Frozen acceptance test for the 1.5.0 cockpit removal R6 (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/services/linear.service.ts","electron/main/ipc/linear.ipc.ts","src/store/linear.store.ts","src/components/Linear","tests/integration/linear.service.test.ts"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R6 · Remove Linear (service, IPC, oxespace_linear, store and UI)", () => {
  test("R6: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R6: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*(linear\\.service|linear\\.ipc|linear\\.store)['\"]","IPC_CHANNELS\\.linear\\b","window\\.oxe\\.linear\\b"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R6: its MCP tools are gone from the app, the bridge and the coverage", () => {
    const tools: string[] = ["oxespace_linear"]
    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(`['"\`]${tool}(?![a-z_])`).test(text)).map(tool => `${file}: ${tool}`) })
    expect(offenders).toEqual([])
  })
  test("R6: its IPC channel groups are gone", async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(["linear"].filter(group => group in IPC_CHANNELS)).toEqual([])
  })
})
