import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { gridShape } from '../../../shared/types/pane-tree'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { WorkspaceSplitGrid } from '../../../src/components/Grid/WorkspaceSplitGrid'
import { usePaneLayoutStore } from '../../../src/store/pane-layout.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const mountCounts = new Map<string, number>()
const unmountCounts = new Map<string, number>()

vi.mock('../../../src/components/Grid/PaneContainer', () => ({
  PaneContainer: ({ pane }: { pane: WorkspacePane }) => {
    useEffect(() => {
      mountCounts.set(pane.id, (mountCounts.get(pane.id) ?? 0) + 1)
      return () => {
        unmountCounts.set(pane.id, (unmountCounts.get(pane.id) ?? 0) + 1)
      }
    }, [pane.id])
    return <div data-testid={`pane-${pane.id}`}>{pane.id}</div>
  }
}))

const databases: Array<ReturnType<typeof openInMemoryDatabase>> = []

afterEach(() => {
  cleanup()
  mountCounts.clear()
  unmountCounts.clear()
  for (const db of databases.splice(0)) db.close()
  usePaneLayoutStore.setState({ trees: {} })
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, error: null })
})

function setupService(running: Set<string>) {
  const db = openInMemoryDatabase()
  databases.push(db)
  const service = new WorkspaceService(db, {
    isPaneRunning: (paneId) => running.has(paneId)
  })
  return { db, service }
}

describe('OXE-406 · grid layout switch preserves running agent sessions', () => {
  test('switching from 1x3 to 2x2 relocates the running third pane instead of dropping or rejecting it', () => {
    const running = new Set<string>()
    const { service } = setupService(running)
    const ws = service.create({ rootPath: 'C:/projects/oxe-406', layoutPreset: 1, autoStart: false })
    const p0 = ws.panes[0]!.id
    const { paneId: p1 } = service.createPane(ws.id)
    const { paneId: p2 } = service.createPane(ws.id)
    service.setPaneAgent(p2, 'agent-claude', 'Claude')
    running.add(p0)
    running.add(p2)

    const updated = service.updateSettings({ workspaceId: ws.id, layoutPreset: 4 })

    expect(updated.layout).toBe('2x2')
    expect(updated.layoutPreset).toBe(4)
    expect(updated.panes).toHaveLength(4)
    expect(updated.panes.map((p) => p.id)).toEqual(expect.arrayContaining([p0, p1, p2]))
    const relocated = updated.panes.find((p) => p.id === p2)!
    expect(relocated.rowIndex).toBe(1)
    expect(relocated.columnIndex).toBe(0)
    expect(relocated.agentProfileId).toBe('agent-claude')
    expect(relocated.agentName).toBe('Claude')
    expect(relocated.status).toBe('running')
  })

  test('switching from 1x4 to 2x2 keeps all four running panes without recreating any pane', () => {
    const running = new Set<string>()
    const { service } = setupService(running)
    const ws = service.create({ rootPath: 'C:/projects/oxe-406-4', layoutPreset: 1, autoStart: false })
    const p0 = ws.panes[0]!.id
    const { paneId: p1 } = service.createPane(ws.id)
    const { paneId: p2 } = service.createPane(ws.id)
    const { paneId: p3 } = service.createPane(ws.id)
    for (const id of [p0, p1, p2, p3]) running.add(id)

    const updated = service.updateSettings({ workspaceId: ws.id, layoutPreset: 4 })

    expect(updated.panes.map((p) => p.id).sort()).toEqual([p0, p1, p2, p3].sort())
    expect(updated.panes.every((p) => p.status === 'running')).toBe(true)
  })

  test('shrinking from 1x3 to 1x2 refuses when the third pane has a running session and leaves it intact', () => {
    const running = new Set<string>()
    const { service } = setupService(running)
    const ws = service.create({ rootPath: 'C:/projects/oxe-406-shrink', layoutPreset: 1, autoStart: false })
    const { paneId: p1 } = service.createPane(ws.id)
    const { paneId: p2 } = service.createPane(ws.id)
    running.add(p2)

    expect(() => service.updateSettings({ workspaceId: ws.id, layoutPreset: 2 })).toThrow(/running/)

    const after = service.get(ws.id)!
    expect(after.panes.map((p) => p.id)).toEqual(expect.arrayContaining([ws.panes[0]!.id, p1, p2]))
  })

  test('relocates a running out-of-bounds pane into a free target slot ahead of an idle out-of-bounds pane', () => {
    const running = new Set<string>()
    const { db, service } = setupService(running)
    const ws = service.create({ rootPath: 'C:/projects/oxe-406-prio', layoutPreset: 4, autoStart: false })
    // Remove (0,1) directly so (0,1) is free in 1x2 while (1,0) is idle and (1,1) is running.
    const slot01 = ws.panes.find((p) => p.rowIndex === 0 && p.columnIndex === 1)!
    const slot10 = ws.panes.find((p) => p.rowIndex === 1 && p.columnIndex === 0)!
    const slot11 = ws.panes.find((p) => p.rowIndex === 1 && p.columnIndex === 1)!
    db.prepare('DELETE FROM panes WHERE id = ?').run(slot01.id)
    running.add(slot11.id)

    const updated = service.updateSettings({ workspaceId: ws.id, layoutPreset: 2 })

    expect(updated.layout).toBe('1x2')
    expect(updated.panes).toHaveLength(2)
    expect(updated.panes.map((p) => p.id)).toContain(slot11.id)
    expect(updated.panes.map((p) => p.id)).not.toContain(slot10.id)
    expect(updated.panes.find((p) => p.id === slot11.id)?.status).toBe('running')
  })

  test('WorkspaceSplitGrid reshapes from 1x3 to 2x2 without unmounting running panes', async () => {
    const running = new Set<string>()
    const { service } = setupService(running)
    const created = service.create({ rootPath: 'C:/projects/oxe-406-ui', layoutPreset: 1, autoStart: false })
    const p0 = created.panes[0]!.id
    const { paneId: p1 } = service.createPane(created.id)
    const { workspace: initialWs, paneId: p2 } = service.createPane(created.id)
    running.add(p0)
    running.add(p2)

    const previousApi = window.oxe
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        workspace: {
          updateSettings: vi.fn(async (input) => service.updateSettings(input))
        }
      }
    })

    try {
      useWorkspaceStore.setState({ workspaces: [initialWs], activeWorkspaceId: initialWs.id, error: null })
      usePaneLayoutStore.getState().resetFromPanes(initialWs.id, initialWs.panes)
      expect(gridShape(usePaneLayoutStore.getState().trees[initialWs.id] ?? null)).toEqual({ rows: 1, columns: 3 })

      const GridHost = ({ workspace }: { workspace: Workspace }) => {
        const tree = usePaneLayoutStore((s) => s.trees[workspace.id] ?? null)
        return (
          <WorkspaceSplitGrid
            workspace={workspace}
            tree={tree}
            maximizedPaneId={null}
            activePaneId={p2}
            onToggleMaximize={vi.fn()}
            onResize={vi.fn()}
            onMovePane={vi.fn()}
          />
        )
      }

      const { rerender } = render(<GridHost workspace={initialWs} />)
      expect(mountCounts.get(p0)).toBe(1)
      expect(mountCounts.get(p1)).toBe(1)
      expect(mountCounts.get(p2)).toBe(1)

      await act(async () => {
        await useWorkspaceStore.getState().updateSettings({ workspaceId: initialWs.id, layoutPreset: 4 })
      })

      const nextWs = useWorkspaceStore.getState().workspaces[0]!
      rerender(<GridHost workspace={nextWs} />)

      expect(gridShape(usePaneLayoutStore.getState().trees[initialWs.id] ?? null)).toEqual({ rows: 2, columns: 2 })
      expect(mountCounts.get(p0)).toBe(1)
      expect(mountCounts.get(p1)).toBe(1)
      expect(mountCounts.get(p2)).toBe(1)
      expect(unmountCounts.get(p0) ?? 0).toBe(0)
      expect(unmountCounts.get(p1) ?? 0).toBe(0)
      expect(unmountCounts.get(p2) ?? 0).toBe(0)
    } finally {
      Object.defineProperty(window, 'oxe', { configurable: true, value: previousApi })
    }
  })
})
