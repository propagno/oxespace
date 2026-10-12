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
  /** Close the HUD and discard capture/results still in flight. */
  dismiss: () => void
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
  if (name === 'AbortError') return 'Microphone request was canceled. Try again.'
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
  const sessionRef = useRef(0)
  const startingRef = useRef(false)
  const activeRef = useRef(false)
  const onFinalTextRef = useRef(onFinalText)
  onFinalTextRef.current = onFinalText

  // Subscribe to model-download progress.
  useEffect(() => {
    if (!supported) return
    return window.oxe.voice.onModelProgress((event) => {
      if (event.size !== modelSize || !activeRef.current) return
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

  const dismiss = useCallback((): void => {
    sessionRef.current += 1
    activeRef.current = false
    startingRef.current = false
    const recorder = recorderRef.current
    recorderRef.current = null
    void recorder?.stop().catch(() => {})
    chunksRef.current = []
    modeRef.current = null
    vadRef.current = null
    stopLevelPump()
    setError(null)
    setModelProgress(null)
    setStatus(supported ? 'idle' : 'unsupported')
  }, [stopLevelPump, supported])

  const transcribeBuffer = useCallback(async (samples: Float32Array): Promise<void> => {
    if (samples.length < 1600) return // <0.1s — ignore stray taps
    const session = sessionRef.current
    const wav = encodeWav(samples)
    pendingRef.current += 1
    try {
      // Language is pinned to pt-BR in the main service; modelSize is the only knob.
      const result = await window.oxe.voice.transcribe(wav, { modelSize })
      if (session !== sessionRef.current) return
      const text = result.text.trim()
      if (text) onFinalTextRef.current(text)
    } catch (err) {
      if (session !== sessionRef.current) return
      setError(err instanceof Error ? err.message : 'Transcription failed.')
      setStatus('error')
    } finally {
      pendingRef.current -= 1
    }
  }, [modelSize])

  const ensureReady = useCallback(async (session: number): Promise<boolean> => {
    const current = await window.oxe.voice.getModelStatus(modelSize)
    if (session !== sessionRef.current) return false
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
      if (session !== sessionRef.current) return false
      setModelProgress(null)
      if (!after.ready) {
        setError('Voice model could not be prepared.')
        setStatus('error')
        return false
      }
      return true
    } catch (err) {
      if (session !== sessionRef.current) return false
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
    if (recorderRef.current || startingRef.current) return
    const session = ++sessionRef.current
    startingRef.current = true
    activeRef.current = true
    modeRef.current = mode
    setError(null)
    setStatus('requesting')

    let stream: MediaStream | undefined
    try {
      const ready = await ensureReady(session)
      if (!ready) return
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (session !== sessionRef.current) { for (const track of stream.getTracks()) track.stop(); return }

      chunksRef.current = []
      modeRef.current = mode
      vadRef.current = mode === 'toggle' ? createVad() : null

      const recorder = await createAudioRecorder(stream, {
        onLevel: (l) => { if (session === sessionRef.current) levelRef.current = l },
        onChunk: (chunk) => {
          if (session !== sessionRef.current) return
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
      if (session !== sessionRef.current) { await recorder.stop(); return }
      recorderRef.current = recorder

      setStatus('listening')
      startLevelPump()
    } catch (err) {
      for (const track of stream?.getTracks() ?? []) track.stop()
      if (session === sessionRef.current) { setError(toMicError(err)); setStatus('error') }
    } finally {
      if (session === sessionRef.current) startingRef.current = false
    }
  }, [enabled, ensureReady, startLevelPump, transcribeBuffer])

  const finishRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current
    if (!recorder) return
    const session = sessionRef.current
    recorderRef.current = null
    stopLevelPump()
    const remaining = concatFloat32(chunksRef.current)
    chunksRef.current = []
    vadRef.current = null
    modeRef.current = null
    try { await recorder.stop() } catch (err) {
      if (session === sessionRef.current) { setError(toMicError(err)); setStatus('error') }
      return
    }
    if (session !== sessionRef.current) return

    // PTT always has a tail to transcribe; toggle may have a final partial.
    if (remaining.length >= 1600) {
      setStatus('transcribing')
      await transcribeBuffer(remaining)
    }
    if (session !== sessionRef.current) return
    // Don't clobber an error surfaced by a transcribe call.
    setStatus((s) => (s === 'error' ? s : 'idle'))
  }, [stopLevelPump, transcribeBuffer])

  const startHold = useCallback((): void => {
    if (!supported || recorderRef.current) return
    void beginRecording('ptt')
  }, [supported, beginRecording])

  const endHold = useCallback((): void => {
    if (modeRef.current !== 'ptt') return
    if (startingRef.current) { dismiss(); return }
    void finishRecording()
  }, [finishRecording, dismiss])

  const toggle = useCallback((): void => {
    if (!supported) return
    if (error || startingRef.current || status === 'transcribing') { dismiss(); return }
    if (recorderRef.current) void finishRecording()
    else void beginRecording('toggle')
  }, [supported, error, status, beginRecording, finishRecording, dismiss])

  // Tear down if the terminal stops or the component unmounts.
  useEffect(() => {
    if (enabled) return
    dismiss()
  }, [enabled, dismiss])

  useEffect(() => () => {
    sessionRef.current += 1
    activeRef.current = false
    void recorderRef.current?.stop().catch(() => {})
    recorderRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  return { status, isSupported: supported, error, level, modelProgress, startHold, endHold, toggle, dismiss }
}
