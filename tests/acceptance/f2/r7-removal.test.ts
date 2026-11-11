// Frozen acceptance test for the 1.5.0 cockpit removal R7 (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/ipc/team.ipc.ts","electron/main/mcp-internal/team-tools.ts","src/components/Teams"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R7 · Remove the Teams UI and team IPC/MCP; the coordination core used by Delegation stays (050–052, 061/062 kept in the DB)", () => {
  test("R7: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R7: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*(team\\.ipc|team-tools|components/Teams)[^'\"]*['\"]","IPC_CHANNELS\\.team\\b","window\\.oxe\\.team\\b"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R7: its MCP tools are gone from the app, the bridge and the coverage", () => {
    const tools: string[] = ["oxespace_team_status","oxespace_team_inbox","oxespace_team_message","oxespace_team_acknowledge"]
    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(`['"\`]${tool}(?![a-z_])`).test(text)).map(tool => `${file}: ${tool}`) })
    expect(offenders).toEqual([])
  })
  test("R7: its IPC channel groups are gone", async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(["team"].filter(group => group in IPC_CHANNELS)).toEqual([])
  })
  test("R7: what it keeps is still there", () => {
    expect(["electron/main/services/coordination/coordinator.ts","electron/main/db/migrations/061_persistent_teams.sql","electron/main/db/migrations/062_team_delivery.sql"].filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
