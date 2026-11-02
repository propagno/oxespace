import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_HELP, VOICE_PREFS_KEY, dictationHelpUrl, showVoiceRemovedNotice } from '../src/app/voiceRemovedNotice'
import { changeLanguage } from '../src/i18n'
import { useToasts } from '../src/ui/Toast'

const openExternal = vi.fn(async () => ({ opened: true }))

beforeEach(() => {
  useToasts.setState({ items: [] })
  localStorage.clear()
  openExternal.mockClear()
  ;(window as unknown as { oxe: unknown }).oxe = { app: { openExternal } }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('F34: the one-time notice that OXEVoice was removed', () => {
  it('shows once to a former voice user, stays until dismissed, and deletes the stored preferences', () => {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ state: { modelSize: 'base', pttHotkey: 'Ctrl+Shift+Space' } }))
    expect(showVoiceRemovedNotice()).toBe(true)
    expect(useToasts.getState().items).toEqual([expect.objectContaining({
      title: 'Voice input was removed',
      description: "OXESpace no longer records speech. Your operating system's dictation still types into any field.",
      intent: 'info',
      timeout: 0,
      action: expect.objectContaining({ label: 'How to dictate' })
    })])
    expect(localStorage.getItem(VOICE_PREFS_KEY)).toBeNull()
    // The next start finds nothing to tell.
    expect(showVoiceRemovedNotice()).toBe(false)
    expect(useToasts.getState().items).toHaveLength(1)
  })

  it('never shows to someone who did not use voice', () => {
    expect(showVoiceRemovedNotice()).toBe(false)
    expect(useToasts.getState().items).toEqual([])
  })

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => showVoiceRemovedNotice()).not.toThrow()
    expect(useToasts.getState().items).toEqual([])
  })

  it('speaks Portuguese in pt-BR', async () => {
    await changeLanguage('pt-BR')
    localStorage.setItem(VOICE_PREFS_KEY, '{}')
    showVoiceRemovedNotice()
    expect(useToasts.getState().items[0]).toMatchObject({
      title: 'O OXEVoice foi removido',
      description: 'O OXESpace não grava mais voz. O ditado do seu sistema continua digitando em qualquer campo.',
      action: { label: 'Como ditar' }
    })
  })

  it('the action opens the dictation help page of this platform', async () => {
    vi.spyOn(Navigator.prototype, 'platform', 'get').mockReturnValue('MacIntel')
    vi.spyOn(Navigator.prototype, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    localStorage.setItem(VOICE_PREFS_KEY, '{}')
    showVoiceRemovedNotice()
    useToasts.getState().items[0].action!.run()
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(DICTATION_HELP.mac))
  })

  it('picks the help page by platform', () => {
    expect(dictationHelpUrl({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(DICTATION_HELP.windows)
    expect(dictationHelpUrl({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe(DICTATION_HELP.mac)
    expect(dictationHelpUrl({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(DICTATION_HELP.linux)
    expect(dictationHelpUrl({ platform: '', userAgent: '' })).toBe(DICTATION_HELP.linux)
  })
})
