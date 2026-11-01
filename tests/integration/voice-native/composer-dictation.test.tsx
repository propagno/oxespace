/**
 * OxeVoice F1 · A7 — frozen acceptance test (written by the plan, before execution; do not edit).
 * Push-to-talk dictation for the OxeChat composer. The person always sees where the audio is processed, before and
 * while recording; recording starts only on an explicit gesture (hold the button, or hold Space/Enter on it);
 * consent for a cloud engine is asked first and never starts recording by itself; the final text goes to the draft.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceDictationControl } from '../../../src/features/voice/VoiceDictationControl'
import type { VoiceEngineInfo, VoiceRendererApi, VoiceSessionEvent } from '../../../shared/types/ipc/voice'

const cloud = (overrides: Partial<VoiceEngineInfo> = {}): VoiceEngineInfo => ({
  id: 'windows-winrt', privacy: 'os-cloud', available: true, reason: null, languages: ['pt-BR'], consentRequired: true, consented: true, ...overrides
})

function fakeApi(engines: VoiceEngineInfo[]) {
  let listener: ((event: VoiceSessionEvent) => void) | null = null
  const api: VoiceRendererApi = {
    getEngines: vi.fn(async () => engines),
    start: vi.fn(async () => ({ ok: true as const, sessionId: 's1', engine: engines[0] })),
    stop: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    setConsent: vi.fn(async ({ granted }) => engines.map(engine => ({ ...engine, consented: granted, available: true, reason: null }))),
    openSpeechSettings: vi.fn(async () => undefined),
    onEvent: vi.fn(next => { listener = next; return () => { listener = null } })
  }
  const send = (event: Omit<VoiceSessionEvent, 'sessionId'>) => act(() => { listener?.({ sessionId: 's1', ...event } as VoiceSessionEvent) })
  return { api, send, hasListener: () => listener !== null }
}

async function mount(engines: VoiceEngineInfo[]) {
  const fake = fakeApi(engines)
  const onInsert = vi.fn()
  const view = render(<VoiceDictationControl api={fake.api} onInsert={onInsert} />)
  const button = await screen.findByRole('button', { name: /dictate/i })
  await waitFor(() => expect(button).not.toBeDisabled())
  return { ...fake, onInsert, button, view }
}

afterEach(() => cleanup())

describe('OxeChat push-to-talk dictation (A7)', () => {
  it('says where the audio is processed before any recording', async () => {
    await mount([cloud()])
    expect(screen.getByTestId('voice-privacy')).toHaveTextContent(/Microsoft/)
    const onDevice = await mount([cloud({ id: 'macos-sfspeech', privacy: 'on-device', consentRequired: false })])
    expect(onDevice.view.container.querySelector('[data-testid="voice-privacy"]')).toHaveTextContent(/this device/i)
  })

  it('hold to talk: start on press, indicator with the engine privacy, partial preview, final into the draft, stop on release', async () => {
    const { api, send, onInsert, button } = await mount([cloud()])
    fireEvent.pointerDown(button)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    send({ type: 'listening' })
    const indicator = screen.getByRole('status')
    expect(indicator).toHaveTextContent(/listening|recording/i)
    expect(indicator).toHaveTextContent(/Microsoft/)

    send({ type: 'partial', text: 'olá' })
    expect(screen.getByTestId('voice-partial')).toHaveTextContent('olá')
    send({ type: 'final', text: 'olá mundo' })
    expect(onInsert).toHaveBeenCalledWith('olá mundo')

    fireEvent.pointerUp(button)
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('s1'))
    send({ type: 'ended', reason: 'stopped' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('keyboard push-to-talk: holding Space on the focused button records, releasing stops', async () => {
    const { api, button } = await mount([cloud()])
    button.focus()
    fireEvent.keyDown(button, { key: ' ', code: 'Space' })
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(button, { key: ' ', code: 'Space', repeat: true })
    expect(api.start).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(button, { key: ' ', code: 'Space' })
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith('s1'))
  })

  it('a cloud engine without consent asks first, naming Microsoft; accepting does not start recording by itself', async () => {
    const { api, button } = await mount([cloud({ consented: false, available: false, reason: 'consent-required' })])
    fireEvent.pointerDown(button)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Microsoft/)
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /allow/i }))
    await waitFor(() => expect(api.setConsent).toHaveBeenCalledWith({ engineId: 'windows-winrt', granted: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.pointerDown(button)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
  })

  it('declining consent records nothing', async () => {
    const { api, button } = await mount([cloud({ consented: false, available: false, reason: 'consent-required' })])
    fireEvent.pointerDown(button)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /cancel|not now/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.setConsent).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('the OS speech privacy setting off shows an action that opens the OS settings', async () => {
    const { api, send, button } = await mount([cloud()])
    fireEvent.pointerDown(button)
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    send({ type: 'error', message: { code: 'voice.os.speechPrivacyOff', params: {} } })
    send({ type: 'ended', reason: 'error' })
    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: /speech settings/i }))
    expect(api.openSpeechSettings).toHaveBeenCalledTimes(1)
  })

  it('a refused start (C3 as data) is shown, not swallowed', async () => {
    const { api, button } = await mount([cloud()])
    ;(api.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, message: { code: 'voice.session.busy', params: {} } })
    fireEvent.pointerDown(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('an unavailable engine disables the control and says why; no engine at all renders nothing clickable', async () => {
    const fake = fakeApi([cloud({ available: false, reason: 'engine-error', consented: true })])
    render(<VoiceDictationControl api={fake.api} onInsert={vi.fn()} />)
    const button = await screen.findByRole('button', { name: /dictate/i })
    await waitFor(() => expect(button).toBeDisabled())
    cleanup()
    const none = fakeApi([])
    const view = render(<VoiceDictationControl api={none.api} onInsert={vi.fn()} />)
    await waitFor(() => expect(none.api.getEngines).toHaveBeenCalled())
    expect(view.container.querySelector('button:not([disabled])')).toBeNull()
  })

  it('unmounting while recording cancels the session and unsubscribes', async () => {
    const { api, button, view, hasListener } = await mount([cloud()])
    fireEvent.pointerDown(button)
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    view.unmount()
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('s1'))
    expect(hasListener()).toBe(false)
  })
})

function within(element: HTMLElement) {
  return {
    getByRole: (role: string, options: { name: RegExp }) => {
      const found = Array.from(element.querySelectorAll<HTMLElement>(role === 'button' ? 'button' : `[role="${role}"]`))
        .find(node => options.name.test(node.getAttribute('aria-label') || node.textContent || ''))
      if (!found) throw new Error(`no ${role} ${options.name} inside the element`)
      return found
    }
  }
}
