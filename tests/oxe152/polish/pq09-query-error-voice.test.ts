import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

type JsonRecord = Record<string, unknown>

function collectRecoveryEntries(node: unknown, prefix = ''): Array<[string, string]> {
  if (!node || typeof node !== 'object') return []
  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(node as JsonRecord)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (key === 'recovery' && typeof value === 'string') {
      entries.push([path, value])
    } else if (value && typeof value === 'object') {
      entries.push(...collectRecoveryEntries(value, path))
    }
  }
  return entries
}

const ANNOUNCES_TECHNICAL_DETAILS =
  /detalhes?\s+t[eé]cnicos?|technical\s+details?|leia\s+os\s+detalhes|read\s+the\s+details?\s+below/i

describe('OXE-289 PE-09·G QueryError recovery voice', () => {
  test('no recovery line in queryError.* announces the technical details in pt-BR or en', () => {
    for (const locale of ['pt-BR', 'en'] as const) {
      const catalog = JSON.parse(
        readFileSync(join(process.cwd(), `shared/locales/${locale}/oxequery.json`), 'utf8')
      ) as { queryError: JsonRecord }

      const recoveries = collectRecoveryEntries(catalog.queryError, 'queryError')
      expect(recoveries.length, `${locale} has queryError.*.recovery entries`).toBeGreaterThanOrEqual(19)

      for (const [key, text] of recoveries) {
        expect(text.trim().length, `${locale} ${key} is non-empty`).toBeGreaterThan(0)
        expect(text, `${locale} ${key} must not announce technical details`).not.toMatch(ANNOUNCES_TECHNICAL_DETAILS)
      }

      // The sibling <details> summary keeps the glossary wording intact.
      expect(catalog.queryError.technical).toBe(locale === 'pt-BR' ? 'Detalhes técnicos' : 'Technical details')
    }
  })
})
