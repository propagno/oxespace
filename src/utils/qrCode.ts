/**
 * A QR code encoder (ISO/IEC 18004), byte mode, error correction level M, versions 1 to 40, for the pairing code of
 * Settings › Devices. Small and dependency free, after Project Nayuki's reference implementation (MIT). It draws only
 * what the gateway gives (`RemotePairingOffer.uri`); nothing here touches the network.
 */

/** Error correction codewords per block, level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
/** Error correction blocks, level M, by version (index 0 unused). */
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
/** Level M in the format information. */
const ECL_FORMAT_BITS = 0

export interface QrCode {
  version: number
  /** Modules per side, without the quiet zone. */
  size: number
  /** `modules[y][x]`, true for dark. */
  modules: boolean[][]
}

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

const dataCodewords = (version: number): number => Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version]
const countBits = (version: number): number => version <= 9 ? 8 : 16

function multiply(x: number, y: number): number {
  let z = 0
  for (let index = 7; index >= 0; index--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> index) & 1) * x
  }
  return z & 0xff
}

function divisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let index = 0; index < degree; index++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = multiply(root, 0x02)
  }
  return result
}

function remainder(data: number[], by: number[]): number[] {
  const result = new Array<number>(by.length).fill(0)
  for (const value of data) {
    const factor = value ^ (result.shift() as number)
    result.push(0)
    by.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor) })
  }
  return result
}

function withErrorCorrection(data: number[], version: number): number[] {
  const blocks = BLOCKS[version], eccLength = ECC_PER_BLOCK[version]
  const raw = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - raw % blocks, shortLength = Math.floor(raw / blocks)
  const by = divisor(eccLength)
  const all: number[][] = []
  for (let index = 0, offset = 0; index < blocks; index++) {
    const block = data.slice(offset, offset + shortLength - eccLength + (index < shortBlocks ? 0 : 1))
    offset += block.length
    const ecc = remainder(block, by)
    if (index < shortBlocks) block.push(0)
    all.push(block.concat(ecc))
  }
  const result: number[] = []
  for (let index = 0; index < all[0].length; index++) {
    all.forEach((block, j) => { if (index !== shortLength - eccLength || j >= shortBlocks) result.push(block[index]) })
  }
  return result
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const result = [6]
  for (let position = version * 4 + 17 - 7; result.length < count; position -= step) result.splice(1, 0, position)
  return result
}

class Matrix {
  readonly modules: boolean[][]
  readonly fixed: boolean[][]
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }
  set(x: number, y: number, dark: boolean): void { this.modules[y][x] = dark; this.fixed[y][x] = true }
}

function drawFormat(matrix: Matrix, mask: number): void {
  const data = (ECL_FORMAT_BITS << 3) | mask
  let rem = data
  for (let index = 0; index < 10; index++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const size = matrix.size
  for (let index = 0; index <= 5; index++) matrix.set(8, index, bit(bits, index))
  matrix.set(8, 7, bit(bits, 6)); matrix.set(8, 8, bit(bits, 7)); matrix.set(7, 8, bit(bits, 8))
  for (let index = 9; index < 15; index++) matrix.set(14 - index, 8, bit(bits, index))
  for (let index = 0; index < 8; index++) matrix.set(size - 1 - index, 8, bit(bits, index))
  for (let index = 8; index < 15; index++) matrix.set(8, size - 15 + index, bit(bits, index))
  matrix.set(8, size - 8, true)
}

function drawFunctionPatterns(matrix: Matrix, version: number): void {
  const size = matrix.size
  for (let index = 0; index < size; index++) { matrix.set(6, index, index % 2 === 0); matrix.set(index, 6, index % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) matrix.set(x, y, distance !== 2 && distance !== 4)
    }
  }
  const positions = alignmentPositions(version), last = positions.length - 1
  positions.forEach((cx, i) => positions.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) matrix.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  drawFormat(matrix, 0)
  if (version >= 7) {
    let rem = version
    for (let index = 0; index < 12; index++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let index = 0; index < 18; index++) {
      const a = size - 11 + index % 3, b = Math.floor(index / 3)
      matrix.set(a, b, bit(bits, index)); matrix.set(b, a, bit(bits, index))
    }
  }
}

function drawCodewords(matrix: Matrix, data: number[]): void {
  const size = matrix.size
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vertical : vertical
        if (!matrix.fixed[y][x] && index < data.length * 8) { matrix.modules[y][x] = bit(data[index >>> 3], 7 - (index & 7)); index++ }
      }
    }
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
]

function applyMask(matrix: Matrix, mask: number): void {
  for (let y = 0; y < matrix.size; y++) for (let x = 0; x < matrix.size; x++) {
    if (!matrix.fixed[y][x] && MASKS[mask](x, y)) matrix.modules[y][x] = !matrix.modules[y][x]
  }
}

const FINDER_LIKE = [[true, false, true, true, true, false, true, false, false, false, false], [false, false, false, false, true, false, true, true, true, false, true]]

/** The standard's penalty score: long runs, 2×2 blocks, finder-like patterns and dark/light balance. */
export function penalty(modules: boolean[][]): number {
  const size = modules.length
  let score = 0, dark = 0
  const lines = (vertical: boolean): boolean[][] => Array.from({ length: size }, (_, a) => Array.from({ length: size }, (_, b) => vertical ? modules[b][a] : modules[a][b]))
  for (const line of [...lines(false), ...lines(true)]) {
    let run = 1
    for (let index = 1; index <= size; index++) {
      if (index < size && line[index] === line[index - 1]) { run++; continue }
      if (run >= 5) score += 3 + run - 5
      run = 1
    }
    for (let index = 0; index + 11 <= size; index++) {
      if (FINDER_LIKE.some(pattern => pattern.every((value, offset) => line[index + offset] === value))) score += 40
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y][x]) dark++
    if (x + 1 < size && y + 1 < size) {
      const value = modules[y][x]
      if (modules[y][x + 1] === value && modules[y + 1][x] === value && modules[y + 1][x + 1] === value) score += 3
    }
  }
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
}

/** Encodes text (UTF-8) in the smallest version that fits, with the mask of lowest penalty. */
export function encodeQr(text: string): QrCode {
  const bytes = [...new TextEncoder().encode(text)]
  let version = 1
  for (; version <= 40; version++) if (4 + countBits(version) + bytes.length * 8 <= dataCodewords(version) * 8) break
  if (version > 40) throw new Error('Text too long for a QR code')
  const capacity = dataCodewords(version) * 8
  const bits: number[] = []
  const push = (value: number, length: number): void => { for (let index = length - 1; index >= 0; index--) bits.push((value >>> index) & 1) }
  push(0b0100, 4); push(bytes.length, countBits(version))
  for (const value of bytes) push(value, 8)
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - bits.length % 8) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let index = 0; index < bits.length; index += 8) data.push(bits.slice(index, index + 8).reduce((value, next) => (value << 1) | next, 0))

  const size = version * 4 + 17
  const base = new Matrix(size)
  drawFunctionPatterns(base, version)
  drawCodewords(base, withErrorCorrection(data, version))
  let best: boolean[][] | null = null, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const candidate = new Matrix(size)
    base.modules.forEach((row, y) => row.forEach((value, x) => { candidate.modules[y][x] = value; candidate.fixed[y][x] = base.fixed[y][x] }))
    applyMask(candidate, mask)
    drawFormat(candidate, mask)
    const score = penalty(candidate.modules)
    if (score < bestScore) { best = candidate.modules; bestScore = score }
  }
  return { version, size, modules: best as boolean[][] }
}

/** One SVG path of the dark modules, offset by a quiet zone of `margin` modules. */
export function qrPath(code: QrCode, margin = 4): string {
  let path = ''
  code.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + margin} ${y + margin}h1v1h-1z` }))
  return path
}
