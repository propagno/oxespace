import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../electron/main/db/index'
import { WorkspaceService } from '../electron/main/services/workspace.service'
import { TerminalManager, type TerminalObserver } from '../electron/main/services/terminal.service'
import { terminalLevers } from '../shared/terminal-levers'

/*
 * OXE-411 · The levers measured by e2e/perf/terminal-load-breakdown.spec.ts are off unless OXESPACE_TERM_LEVERS names
 * them: the app behaves as before the card. The measurements are in docs/validation/terminal-load-breakdown.md.
 */
function fakePty() {
  let onData: ((data: string) => void) | undefined
  const pty = {
    pid: 0, process: 'agent', write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => { onData = handler; return { dispose: vi.fn() } }),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
  return { pty, print: (data: string) => onData?.(data) }
}

async function startAgent(env: NodeJS.ProcessEnv) {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
  const { pty, print } = fakePty()
  const observed: string[] = []
  const observer: TerminalObserver = { start: vi.fn(), output: (_paneId, data) => { observed.push(data) }, resize: vi.fn(), exit: vi.fn() }
  const emitted: string[] = []
  const manager = new TerminalManager(db, { pty: { spawn: vi.fn(() => pty as never) }, platform: 'linux', env, observer, emitData: event => { emitted.push(event.data) } })
  await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'my-agent' })
  return { manager, db, print, observed, emitted }
}

describe('the terminal load levers (OXE-411)', () => {
  test('every lever is off by default', async () => {
    expect([...terminalLevers(undefined)]).toEqual([])
    expect([...terminalLevers('')]).toEqual([])
    expect([...terminalLevers('X, , hm')]).toEqual([])

    // No lever: the agent mirror is fed and output reaches the window in the usual 16 ms batch.
    const { manager, db, print, observed, emitted } = await startAgent({ PATH: process.env.PATH ?? '' })
    try {
      print('hello')
      expect(observed.join('')).toBe('hello')
      await vi.waitFor(() => expect(emitted.join('')).toBe('hello'), { timeout: 1_000 })
    } finally { manager.stopAll(); db.close() }
  })

  test('OXESPACE_TERM_LEVERS turns on exactly the levers it names', () => {
    expect([...terminalLevers('h, M ,i')].sort()).toEqual(['H', 'I', 'M'])
    expect([...terminalLevers('M')]).toEqual(['M'])
  })

  test('lever M still feeds the mirror of a pane started as an agent', async () => {
    const { manager, db, print, observed } = await startAgent({ PATH: process.env.PATH ?? '', OXESPACE_TERM_LEVERS: 'M' })
    try {
      print('agent says hi')
      expect(observed.join('')).toBe('agent says hi')
    } finally { manager.stopAll(); db.close() }
  })
})
