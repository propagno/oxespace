import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceStore } from '../store/voice.store'
import { createAudioRecorder, type AudioRecorder } from '../lib/audio/recorder-worklet'
import { concatFloat32, encodeWav } from '../lib/audio/wav-encode'
import { createVad } from '../lib/audio/vad'

export type OxeVoiceStatus =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'downloading'
  | 'listening'
  | 'transcribing'
  | 'error'

type Mode = 'ptt' | 'toggle'

interface UseOxeVoiceOptions {
  enabled: boolean
  onFinalText: (text: string) => void
}

interface UseOxeVoiceResult {
  status: OxeVoiceStatus
  isSupported: boolean
  error: string | null
  /** 0..1 microphone level for the live meter. */
  level: number
  /** 0..1 model download progress, or null when not downloading. */
  modelProgress: number | null
  /** Push-to-talk: begin while held. */
  startHold: () => void
  /** Push-to-talk: transcribe + insert on release. */
  endHold: () => void
  /** Hands-free: start/stop a VAD-segmented session. */
  toggle: () => void
}

function isSupportedRuntime(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    Boolean(window.oxe?.voice?.transcribe)
  )
}

function toMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission denied.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was detected.'
  return err instanceof Error ? err.message : 'Could not access the microphone.'
}

export function useOxeVoice({ enabled, onFinalText }: UseOxeVoiceOptions): UseOxeVoiceResult {
  const modelSize = useVoiceStore((s) => s.modelSize)

  const supported = isSupportedRuntime()
  const [status, setStatus] = useState<OxeVoiceStatus>(supported ? 'idle' : 'unsupported')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [modelProgress, setModelProgress] = useState<number | null>(null)

  // Mutable recording state kept in refs to dodge stale closures.
  const recorderRef = useRef<AudioRecorder | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const modeRef = useRef<Mode | null>(null)
  const vadRef = useRef<ReturnType<typeof createVad> | null>(null)
  const levelRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef(0)
  const onFinalTextRef = useRef(onFinalText)
  onFinalTextRef.current = onFinalText

  // Subscribe to model-download progress.
  useEffect(() => {
    if (!supported) return
    return window.oxe.voice.onModelProgress((event) => {
      if (event.size !== modelSize) return
      setModelProgress(event.done ? null : event.progress)
      if (event.error) {
        setError(event.error)
        setStatus('error')
      }
    })
  }, [supported, modelSize])

  // Publish the live mic level at ~60fps while listening (cheap; avoids
  // 100+ setState/sec from the worklet's 8ms chunk cadence).
  const startLevelPump = useCallback((): void => {
    const tick = (): void => {
      setLevel(levelRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopLevelPump = useCallback((): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    levelRef.current = 0
    setLevel(0)
  }, [])

  const transcribeBuffer = useCallback(async (samples: Float32Array): Promise<void> => {
    if (samples.length < 1600) return // <0.1s — ignore stray taps
    const wav = encodeWav(samples)
    pendingRef.current += 1
    try {
      // Language is pinned to pt-BR in the main service; modelSize is the only knob.
      const result = await window.oxe.voice.transcribe(wav, { modelSize })
      const text = result.text.trim()
      if (text) onFinalTextRef.current(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed.')
      setStatus('error')
    } finally {
      pendingRef.current -= 1
    }
  }, [modelSize])

  const ensureReady = useCallback(async (): Promise<boolean> => {
    const current = await window.oxe.voice.getModelStatus(modelSize)
    if (!current.engineReady) {
      setError('Voice engine unavailable in this build.')
      setStatus('error')
      return false
    }
    if (current.ready) return true
    setStatus('downloading')
    setModelProgress(0)
    try {
      const after = await window.oxe.voice.ensureModel(modelSize)
      setModelProgress(null)
      if (!after.ready) {
        setError('Voice model could not be prepared.')
        setStatus('error')
        return false
      }
      return true
    } catch (err) {
      setModelProgress(null)
      setError(err instanceof Error ? err.message : 'Could not download the voice model.')
      setStatus('error')
      return false
    }
  }, [modelSize])

  const beginRecording = useCallback(async (mode: Mode): Promise<void> => {
    if (!enabled) {
      setError('Start the terminal before using OXEVoice.')
      setStatus('error')
      return
    }
    if (recorderRef.current) return // already recording
    setError(null)
    setStatus('requesting')

    const ready = await ensureReady()
    if (!ready) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      setError(toMicError(err))
      setStatus('error')
      return
    }

    chunksRef.current = []
    modeRef.current = mode
    vadRef.current = mode === 'toggle' ? createVad() : null

    try {
      recorderRef.current = await createAudioRecorder(stream, {
        onLevel: (l) => { levelRef.current = l },
        onChunk: (chunk) => {
          chunksRef.current.push(chunk)
          const vad = vadRef.current
          if (vad) {
            const chunkMs = (chunk.length / 16000) * 1000
            if (vad.process(chunk, chunkMs) === 'segment') {
              const segment = concatFloat32(chunksRef.current)
              chunksRef.current = []
              void transcribeBuffer(segment)
            }
          }
        }
      })
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      setError(err instanceof Error ? err.message : 'Could not start audio capture.')
      setStatus('error')
      return
    }

    setStatus('listening')
    startLevelPump()
  }, [enabled, ensureReady, startLevelPump, transcribeBuffer])

  const finishRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    stopLevelPump()
    await recorder.stop()

    const remaining = concatFloat32(chunksRef.current)
    chunksRef.current = []
    vadRef.current = null
    const mode = modeRef.current
    modeRef.current = null

    // PTT always has a tail to transcribe; toggle may have a final partial.
    if (remaining.length >= 1600) {
      setStatus('transcribing')
      await transcribeBuffer(remaining)
    }
    // Don't clobber an error surfaced by a transcribe call.
    setStatus((s) => (s === 'error' ? s : 'idle'))
    void mode
  }, [stopLevelPump, transcribeBuffer])

  const startHold = useCallback((): void => {
    if (!supported || recorderRef.current) return
    void beginRecording('ptt')
  }, [supported, beginRecording])

  const endHold = useCallback((): void => {
    if (modeRef.current !== 'ptt') return
    void finishRecording()
  }, [finishRecording])

  const toggle = useCallback((): void => {
    if (!supported) return
    if (recorderRef.current) void finishRecording()
    else void beginRecording('toggle')
  }, [supported, beginRecording, finishRecording])

  // Tear down if the terminal stops or the component unmounts.
  useEffect(() => {
    if (enabled) return
    void recorderRef.current?.stop()
    recorderRef.current = null
    chunksRef.current = []
    modeRef.current = null
    stopLevelPump()
    setStatus(supported ? 'idle' : 'unsupported')
  }, [enabled, supported, stopLevelPump])

  useEffect(() => () => {
    void recorderRef.current?.stop()
    recorderRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  return { status, isSupported: supported, error, level, modelProgress, startHold, endHold, toggle }
}
