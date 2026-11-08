// Frozen acceptance test for the 1.5.0 cockpit removal R0b (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = []
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R0b · One-time export of the removed features' data to <userData>/exports/1.5-removed-<ts>.json, plus the Settings › Data button", () => {
  test("R0b: the moved or new modules exist and export their names", () => {
    const modules: Record<string, string[]> = {"electron/main/services/data-export/removed-features-export.ts":["exportRemovedFeatures","removedFeaturesState","markRemovedFeaturesNoticeShown"]}
    for (const [path, names] of Object.entries(modules)) {
      expect(existsSync(join(ROOT, path)), path).toBe(true)
      const text = read(path)
      for (const name of names) expect(new RegExp(`export\\s+(async\\s+)?(function|const|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(text), `${path} exports ${name}`).toBe(true)
    }
  })
})
