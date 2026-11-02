import { describe, expect, it } from 'vitest'
import { encodeQr, penalty, qrPath } from '../src/utils/qrCode'

// Decoding was checked against OpenCV's QR reader while writing the encoder; these keep its structure from regressing.
const finderAt = (modules: boolean[][], x: number, y: number): boolean => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
    if (modules[y + dy][x + dx] !== (ring !== 2)) return false
  }
  return true
}

describe('encodeQr', () => {
  it('picks the smallest version and draws the three finder patterns and timing lines', () => {
    const code = encodeQr('HELLO')
    expect(code.version).toBe(1)
    expect(code.size).toBe(21)
    expect(finderAt(code.modules, 0, 0) && finderAt(code.modules, 14, 0) && finderAt(code.modules, 0, 14)).toBe(true)
    for (let index = 8; index < 13; index++) { expect(code.modules[6][index]).toBe(index % 2 === 0); expect(code.modules[index][6]).toBe(index % 2 === 0) }
    expect(code.modules[code.size - 8][8]).toBe(true)
  })

  it('fits a pairing link with version information, and grows with the text', () => {
    const uri = `oxespace://pair?v=1&host=192.168.0.10&port=47321&fp=${'ab'.repeat(32)}&code=AbCdEfGhIjKlMnOpQrStUv&name=OXESpace`
    const code = encodeQr(uri)
    expect(code.version).toBe(9)
    expect(code.modules).toHaveLength(9 * 4 + 17)
    expect(encodeQr('y'.repeat(1200)).version).toBeGreaterThan(code.version)
    expect(() => encodeQr('z'.repeat(3000))).toThrow('Text too long')
  })

  it('is deterministic and draws one square per dark module', () => {
    const code = encodeQr('oxespace')
    expect(encodeQr('oxespace').modules).toEqual(code.modules)
    const dark = code.modules.flat().filter(Boolean).length
    expect(qrPath(code).match(/h1v1h-1z/g)).toHaveLength(dark)
    expect(qrPath(code, 4).startsWith('M4 4')).toBe(true)
    expect(penalty(code.modules)).toBeGreaterThan(0)
  })
})
