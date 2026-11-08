// Frozen acceptance test for the 1.5.0 cockpit removal R6, renderer side (OXE program, phase F2, task FE-R6). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R6).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

const GONE = ['src/components/Linear', 'src/store/linear.store.ts']

describe('R6 · Linear leaves the renderer; the official Linear MCP stays', () => {
  test('the Linear panel and store are gone and no renderer source opens them', () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
    const pattern = /LinearPanel|linear\.store|useLinearStore|isLinearPanelOpen|openLinearPanel|closeLinearPanel|window\.oxe\??\.linear\b/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
    expect(read('src/lib/externalLinks.ts')).not.toMatch(/'linear'/)
  })

  test('the command palette has no open-linear command', () => {
    expect(sources('src').filter(file => /open-linear/.test(read(file)))).toEqual([])
  })

  test('the MCP connector catalog still offers the official Linear MCP', async () => {
    const { MCP_CATALOG } = await import('../../../src/components/MCP/connectorCatalog')
    const linear = MCP_CATALOG.find(entry => entry.id === 'linear')
    expect(linear?.name).toBe('Linear')
  })
})
