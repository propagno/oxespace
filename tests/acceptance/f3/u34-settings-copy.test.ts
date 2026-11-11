// rigor: source-assertion — the criterion is about visible text (no Settings string names a removed feature, and two rows
// read as DESIGN wrote them), so the catalogs the window shows are what is checked.
// Frozen acceptance test for 1.5.0 A7 copy after the removals (DESIGN U3.4, OXE program, phase F3, task FE-A7). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.4).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const catalog = (locale: 'en' | 'pt-BR', ns: string): Array<[string, string]> => {
  const walk = (value: unknown, prefix = ''): Array<[string, string]> => value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => walk(child, `${prefix}${key}.`))
    : [[prefix.slice(0, -1), String(value)]]
  return walk(JSON.parse(readFileSync(join(process.cwd(), `shared/locales/${locale}/${ns}.json`), 'utf8')))
}

describe('U3.4 · Settings copy after the removals', () => {
  test('no Settings string names Automations, the Memory page or the OxePost Requests section, in en or pt-BR', () => {
    const terms: Record<'en' | 'pt-BR', RegExp> = {
      en: /\bAutomations?\b|\bAI Memory\b|\bProject memory\b|\bOxePost\b|\bCode search index\b|\bsearch by meaning\b/i,
      'pt-BR': /\bAutomaç(ão|ões)\b|\bMemória (de IA|do projeto)\b|\bOxePost\b|índice de busca de código|busca por significado/i
    }
    const left = (['en', 'pt-BR'] as const).flatMap(locale => catalog(locale, 'settings').filter(([, text]) => terms[locale].test(text)).map(([key, text]) => `${locale} ${key}: ${text.slice(0, 80)}`))
    expect(left).toEqual([])
  })

  test('the Network access row reads "Hosts agents can call.", in en and pt-BR', () => {
    expect(catalog('en', 'settings').map(([, text]) => text)).toContain('Hosts agents can call.')
    expect(catalog('pt-BR', 'settings').map(([, text]) => text)).toContain('Hosts que os agentes podem chamar.')
  })
})
