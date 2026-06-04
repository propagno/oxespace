import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { TerminalManager, resolveExecutable } from '../../electron/main/services/terminal.service'

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

    await expect(manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })).rejects.toThrow(
      /Check Settings > Shell profiles executable "powershell\.exe"/
    )
    expect(manager.hasSession(workspace.panes[0].id)).toBe(false)

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
