import { describe, expect, test } from 'vitest'
import { PtyRingBuffer } from '../../electron/main/services/pty-ring-buffer'

describe('PtyRingBuffer', () => {
  test('retains output and reports a monotonic cursor', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('hello ')
    ring.push('world')

    expect(ring.snapshot()).toBe('hello world')
    expect(ring.seq).toBe(11)
  })

  test('evicts whole chunks once over capacity', () => {
    const ring = new PtyRingBuffer(10)
    ring.push('aaaaa')
    ring.push('bbbbb')
    ring.push('ccccc')

    // 'aaaaa' is evicted; the survivors are never sliced.
    expect(ring.snapshot()).toBe('bbbbbccccc')
    // seq keeps counting everything ever written, including evicted bytes.
    expect(ring.seq).toBe(15)
  })

  test('keeps the newest chunk even when it alone exceeds capacity', () => {
    const ring = new PtyRingBuffer(4)
    ring.push('x')
    ring.push('this chunk is far larger than the capacity')

    // Dropping it would lose the most recent screen — the opposite of useful.
    expect(ring.snapshot()).toBe('this chunk is far larger than the capacity')
  })

  test('since() returns only what came after the cursor', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('first')
    const cursor = ring.seq
    ring.push('second')

    expect(ring.since(cursor)).toEqual({ data: 'second', truncated: false })
  })

  test('since() slices inside a chunk, not just at chunk boundaries', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('abcdef')

    expect(ring.since(2)).toEqual({ data: 'cdef', truncated: false })
  })

  test('since() reports truncation only when bytes the cursor needed were evicted', () => {
    const ring = new PtyRingBuffer(10)
    ring.push('aa')
    const staleCursor = ring.seq // 2 — these bytes get evicted below
    ring.push('aaa')
    ring.push('bbbbb')
    ring.push('ccccc') // evicts 'aa' then 'aaa'; 5 chars dropped

    const slice = ring.since(staleCursor)
    // The consumer missed chars 2..4, so it cannot safely append.
    expect(slice.truncated).toBe(true)
    expect(slice.data).toBe('bbbbbccccc')
  })

  test('a cursor exactly at the evicted boundary has missed nothing', () => {
    const ring = new PtyRingBuffer(10)
    ring.push('aaaaa')
    const cursor = ring.seq // 5 — the retained window starts here
    ring.push('bbbbb')
    ring.push('ccccc') // evicts 'aaaaa'; dropped === 5

    // Off-by-one here would make every well-timed re-attach clear its screen
    // for no reason.
    expect(ring.since(cursor)).toEqual({ data: 'bbbbbccccc', truncated: false })
  })

  test('since() at or past the head is an empty, untruncated delta', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('abc')

    expect(ring.since(ring.seq)).toEqual({ data: '', truncated: false })
  })

  test('a fresh cursor of 0 gets everything without claiming truncation', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('abc')

    // A newly mounted terminal has no cursor; it must not be told it lost data.
    expect(ring.since(0)).toEqual({ data: 'abc', truncated: false })
  })

  test('never starts a slice on a lone low surrogate', () => {
    const ring = new PtyRingBuffer(1024)
    const emoji = '🚀' // one astral char = two UTF-16 code units
    ring.push(`a${emoji}b`)

    // Cursor 1 lands exactly between the surrogate halves; slicing there would
    // emit an unpaired low surrogate into xterm.
    const slice = ring.since(2)
    expect(slice.data.startsWith(emoji)).toBe(true)
    expect(slice.data).toBe(`${emoji}b`)
  })

  test('clear() drops content but keeps the cursor moving forward', () => {
    const ring = new PtyRingBuffer(1024)
    ring.push('before')
    const beforeSeq = ring.seq
    ring.clear()

    expect(ring.snapshot()).toBe('')
    // A consumer holding the old cursor must not be told "nothing happened".
    expect(ring.seq).toBe(beforeSeq)
    ring.push('after')
    expect(ring.since(beforeSeq)).toEqual({ data: 'after', truncated: false })
  })
})
