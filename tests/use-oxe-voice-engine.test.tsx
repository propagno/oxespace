import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOxeVoice } from '../src/hooks/useOxeVoice'

function install(engineReady: boolean): void {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  ;(window as unknown as { oxe: unknown }).oxe = {
    voice: { transcribe: vi.fn(), onModelProgress: vi.fn(() => () => undefined), getModelStatus: vi.fn(async () => ({ size: 'base', ready: false, path: '', engineReady })), ensureModel: vi.fn() }
  }
}

afterEach(() => { delete (window as unknown as { oxe?: unknown }).oxe })

describe('useOxeVoice without a speech engine', () => {
  it('reports voice as unsupported once the build says it has no engine, so no microphone is offered', async () => {
    install(false)
    const { result } = renderHook(() => useOxeVoice({ enabled: true, onFinalText: () => undefined }))
    await waitFor(() => expect(result.current.isSupported).toBe(false))
  })

  it('stays supported when the engine is present', async () => {
    install(true)
    const { result } = renderHook(() => useOxeVoice({ enabled: true, onFinalText: () => undefined }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(result.current.isSupported).toBe(true)
  })
})
