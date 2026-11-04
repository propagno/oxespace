// Frozen acceptance test for 1.5.0 A8 (OXE program, phase F1). Written by the planner; the executor must not edit it.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f1/a8-workspace-color.test.ts
import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { parseUpdateWorkspaceSettingsInput } from '../../../electron/main/ipc/validation'
import { WORKSPACE_COLORS, workspaceColorIndex, workspaceColorAttrs } from '../../../shared/workspace-color'

describe('A8 · workspace color is stored per workspace and has a stable default', () => {
  test('there are exactly eight workspace colors, numbered 1 to 8', () => {
    expect(WORKSPACE_COLORS).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  test('workspaces.color is a nullable INTEGER column added by a migration', () => {
    const db = openInMemoryDatabase()
    try {
      const columns = db.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name: string; type: string; notnull: number }>
      const color = columns.find(column => column.name === 'color')
      expect(color?.type.toUpperCase()).toBe('INTEGER')
      expect(color?.notnull).toBe(0)
      expect(() => db.prepare("UPDATE workspaces SET color = 9 WHERE 0").run()).not.toThrow()
    } finally { db.close() }
  })

  test('a new workspace has no stored color; its shown color is a stable hash of its id', () => {
    const db = openInMemoryDatabase()
    try {
      const service = new WorkspaceService(db)
      const ws = service.create({ rootPath: 'C:/projects/cajui-api', layoutPreset: 1, autoStart: false })
      expect(ws.color).toBeNull()
      const shown = workspaceColorIndex(ws)
      expect(WORKSPACE_COLORS).toContain(shown)
      expect(workspaceColorIndex({ id: ws.id, color: null })).toBe(shown)
      expect(workspaceColorIndex({ id: `${ws.id}-other`, color: null })).toBeGreaterThanOrEqual(1)
    } finally { db.close() }
  })

  test('workspace:update-settings stores a color 1–8, keeps it across reads, and null clears it', () => {
    const db = openInMemoryDatabase()
    try {
      const service = new WorkspaceService(db)
      const ws = service.create({ rootPath: 'C:/projects/cajui-web', layoutPreset: 1, autoStart: false })
      const saved = service.updateSettings(parseUpdateWorkspaceSettingsInput({ workspaceId: ws.id, color: 6 }))
      expect(saved.color).toBe(6)
      expect(service.get(ws.id)?.color).toBe(6)
      expect(workspaceColorIndex(saved)).toBe(6)
      const untouched = service.updateSettings(parseUpdateWorkspaceSettingsInput({ workspaceId: ws.id, themeId: saved.themeId }))
      expect(untouched.color).toBe(6)
      const cleared = service.updateSettings(parseUpdateWorkspaceSettingsInput({ workspaceId: ws.id, color: null }))
      expect(cleared.color).toBeNull()
    } finally { db.close() }
  })

  test('validation refuses anything but an integer 1–8 or null', () => {
    for (const bad of [0, 9, 1.5, '3', true, -1]) {
      expect(() => parseUpdateWorkspaceSettingsInput({ workspaceId: 'w', color: bad })).toThrow()
    }
    expect(parseUpdateWorkspaceSettingsInput({ workspaceId: 'w', color: 8 }).color).toBe(8)
    expect(parseUpdateWorkspaceSettingsInput({ workspaceId: 'w', color: null }).color).toBeNull()
    expect(parseUpdateWorkspaceSettingsInput({ workspaceId: 'w' }).color).toBeUndefined()
  })

  test('the renderer marks a workspace surface with data-ws, the only hook the CSS reads', () => {
    expect(workspaceColorAttrs({ id: 'a', color: 3 })).toEqual({ 'data-ws': '3' })
    const auto = workspaceColorAttrs({ id: 'a', color: null })
    expect(Number(auto['data-ws'])).toBe(workspaceColorIndex({ id: 'a', color: null }))
  })
})
