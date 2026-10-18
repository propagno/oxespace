import { describe, expect, it } from 'vitest'
import { diffLines, joinLines, revertHunk, splitLines, type LineHunk } from '../shared/lineDiff'

/** Applying every hunk to the old text must give the new text. */
function apply(a: string[], hunks: LineHunk[]): string[] {
  const out: string[] = []
  let index = 0
  for (const hunk of hunks) {
    out.push(...a.slice(index, hunk.oldStart), ...hunk.newLines)
    index = hunk.oldStart + hunk.oldLines.length
  }
  return [...out, ...a.slice(index)]
}

function random(seed: number) {
  let state = seed
  return () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff }
}

describe('diffLines', () => {
  it('finds separate change blocks and keeps CRLF and the final newline', () => {
    const a = splitLines('one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n')
    const b = splitLines('one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix')
    const hunks = diffLines(a, b)!
    expect(hunks).toEqual([
      { oldStart: 1, oldLines: ['two\r'], newStart: 1, newLines: ['TWO\r'] },
      { oldStart: 5, oldLines: [''], newStart: 5, newLines: ['six'] }
    ])
    expect(joinLines(apply(a, hunks))).toBe(joinLines(b))
  })

  it('handles empty sides and identical texts', () => {
    expect(diffLines([], ['a', 'b'])).toEqual([{ oldStart: 0, oldLines: [], newStart: 0, newLines: ['a', 'b'] }])
    expect(diffLines(['a'], ['a'])).toEqual([])
  })

  it('reconstructs the new text and reverts each hunk exactly, on random edits', () => {
    const next = random(7)
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: Math.floor(next() * 40) }, () => `l${Math.floor(next() * 8)}`)
      const b = a.flatMap(line => next() < 0.15 ? [] : next() < 0.15 ? [line, `n${Math.floor(next() * 8)}`] : next() < 0.1 ? [`c${Math.floor(next() * 8)}`] : [line])
      const hunks = diffLines(a, b)!
      expect(apply(a, hunks)).toEqual(b)
      for (const hunk of hunks) {
        const reverted = revertHunk(b, hunk)!
        // Undoing one block equals applying every other block to the old text.
        expect(reverted).toEqual(apply(a, hunks.filter(other => other !== hunk)))
      }
    }
  })

  it('gives up past the edit budget and refuses to revert lines that changed', () => {
    expect(diffLines(Array.from({ length: 50 }, (_, i) => `a${i}`), Array.from({ length: 50 }, (_, i) => `b${i}`), 10)).toBeNull()
    expect(revertHunk(['x', 'changed'], { oldStart: 1, oldLines: ['old'], newStart: 1, newLines: ['new'] })).toBeNull()
  })
})
