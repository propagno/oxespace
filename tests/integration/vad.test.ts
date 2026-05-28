import { describe, expect, test } from 'vitest'
import { createVad, rms } from '../../src/lib/audio/vad'

/** A chunk of constant amplitude, used to drive the energy detector. */
function tone(amplitude: number, length = 1600): Float32Array {
  return new Float32Array(length).fill(amplitude)
}

describe('rms', () => {
  test('is zero for silence and the amplitude for a DC tone', () => {
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 5)
  })
})

describe('createVad', () => {
  const CHUNK_MS = 100

  test('reports a segment after speech followed by hangover silence', () => {
    const vad = createVad({ threshold: 0.05, hangoverMs: 300, minSpeechMs: 200 })
    const events: string[] = []
    // 400ms of speech → crosses minSpeechMs.
    for (let i = 0; i < 4; i++) events.push(vad.process(tone(0.3), CHUNK_MS))
    // 300ms of silence → closes the segment on the 3rd silent chunk.
    for (let i = 0; i < 3; i++) events.push(vad.process(tone(0), CHUNK_MS))

    expect(events).toContain('speech')
    expect(events[events.length - 1]).toBe('segment')
    expect(events.filter((e) => e === 'segment')).toHaveLength(1)
  })

  test('ignores blips shorter than minSpeechMs', () => {
    const vad = createVad({ threshold: 0.05, hangoverMs: 300, minSpeechMs: 250 })
    // One 100ms blip, then silence — never reaches minSpeechMs.
    const events = [
      vad.process(tone(0.3), CHUNK_MS),
      vad.process(tone(0), CHUNK_MS),
      vad.process(tone(0), CHUNK_MS),
      vad.process(tone(0), CHUNK_MS)
    ]
    expect(events).not.toContain('segment')
    expect(events.every((e) => e === 'idle')).toBe(true)
  })

  test('reset clears in-progress speech state', () => {
    const vad = createVad({ threshold: 0.05, hangoverMs: 200, minSpeechMs: 100 })
    vad.process(tone(0.3), CHUNK_MS)
    vad.process(tone(0.3), CHUNK_MS)
    vad.reset()
    // After reset, a single silent chunk must not emit a segment.
    expect(vad.process(tone(0), CHUNK_MS)).toBe('idle')
  })
})
