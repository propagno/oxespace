// Frozen acceptance test for the 1.5.0 cockpit removal R2 (OXE program, phase F2). Written by the planner; the executor must not edit it.
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

const GONE: string[] = ["electron/main/services/semantic.service.ts","electron/main/services/semantic-chunk.ts","electron/main/services/semantic-ignore.ts","electron/main/services/semantic-model-store.ts","electron/main/services/semantic-model.ts","electron/main/services/semantic-projects.ts","electron/main/services/semantic-retrieval.ts","electron/main/ipc/semantic.ipc.ts","src/components/Semantic"]
const APP = sources(['electron', 'src', 'shared', 'resources'], GONE)

describe("R2 · Remove semantic search (services, IPC, oxespace_semantic_search, @xenova/transformers); tables 039–044 stay", () => {
  test("R2: the removed paths are gone", () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })
  test("R2: nothing under electron, src, shared or resources imports what was removed", () => {
    const patterns = ["from\\s*['\"][^'\"]*/semantic(\\.service|-chunk|-ignore|-model-store|-model|-projects|-retrieval|\\.ipc)['\"]","@xenova/transformers","IPC_CHANNELS\\.semantic\\b","window\\.oxe\\.semantic\\b"].map(source => new RegExp(source))
    const offenders = APP.flatMap(file => { const text = read(file); return patterns.filter(pattern => pattern.test(text)).map(pattern => `${file}: ${pattern.source}`) })
    expect(offenders).toEqual([])
  })
  test("R2: its MCP tools are gone from the app, the bridge and the coverage", () => {
    const tools: string[] = ["oxespace_semantic_search"]
    const offenders = APP.flatMap(file => { const text = read(file); return tools.filter(tool => new RegExp(`['"\`]${tool}(?![a-z_])`).test(text)).map(tool => `${file}: ${tool}`) })
    expect(offenders).toEqual([])
  })
  test("R2: its IPC channel groups are gone", async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(["semantic"].filter(group => group in IPC_CHANNELS)).toEqual([])
  })
  test("R2: package.json drops its packages and keeps the ones still used", () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }
    expect(["@xenova/transformers"].filter(name => name in all)).toEqual([])
    expect([].filter(name => !(name in all))).toEqual([])
  })
  test("R2: what it keeps is still there", () => {
    expect(["electron/main/db/migrations/039_semantic_embeddings.sql","electron/main/db/migrations/040_semantic_embedding_blob.sql","electron/main/db/migrations/043_semantic_lexical_index.sql","electron/main/db/migrations/044_semantic_chunk_metadata.sql"].filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
