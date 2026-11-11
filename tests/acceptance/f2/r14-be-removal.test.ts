// Frozen acceptance test for the 1.5.0 cockpit removal R14-be (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/services/oxepost","electron/main/ipc/oxepost.ipc.ts"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R14-be · Remove the OxePost backend (services/oxepost, oxepost.ipc, shared/oxepost); the HTTP panel (H1–H3) replaces the mode", () => {
  test("R14-be: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R14-be: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*(services/oxepost/|oxepost\\.ipc)[^'\"]*['\"]","IPC_CHANNELS\\.oxePost\\b","window\\.oxe\\.oxePost\\b"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R14-be: its IPC channel groups are gone", async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(["oxePost"].filter(group => group in IPC_CHANNELS)).toEqual([])
  })
  test("R14-be: its data is covered by the one-time export", () => {
    const exporter = 'electron/main/services/data-export/removed-features-export.ts'
    expect(existsSync(join(ROOT, exporter))).toBe(true)
    expect(read(exporter)).toMatch("oxepostCollections")
  })
})
