import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useOxeVoice } from '../../src/hooks/useOxeVoice'

// Drive the recorder via captured callbacks instead of a real AudioContext.
let recorderCb: { onChunk: (c: Float32Array) => void; onLevel?: (l: number) => void } | null = null
const stopMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/lib/audio/recorder-worklet', () => ({
  RECORDER_SAMPLE_RATE: 16000,
  createAudioRecorder: vi.fn(async (_stream: MediaStream, cb: typeof recorderCb) => {
    recorderCb = cb
    return { sampleRate: 16000, stop: stopMock }
  })
}))

function Harness({ onFinalText }: { onFinalText: (t: string) => void }) {
  const v = useOxeVoice({ enabled: true, onFinalText })
  return (
    <div>
      <span data-testid="status">{v.status}</span>
      <span data-testid="supported">{String(v.isSupported)}</span>
      <button type="button" onClick={v.startHold}>hold</button>
      <button type="button" onClick={v.endHold}>release</button>
      <button type="button" onClick={v.toggle}>toggle</button>
    </div>
  )
}

const speech = (): Float32Array => new Float32Array(4000).fill(0.2)

describe('useOxeVoice', () => {
  beforeEach(() => {
    recorderCb = null
    stopMock.mockClear()
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }
    })
    window.oxe = {
      voice: {
        transcribe: vi.fn().mockResolvedValue({ text: 'hello world', durationMs: 5 }),
        getModelStatus: vi.fn().mockResolvedValue({ size: 'base', ready: true, path: 'x', engineReady: true }),
        ensureModel: vi.fn().mockResolvedValue({ size: 'base', ready: true, path: 'x', engineReady: true }),
        onModelProgress: vi.fn(() => vi.fn())
      }
    } as unknown as typeof window.oxe
  })

  afterEach(() => {
    // @ts-expect-error reset for next test
    delete window.oxe
  })

  test('is unsupported without the voice bridge', () => {
    // @ts-expect-error simulate missing bridge
    delete window.oxe
    render(<Harness onFinalText={vi.fn()} />)
    expect(screen.getByTestId('supported')).toHaveTextContent('false')
    expect(screen.getByTestId('status')).toHaveTextContent('unsupported')
  })

  test('push-to-talk records, transcribes and inserts on release', async () => {
    const user = userEvent.setup()
    const onFinalText = vi.fn()
    render(<Harness onFinalText={onFinalText} />)

    await user.click(screen.getByText('hold'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'))
    expect(recorderCb).not.toBeNull()

    act(() => recorderCb!.onChunk(speech()))

    await user.click(screen.getByText('release'))
    await waitFor(() => expect(onFinalText).toHaveBeenCalledWith('hello world'))
    expect(window.oxe.voice.transcribe).toHaveBeenCalledTimes(1)
    const [wav, opts] = (window.oxe.voice.transcribe as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(wav).toBeInstanceOf(Uint8Array)
    expect(opts).toMatchObject({ modelSize: 'base' })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'))
    expect(stopMock).toHaveBeenCalled()
  })

  test('toggle starts a hands-free session and stops on second toggle', async () => {
    const user = userEvent.setup()
    render(<Harness onFinalText={vi.fn()} />)

    await user.click(screen.getByText('toggle'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'))

    await user.click(screen.getByText('toggle'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'))
    expect(stopMock).toHaveBeenCalled()
  })

  test('downloads the model on first use before listening', async () => {
    ;(window.oxe.voice.getModelStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      size: 'base', ready: false, path: 'x', engineReady: true
    })
    const user = userEvent.setup()
    render(<Harness onFinalText={vi.fn()} />)

    await user.click(screen.getByText('hold'))
    await waitFor(() => expect(window.oxe.voice.ensureModel).toHaveBeenCalledWith('base'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'))
  })
})
