import { describe, expect, test, vi } from 'vitest'

// The window went blank at startup (F17 found it on #197): the static command sources register when their module is
// imported, which can be before the translator starts, and `tCommand('aboutKeywords').split(...)` then ran on
// undefined. Here the app's i18n is a translator that never started, so nothing comes back from t().
vi.mock('../src/i18n', async () => {
  const { default: i18next } = await import('i18next')
  const i18n = i18next.createInstance()
  return { i18n, default: i18n }
})

describe('palette commands before the translator starts', () => {
  test('the static sources register without throwing, with string labels and keywords', async () => {
    const { i18n } = await import('../src/i18n')
    expect(i18n.isInitialized).toBeFalsy()
    await expect(import('../src/commands/settings.commands')).resolves.toBeDefined()
    await expect(import('../src/commands/activity.commands')).resolves.toBeDefined()
    const { tCommand } = await import('../src/commands/commandText')
    expect(tCommand('aboutKeywords')).toBe('')
    expect(typeof tCommand('about')).toBe('string')
  })
})
