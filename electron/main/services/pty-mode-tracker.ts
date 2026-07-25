/**
 * Tracks the DEC private modes a PTY has switched on, so a terminal view that
 * re-attaches to a running session can be put back into the right mode before
 * any output is replayed.
 *
 * Why this is needed: replaying raw bytes only reproduces what is IN the buffer.
 * If the `\x1b[?1049h` that entered the alternate screen was evicted from the
 * ring head, the replay paints full-screen TUI content onto the NORMAL buffer
 * and the result is garbage. Likewise a re-attached view that lost bracketed
 * paste or mouse tracking silently breaks agent CLIs (Claude/Copilot) that
 * enabled them.
 *
 * Kept dependency-free and side-effect-free so it can be unit tested by feeding
 * it bytes, including sequences split across chunk boundaries.
 */

/** Modes worth restoring. Anything else is left to the app to re-assert. */
const TRACKED_MODES = new Set([
  1, // DECCKM — application cursor keys
  25, // DECTCEM — cursor visibility
  1000, // X11 mouse: button press/release
  1002, // …with drag tracking
  1003, // …any-motion tracking
  1006, // SGR extended mouse coordinates
  1049, // alternate screen buffer + saved cursor
  2004 // bracketed paste
])

/**
 * Cursor visibility is the one tracked mode whose default is ON, so a plain
 * "is it in the enabled set" test cannot tell "never touched" (visible) from
 * "explicitly hidden". It gets its own tri-state.
 */
type CursorState = 'default' | 'shown' | 'hidden'

/** Longest prefix we may need to hold while a sequence spans two chunks. */
const MAX_PARTIAL = 32

export class PtyModeTracker {
  private readonly enabled = new Set<number>()
  private cursor: CursorState = 'default'
  /** Trailing bytes of the previous chunk that could be an unfinished CSI. */
  private carry = ''

  /** Feed raw PTY output. Safe to call with arbitrary chunk boundaries. */
  consume(data: string): void {
    if (!data) return
    const text = this.carry + data
    // CSI ? <params> h|l — params may be multiple, separated by ';'.
    const pattern = /\x1b\[\?([0-9;]*)([hl])/g
    let match: RegExpExecArray | null
    let lastEnd = 0
    while ((match = pattern.exec(text)) !== null) {
      lastEnd = match.index + match[0].length
      const set = match[2] === 'h'
      for (const raw of (match[1] ?? '').split(';')) {
        if (!raw) continue
        const mode = Number(raw)
        if (!TRACKED_MODES.has(mode)) continue
        if (mode === 25) {
          this.cursor = set ? 'shown' : 'hidden'
          continue
        }
        if (set) this.enabled.add(mode)
        else this.enabled.delete(mode)
      }
    }

    // Retain a possible partial sequence so `\x1b[?10` + `49h` still registers.
    const tailStart = Math.max(lastEnd, text.length - MAX_PARTIAL)
    const tail = text.slice(tailStart)
    const escape = tail.lastIndexOf('\x1b')
    this.carry = escape === -1 ? '' : tail.slice(escape)
  }

  /** True while the app is on the alternate screen (a full-screen TUI). */
  get altScreen(): boolean {
    return this.enabled.has(1049)
  }

  /**
   * Sequences that put a fresh terminal back into the tracked modes.
   *
   * `1049` is emitted FIRST so the modes that follow apply to the buffer the
   * app is actually drawing on. Cursor visibility is only asserted when the
   * app moved it away from the terminal default.
   */
  prologue(): string {
    let out = ''
    if (this.enabled.has(1049)) out += '\x1b[?1049h'
    for (const mode of [1, 1000, 1002, 1003, 1006, 2004]) {
      if (this.enabled.has(mode)) out += `\x1b[?${mode}h`
    }
    if (this.cursor === 'hidden') out += '\x1b[?25l'
    return out
  }

  reset(): void {
    this.enabled.clear()
    this.cursor = 'default'
    this.carry = ''
  }
}
