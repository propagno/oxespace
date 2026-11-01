import headless from '@xterm/headless'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../electron/main/db/index'
import { WorkspaceService } from '../electron/main/services/workspace.service'
import { CONPTY_START_SCREEN, TerminalManager } from '../electron/main/services/terminal.service'

/*
 * B13 / HML FINDING H on #374: with node-pty's bundled ConPTY (useConptyDll) the FIRST PowerShell screen was drawn one
 * row off. The bytes below were recorded from both ConPTYs on Windows (PowerShell 5.1, 80x24, `echo acc-ready`; prompt
 * path shortened):
 * - the system ConPTY starts with ESC[2J ESC[m ESC[H, so whatever the view held is wiped and the cursor is home;
 * - the bundled one starts with ESC[1t ESC[c ESC[?1004h ESC[?9001h and prints the prompt wherever xterm's cursor is,
 *   then redraws the command line with absolute moves from row 1 (ESC[1;13H).
 * TerminalView writes "Idle\r\n" into a fresh view before the shell's first byte, so the prompt landed on row 2 while
 * ConPTY drew the command on row 1 and its output over the prompt. Main now starts a Windows session with the same
 * clean, homed screen the system ConPTY gave (CONPTY_START_SCREEN).
 */
const { Terminal } = headless
const PROMPT = 'PS C:\\repo> '
const VIEW_BEFORE_FIRST_BYTE = 'Idle\r\n' // TerminalView.tsx, a view with no running session yet

const SYSTEM_CONPTY = [
  '\x1b[?9001h\x1b[?1004h',
  `\x1b[?25l\x1b[2J\x1b[m\x1b[H${PROMPT.trimEnd()}\x1b[1C\x1b]0;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\x07\x1b[?25h`,
  '\x1b[?25l\x1b[93mecho \x1b[37macc-ready\r\n\x1b[?25h\x1b[macc-ready\r\n' + PROMPT
]
const typed = (text: string, column: number) =>
  `\x1b[?25l\x1b[1;13H\x1b[93mecho\x1b[39;49m \x1b[37m${text}\x1b[39;49m\x1b[0m\x1b[1;${column}H\x1b[?25h`
const BUNDLED_CONPTY = [
  '\x1b[1t\x1b[c',
  '\x1b[?1004h\x1b[?9001h',
  PROMPT,
  typed('acc-ready', 27),
  '\x1b[1;27H\r\n\x1b[0m\x1b[0macc-ready\r\n' + PROMPT
]

async function screen(chunks: string[]): Promise<string[]> {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  for (const chunk of chunks) await new Promise<void>(resolve => term.write(chunk, resolve))
  const rows = [0, 1, 2, 3].map(y => term.buffer.active.getLine(y)?.translateToString(true) ?? '')
  term.dispose()
  return rows
}

const EXPECTED = [`${PROMPT}echo acc-ready`, 'acc-ready', PROMPT.trimEnd(), '']

describe('the first Windows terminal screen (B13, bundled ConPTY)', () => {
  test('the system ConPTY draws the prompt and the first output on rows 1 and 2', async () => {
    expect((await screen([VIEW_BEFORE_FIRST_BYTE, ...SYSTEM_CONPTY])).map(row => row.trimEnd())).toEqual(EXPECTED)
  })

  test('the bundled ConPTY alone lands one row off: the reported bug', async () => {
    const rows = await screen([VIEW_BEFORE_FIRST_BYTE, ...BUNDLED_CONPTY])
    expect(rows[0]).toMatch(/^Idle\s+echo acc-ready$/)
    expect(rows[1].startsWith('acc-ready')).toBe(true)
    expect(rows.map(row => row.trimEnd())).not.toEqual(EXPECTED)
  })

  test('with the start screen main sends first, the bundled ConPTY matches the system one', async () => {
    expect((await screen([VIEW_BEFORE_FIRST_BYTE, CONPTY_START_SCREEN, ...BUNDLED_CONPTY])).map(row => row.trimEnd())).toEqual(EXPECTED)
  })

  test('main sends the start screen before any shell byte on Windows, and nothing extra elsewhere', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const db = openInMemoryDatabase()
      const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
      let onData: ((data: string) => void) | undefined
      const fake = {
        pid: 0, write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
        onData: vi.fn((handler: (data: string) => void) => { onData = handler; return { dispose: vi.fn() } }),
        onExit: vi.fn(() => ({ dispose: vi.fn() }))
      }
      const emitted: string[] = []
      const manager = new TerminalManager(db, { pty: { spawn: vi.fn(() => fake as never) }, platform, emitData: event => { emitted.push(event.data) } })
      try {
        await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'my-agent', disableRtk: true })
        onData?.('PS> ')
        await vi.waitFor(() => expect(emitted.join('')).toContain('PS> '))
        expect(emitted.join('')).toBe(platform === 'win32' ? `${CONPTY_START_SCREEN}PS> ` : 'PS> ')
      } finally { manager.stopAll(); db.close() }
    }
  })
})
