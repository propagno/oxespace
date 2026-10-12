import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useOxeVoice } from '../../src/hooks/useOxeVoice'
import { VoiceHud } from '../../src/components/Voice/VoiceHud'

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
    <div className="terminal-pane">
      <textarea className="xterm-helper-textarea" aria-label="Terminal input" />
      <VoiceHud status={v.status} error={v.error} level={v.level} modelProgress={v.modelProgress} onDismiss={v.dismiss} />
      <span data-testid="status">{v.status}</span>
      <span data-testid="supported">{String(v.isSupported)}</span>
      <button type="button" onClick={v.startHold}>hold</button>
      <button type="button" onClick={v.endHold}>release</button>
      <button type="button" onClick={v.toggle}>toggle</button>
      <button type="button" onClick={v.dismiss}>dismiss</button>
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
  test('closes an aborted microphone error with the close button, restores input and allows retry', async () => {
    const user = userEvent.setup()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('The user aborted a request.', 'AbortError'))
    render(<Harness onFinalText={vi.fn()} />)
    await user.click(screen.getByText('toggle'))
    await screen.findByText('Microphone request was canceled. Try again.')
    await user.click(screen.getByRole('button', { name: 'Close voice input' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus()
    await user.click(screen.getByText('toggle'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'))
    await user.click(screen.getByText('dismiss'))
  })
  test('dismisses an error with Escape or the same toggle shortcut without starting a new microphone request', async () => {
    const user = userEvent.setup()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    render(<Harness onFinalText={vi.fn()} />)
    await user.click(screen.getByText('toggle'))
    await screen.findByText('Microphone permission denied.')
    const input = screen.getByRole('textbox', { name: 'Terminal input' })
    act(() => input.focus())
    const forwarded = vi.fn()
    input.addEventListener('keydown', forwarded)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(forwarded).not.toHaveBeenCalled()
    await user.click(screen.getByText('toggle'))
    await screen.findByText('Microphone permission denied.')
    await user.click(screen.getByText('toggle'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
  })
  test('stops a late microphone stream when closed during permission request and prevents duplicate starts', async () => {
    const user = userEvent.setup(), trackStop = vi.fn()
    let resolveStream!: (stream: MediaStream) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise(resolve => { resolveStream = resolve }))
    render(<Harness onFinalText={vi.fn()} />)
    await user.click(screen.getByText('hold'))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))
    await user.click(screen.getByText('hold'))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close voice input' }))
    await act(async () => resolveStream({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream))
    expect(trackStop).toHaveBeenCalledOnce()
    expect(recorderCb).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  test('discards a transcription completed after the user closes voice input', async () => {
    const user = userEvent.setup(), insert = vi.fn()
    let resolveText!: (result: { text: string; durationMs: number }) => void
    vi.mocked(window.oxe.voice.transcribe).mockImplementation(() => new Promise(resolve => { resolveText = resolve }))
    render(<Harness onFinalText={insert} />)
    await user.click(screen.getByText('hold'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'))
    act(() => recorderCb!.onChunk(speech()))
    await user.click(screen.getByText('release'))
    await screen.findByText('Transcrevendo…')
    await user.click(screen.getByRole('button', { name: 'Close voice input' }))
    await act(async () => resolveText({ text: 'Late text', durationMs: 1 }))
    expect(insert).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  test('does not resurrect dismissed errors from late model download progress', async () => {
    const user = userEvent.setup()
    let resolveModel!: (value: Awaited<ReturnType<typeof window.oxe.voice.ensureModel>>) => void
    vi.mocked(window.oxe.voice.getModelStatus).mockResolvedValue({ size: 'base', ready: false, path: 'x', engineReady: true })
    vi.mocked(window.oxe.voice.ensureModel).mockImplementation(() => new Promise(resolve => { resolveModel = resolve }))
    render(<Harness onFinalText={vi.fn()} />)
    await user.click(screen.getByText('toggle'))
    await screen.findByText('Baixando modelo de voz… 0%')
    await user.click(screen.getByRole('button', { name: 'Close voice input' }))
    const progress = vi.mocked(window.oxe.voice.onModelProgress).mock.calls[0][0]
    act(() => progress({ size: 'base', progress: 0, receivedBytes: 0, totalBytes: null, done: true, error: 'Late download error' }))
    await act(async () => resolveModel({ size: 'base', ready: false, path: 'x', engineReady: true }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
})
