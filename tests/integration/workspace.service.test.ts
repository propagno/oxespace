import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService, getPanePositions } from '../../electron/main/services/workspace.service'

describe('WorkspaceService', () => {
  test('creates a workspace with a pane per layout cell', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)

    const workspace = service.create({
      rootPath: 'C:/projects/oxespace',
      layout: '4x4',
      autoStart: false
    })

    expect(workspace.name).toBe('oxespace')
    expect(workspace.rootPath).toBe('C:/projects/oxespace')
    expect(workspace.layout).toBe('4x4')
    expect(workspace.autoStart).toBe(false)
    expect(workspace.isActive).toBe(true)
    expect(workspace.defaultShellProfileId).toBe('builtin-claude')
    expect(workspace.panes).toHaveLength(16)
    expect(workspace.panes.every((pane) => pane.type === 'terminal' && pane.status === 'idle')).toBe(true)

    db.close()
  })

  test('keeps a single active workspace', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)

    const first = service.create({ rootPath: 'C:/projects/first', layout: '1x1' })
    const second = service.create({ rootPath: 'C:/projects/second', layout: '1x2' })
    service.setActive(first.id)

    const workspaces = service.list()

    expect(workspaces.find((workspace) => workspace.id === first.id)?.isActive).toBe(true)
    expect(workspaces.find((workspace) => workspace.id === second.id)?.isActive).toBe(false)

    db.close()
  })

  test('calculates pane positions from fixed layouts', () => {
    expect(getPanePositions('1x1')).toHaveLength(1)
    expect(getPanePositions('1x2')).toHaveLength(2)
    expect(getPanePositions('2x2')).toHaveLength(4)
    expect(getPanePositions('3x4')).toHaveLength(12)
    expect(getPanePositions('4x4')).toHaveLength(16)
  })
})
