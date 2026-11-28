import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  captureViewportAnchor,
  createResizeRedrawGuard,
  RESIZE_REDRAW_ARM_MS,
  RESIZE_REDRAW_REPLAY_MAX_HOLD_MS,
  RESIZE_REDRAW_REPLAY_SETTLE_MS,
  RESIZE_REDRAW_SETTLE_MS,
  RESIZE_REDRAW_STUB_SETTLE_MS,
  type ResizeViewportAnchor
} from '../../src/components/Terminal/resizeRedrawGuard'

const AGY_VIEWPORT_ANCHOR: ResizeViewportAnchor = {
  visibleLines: 24,
  bottomAnchors: [
    '> Auto mode: edits &',
    '● Swarm(OXESpace 1.5',
    '? for shortcuts'
  ],
  altScreen: false
}

describe('OXE-473 · multi-phase interactive CLI post-resize redraw protection (problema.mp4)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('holds across a 2-second Phase-1 stub and multi-second Phase-2 history batches until the bottom prompt returns, then flushes once in 140ms', () => {
    vi.useFakeTimers()
    const flushed: Array<{ payload: string; rawBytes: number; truncated: boolean }> = []
    const guard = createResizeRedrawGuard({
      onFlush: (payload, meta) => flushed.push({ payload, ...meta })
    })

    // Initial mount (180x42) then split narrowing (90x42) with pre-resize viewport snapshot.
    guard.notifyPtyResize(180, 42)
    guard.notifyPtyResize(90, 42, AGY_VIEWPORT_ANCHOR)
    expect(guard.state()).toBe('armed')

    // Phase 1 (00:04): agy clears screen and draws ONLY the 1-line footer stub inside DEC 2026.
    expect(
      guard.ingest('\x1b[?2026h\x1b[2J\x1b[3J\x1b[H? for shortcuts   auto · Gemini 4 Neon · xhigh\x1b[?2026l')
    ).toBe(true)
    expect(guard.state()).toBe('holding')

    // 1.5 seconds of silence while agy computes 50-turn layout (00:04 -> 00:05): MUST NOT flush stub!
    vi.advanceTimersByTime(1500)
    expect(flushed).toHaveLength(0)
    expect(guard.state()).toBe('holding')

    // Phase 2 Batch 1 (00:06): Turn 1 ("Antigravity CLI 2.0.10" .. "OxeChat F5"), NO bottom anchor yet.
    const turn1Lines = [
      'Antigravity CLI 2.0.10',
      'Sign-in update needed',
      'Used 48 Tools',
      'OxeChat F5 — executor ainda rodando',
      ...Array.from({ length: 16 }, (_, i) => `Historical turn line ${i + 1}`)
    ].join('\r\n')
    expect(guard.ingest(`\x1b[?2026h\x1b[2J\x1b[3J\x1b[H${turn1Lines}\r\n\x1b[?2026l`)).toBe(true)

    // 3.5 seconds of pause between Turn 1 and Turn 25 (00:06 -> 00:09): MUST NOT expose Turn 1!
    vi.advanceTimersByTime(3500)
    expect(flushed).toHaveLength(0)
    expect(guard.state()).toBe('holding')

    // Phase 2 Batch 2 (00:10): Middle of conversation ("PR #1233"), still no bottom anchor.
    expect(guard.ingest('PR #1233 https://github.com/oxespace/oxespace/pull/1233\r\nUsed RunCommand\r\n')).toBe(true)
    vi.advanceTimersByTime(1200)
    expect(flushed).toHaveLength(0)
    expect(guard.state()).toBe('holding')

    // Phase 2 Final Batch (00:11): Bottom of conversation + prompt + `? for shortcuts` anchor lands!
    expect(
      guard.ingest(
        'Pronto para testar ao vivo\r\n' +
        '> Auto mode: edits & safe commands auto-approved\r\n' +
        '? for shortcuts        auto · Gemini 4 Neon · xhigh\x1b[?2026l'
      )
    ).toBe(true)
    expect(flushed).toHaveLength(0)

    // Because bottom anchor is now present and DEC 2026 is closed, flushes in standard RESIZE_REDRAW_SETTLE_MS (140ms)!
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS - 1)
    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(1)

    expect(flushed).toHaveLength(1)
    expect(guard.state()).toBe('idle')
    expect(flushed[0].payload.startsWith('\x1b[?2026h')).toBe(true)
    expect(flushed[0].payload.endsWith('\x1b[?2026l')).toBe(true)
    expect(flushed[0].payload).toContain('Antigravity CLI 2.0.10')
    expect(flushed[0].payload).toContain('Pronto para testar ao vivo')
    expect(flushed[0].payload).toContain('? for shortcuts')
    // Dead Phase-1 stub before the second \x1b[3J was stripped.
    expect(flushed[0].payload.indexOf('? for shortcuts')).toBeGreaterThan(flushed[0].payload.indexOf('Pronto para testar ao vivo'))

    guard.dispose()
  })

  test('catches non-2J clears (H+J, 1;1H+0J, RIS, ConPTY H+K repaints) and escape sequences split across chunks', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const guard = createResizeRedrawGuard({ onFlush: (payload) => flushed.push(payload) })

    guard.notifyPtyResize(160, 40)

    // 1. Home + Erase-to-End (\x1b[H\x1b[J) triggers holding and holds stub until full content arrives.
    guard.notifyPtyResize(80, 40, AGY_VIEWPORT_ANCHOR)
    expect(guard.ingest('\x1b[H\x1b[J? for shortcuts')).toBe(true)
    expect(guard.state()).toBe('holding')
    vi.advanceTimersByTime(500)
    expect(flushed).toHaveLength(0)
    guard.ingest(
      Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\r\n') +
      '\r\n? for shortcuts   auto · Gemini 4 Neon'
    )
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)

    // 2. ConPTY VtEngine viewport repaint (\x1b[?25l\x1b[1;1H...\x1b[K) triggers holding.
    flushed.length = 0
    guard.notifyPtyResize(160, 40, { visibleLines: 4, bottomAnchors: ['PS C:\\repo>'], altScreen: false })
    expect(guard.ingest('\x1b[?25l\x1b[1;1HPS C:\\repo>\x1b[K\x1b[?25h')).toBe(true)
    expect(guard.state()).toBe('holding')
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)

    // 3. Split escape sequence across chunks (`\x1b[` then `2J...`) still triggers holding.
    flushed.length = 0
    guard.notifyPtyResize(90, 40)
    expect(guard.ingest('prefix\x1b[')).toBe(false)
    expect(guard.ingest('2J\x1b[HReflowed content')).toBe(true)
    expect(guard.state()).toBe('holding')
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)

    // 4. Arm window stays open for CLIs that debounce >500ms before clearing.
    flushed.length = 0
    guard.notifyPtyResize(140, 40, AGY_VIEWPORT_ANCHOR)
    vi.advanceTimersByTime(900)
    expect(RESIZE_REDRAW_ARM_MS).toBeGreaterThanOrEqual(1500)
    expect(guard.state()).toBe('armed')
    expect(guard.ingest('\x1b[2J\x1b[HDelayed clear')).toBe(true)
    expect(guard.state()).toBe('holding')

    guard.dispose()
  })

  test('does not flush prematurely while DEC 2026 synchronized output is still unclosed, and keeps truncation clear inside DEC 2026', () => {
    vi.useFakeTimers()
    const flushed: Array<{ payload: string; truncated: boolean }> = []
    const guard = createResizeRedrawGuard({
      maxBytes: 120,
      onFlush: (payload, meta) => flushed.push({ payload, truncated: meta.truncated })
    })

    guard.notifyPtyResize(140, 40)
    guard.notifyPtyResize(70, 40, AGY_VIEWPORT_ANCHOR)

    // Open DEC 2026 without closing it yet -> waits past 140ms for the closing \x1b[?2026l.
    expect(guard.ingest('\x1b[?2026h\x1b[2J\x1b[H' + 'A'.repeat(200))).toBe(true)
    vi.advanceTimersByTime(500)
    expect(flushed).toHaveLength(0)

    // Close DEC 2026 with bottom anchor -> settles fast and wraps truncation clear INSIDE DEC 2026.
    expect(guard.ingest('\r\n'.repeat(10) + '? for shortcuts\x1b[?2026l')).toBe(true)
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)
    expect(flushed[0].truncated).toBe(true)
    expect(flushed[0].payload.startsWith('\x1b[?2026h\x1b[2J\x1b[H')).toBe(true)
    expect(flushed[0].payload.endsWith('\x1b[?2026l')).toBe(true)

    guard.dispose()
  })

  test('falls back safely via stub/replay settle timeouts, hard replay ceiling, alt-screen fast path, and instant keypress preemption', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const guard = createResizeRedrawGuard({ onFlush: (payload) => flushed.push(payload) })

    // 1. Alternate-screen TUI settles fast even if viewport had 24 lines and bottom line changed.
    guard.notifyPtyResize(140, 40)
    guard.notifyPtyResize(70, 40, { ...AGY_VIEWPORT_ANCHOR, altScreen: true })
    expect(guard.ingest('\x1b[2J\x1b[HNew alt screen')).toBe(true)
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)

    // 2. Stub whose follow-up never arrives still flushes cleanly at RESIZE_REDRAW_STUB_SETTLE_MS.
    flushed.length = 0
    guard.notifyPtyResize(140, 40, AGY_VIEWPORT_ANCHOR)
    expect(guard.ingest('\x1b[2J\x1b[H? for shortcuts')).toBe(true)
    vi.advanceTimersByTime(RESIZE_REDRAW_STUB_SETTLE_MS - 1)
    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)

    // 3. Mid-replay whose bottom line changed still flushes cleanly at RESIZE_REDRAW_REPLAY_SETTLE_MS.
    flushed.length = 0
    guard.notifyPtyResize(70, 40, AGY_VIEWPORT_ANCHOR)
    expect(guard.ingest('\x1b[2J\x1b[H' + Array.from({ length: 12 }, (_, i) => `Different screen ${i}`).join('\r\n'))).toBe(true)
    vi.advanceTimersByTime(RESIZE_REDRAW_REPLAY_SETTLE_MS - 1)
    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)

    // 4. Endless mid-replay stream is capped by RESIZE_REDRAW_REPLAY_MAX_HOLD_MS.
    flushed.length = 0
    guard.notifyPtyResize(120, 40, AGY_VIEWPORT_ANCHOR)
    expect(guard.ingest('\x1b[2J\x1b[H' + Array.from({ length: 12 }, (_, i) => `Stream ${i}`).join('\r\n'))).toBe(true)
    for (let elapsed = 0; elapsed < RESIZE_REDRAW_REPLAY_MAX_HOLD_MS + 500; elapsed += 500) {
      vi.advanceTimersByTime(500)
      if (flushed.length > 0) break
      guard.ingest(`More history ${elapsed}\r\n`)
    }
    expect(flushed).toHaveLength(1)

    // 5. User keypress immediately preempts a multi-phase hold with 0ms lag.
    flushed.length = 0
    guard.notifyPtyResize(80, 40, AGY_VIEWPORT_ANCHOR)
    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[H? for shortcuts')).toBe(true)
    guard.preemptOnInput()
    expect(flushed).toHaveLength(1)
    expect(guard.state()).toBe('idle')

    guard.dispose()
  })

  test('captureViewportAnchor extracts width-independent bottom anchors and ignores box rules', () => {
    const lines = [
      'Pronto para testar ao vivo',
      '────────────────────────────────────────────────────────────',
      '> Auto mode: edits & safe commands auto-approved',
      '● Swarm(OXESpace 1.5.2 Operacao Jira)   103 posts',
      '? for shortcuts                               auto · Gemini 4 Neon · xhigh'
    ]
    const anchor = captureViewportAnchor({
      rows: lines.length,
      buffer: {
        active: {
          type: 'normal',
          viewportY: 10,
          getLine: (y) => {
            const text = lines[y - 10]
            return text === undefined ? null : { translateToString: () => text }
          }
        }
      }
    })

    expect(anchor.altScreen).toBe(false)
    expect(anchor.visibleLines).toBe(5)
    expect(anchor.bottomAnchors).toEqual([
      '> Auto mode: edits &',
      '● Swarm(OXESpace 1.5',
      '? for shortcuts'
    ])
  })
})
