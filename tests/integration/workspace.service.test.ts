import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService, getPanePositions } from '../../electron/main/services/workspace.service'

describe('WorkspaceService', () => {
  test('creates a workspace with a pane per layout cell', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)

    const workspace = service.create({
      rootPath: 'C:/projects/oxespace',
      layoutPreset: 16,
      autoStart: false
    })

    expect(workspace.name).toBe('oxespace')
    expect(workspace.rootPath).toBe('C:/projects/oxespace')
    expect(workspace.layout).toBe('4x4')
    expect(workspace.layoutPreset).toBe(16)
    expect(workspace.themeId).toBe('dracula')
    expect(workspace.uiDensity).toBe('compact')
    expect(workspace.backgroundPanelVisible).toBe(false)
    expect(workspace.backgroundPanelWidthPercent).toBe(36)
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

  test('split panes start as neutral PowerShell terminals', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)
    const workspace = service.create({ rootPath: 'C:/projects/repo', layoutPreset: 1 })

    const updated = service.splitPane(workspace.panes[0].id, 'vertical')
    const splitPane = updated.panes.find((pane) => pane.id !== workspace.panes[0].id)

    expect(updated.layout).toBe('1x2')
    expect(splitPane).toEqual(
      expect.objectContaining({
        type: 'terminal',
        shellProfileId: 'builtin-powershell',
        agentProfileId: null,
        agentName: null,
        displayName: null,
        status: 'idle'
      })
    )

    db.close()
  })

  test('calculates pane positions from fixed layouts', () => {
    expect(getPanePositions('1x1')).toHaveLength(1)
    expect(getPanePositions('1x2')).toHaveLength(2)
    expect(getPanePositions('2x2')).toHaveLength(4)
    expect(getPanePositions('2x3')).toHaveLength(6)
    expect(getPanePositions('2x5')).toHaveLength(10)
    expect(getPanePositions('2x7')).toHaveLength(14)
    expect(getPanePositions('3x4')).toHaveLength(12)
    expect(getPanePositions('4x4')).toHaveLength(16)
  })

  test('updates workspace settings and resizes panes by preset', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)
    const workspace = service.create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })

    const updated = service.updateSettings({
      workspaceId: workspace.id,
      themeId: 'nord',
      uiDensity: 'comfortable',
      layoutPreset: 6,
      defaultShellProfileId: 'builtin-copilot',
      applyShellToIdlePanes: true
    })

    expect(updated.themeId).toBe('nord')
    expect(updated.uiDensity).toBe('comfortable')
    expect(updated.layout).toBe('2x3')
    expect(updated.layoutPreset).toBe(6)
    expect(updated.defaultShellProfileId).toBe('builtin-copilot')
    expect(updated.panes).toHaveLength(6)
    expect(updated.panes.every((pane) => pane.shellProfileId === 'builtin-copilot')).toBe(true)

    db.close()
  })

  test('persists Background panel layout state per workspace', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)
    const workspace = service.create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })

    const updated = service.updateBackgroundState({
      workspaceId: workspace.id,
      backgroundPanelVisible: true,
      backgroundPanelExpanded: true,
      backgroundPanelWidthPercent: 70
    })

    expect(updated.backgroundPanelVisible).toBe(true)
    expect(updated.backgroundPanelExpanded).toBe(true)
    expect(updated.backgroundPanelWidthPercent).toBe(70)

    db.close()
  })

  test('persists Review panel layout state per workspace', () => {
    const db = openInMemoryDatabase()
    const service = new WorkspaceService(db)
    const workspace = service.create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })

    const updated = service.updateReviewState({
      workspaceId: workspace.id,
      reviewPanelVisible: true,
      reviewPanelExpanded: true,
      reviewPanelWidthPercent: 60
    })

    expect(updated.reviewPanelVisible).toBe(true)
    expect(updated.reviewPanelExpanded).toBe(true)
    expect(updated.reviewPanelWidthPercent).toBe(60)

    db.close()
  })
})
