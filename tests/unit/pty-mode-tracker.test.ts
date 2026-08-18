import { describe, expect, test } from 'vitest'
import { PtyModeTracker } from '../../electron/main/services/pty-mode-tracker'

describe('PtyModeTracker', () => {
  test('tracks entering and leaving the alternate screen', () => {
    const tracker = new PtyModeTracker()
    expect(tracker.altScreen).toBe(false)

    tracker.consume('\x1b[?1049h')
    expect(tracker.altScreen).toBe(true)

    tracker.consume('\x1b[?1049l')
    expect(tracker.altScreen).toBe(false)
  })

  test('restores bracketed paste and SGR mouse tracking', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?2004h\x1b[?1006h')

    const prologue = tracker.prologue()
    expect(prologue).toContain('\x1b[?2004h')
    expect(prologue).toContain('\x1b[?1006h')
  })

  test('emits the alt-screen switch before the modes that depend on it', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?1049h\x1b[?2004h')

    const prologue = tracker.prologue()
    // Modes must land on the buffer the app is actually drawing on.
    expect(prologue.indexOf('\x1b[?1049h')).toBeLessThan(prologue.indexOf('\x1b[?2004h'))
  })

  test('recognises a sequence split across chunk boundaries', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?10')
    tracker.consume('49h')

    // The batcher can cut anywhere; missing this would corrupt a TUI redraw.
    expect(tracker.altScreen).toBe(true)
  })

  test('recognises a sequence delivered one byte at a time', () => {
    const tracker = new PtyModeTracker()
    for (const byte of '\x1b[?2004h') tracker.consume(byte)

    expect(tracker.prologue()).toContain('\x1b[?2004h')
  })

  test('handles several modes in one sequence', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?1000;1006h')

    const prologue = tracker.prologue()
    expect(prologue).toContain('\x1b[?1000h')
    expect(prologue).toContain('\x1b[?1006h')
  })

  test('asserts cursor visibility only when the app moved it off the default', () => {
    const untouched = new PtyModeTracker()
    untouched.consume('plain output')
    // The terminal default is "visible"; emitting ?25l here would hide it.
    expect(untouched.prologue()).not.toContain('\x1b[?25l')

    const hidden = new PtyModeTracker()
    hidden.consume('\x1b[?25l')
    expect(hidden.prologue()).toContain('\x1b[?25l')

    const shownAgain = new PtyModeTracker()
    shownAgain.consume('\x1b[?25l\x1b[?25h')
    expect(shownAgain.prologue()).not.toContain('\x1b[?25l')
  })

  test('ignores modes it does not restore', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?7h') // auto-wrap — left to the app

    expect(tracker.prologue()).toBe('')
  })

  test('reset() clears tracked state', () => {
    const tracker = new PtyModeTracker()
    tracker.consume('\x1b[?1049h\x1b[?25l')
    tracker.reset()

    expect(tracker.altScreen).toBe(false)
    expect(tracker.prologue()).toBe('')
  })
})
