// Frozen acceptance test for the 1.5.0 cockpit removal R8, renderer side (OXE program, phase F2, task FE-R8). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R8).
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

describe('R8 · scheduled automations leave the renderer', () => {
  test('the automations settings are gone and no renderer source calls the automation API', () => {
    expect(existsSync(join(ROOT, 'src/components/Settings/AutomationsSettings.tsx'))).toBe(false)
    const pattern = /AutomationsSettings|window\.oxe\??\.automations?\b|shared\/types\/automation/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('no automations catalog key is left, in en or pt-BR', () => {
    const left = (['en', 'pt-BR'] as const).flatMap(locale => (['code', 'common', 'settings'] as const).flatMap(ns =>
      keys(JSON.parse(read(`shared/locales/${locale}/${ns}.json`))).filter(key => /^automations\./.test(key)).map(key => `${locale}/${ns}: ${key}`)))
    expect(left).toEqual([])
  })
})
