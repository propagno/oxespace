import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { TerminalManager } from '../../electron/main/services/terminal.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { WorkspaceGrid } from '../../src/components/Grid/WorkspaceGrid'

vi.mock('../../src/components/Panes/PaneContent', () => ({
  PaneContent: () => <div data-testid="pane-content" />
}))

describe('cleanup flows', () => {
  test('stops all terminal sessions for a closed workspace', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const first = workspaceService.create({ rootPath: 'C:/repo-a', layout: '1x2' })
    const second = workspaceService.create({ rootPath: 'C:/repo-b', layout: '1x1' })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty })

    await manager.start({ workspaceId: first.id, paneId: first.panes[0].id })
    await manager.start({ workspaceId: first.id, paneId: first.panes[1].id })
    await manager.start({ workspaceId: second.id, paneId: second.panes[0].id })
    manager.stopWorkspace(first.id)

    expect(pty.instances[0].kill).toHaveBeenCalled()
    expect(pty.instances[1].kill).toHaveBeenCalled()
    expect(pty.instances[2].kill).not.toHaveBeenCalled()
    expect(manager.hasSession(first.panes[0].id)).toBe(false)
    expect(manager.hasSession(second.panes[0].id)).toBe(true)

    manager.stopAll()
    expect(pty.instances[2].kill).toHaveBeenCalled()
    db.close()
  })

  test('removes a closed pane from persistence and calls the grid close handler', async () => {
    const user = userEvent.setup()
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x2' })
    const onClosePane = vi.fn()

    workspaceService.closePane(workspace.panes[0].id)
    expect(workspaceService.get(workspace.id)?.panes).toHaveLength(1)

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onClosePane={onClosePane} onToggleMaximize={() => undefined} />)
    await user.click(screen.getAllByLabelText('Close pane')[0])

    expect(onClosePane).toHaveBeenCalledWith(workspace.panes[0].id)
    db.close()
  })
})

function createFakePtyModule() {
  const instances: Array<ReturnType<typeof createFakePty>> = []
  return {
    instances,
    spawn: vi.fn(() => {
      const instance = createFakePty()
      instances.push(instance)
      return instance
    })
  }
}

function createFakePty() {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
}
