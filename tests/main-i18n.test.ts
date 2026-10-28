// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isReady: () => true, getLocale: () => 'pt-BR' } }))

const previous = process.env.OXESPACE_LOCALE
delete process.env.OXESPACE_LOCALE
const { setMainLanguage, systemLocale, tMain } = await import('../electron/main/i18n')
afterAll(() => { if (previous !== undefined) process.env.OXESPACE_LOCALE = previous })

describe('main process translations', () => {
  it('starts in the system language and follows the renderer', () => {
    expect(systemLocale()).toBe('pt-BR')
    expect(tMain('crash.rendererGone.title')).toBe('O OXESpace parou de responder')
    expect(setMainLanguage('en')).toBe('en')
    expect(tMain('crash.unexpected.restart')).toBe('Restart OXESpace')
    // Anything unknown means "follow the system".
    expect(setMainLanguage('klingon')).toBe('pt-BR')
    expect(tMain('crash.unexpected.keepWorking')).toBe('Continuar trabalhando')
  })
})
