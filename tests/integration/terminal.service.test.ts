import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { __resetExecutableCacheForTests, TerminalManager, resolveExecutable } from '../../electron/main/services/terminal.service'

describe('TerminalManager', () => {
  test('spawns isolated ptys with workspace cwd and shell profile', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x2', autoStart: false })
    const pty = createFakePtyModule()
    const emitData = vi.fn()
    const manager = new TerminalManager(db, { pty, emitData, platform: 'linux' })

    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })
    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[1].id })

    expect(pty.spawn).toHaveBeenCalledTimes(2)
    expect(pty.spawn).toHaveBeenNthCalledWith(
      1,
      'claude',
      [],
      expect.objectContaining({ cwd: 'C:/repo', cols: 80, rows: 24 })
    )

    pty.instances[0].emitData('A')
    pty.instances[1].emitData('B')

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(emitData).toHaveBeenCalledWith({ paneId: workspace.panes[0].id, data: 'A' })
    expect(emitData).toHaveBeenCalledWith({ paneId: workspace.panes[1].id, data: 'B' })

    manager.write({ paneId: workspace.panes[0].id, data: 'echo A\r' })
    manager.resize({ paneId: workspace.panes[0].id, cols: 120, rows: 32 })
    manager.stop({ paneId: workspace.panes[0].id })

    expect(pty.instances[0].write).toHaveBeenCalledWith('echo A\r')
    expect(pty.instances[0].resize).toHaveBeenCalledWith(120, 32)
    expect(pty.instances[0].kill).toHaveBeenCalled()
    expect(manager.hasSession(workspace.panes[0].id)).toBe(false)

    db.close()
  })

  test('resolves Windows command shims through PATHEXT', () => {
    __resetExecutableCacheForTests()
    const binDir = mkdtempSync(join(tmpdir(), 'oxespace-path-'))
    const shim = join(binDir, 'copilot.cmd')
    writeFileSync(shim, '@echo off')

    try {
      expect(resolveExecutable('copilot', { PATH: binDir, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(shim)
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  test('reports shell profile failures without creating a session', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({
      rootPath: 'C:/repo',
      layout: '1x1',
      defaultShellProfileId: 'builtin-copilot',
      autoStart: false
    })
    const pty = {
      spawn: vi.fn(() => {
        throw new Error('ENOENT')
      })
    }
    const manager = new TerminalManager(db, { pty, platform: 'linux' })

    // builtin-copilot wraps the platform shell (powershell.exe / /bin/bash), and
    // the error quotes whichever executable the profile actually holds.
    const wrappedShell = process.platform === 'win32' ? 'powershell\\.exe' : '/bin/bash'
    await expect(manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })).rejects.toThrow(
      new RegExp(`Check Settings > Shell profiles executable "${wrappedShell}"`)
    )
    expect(manager.hasSession(workspace.panes[0].id)).toBe(false)

    db.close()
  })
})

/**
 * Detaching a view must not kill the shell — that is what made returning to a
 * workspace cost a full respawn. These cover the handoff itself: no output may
 * be lost while detached, and none may be duplicated or skipped on re-attach.
 */
describe('TerminalManager attach/detach', () => {
  const setup = async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const emitData = vi.fn()
    const emitActivity = vi.fn()
    const manager = new TerminalManager(db, { pty, emitData, emitActivity, platform: 'linux' })
    const paneId = workspace.panes[0].id
    await manager.start({ workspaceId: workspace.id, paneId })
    return { db, manager, pty, emitData, emitActivity, paneId }
  }

  /** The batcher coalesces for 16ms before emitting. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

  test('keeps the process alive and buffers output while detached', async () => {
    const { db, manager, pty, emitData, emitActivity, paneId } = await setup()

    manager.detach({ paneId })
    pty.instances[0].emitData('while away')
    await settle()

    // The shell must survive a view unmounting.
    expect(pty.instances[0].kill).not.toHaveBeenCalled()
    expect(manager.hasSession(paneId)).toBe(true)
    // No payload crosses the IPC boundary for a pane nobody is rendering…
    expect(emitData).not.toHaveBeenCalled()
    // …but the UI still learns the agent is working.
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({ paneId, bytes: 10 }))
    expect(manager.status(paneId)).toMatchObject({ running: true })

    db.close()
  })

  test('replays what was missed without dropping or duplicating a byte', async () => {
    const { db, manager, pty, emitData, paneId } = await setup()

    pty.instances[0].emitData('A')
    await settle()
    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'A' })
    emitData.mockClear()

    manager.detach({ paneId })
    pty.instances[0].emitData('B')
    await settle()

    const attached = manager.attach({ paneId })
    // Everything produced so far comes back at once…
    expect(attached.running).toBe(true)
    expect(attached.replay).toBe('AB')
    expect(attached.truncated).toBe(false)
    // …and nothing was streamed while detached.
    expect(emitData).not.toHaveBeenCalled()

    pty.instances[0].emitData('C')
    await settle()
    // Only the new byte streams — 'B' is not delivered a second time.
    expect(emitData).toHaveBeenCalledTimes(1)
    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'C' })

    db.close()
  })

  test('a fresh view that attaches to a live session gets the whole buffer', async () => {
    const { db, manager, pty, paneId } = await setup()

    pty.instances[0].emitData('history')
    await settle()
    manager.detach({ paneId })

    // No cursor: this is a newly constructed xterm, so it needs everything.
    expect(manager.attach({ paneId }).replay).toBe('history')

    db.close()
  })

  test('skips the replay and forces a redraw for a full-screen TUI', async () => {
    const { db, manager, pty, paneId } = await setup()

    manager.resize({ paneId, cols: 100, rows: 30 })
    pty.instances[0].emitData('\x1b[?1049hTUI FRAME')
    await settle()
    manager.detach({ paneId })
    pty.instances[0].resize.mockClear()

    const attached = manager.attach({ paneId })

    // Replaying alt-screen bytes would paint TUI content onto the normal
    // buffer; the app is asked to repaint instead.
    expect(attached.altScreen).toBe(true)
    expect(attached.replay).toBe('')
    expect(attached.prologue).toContain('\x1b[?1049h')
    expect(pty.instances[0].resize).toHaveBeenCalledWith(100, 29)

    db.close()
  })

  test('surfaces a crash that happened while detached instead of respawning silently', async () => {
    const { db, manager, pty, paneId } = await setup()

    manager.detach({ paneId })
    pty.instances[0].emitData('stack trace')
    await settle()
    pty.instances[0].emitExit(1)

    const attached = manager.attach({ paneId })
    expect(attached.running).toBe(false)
    expect(attached.exit).toMatchObject({ exitCode: 1 })
    // The output that explains the death must still be readable.
    expect(attached.replay).toContain('stack trace')

    db.close()
  })

  test('an explicit stop leaves nothing to explain on the next attach', async () => {
    const { db, manager, pty, paneId } = await setup()

    pty.instances[0].emitData('output')
    await settle()
    manager.stop({ paneId })

    const attached = manager.attach({ paneId })
    expect(attached).toMatchObject({ running: false, replay: '' })
    expect(attached.exit).toBeUndefined()

    db.close()
  })

  test('flushes pending output before disposing so last words survive', async () => {
    const { db, manager, pty, emitData, paneId } = await setup()

    // Inside the batcher's 16ms window — previously discarded by dispose().
    pty.instances[0].emitData('fatal: boom')
    manager.stop({ paneId })

    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'fatal: boom' })

    db.close()
  })

  test('counts detached sessions for the status bar', async () => {
    const { db, manager, paneId } = await setup()

    expect(manager.countDetached()).toBe(0)
    manager.detach({ paneId })
    expect(manager.countDetached()).toBe(1)
    manager.attach({ paneId })
    expect(manager.countDetached()).toBe(0)

    db.close()
  })

  test('spawns at the geometry the view reported', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux' })

    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, cols: 132, rows: 43 })

    // Starting at 80x24 and resizing afterwards makes the app reflow once,
    // which the user sees as a flash.
    expect(pty.spawn).toHaveBeenCalledWith('claude', [], expect.objectContaining({ cols: 132, rows: 43 }))

    db.close()
  })
})

function createFakePtyModule() {
  const instances: Array<ReturnType<typeof createFakePty>> = []
  return {
    instances,
    spawn: vi.fn((_file: string, _args: string[], _options: unknown) => {
      const instance = createFakePty()
      instances.push(instance)
      return instance
    })
  }
}

function createFakePty() {
  let dataHandler: ((data: string) => void) | null = null
  let exitHandler: ((event: { exitCode: number }) => void) | null = null

  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      exitHandler = handler
      return { dispose: vi.fn() }
    }),
    emitData: (data: string) => dataHandler?.(data),
    emitExit: (exitCode: number) => exitHandler?.({ exitCode })
  }
}
