/**
 * OxeVoice F1 · CR-13 (DESIGN review of #417 @4fdc80ef) — frozen acceptance test, written by the planner before
 * execution. M1: the consent dialog is the app's dialog primitive (focus moves in, is trapped, and returns), with the
 * default focus on the safe choice, "Not now". M2: no `--layer-popover` (a token that does not exist). L: the engine
 * reason row and the error never show together, so "Open speech settings" appears once.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceDictationControl } from '../../../src/features/voice/VoiceDictationControl'
import type { VoiceEngineInfo, VoiceRendererApi, VoiceSessionEvent } from '../../../shared/types/ipc/voice'

afterEach(() => cleanup())

function apiFor(engine: VoiceEngineInfo) {
  let listener: ((event: VoiceSessionEvent) => void) | null = null
  const api: VoiceRendererApi = {
    getEngines: vi.fn(async () => [engine]),
    start: vi.fn(async () => ({ ok: true as const, sessionId: 's1' })),
    stop: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    setConsent: vi.fn(async () => [{ ...engine, consented: true, available: true, reason: null }]),
    openSpeechSettings: vi.fn(async () => undefined),
    onEvent: vi.fn((fn: (event: VoiceSessionEvent) => void) => { listener = fn; return () => { listener = null } })
  }
  return { api, emit: (event: VoiceSessionEvent) => act(() => { listener?.(event) }) }
}

const needsConsent: VoiceEngineInfo = { id: 'windows-winrt', privacy: 'os-cloud', available: false, reason: 'consent-required', languages: ['en-US'], consentRequired: true, consented: false }

async function openConsent() {
  const { api } = apiFor(needsConsent)
  render(<VoiceDictationControl api={api} onInsert={vi.fn()} />)
  const button = await screen.findByRole('button', { name: /dictate/i })
  button.focus()
  fireEvent.pointerDown(button)
  const dialog = await screen.findByRole('dialog', { name: "Use Microsoft's speech service?" })
  return { api, button, dialog }
}

describe('consent dialog on the dialog primitive (CR-13 M1/M2)', () => {
  it('opens with the focus on "Not now"', async () => {
    await openConsent()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toHaveFocus())
  })

  it('keeps the focus inside while open', async () => {
    const { dialog } = await openConsent()
    const user = userEvent.setup()
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('Escape declines and the focus returns to the dictation button', async () => {
    const { button } = await openConsent()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('Allow grants consent and closes', async () => {
    const { api } = await openConsent()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(api.setConsent).toHaveBeenCalledWith({ engineId: 'windows-winrt', granted: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('uses the shared dialog primitive, not a hand-made aria-modal surface or a missing layer token', () => {
    const tsx = readFileSync(resolve(__dirname, '../../../src/features/voice/VoiceDictationControl.tsx'), 'utf8')
    const css = readFileSync(resolve(__dirname, '../../../src/features/voice/voice.css'), 'utf8')
    expect(tsx).not.toMatch(/aria-modal/)
    expect(tsx).toMatch(/\b(ConfirmDialog|Dialog)\b/)
    expect(css).not.toMatch(/--layer-popover/)
  })
})

describe('reason row and error never together (CR-13 L)', () => {
  it('an error replaces the engine reason row, so the settings action appears once', async () => {
    const blocked: VoiceEngineInfo = { id: 'windows-winrt', privacy: 'os-cloud', available: false, reason: 'os-speech-privacy-off', languages: ['en-US'], consentRequired: true, consented: true }
    const { api, emit } = apiFor(blocked)
    render(<VoiceDictationControl api={api} onInsert={vi.fn()} />)
    await screen.findByText('Online speech recognition is off in your system settings')
    expect(screen.getAllByRole('button', { name: 'Open speech settings' })).toHaveLength(1)

    emit({ sessionId: 's1', type: 'error', message: { code: 'voice.os.speechPrivacyOff', params: {} } as never })
    await screen.findByRole('alert')
    expect(screen.getAllByRole('button', { name: 'Open speech settings' })).toHaveLength(1)
    expect(screen.queryByText('Online speech recognition is off in your system settings')).toBeNull()
  })
})
