// Frozen acceptance test for the 1.5.0 cockpit item R0d (OXE program, phase F2): delegation's enrich no longer uses AI
// Memory or CodeGraph. Written by the planner; the executor must not edit it. Static checks only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function files(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return []
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const rel = `${dir}/${name}`
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(name) ? [rel] : []
  })
}

describe('R0d · delegation enrich without AI Memory or CodeGraph', () => {
  test('R0d: the enrich passed to DelegationService uses neither memory nor CodeGraph', () => {
    const index = read('electron/main/index.ts')
    const start = index.indexOf('new DelegationService(')
    expect(start).toBeGreaterThan(-1)
    const block = index.slice(start, index.indexOf('\n  })', start))
    for (const name of ['memoryService', 'codeGraphService', 'vendor/codegraph', 'codegraph_explore', 'getRelevantContext']) expect(block, name).not.toContain(name)
  })

  test('R0d: no delegation module imports AI Memory or the vendored CodeGraph', () => {
    const offenders = [...files('electron/main/services/delegation'), 'electron/main/services/delegation.service.ts']
      .filter(file => existsSync(join(ROOT, file)))
      .filter(file => /from\s*['"][^'"]*(services\/memory\/|\/memory\/|vendor\/codegraph)[^'"]*['"]/.test(read(file)))
    expect(offenders).toEqual([])
  })
})
