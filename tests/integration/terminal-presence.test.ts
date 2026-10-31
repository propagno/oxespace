import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { RtkService } from '../../electron/main/services/rtk.service'
import { TerminalManager } from '../../electron/main/services/terminal.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { parseTerminalPresenceInput } from '../../electron/main/ipc/terminal.ipc'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getFocusedWindow: vi.fn() }, ipcMain: { handle: vi.fn() } }))

beforeEach(() => { vi.spyOn(RtkService.prototype, 'ensureRtk').mockResolvedValue('/test/rtk/bin') })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function fakePty() {
  let onData: ((data: string) => void) | null = null
  const instance = {
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pid: 4242,
    onData: vi.fn((handler: (data: string) => void) => { onData = handler; return { dispose: vi.fn() } }),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    emit: (data: string) => onData?.(data)
  }
  return { instance, module: { spawn: vi.fn(() => instance) } }
}

/** A started terminal whose output, activity and agent observer are recorded. */
async function setup(ringCapacityBytes?: number, beforeStart?: (manager: TerminalManager, paneId: string) => void) {
  const db = openInMemoryDatabase()
  db.prepare("INSERT OR IGNORE INTO shell_profiles(id,name,executable,args_json,is_builtin) VALUES ('builtin-bash','Bash','/bin/bash','[]',1)").run()
  const workspace = new WorkspaceService(db).create({ rootPath: process.cwd(), layout: '1x1', autoStart: false })
  const pty = fakePty()
  const data: string[] = [], activity: number[] = [], observed: string[] = []
  const observer = { start: vi.fn(), output: (_pane: string, chunk: string) => { observed.push(chunk) }, resize: vi.fn(), exit: vi.fn() }
  const manager = new TerminalManager(db, { pty: pty.module, platform: 'linux', ringCapacityBytes, observer: observer as never,
    emitData: event => data.push(event.data), emitActivity: event => activity.push(event.bytes) })
  const paneId = workspace.panes[0].id
  beforeStart?.(manager, paneId)
  await manager.start({ workspaceId: workspace.id, paneId, disableRtk: true })
  vi.useFakeTimers()
  return { db, manager, paneId, emit: pty.instance.emit, data, activity, observed, close: () => { vi.useRealTimers(); manager.stopAll(); db.close() } }
}

describe('output pace by presence (B2.3)', () => {
  test('keeps the 16 ms pace for a pane the window never told about', async () => {
    const f = await setup()
    try {
      f.emit('z')
      vi.advanceTimersByTime(16)
      expect(f.data).toEqual(['z'])
    } finally { f.close() }
  })

  test('draws a focused pane at 16 ms and a visible one at 100 ms', async () => {
    const f = await setup()
    try {
      f.manager.setPresence({ paneId: f.paneId, state: 'focused' })
      f.emit('a')
      vi.advanceTimersByTime(16)
      expect(f.data.join('')).toBe('a')
      f.manager.setPresence({ paneId: f.paneId, state: 'visible' })
      f.emit('b')
      vi.advanceTimersByTime(50)
      expect(f.data.join('')).toBe('a')
      vi.advanceTimersByTime(50)
      expect(f.data.join('')).toBe('ab')
    } finally { f.close() }
  })

  test('draws a focused pane at the visible pace while the app window is not focused', async () => {
    const f = await setup()
    try {
      f.manager.setPresence({ paneId: f.paneId, state: 'focused' })
      f.manager.setWindowFocused(false)
      f.emit('x')
      vi.advanceTimersByTime(16)
      expect(f.data).toEqual([])
      vi.advanceTimersByTime(84)
      expect(f.data).toEqual(['x'])
      f.manager.setWindowFocused(true)
      f.emit('y')
      vi.advanceTimersByTime(16)
      expect(f.data).toEqual(['x', 'y'])
    } finally { f.close() }
  })

  test('sends nothing for a hidden pane, keeps activity and the agent observer, and catches the view up once on return', async () => {
    const f = await setup()
    try {
      f.emit('before ')
      vi.advanceTimersByTime(100)
      f.manager.setPresence({ paneId: f.paneId, state: 'hidden' })
      f.emit('working ')
      vi.advanceTimersByTime(1000)
      // An agent asking for approval while its pane is hidden: the observer still reads it, and activity is reported.
      f.emit('Do you want to proceed? [y/n] ')
      vi.advanceTimersByTime(1000)
      expect(f.data.join('')).toBe('before ')
      expect(f.observed.join('')).toContain('Do you want to proceed?')
      expect(f.activity.length).toBeGreaterThan(0)
      f.manager.setPresence({ paneId: f.paneId, state: 'focused' })
      expect(f.data.join('')).toBe('before working Do you want to proceed? [y/n] ')
      // Once: nothing repeats afterwards.
      f.emit('done')
      vi.advanceTimersByTime(16)
      expect(f.data.join('')).toBe('before working Do you want to proceed? [y/n] done')
    } finally { f.close() }
  })

  test('resets and repaints the view when the ring dropped part of what it missed', async () => {
    const f = await setup(64)
    try {
      f.emit('start\n')
      vi.advanceTimersByTime(16)
      f.manager.setPresence({ paneId: f.paneId, state: 'hidden' })
      for (let index = 0; index < 20; index++) { f.emit(`line-${index.toString().padStart(2, '0')}\n`); vi.advanceTimersByTime(250) }
      f.manager.setPresence({ paneId: f.paneId, state: 'visible' })
      const caught = f.data.at(-1)!
      expect(caught.startsWith('\x1bc')).toBe(true)
      expect(caught).toContain('line-19')
      expect(caught).not.toContain('line-00')
    } finally { f.close() }
  })

  test('a view attaching while its pane is hidden is caught up from there, not from before', async () => {
    const f = await setup()
    try {
      f.manager.setPresence({ paneId: f.paneId, state: 'hidden' })
      f.emit('old ')
      vi.advanceTimersByTime(250)
      f.manager.detach({ paneId: f.paneId })
      expect(f.manager.attach({ paneId: f.paneId, sinceSeq: 0 }).replay).toBe('old ')
      f.emit('new')
      vi.advanceTimersByTime(250)
      f.manager.setPresence({ paneId: f.paneId, state: 'visible' })
      expect(f.data).toEqual(['new'])
    } finally { f.close() }
  })

  test('presence sent before the session starts applies when it starts', async () => {
    const f = await setup(undefined, (manager, paneId) => {
      manager.setPresence({ paneId, state: 'focused' })
      manager.setPresence({ paneId, state: 'hidden' })
    })
    try {
      f.emit('h')
      vi.advanceTimersByTime(1000)
      expect(f.data).toEqual([])
      expect(f.activity.length).toBeGreaterThan(0)
      f.manager.setPresence({ paneId: f.paneId, state: 'visible' })
      expect(f.data).toEqual(['h'])
    } finally { f.close() }
  })

  test('presence for a pane that was stopped before starting is forgotten', async () => {
    const f = await setup(undefined, (manager, paneId) => {
      manager.setPresence({ paneId, state: 'hidden' })
      manager.stop({ paneId })
    })
    try {
      f.emit('s')
      vi.advanceTimersByTime(16)
      expect(f.data).toEqual(['s'])
    } finally { f.close() }
  })

  test('takes only a known state for a pane, and nothing else', () => {
    expect(parseTerminalPresenceInput({ paneId: 'p', state: 'hidden' })).toEqual({ paneId: 'p', state: 'hidden' })
    for (const value of [null, [], {}, { paneId: 'p' }, { paneId: '', state: 'focused' }, { paneId: 'p', state: 'minimized' }, { paneId: 'p', state: 'focused', extra: 1 }, { paneId: 'x'.repeat(201), state: 'visible' }]) {
      expect(() => parseTerminalPresenceInput(value), JSON.stringify(value)).toThrow()
    }
  })
})
