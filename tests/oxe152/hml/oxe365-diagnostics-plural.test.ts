import { describe, expect, test } from 'vitest'
import { i18n } from '../../../src/i18n'

// OXE-365 (HML3): the Settings › Diagnostics summary read "2 warning" in English; the catalog had no plural forms.
describe('OXE-365 · en/settings.json renders the diagnostics counts in the plural', () => {
  const t = i18n.getFixedT('en', 'settings')

  test('"2 warnings", and "1 warning" for one', () => {
    expect(t('diagnostics.warning', { count: 2 })).toBe('2 warnings')
    expect(t('diagnostics.warning', { count: 1 })).toBe('1 warning')
  })

  test('"All 3 checks passing", and "1 check passing" for one', () => {
    expect(t('diagnostics.allPassing', { count: 3 })).toBe('All 3 checks passing')
    expect(t('diagnostics.allPassing', { count: 1 })).toBe('1 check passing')
  })
})
