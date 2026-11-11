// Frozen acceptance test for the 1.5.0 cockpit removal R9, renderer side (OXE program, phase F2, task FE-R9). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R9).
// The renderer had no documentation-tools surface on 34746339; this guards that none comes back with R0c's move.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

describe('R9 · the documentation tools have no renderer surface', () => {
  test('no renderer source names the documentation tools or their IPC', () => {
    const pattern = /oxespace_documentation_|window\.oxe\??\.documentation\b|IPC_CHANNELS\.documentation\b|agentDocumentation/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })
})
