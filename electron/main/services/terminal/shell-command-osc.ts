import type { ShellCommandState } from '../../../../shared/types/ipc/terminal'

/**
 * OXE-272 · Passive command lifecycle parser for shells with OSC 633 (VS Code)
 * or OSC 133 (FinalTerm / iTerm2 / WezTerm) shell integration:
 *   OSC 633 ; C          / OSC 133 ; C             command started
 *   OSC 633 ; D ; <code> / OSC 133 ; D ; <code>    command finished with exit code
 *   OSC 633 ; D          / OSC 133 ; D             command finished / cancelled (no code)
 *
 * Sequences may be terminated by BEL (\x07) or ST (\x1b\\) and split across
 * arbitrary PTY chunks. Partial sequences are bounded at SHELL_COMMAND_OSC_MAX_PENDING
 * bytes so stray ESC ] bytes never accumulate memory.
 */
export const SHELL_COMMAND_OSC_MAX_PENDING = 512

const ESC = '\u001b'
const BEL = '\u0007'
const OSC = `${ESC}]`

interface Terminated { body: number; next: number }
type ParsedEvent = { kind: 'start' } | { kind: 'end'; exitCode?: number }

function terminatorOf(text: string, from: number): Terminated | { body: -1; next: number } | null {
  const bel = text.indexOf(BEL, from)
  const esc = text.indexOf(ESC, from)
  if (bel >= 0 && (esc < 0 || bel < esc)) return { body: bel, next: bel + 1 }
  if (esc < 0) return null
  if (esc + 1 >= text.length) return null
  return text[esc + 1] === '\\' ? { body: esc, next: esc + 2 } : { body: -1, next: esc }
}

function parseOscCommand(body: string): ParsedEvent | null {
  if (!body.startsWith('633;') && !body.startsWith('133;')) return null
  const rest = body.slice(4)
  if (rest === 'C' || rest.startsWith('C;')) return { kind: 'start' }
  if (rest === 'D') return { kind: 'end' }
  if (rest.startsWith('D;')) {
    const rawCode = rest.slice(2).split(';', 1)[0].trim()
    if (/^-?\d+$/.test(rawCode)) {
      const parsed = Number.parseInt(rawCode, 10)
      if (Number.isSafeInteger(parsed)) return { kind: 'end', exitCode: parsed }
    }
    return { kind: 'end' }
  }
  return null
}

export class ShellCommandOscScanner {
  private pending = ''
  private state: ShellCommandState | null = null

  constructor(private readonly now: () => number = Date.now) {}

  pendingLength(): number { return this.pending.length }

  current(): ShellCommandState | null {
    return this.state ? { ...this.state } : null
  }

  /** Consumes a PTY output chunk and returns the latest command state if a transition occurred, else null. */
  push(chunk: string): ShellCommandState | null {
    let text: string
    if (this.pending) {
      text = this.pending + chunk
      this.pending = ''
    } else {
      const first = chunk.indexOf(OSC)
      if (first < 0) {
        if (chunk.endsWith(ESC)) this.pending = ESC
        return null
      }
      text = chunk.slice(first)
    }

    let changed = false
    let at = 0
    while (at < text.length) {
      const start = text.indexOf(OSC, at)
      if (start < 0) {
        if (text.endsWith(ESC)) this.pending = ESC
        break
      }
      const end = terminatorOf(text, start + 2)
      if (!end) {
        const rest = text.slice(start)
        this.pending = rest.length > SHELL_COMMAND_OSC_MAX_PENDING ? '' : rest
        break
      }
      if (end.body >= 0) {
        const event = parseOscCommand(text.slice(start + 2, end.body))
        if (event && this.apply(event)) changed = true
      }
      at = end.next
    }
    return changed && this.state ? { ...this.state } : null
  }

  private apply(event: ParsedEvent): boolean {
    if (event.kind === 'start') {
      this.state = { running: true, startedAt: this.now() }
      return true
    }
    if (!this.state) {
      if (event.exitCode === undefined) return false
      const at = this.now()
      this.state = { running: false, startedAt: at, finishedAt: at, exitCode: event.exitCode }
      return true
    }
    if (!this.state.running) return false
    this.state = {
      running: false,
      startedAt: this.state.startedAt,
      finishedAt: this.now(),
      ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {})
    }
    return true
  }
}
