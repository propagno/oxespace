// Frozen acceptance test for the 1.5.0 cockpit removal R4, renderer side (OXE program, phase F2, task FE-R4). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R4).
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

describe('R4 · RTK leaves the renderer', () => {
  test('no renderer source names RTK (rtk, Rtk, RTK, rtkHookEnabled, disableRtk)', () => {
    const pattern = /\brtk|Rtk\b|\bRTK\b|rtkHookEnabled|disableRtk|menu-toggle-rtk|settings-rtk-update/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('the updater store has no rtk slice and the title bar shows only the app update', async () => {
    const { useUpdaterStore } = await import('../../../src/store/updater.store')
    const state = useUpdaterStore.getState() as unknown as Record<string, unknown>
    expect(['rtk', 'checkRtk', 'updateRtk'].filter(name => name in state)).toEqual([])
    expect(existsSync(join(ROOT, 'src/components/Updates/UpdateBanner.tsx'))).toBe(false)
    expect(read('src/app/UpdateChips.tsx')).not.toMatch(/UpdateBanner/)
  })

  test('no catalog key under terminalPane.rtk or updates.rtk is left, in en or pt-BR', () => {
    const left = (['en', 'pt-BR'] as const).flatMap(locale => (['code', 'common', 'settings'] as const).flatMap(ns =>
      keys(JSON.parse(read(`shared/locales/${locale}/${ns}.json`))).filter(key => /^(terminalPane\.rtk|updates\.rtk)/.test(key)).map(key => `${locale}/${ns}: ${key}`)))
    expect(left).toEqual([])
  })
})
