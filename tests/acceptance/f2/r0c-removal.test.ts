// Frozen acceptance test for the 1.5.0 cockpit removal R0c (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/services/documentation/preview-automation.ts","electron/main/services/documentation/preview-capture-store.ts"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R0c · Move preview-automation and preview-capture-store out of documentation/ into services/browser-preview/", () => {
  test("R0c: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R0c: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*documentation/preview-(automation|capture-store)['\"]"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R0c: the moved or new modules exist and export their names", () => {
    const modules: Record<string, string[]> = {"electron/main/services/browser-preview/preview-automation.ts":[],"electron/main/services/browser-preview/preview-capture-store.ts":[]}
    for (const [path, names] of Object.entries(modules)) {
      expect(existsSync(join(ROOT, path)), path).toBe(true)
      const text = read(path)
      for (const name of names) expect(new RegExp(`export\\s+(async\\s+)?(function|const|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(text), `${path} exports ${name}`).toBe(true)
    }
  })
})
