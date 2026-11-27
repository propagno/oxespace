// @xterm/headless is CommonJS: the main bundle is ESM, so only its default export can be imported.
import xtermHeadless from '@xterm/headless'
import { trimStringToSafeVtTail } from '../../../../shared/vt-trim'
import type { ScreenInput } from './manifest'

/** Fast-path ceiling: normal writes up to 64 KB go straight into @xterm/headless with zero delay. */
export const MAX_MIRROR_CHUNK_BYTES = 64 * 1024
/** Hard cap on coalesced/trimmed burst data fed to @xterm/headless (only the live bottom viewport matters). */
export const MAX_MIRROR_BUFFERED_BYTES = 128 * 1024

const CLEAR_SCREEN = '\x1b[2J'
const CLEAR_SCROLLBACK = '\x1b[3J'
const CLEAR_AND_UNLOCK_PREFIX = '\x1b[2J\x1b[H\x1b[?2026l'
const UNLOCK_SYNC_PREFIX = '\x1b[?2026l'

function findLastScreenErase(data: string): number {
  const last2J = data.lastIndexOf(CLEAR_SCREEN)
  const last3J = data.lastIndexOf(CLEAR_SCROLLBACK)
  if (last2J === -1 && last3J === -1) return -1
  if (last2J === -1) return last3J
  if (last3J === -1) return last2J
  // Adjacent `\x1b[2J\x1b[3J` or `\x1b[3J\x1b[2J`: preserve both sequences intact.
  if (Math.abs(last2J - last3J) === 4) return Math.min(last2J, last3J)
  return Math.max(last2J, last3J)
}

function compactMirrorPayload(data: string, maxBytes: number): string {
  const eraseIdx = findLastScreenErase(data)
  const slice = eraseIdx > 0 ? data.slice(eraseIdx) : data
  if (slice.length > maxBytes) {
    const tail = trimStringToSafeVtTail(slice, maxBytes)
    return eraseIdx >= 0 ? `${CLEAR_AND_UNLOCK_PREFIX}${tail}` : `${UNLOCK_SYNC_PREFIX}${tail}`
  }
  return slice
}

/**
 * A terminal emulator with no view, fed with a pane's output so the main
 * process can read what the agent shows on screen (its prompt, a permission
 * dialog, a spinner) and the OSC window title and progress it reports.
 * Scrollback is small: detection only reads the live bottom of the screen.
 */
export class PaneScreen {
  private readonly terminal: InstanceType<typeof xtermHeadless.Terminal>
  private oscTitle = ''
  private oscProgress = ''
  private writing = false
  private disposed = false
  private queued = ''
  private queuedResolvers: Array<() => void> = []

  constructor(cols: number, rows: number) {
    this.terminal = new xtermHeadless.Terminal({ cols: Math.max(cols, 20), rows: Math.max(rows, 5), scrollback: 200, allowProposedApi: true })
    this.terminal.onTitleChange(title => { this.oscTitle = title.slice(0, 500) })
    // OSC 9;4;<state>;<progress> is the progress report some agents send; herdr matches its payload.
    this.terminal.parser.registerOscHandler(9, data => {
      if (data.startsWith('4;')) this.oscProgress = data.slice(0, 100)
      return false
    })
  }

  /** Resolves when the data has been parsed into the screen. */
  write(data: string): Promise<void> {
    if (this.disposed || !data) return Promise.resolve()

    // Fast path: small chunks on an idle mirror pass straight through with zero latency change.
    if (!this.writing && this.queued.length === 0 && data.length <= MAX_MIRROR_CHUNK_BYTES) {
      this.writing = true
      return new Promise(resolve => {
        this.terminal.write(data, () => {
          this.writing = false
          resolve()
          this.drainQueued()
        })
      })
    }

    // Burst / busy path: coalesce and drop dead pre-clear history so multi-MB redraws never stall main.
    const nextPayload = data.length > MAX_MIRROR_BUFFERED_BYTES ? data : this.queued + data
    this.queued = compactMirrorPayload(nextPayload, MAX_MIRROR_BUFFERED_BYTES)

    return new Promise(resolve => {
      this.queuedResolvers.push(resolve)
      if (!this.writing) this.drainQueued()
    })
  }

  get busy(): boolean { return this.writing || this.queued.length > 0 }

  resize(cols: number, rows: number): void {
    this.terminal.resize(Math.max(cols, 20), Math.max(rows, 5))
  }

  /** The visible screen, one line per row without trailing spaces, plus the OSC title and progress. */
  read(): ScreenInput {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let row = 0; row < this.terminal.rows; row += 1) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return { screen: lines.join('\n'), oscTitle: this.oscTitle, oscProgress: this.oscProgress }
  }

  dispose(): void {
    this.disposed = true
    this.queued = ''
    this.flushResolvers()
    this.terminal.dispose()
  }

  private drainQueued(): void {
    if (this.writing) return
    if (this.disposed || this.queued.length === 0) {
      this.flushResolvers()
      return
    }
    const next = this.queued
    const resolvers = this.queuedResolvers
    this.queued = ''
    this.queuedResolvers = []
    this.writing = true
    this.terminal.write(next, () => {
      this.writing = false
      for (const resolve of resolvers) resolve()
      this.drainQueued()
    })
  }

  private flushResolvers(): void {
    if (this.queuedResolvers.length === 0) return
    const resolvers = this.queuedResolvers
    this.queuedResolvers = []
    for (const resolve of resolvers) resolve()
  }
}
