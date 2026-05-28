import { rms } from './vad'

/**
 * Captures mono 16 kHz Float32 audio from a MediaStream and emits it chunk by
 * chunk. Prefers an AudioWorklet (off the main thread); falls back to the
 * deprecated ScriptProcessorNode where worklets are unavailable.
 *
 * The AudioContext is forced to 16 kHz so the samples are already at whisper's
 * required rate — connecting the (device-rate) mic stream resamples for us.
 */

export const RECORDER_SAMPLE_RATE = 16000

export interface AudioRecorderOptions {
  onChunk: (chunk: Float32Array) => void
  onLevel?: (level: number) => void
}

export interface AudioRecorder {
  readonly sampleRate: number
  stop: () => Promise<void>
}

// Inlined as a Blob URL so it works inside the asar package (no asset path).
const WORKLET_SOURCE = `
class OxeRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice(0))
    }
    return true
  }
}
registerProcessor('oxe-recorder', OxeRecorderProcessor)
`

export async function createAudioRecorder(
  stream: MediaStream,
  options: AudioRecorderOptions
): Promise<AudioRecorder> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtx({ sampleRate: RECORDER_SAMPLE_RATE })
  const source = context.createMediaStreamSource(stream)

  const emit = (chunk: Float32Array): void => {
    options.onChunk(chunk)
    options.onLevel?.(Math.min(1, rms(chunk) * 4))
  }

  let teardown: () => void

  if (context.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
      const node = new AudioWorkletNode(context, 'oxe-recorder')
      node.port.onmessage = (event: MessageEvent<Float32Array>) => emit(event.data)
      source.connect(node)
      // Worklet needs a graph sink to pull audio; a muted gain avoids feedback.
      const sink = context.createGain()
      sink.gain.value = 0
      node.connect(sink).connect(context.destination)
      teardown = () => {
        node.port.onmessage = null
        node.disconnect()
        sink.disconnect()
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  } else {
    const BUFFER = 2048
    const processor = context.createScriptProcessor(BUFFER, 1, 1)
    processor.onaudioprocess = (event) => emit(event.inputBuffer.getChannelData(0).slice(0))
    source.connect(processor)
    processor.connect(context.destination)
    teardown = () => {
      processor.onaudioprocess = null
      processor.disconnect()
    }
  }

  return {
    sampleRate: context.sampleRate,
    async stop() {
      try { teardown() } catch { /* graph already torn down */ }
      try { source.disconnect() } catch { /* noop */ }
      for (const track of stream.getTracks()) track.stop()
      try { await context.close() } catch { /* already closed */ }
    }
  }
}
