import headless from '@xterm/headless'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../electron/main/db/index'
import { WorkspaceService } from '../electron/main/services/workspace.service'
import { TerminalManager } from '../electron/main/services/terminal.service'
import { DA1_CARRY_MS, DA1_REPLY, Da1Filter, stripDa1 } from '../electron/main/services/pty-da1'

/*
 * B13 / HML on #374: the bundled ConPTY sends DA1 (ESC[c) on start and holds the first prompt until it is answered.
 * A pane started with no view had nobody to answer and its prompt came ~3 s late. Main answers when no view is
 * attached, never when one is, and keeps no DA1 in what it replays.
 */
const { Terminal } = headless
const BUNDLED_START = ['\x1b[1t\x1b[c', '\x1b[?1004h\x1b[?9001h', 'PS C:\\repo> ']

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

async function startPane(platform: NodeJS.Platform = 'win32') {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
  const paneId = workspace.panes[0].id
  let onData: ((data: string) => void) | undefined
  const fake = {
    pid: 0, write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => { onData = handler; return { dispose: vi.fn() } }),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const emitted: string[] = []
  const manager = new TerminalManager(db, { pty: { spawn: vi.fn(() => fake as never) }, platform, emitData: event => { emitted.push(event.data) } })
  cleanups.push(() => { manager.stopAll(); db.close() })
  await manager.start({ workspaceId: workspace.id, paneId, agentCommand: 'my-agent', disableRtk: true })
  const replies = () => fake.write.mock.calls.map(([data]) => data as string).filter(data => data === DA1_REPLY)
  return { manager, paneId, emit: (data: string) => onData?.(data), fake, emitted, replies }
}

/** What a fresh xterm sends back to the PTY while it renders `data`. */
async function answersFrom(data: string): Promise<string[]> {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  const sent: string[] = []
  term.onData(reply => sent.push(reply))
  await new Promise<void>(resolve => term.write(data, resolve))
  term.dispose()
  return sent
}

describe('DA1 for panes with no view (B13, bundled ConPTY)', () => {
  test('main replies with the bytes xterm.js itself sends', async () => {
    expect(await answersFrom('\x1b[c')).toEqual([DA1_REPLY])
    expect(await answersFrom('\x1b[0c')).toEqual([DA1_REPLY])
  })

  test('a pane with no view gets exactly one reply, and the query goes nowhere', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const pane = await startPane(platform)
      for (const chunk of BUNDLED_START) pane.emit(chunk)
      expect(pane.replies()).toEqual([DA1_REPLY])
      await vi.waitFor(() => expect(pane.emitted.join('')).toContain('PS C:\\repo> '))
      expect(pane.emitted.join('')).not.toContain('\x1b[c')
    }
  })

  test('with a view attached main does not reply; the view gets the query', async () => {
    const pane = await startPane()
    pane.manager.attach({ paneId: pane.paneId })
    for (const chunk of BUNDLED_START) pane.emit(chunk)
    await vi.waitFor(() => expect(pane.emitted.join('')).toContain('PS C:\\repo> '))
    expect(pane.replies()).toEqual([])
    expect(pane.emitted.join('')).toContain('\x1b[1t\x1b[c')
  })

  test('a query split across two chunks is answered once', async () => {
    for (const split of [['\x1b', '[c'], ['\x1b[', 'c'], ['\x1b[0', 'cPS> ']]) {
      const pane = await startPane('linux')
      for (const chunk of split) pane.emit(chunk)
      expect(pane.replies()).toEqual([DA1_REPLY])
    }
  })

  test('DA2, a non-zero DA1 and other CSI sequences are left alone', async () => {
    const pane = await startPane('linux')
    pane.emit('\x1b[>c\x1b[1c\x1b[?1;2c\x1b[0m\x1b[2J\x1b[>0c')
    expect(pane.replies()).toEqual([])
    await vi.waitFor(() => expect(pane.emitted.join('')).toBe('\x1b[>c\x1b[1c\x1b[?1;2c\x1b[0m\x1b[2J\x1b[>0c'))
  })

  test('a held prefix that is not DA1 goes out with the next chunk, or alone after a moment', async () => {
    const pane = await startPane('linux')
    pane.emit('a\x1b[0')
    pane.emit('mb')
    pane.emit('c\x1b')
    await vi.waitFor(() => expect(pane.emitted.join('')).toBe('a\x1b[0mbc\x1b'), { timeout: DA1_CARRY_MS * 20 })
    expect(pane.replies()).toEqual([])
  })

  test('the replay after main answered holds no DA1, so the view sends nothing back', async () => {
    const pane = await startPane()
    for (const chunk of BUNDLED_START) pane.emit(chunk)
    // The raw start does make an xterm answer: the stray `?1;2c` a replay would type into the shell.
    expect(await answersFrom(BUNDLED_START.join(''))).toContain(DA1_REPLY)
    const view = pane.manager.attach({ paneId: pane.paneId })
    expect(view.replay).toContain('PS C:\\repo> ')
    expect(view.replay).not.toContain('\x1b[c')
    expect(await answersFrom(view.prologue + view.replay)).toEqual([])
    expect(pane.replies()).toEqual([DA1_REPLY])
  })

  test('a query the live view answered is not replayed to the next view', async () => {
    const pane = await startPane()
    pane.manager.attach({ paneId: pane.paneId })
    for (const chunk of BUNDLED_START) pane.emit(chunk)
    pane.manager.detach({ paneId: pane.paneId })
    const view = pane.manager.attach({ paneId: pane.paneId })
    expect(view.replay).toContain('PS C:\\repo> ')
    expect(await answersFrom(view.prologue + view.replay)).toEqual([])
    expect(pane.replies()).toEqual([])
  })

  test('a view attaching right after main answered (reply still queued) gets no query: one reply in all', async () => {
    const pane = await startPane()
    pane.emit('\x1b[1t\x1b[c')
    const view = pane.manager.attach({ paneId: pane.paneId })
    pane.emit('PS C:\\repo> ')
    await vi.waitFor(() => expect(pane.emitted.join('')).toContain('PS C:\\repo> '))
    const seen = view.replay + pane.emitted.join('')
    expect(await answersFrom(seen)).toEqual([])
    expect(pane.replies()).toEqual([DA1_REPLY])
  })
})

describe('Da1Filter', () => {
  test('answers and strips only when asked, and never splits a query', () => {
    const filter = new Da1Filter()
    expect(filter.filter('x\x1b[', false)).toEqual({ data: 'x', answered: 0 })
    expect(filter.holding).toBe(true)
    expect(filter.filter('cy', false)).toEqual({ data: '\x1b[cy', answered: 0 })
    expect(filter.filter('\x1b[c\x1b[0c', true)).toEqual({ data: '', answered: 2 })
    expect(stripDa1('a\x1b[cb\x1b[>cc')).toBe('ab\x1b[>cc')
  })
})
