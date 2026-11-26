import { describe, expect, test, vi } from 'vitest'
import { trimStringToSafeVtTail } from '../../shared/vt-trim'
import {
  DEFAULT_WINDOWS_CONPTY_BUILD,
  parseWindowsBuildNumber,
  readWindowsBuildFromArgv,
  resolveWindowsPty
} from '../../shared/windows-pty'
import { createTerminalWriteScheduler } from '../../src/components/Terminal/terminalWriteScheduler'
import { estimateTerminalGrid, resolveInactiveCursorStyle } from '../../src/components/Terminal/terminalViewHelpers'
import { TERMINAL_PREFS_DEFAULTS } from '../../src/store/terminal-prefs.store'

describe('OXE-436 · Windows ConPTY build detection & windowsPty resolution', () => {
  test('parses Windows build numbers from os.release() and integer strings', () => {
    expect(parseWindowsBuildNumber('10.0.26200')).toBe(26200)
    expect(parseWindowsBuildNumber('10.0.22621')).toBe(22621)
    expect(parseWindowsBuildNumber('19045')).toBe(19045)
    expect(parseWindowsBuildNumber('')).toBeUndefined()
    expect(parseWindowsBuildNumber('10.0.abc')).toBeUndefined()
    expect(parseWindowsBuildNumber('0')).toBeUndefined()
  })

  test('reads build number from preload argv on win32 with systemVersion fallback', () => {
    expect(readWindowsBuildFromArgv(['electron', '--oxe-win-build=26200'], 'win32')).toBe(26200)
    expect(readWindowsBuildFromArgv(['electron'], 'win32', '10.0.26100')).toBe(26100)
    expect(readWindowsBuildFromArgv(['electron', '--oxe-win-build=26200'], 'linux')).toBeUndefined()
    expect(readWindowsBuildFromArgv(['electron', '--oxe-win-build=26200'], 'darwin')).toBeUndefined()
  })

  test('resolves xterm windowsPty only on win32 with 22621 fallback', () => {
    expect(resolveWindowsPty({ platform: 'win32', windowsBuildNumber: 26200 })).toEqual({
      backend: 'conpty',
      buildNumber: 26200
    })
    expect(resolveWindowsPty({ platform: 'win32' })).toEqual({
      backend: 'conpty',
      buildNumber: DEFAULT_WINDOWS_CONPTY_BUILD
    })
    expect(resolveWindowsPty({ platform: 'linux', windowsBuildNumber: 26200 })).toBeUndefined()
    expect(resolveWindowsPty(undefined)).toBeUndefined()
  })
})

describe('OXE-436 · Safe VT head-truncation in trimStringToSafeVtTail and write scheduler', () => {
  test('trimStringToSafeVtTail skips partial CSI, OSC, DCS, and ESC fragments', () => {
    // Cut lands inside `\x1b[38;2;255;0;128m`.
    const csi = 'PREFIX\x1b[38;2;255;0;128mHELLO'
    expect(trimStringToSafeVtTail(csi, 14)).toBe('HELLO')

    // Cut lands inside OSC title.
    const osc = 'PREFIX\x1b]0;Window Title\x07PROMPT'
    expect(trimStringToSafeVtTail(osc, 15)).toBe('PROMPT')

    // Cut lands inside DCS string terminated by ST.
    const dcs = 'PREFIX\x1bP1$r0;1m\x1b\\AFTER'
    expect(trimStringToSafeVtTail(dcs, 12)).toBe('AFTER')

    // Cut lands right after complete CSI preserves following text untouched.
    const aligned = 'PREFIX\x1b[31mHELLO'
    expect(trimStringToSafeVtTail(aligned, 5)).toBe('HELLO')
  })

  for (const queue of [true, false]) {
    test(`write scheduler (queue=${queue}) never emits orphaned escape parameters after buffer cap truncation`, () => {
      const writes: Array<{ chunk: string; truncated: boolean }> = []
      const frames: Array<() => void> = []
      const scheduler = createTerminalWriteScheduler({
        paused: true,
        queue,
        maxBytesPerFrame: 128,
        maxBufferedBytes: 16,
        write: (chunk, done, meta) => {
          writes.push({ chunk, truncated: meta.truncated })
          done()
        },
        scheduleFrame: (cb) => frames.push(cb),
        cancelFrame: vi.fn()
      })

      scheduler.enqueue('0123456789\x1b[38;2;')
      scheduler.enqueue('255;128;0mBODY')
      expect(scheduler.wasTruncated()).toBe(true)

      scheduler.setPaused(false)
      while (frames.length > 0) frames.shift()!()

      expect(writes).toHaveLength(1)
      expect(writes[0].truncated).toBe(true)
      expect(writes[0].chunk).toBe('BODY')
      scheduler.dispose()
    })
  }
})

describe('OXE-436 · Unfocused cursor style & initial pane geometry estimator', () => {
  test('matches unfocused cursorInactiveStyle to cursorStyle', () => {
    expect(resolveInactiveCursorStyle('bar')).toBe('bar')
    expect(resolveInactiveCursorStyle('underline')).toBe('underline')
    expect(resolveInactiveCursorStyle('block')).toBe('outline')
  })

  test('estimates grid cols/rows from laid-out pane container and returns null when unmeasured', () => {
    expect(estimateTerminalGrid(null, TERMINAL_PREFS_DEFAULTS)).toBeNull()

    const unmeasured = document.createElement('div')
    unmeasured.getBoundingClientRect = () => ({ width: 0, height: 0 } as DOMRect)
    expect(estimateTerminalGrid(unmeasured, TERMINAL_PREFS_DEFAULTS)).toBeNull()

    const box = document.createElement('div')
    box.getBoundingClientRect = () => ({ width: 1000, height: 600 } as DOMRect)
    const grid = estimateTerminalGrid(box, {
      fontFamily: 'Cascadia Mono, monospace',
      fontSize: 16,
      lineHeight: 1.4,
      letterSpacing: 0
    })
    expect(grid).not.toBeNull()
    expect(grid!.cols).toBeGreaterThan(80)
    expect(grid!.rows).toBeGreaterThan(20)
  })
})
