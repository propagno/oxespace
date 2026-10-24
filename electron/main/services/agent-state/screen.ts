// @xterm/headless is CommonJS: the main bundle is ESM, so only its default export can be imported.
import xtermHeadless from '@xterm/headless'
import type { ScreenInput } from './manifest'

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
  private pending = 0

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
    this.pending += 1
    return new Promise(resolve => this.terminal.write(data, () => { this.pending -= 1; resolve() }))
  }

  get busy(): boolean { return this.pending > 0 }

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
    this.terminal.dispose()
  }
}
