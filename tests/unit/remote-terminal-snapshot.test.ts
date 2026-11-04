// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import xtermHeadless from '@xterm/headless'
import { buildTerminalSnapshot, SNAPSHOT_SCROLLBACK } from '../../electron/main/services/remote/terminal-snapshot'
import { clean, escapeSafeCut, TerminalWindow } from '../../electron/main/services/remote/text'

/** 1.4.3 P4 · the screen a phone gets on subscribe. */

const plain = (ansi: string) => ansi.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, '')
const SECRET = `sk-ant-${'q'.repeat(40)}`

afterEach(() => { vi.restoreAllMocks() })

describe('escape-safe cut', () => {
  test('a cut never lands inside a CSI, an OSC, a DCS or a lone ESC; complete sequences are left alone', () => {
    expect(escapeSafeCut('ab\x1b[31', 7)).toBe(2)
    expect(escapeSafeCut('ab\x1b[31mcd', 9)).toBe(9)
    expect(escapeSafeCut('ab\x1b]0;my title', 15)).toBe(2)
    expect(escapeSafeCut('ab\x1b]0;my title\x07cd', 18)).toBe(18)
    expect(escapeSafeCut('ab\x1b]0;t\x1b\\cd', 11)).toBe(11)
    expect(escapeSafeCut('ab\x1bPq data', 10)).toBe(2)
    expect(escapeSafeCut('ab\x1b', 3)).toBe(2)
    expect(escapeSafeCut('ab\x1b=cd', 6)).toBe(6)
    expect(escapeSafeCut('plain text', 5)).toBe(5)
  })

  test('the window holds a split OSC (a title with spaces) and releases it whole with the next batch', () => {
    const window = new TerminalWindow(text => clean(text, [], Number.MAX_SAFE_INTEGER), 4)
    const first = window.take(`${'x'.repeat(30)} \x1b]0;my long window title`)
    expect(first.text).not.toContain('\x1b]')
    const rest = window.take(' done\x07 after', true)
    expect(rest.text).toContain('\x1b]0;my long window title done\x07')
  })
})

describe('buildTerminalSnapshot', () => {
  test('replays the redacted text at the pane size and serializes the screen with xterm\'s own serializer', async () => {
    const { snapshot, redacted } = await buildTerminalSnapshot('one\r\n\x1b[1mtwo\x1b[0m\r\nbusy: building 3/7', 40, 10, [])
    expect(redacted).toBe(0)
    expect(snapshot).toMatchObject({ cols: 40, rows: 10 })
    expect(plain(snapshot.ansi)).toContain('one')
    expect(plain(snapshot.ansi)).toContain('busy: building 3/7')
    expect(snapshot.ansi).toContain('\x1b[1m') // styles kept
  })

  test('a full-screen app on the alternate screen is serialized as such', async () => {
    const { snapshot } = await buildTerminalSnapshot('shell line\r\n\x1b[?1049h\x1b[HTUI FRAME', 40, 10, [])
    expect(snapshot.ansi).toContain('\x1b[?1049h')
    expect(plain(snapshot.ansi)).toContain('TUI FRAME')
  })

  test('scrollback is capped at 200 rows', async () => {
    const lines = Array.from({ length: 600 }, (_, index) => `line ${index}`).join('\r\n')
    const { snapshot } = await buildTerminalSnapshot(lines, 40, 10, [])
    const text = plain(snapshot.ansi)
    expect(text).toContain('line 599')
    expect(text).not.toContain('line 100\r')
    expect(text.split(/\r?\n/).length).toBeLessThanOrEqual(SNAPSHOT_SCROLLBACK + 10 + 2)
  })

  test('sizes are clamped to sane bounds', async () => {
    expect((await buildTerminalSnapshot('x', 5, 1, [])).snapshot).toMatchObject({ cols: 20, rows: 5 })
    expect((await buildTerminalSnapshot('x', 10_000, 9_999, [])).snapshot).toMatchObject({ cols: 500, rows: 200 })
  })

  test('TECH LEAD: a secret printed in two colours never shows in clear in snapshot.ansi', async () => {
    // Split by an SGR change, the raw-text redactor sees two short pieces; on screen it reads as one key.
    const raw = `key: ${SECRET.slice(0, 12)}\x1b[31m${SECRET.slice(12)}\x1b[0m\r\nok`
    const released = clean(raw, [], Number.MAX_SAFE_INTEGER)
    expect(released.text).toContain(SECRET.slice(12)) // layer 1 alone misses it
    const { snapshot, redacted } = await buildTerminalSnapshot(released.text, 80, 10, [])
    expect(plain(snapshot.ansi)).not.toContain(SECRET)
    expect(snapshot.ansi).not.toContain(SECRET.slice(12))
    expect(redacted).toBeGreaterThan(0)
    expect(plain(snapshot.ansi)).toContain('ok')
  })

  test('a secret split by the wrap at the right edge is caught too', async () => {
    const { snapshot } = await buildTerminalSnapshot(`${'.'.repeat(30)}${SECRET}`, 40, 10, [])
    expect(plain(snapshot.ansi).replace(/\r?\n/g, '')).not.toContain(SECRET)
  })

  test('the emulator is disposed after every snapshot, also when building fails', async () => {
    const dispose = vi.spyOn(xtermHeadless.Terminal.prototype, 'dispose')
    for (let index = 0; index < 5; index += 1) await buildTerminalSnapshot(`run ${index}`, 40, 10, [])
    expect(dispose).toHaveBeenCalledTimes(5)
    vi.spyOn(xtermHeadless.Terminal.prototype, 'write').mockImplementationOnce(() => { throw new Error('parser') })
    await expect(buildTerminalSnapshot('boom', 40, 10, [])).rejects.toThrow('parser')
    expect(dispose).toHaveBeenCalledTimes(6)
  })
})

describe('the frame budget (TECH LEAD on #634)', () => {
  test('the screen is judged on a page of its own, with no ring data beside it', async () => {
    const { snapshotFits } = await import('../../electron/main/services/remote/topics')
    const { REMOTE_LIMITS } = await import('../../shared/remote/protocol')
    expect(snapshotFits({ ansi: 'x'.repeat(30_000), cols: 80, rows: 24 })).toBe(true)
    expect(snapshotFits({ ansi: 'x'.repeat(REMOTE_LIMITS.maxFrameBytes), cols: 80, rows: 24 })).toBe(false)
  })

  test('too big: less history (200, then 50, then none); left out only when the screen alone does not fit', async () => {
    const lines = Array.from({ length: 400 }, (_, index) => `row ${index} ${'#'.repeat(60)}`).join('\r\n')
    const sizes: number[] = []
    const reduced = await buildTerminalSnapshot(lines, 80, 10, [], snapshot => { sizes.push(snapshot.ansi.length); return sizes.length === 2 })
    expect(sizes).toHaveLength(2)
    expect(sizes[1]).toBeLessThan(sizes[0])
    expect(plain(reduced!.snapshot.ansi)).toContain('row 399')
    expect(plain(reduced!.snapshot.ansi)).not.toContain('row 300 ')
    // Nothing fits, not even the screen alone: left out (null), all three tried.
    let tries = 0
    expect(await buildTerminalSnapshot(lines, 80, 10, [], () => { tries += 1; return false })).toBeNull()
    expect(tries).toBe(3)
  })

  test('the plain fallback (a secret was redacted on screen) also steps its history down', async () => {
    const SPLIT = `key ${SECRET.slice(0, 12)}\x1b[31m${SECRET.slice(12)}\x1b[0m\r\n`
    const text = `${Array.from({ length: 300 }, (_, index) => `old ${index}`).join('\r\n')}\r\n${SPLIT}tail`
    const released = clean(text, [], Number.MAX_SAFE_INTEGER).text
    const tried: string[] = []
    const built = await buildTerminalSnapshot(released, 80, 10, [], snapshot => { tried.push(snapshot.ansi); return tried.length === 3 })
    expect(plain(built!.snapshot.ansi)).toContain('tail')
    expect(plain(built!.snapshot.ansi)).not.toContain('old 250')
    expect(built!.snapshot.ansi).not.toContain(SECRET.slice(12))
    expect(built!.redacted).toBeGreaterThan(0)
  })
})
