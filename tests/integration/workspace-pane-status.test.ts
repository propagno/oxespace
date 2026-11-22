// Frozen acceptance test for 1.5.2 Multiprovedor (Jira OXE-316, A3–A4). Written by the planner; the executor must not
// edit it. panes.status in SQLite never learned that a PTY runs (TerminalService keeps that in memory), so the layout
// guard read 'idle' with a terminal running. Contract: the live terminal is the one source of truth.
// - WorkspaceService takes `{ isPaneRunning(paneId) }` as its second constructor argument (registerWorkspaceIpc passes
//   TerminalService.hasSession). A pane reads 'running' while that probe says so, whatever the row holds, and the
//   layout guard (updateSettings) uses the same answer.
// - `resetStalePaneStatus()` turns every row left as anything but 'idle'/'exited' (a crash, a kill) back to 'idle' and
//   returns how many it changed; it runs once when the IPC registers, at startup.
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

const databases: Array<ReturnType<typeof openInMemoryDatabase>> = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup(running: Set<string>) {
  const db = openInMemoryDatabase(); databases.push(db)
  const service = new (WorkspaceService as unknown as new (db: unknown, options: { isPaneRunning: (paneId: string) => boolean }) => WorkspaceService)(db, { isPaneRunning: paneId => running.has(paneId) })
  const workspace = service.create({ rootPath: process.cwd(), layoutPreset: 4 })
  return { db, service, workspace }
}

describe('OXE-316 · pane status follows the live terminal', () => {
  test('pane running status reflects live PTY sessions consistently in lockedPane and persistence', () => {
    const running = new Set<string>()
    const { service, workspace } = setup(running)
    const removed = workspace.panes.find(pane => pane.rowIndex !== 0 || pane.columnIndex !== 0)!
    running.add(removed.id)

    expect(service.get(workspace.id)!.panes.find(pane => pane.id === removed.id)!.status).toBe('running')
    expect(() => service.updateSettings({ workspaceId: workspace.id, layoutPreset: 1 })).toThrow(/running/)

    running.delete(removed.id)
    expect(service.get(workspace.id)!.panes.find(pane => pane.id === removed.id)!.status).not.toBe('running')
    expect(service.updateSettings({ workspaceId: workspace.id, layoutPreset: 1 }).layoutPreset).toBe(1)
  })

  test('pane status resets stale running entries cleanly on startup', () => {
    const { db, service, workspace } = setup(new Set())
    const [first, second] = workspace.panes
    db.prepare("UPDATE panes SET status = 'running' WHERE id = ?").run(first.id)
    db.prepare("UPDATE panes SET status = 'starting' WHERE id = ?").run(second.id)

    expect((service as unknown as { resetStalePaneStatus(): number }).resetStalePaneStatus()).toBe(2)
    const rows = db.prepare('SELECT status FROM panes WHERE workspace_id = ?').all(workspace.id) as Array<{ status: string }>
    expect(rows.every(row => row.status === 'idle' || row.status === 'exited')).toBe(true)
    expect((service as unknown as { resetStalePaneStatus(): number }).resetStalePaneStatus()).toBe(0)
  })
})
