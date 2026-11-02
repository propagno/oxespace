/**
 * Primary Device Attributes (DA1) for panes no view is rendering (B13, #374).
 *
 * node-pty's bundled ConPTY (useConptyDll) sends DA1 (`ESC [ c`) on start and waits for the reply before the shell's
 * first prompt goes out. A pane started with no view (IPC start, hidden pane) had nobody to answer, so its prompt came
 * ~3 s late, when ConPTY gave up. Main answers in that case, with the reply xterm.js itself sends
 * (InputHandler.sendDeviceAttributesPrimary for TERM xterm: `ESC [ ? 1 ; 2 c`). With a view attached, the query goes
 * through and xterm answers, as before.
 *
 * Only `ESC [ c` and `ESC [ 0 c` are DA1; xterm answers nothing for a non-zero parameter, and DA2 (`ESC [ > c`) or any
 * other CSI never matches. A query split across PTY chunks is held back (`carry`) until it is whole, so the stream
 * after this filter never splits a DA1 and the ring can drop every query with a plain match.
 */
export const DA1_REPLY = '\x1b[?1;2c'
const DA1 = /\x1b\[0?c/g
/** A chunk ending in one of these may be the start of a DA1 query. */
const PARTIAL = /\x1b(?:\[0?)?$/
/** How long a held prefix waits for the rest before it goes out as is. */
export const DA1_CARRY_MS = 50

export function stripDa1(data: string): string {
  return data.includes('\x1b[') ? data.replace(DA1, '') : data
}

export class Da1Filter {
  private carry = ''

  /** True while the end of the last chunk is held back. */
  get holding(): boolean {
    return this.carry.length > 0
  }

  /**
   * The bytes to pass on, and how many queries main must answer. With `answer` the queries are removed from the
   * stream (no view will ever see them, so none answers them a second time); without it they stay for the view.
   */
  filter(chunk: string, answer: boolean): { data: string; answered: number } {
    let data = this.carry + chunk
    this.carry = ''
    const partial = PARTIAL.exec(data)
    if (partial) {
      this.carry = partial[0]
      data = data.slice(0, partial.index)
    }
    if (!answer || !data.includes('\x1b[')) return { data, answered: 0 }
    let answered = 0
    data = data.replace(DA1, () => { answered++; return '' })
    return { data, answered }
  }

  /** What is held back, released when the rest never came (or the session ends). */
  release(): string {
    const data = this.carry
    this.carry = ''
    return data
  }
}
