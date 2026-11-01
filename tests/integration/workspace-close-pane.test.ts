import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import type { Workspace } from '../../shared/types/workspace'

/**
 * HOMOLOGATION reproduced it on main (e2e/homologation/bug-split-focus.spec.ts): OxeCode on 2x2, split four times to
 * eight panes, close the new one, and workspace:close-pane threw "UNIQUE constraint failed: panes.workspace_id,
 * panes.row_index, panes.column_index"; the pane could not be closed.
 */
const databases: Array<ReturnType<typeof openInMemoryDatabase>> = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup(layoutPreset: 1 | 4 | 16) {
  const db = openInMemoryDatabase(); databases.push(db)
  const service = new WorkspaceService(db)
  const workspace = service.create({ rootPath: process.cwd(), layoutPreset })
  return { db, service, workspace }
}

/** Every grid pane on its own slot; after a close, inside the layout (a split tree places new panes past it). */
function expectTidy(workspace: Workspace, inLayout = true): void {
  const grid = workspace.panes.filter(pane => pane.rowIndex >= 0)
  const slots = grid.map(pane => `${pane.rowIndex},${pane.columnIndex}`)
  expect(new Set(slots).size, slots.join(' ')).toBe(slots.length)
  const [rows, columns] = workspace.layout.split('x').map(Number)
  if (inLayout && grid.length <= 16) for (const pane of grid) expect(pane.rowIndex < rows && pane.columnIndex < columns, `${pane.rowIndex},${pane.columnIndex} in ${workspace.layout}`).toBe(true)
}

describe('closing a pane after a split past the preset', () => {
  test('8 panes on 2x2: the newest closes, then each of the others in turn, down to one', () => {
    const { service, workspace } = setup(4)
    let current = workspace
    for (let i = 0; i < 4; i += 1) current = service.createPane(current.id).workspace
    expect(current.panes).toHaveLength(8)
    // The split tree leaves the preset alone (the window sends it back on every settings save); the panes sit past it.
    expect(current.layout).toBe('2x2')
    expectTidy(current, false)

    const newest = current.panes.at(-1)!
    current = service.closePane(newest.id)!
    expect(current.panes).toHaveLength(7)
    // The reflow on close picks the smallest preset that holds what is left.
    expect(current.layout).toBe('2x4')
    expectTidy(current)

    // Then close from the front, the middle and the back, in turn, until one pane is left.
    for (const pick of [0, 3, -1, 1, 0, -1] as const) {
      const pane = current.panes.at(pick)!
      current = service.closePane(pane.id)!
      expectTidy(current)
    }
    expect(current.panes).toHaveLength(1)
    expect(current.layout).toBe('1x1')
  })

  test('the off-grid helper pane keeps its -1/-1 slot through the reflow', () => {
    const { db, service, workspace } = setup(4)
    db.prepare("INSERT INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status) VALUES ('helper', ?, 'terminal', -1, -1, 'builtin-claude', 'idle')").run(workspace.id)
    let current = workspace
    for (let i = 0; i < 4; i += 1) current = service.createPane(current.id).workspace
    current = service.closePane(current.panes.filter(pane => pane.rowIndex >= 0).at(-1)!.id)!
    expect(current.panes.find(pane => pane.id === 'helper')).toMatchObject({ rowIndex: -1, columnIndex: -1 })
    expectTidy(current)
  })

  test('more panes than the largest preset: closing one keeps every slot unique', () => {
    const { service, workspace } = setup(16)
    let current = workspace
    for (let i = 0; i < 2; i += 1) current = service.createPane(current.id).workspace
    expect(current.panes).toHaveLength(18)
    expect(current.layout).toBe('4x4')
    current = service.closePane(current.panes[5].id)!
    expect(current.panes).toHaveLength(17)
    expectTidy(current)
  })

  test('creating a pane never changes the stored preset', () => {
    const { service, workspace } = setup(4)
    const before = workspace.layout
    const removed = service.closePane(workspace.panes[3].id)!
    expect(removed.panes).toHaveLength(3)
    const after = service.createPane(removed.id).workspace
    expect(after.panes).toHaveLength(4)
    expect(after.layout).toBe(before)
  })
})
