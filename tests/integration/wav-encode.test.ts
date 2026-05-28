import { describe, expect, test } from 'vitest'
import { concatFloat32, encodeWav } from '../../src/lib/audio/wav-encode'

function ascii(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

describe('encodeWav', () => {
  test('writes a valid 44-byte PCM16 mono header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const bytes = encodeWav(samples, 16000)
    const view = new DataView(bytes.buffer)

    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2) // data size
    expect(bytes.length).toBe(44 + samples.length * 2)
  })

  test('quantises full-scale samples to int16 extremes', () => {
    const bytes = encodeWav(new Float32Array([1, -1, 0]), 16000)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(view.getInt16(48, true)).toBe(0)
  })

  test('clamps out-of-range samples', () => {
    const bytes = encodeWav(new Float32Array([2, -2]), 16000)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })
})

describe('concatFloat32', () => {
  test('joins chunks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])])
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5])
  })

  test('handles an empty list', () => {
    expect(concatFloat32([]).length).toBe(0)
  })
})
