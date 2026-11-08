// Frozen acceptance test for the 1.5.0 cockpit removal R2, renderer side (OXE program, phase F2, task FE-R2). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R2).
// The design tokens named "semantic" (colour roles) are not this feature: the scan looks for the feature's identifiers.
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
const keys = (value: unknown, prefix = ''): string[] => value && typeof value === 'object'
  ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
  : [prefix.slice(0, -1)]

const GONE = ['src/components/Semantic', 'src/components/Threads/ThreadProjectSemantic.tsx']

describe('R2 · search by meaning leaves the renderer', () => {
  test('the search-by-meaning UI files are gone and no renderer source calls window.oxe.semantic', () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
    const pattern = /window\.oxe\??\.semantic\b|SemanticActivityPanel|SemanticIndexSetting|ThreadProjectSemantic|semanticStatusSummary/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('the tool catalog has no semantic tool and the palette has no semantic hits', async () => {
    const { TOOL_CATALOG } = await import('../../../src/components/Workspace/toolCatalog')
    expect(TOOL_CATALOG.map(tool => tool.id as string)).not.toContain('semantic')
    expect(read('src/components/CommandMenu/CommandMenu.tsx')).not.toMatch(/SemanticQueryHit|semanticHits/)
    expect(read('src/commands/code.commands.ts')).not.toMatch(/'semantic'/)
  })

  test('the terminal preferences have no semantic search setting', async () => {
    const { TERMINAL_PREFS_DEFAULTS } = await import('../../../src/store/terminal-prefs.store')
    expect(Object.keys(TERMINAL_PREFS_DEFAULTS).filter(key => /semantic/i.test(key))).toEqual([])
    expect(sources('src').filter(file => /menu-toggle-semantic|semanticSearch(Enabled|Mode)/.test(read(file)))).toEqual([])
  })

  test('no semantic search catalog key is left, in en or pt-BR', () => {
    const left = (['en', 'pt-BR'] as const).flatMap(locale => (['code', 'settings', 'thread'] as const).flatMap(ns =>
      keys(JSON.parse(read(`shared/locales/${locale}/${ns}.json`)))
        .filter(key => /^(semantic\.|tools\.semantic\.|terminalPane\.semantic)/.test(key)).map(key => `${locale}/${ns}: ${key}`)))
    expect(left).toEqual([])
  })
})
