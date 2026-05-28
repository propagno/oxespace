/**
 * Tiny energy-based voice activity detector for the hands-free (toggle) mode.
 *
 * It doesn't classify phonemes — it watches short-term RMS energy and reports
 * when an utterance has ended (speech followed by `hangoverMs` of silence).
 * The hook feeds it the same Float32 chunks the recorder emits; when a
 * `segment` is reported, the hook flushes the accumulated audio to whisper.
 */

export type VadEvent = 'idle' | 'speech' | 'segment'

export interface VadOptions {
  /** RMS above this counts as speech. 0..1. */
  threshold?: number
  /** Silence this long after speech closes a segment. */
  hangoverMs?: number
  /** Ignore blips shorter than this so coughs don't trigger a transcribe. */
  minSpeechMs?: number
}

export interface Vad {
  /** Feed one chunk; `chunkMs` is its duration. Returns the current event. */
  process(chunk: Float32Array, chunkMs: number): VadEvent
  reset(): void
}

export function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0
  let sum = 0
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
  return Math.sqrt(sum / chunk.length)
}

export function createVad(options: VadOptions = {}): Vad {
  const threshold = options.threshold ?? 0.015
  const hangoverMs = options.hangoverMs ?? 800
  const minSpeechMs = options.minSpeechMs ?? 250

  let speechMs = 0
  let silenceMs = 0
  let inSpeech = false

  return {
    process(chunk, chunkMs) {
      const energetic = rms(chunk) >= threshold
      if (energetic) {
        speechMs += chunkMs
        silenceMs = 0
        if (speechMs >= minSpeechMs) inSpeech = true
        return inSpeech ? 'speech' : 'idle'
      }

      // Below threshold.
      if (!inSpeech) {
        speechMs = 0
        return 'idle'
      }
      silenceMs += chunkMs
      if (silenceMs >= hangoverMs) {
        // Utterance finished — reset for the next one.
        inSpeech = false
        speechMs = 0
        silenceMs = 0
        return 'segment'
      }
      return 'speech'
    },
    reset() {
      speechMs = 0
      silenceMs = 0
      inSpeech = false
    }
  }
}
