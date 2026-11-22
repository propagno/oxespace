// @vitest-environment node
// Frozen acceptance test for 1.5.2 Desempenho (program 152perf, Jira OXE-147, A1). Written by the planner; the
// executor must not edit it. Red on main 8388aa419: electron/main/services/terminal.service.ts has 1000 lines.
// Contract: terminal.service.ts is the coordinating facade, at most 800 lines; what it hands off lives in cohesive
// modules under electron/main/services/terminal/, none over 400 lines, none importing the facade back; no exception for
// it in the file-size baseline; and the facade still exports what the app and the tests import from it.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()
const facade = 'electron/main/services/terminal.service.ts'
const dir = 'electron/main/services/terminal'
const lines = (rel: string): number => readFileSync(join(root, rel), 'utf8').split(/\r?\n/).length

describe('OXE-147 · terminal.service.ts split by responsibility', () => {
  test('keeps terminal.service.ts <= 800 lines with extracted modules under electron/main/services/terminal/', async () => {
    expect(lines(facade), `${facade} is the facade`).toBeLessThanOrEqual(800)

    const modules = readdirSync(join(root, dir)).filter(name => name.endsWith('.ts'))
    // The four helpers already on main plus at least one module extracted from the facade.
    expect(modules.length).toBeGreaterThan(4)
    for (const name of modules) {
      const rel = `${dir}/${name}`
      expect(lines(rel), rel).toBeLessThanOrEqual(400)
      // A child never imports the facade back (no cycle).
      expect(readFileSync(join(root, rel), 'utf8'), rel).not.toMatch(/from ['"]\.\.\/terminal\.service['"]/)
    }

    const baseline = readFileSync(join(root, 'scripts/file-size-baseline.json'), 'utf8')
    expect(baseline).not.toContain('terminal.service.ts')

    const api = await import('../../../electron/main/services/terminal.service')
    expect(typeof api.TerminalManager).toBe('function')
    expect(typeof api.resolveExecutable).toBe('function')
    expect(typeof api.__resetExecutableCacheForTests).toBe('function')
    expect(api.CONPTY_START_SCREEN).toBe('\x1b[2J\x1b[m\x1b[H')
  })
})
