/**
 * Line diff (Myers, O(ND)) producing change blocks with no context lines, so
 * each block can be kept or undone on its own. Lossless: lines are split on
 * "\n" only, so "\r" and a missing final newline survive a round trip.
 */
export interface LineHunk {
  /** 0-based index of the first replaced line in the old text. */
  oldStart: number
  oldLines: string[]
  /** 0-based index of the first replacement line in the new text. */
  newStart: number
  newLines: string[]
}

export const splitLines = (text: string): string[] => text.split('\n')
export const joinLines = (lines: string[]): string => lines.join('\n')

/** Null when the edit distance exceeds `maxEdits`; callers then treat the file as one change. */
export function diffLines(a: string[], b: string[], maxEdits = 2000): LineHunk[] | null {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const x0 = a.slice(prefix, a.length - suffix), y0 = b.slice(prefix, b.length - suffix)
  const ops = myers(x0, y0, maxEdits)
  if (!ops) return null
  // Group consecutive deletions/insertions into blocks.
  const hunks: LineHunk[] = []
  let ai = 0, bi = 0, current: LineHunk | null = null
  for (const op of ops) {
    if (op === '=') { if (current) { hunks.push(current); current = null } ai++; bi++; continue }
    current ??= { oldStart: prefix + ai, oldLines: [], newStart: prefix + bi, newLines: [] }
    if (op === '-') current.oldLines.push(x0[ai++])
    else current.newLines.push(y0[bi++])
  }
  if (current) hunks.push(current)
  return hunks
}

function myers(a: string[], b: string[], maxEdits: number): Array<'=' | '-' | '+'> | null {
  const n = a.length, m = b.length
  if (n === 0) return Array<'+'>(m).fill('+')
  if (m === 0) return Array<'-'>(n).fill('-')
  const limit = Math.min(n + m, maxEdits)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
  }
  if (found < 0) return null
  const ops: Array<'=' | '-' | '+'> = []
  let x = n, y = m
  for (let d = found; d > 0; d--) {
    // trace[d] holds v as it was before step d, for k in [-d-1, d+1].
    const saved = trace[d], at = (k: number) => saved[k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK), prevY = prevX - prevK
    while (x > prevX && y > prevY) { ops.push('='); x--; y-- }
    if (x === prevX) { ops.push('+'); y-- } else { ops.push('-'); x-- }
  }
  while (x > 0 && y > 0) { ops.push('='); x--; y-- }
  return ops.reverse()
}

/** Reverts one hunk in `current` (the new text), when its lines are still there unchanged. */
export function revertHunk(current: string[], hunk: LineHunk): string[] | null {
  const here = current.slice(hunk.newStart, hunk.newStart + hunk.newLines.length)
  if (here.length !== hunk.newLines.length || here.some((line, index) => line !== hunk.newLines[index])) return null
  return [...current.slice(0, hunk.newStart), ...hunk.oldLines, ...current.slice(hunk.newStart + hunk.newLines.length)]
}
