// 1.5.0 A8 · workspace color: migration, validation and service round trip (task T4).
// Payloads copied from the planner's fixture FX-01; the product never reads .oxe/.
import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { parseUpdateWorkspaceSettingsInput } from '../../electron/main/ipc/validation'
import { WORKSPACE_COLORS, workspaceColorAttrs, workspaceColorIndex } from '../../shared/workspace-color'

const VALID = [{ workspaceId: 'w', color: 1 }, { workspaceId: 'w', color: 8 }, { workspaceId: 'w', color: null }, { workspaceId: 'w' }]
const INVALID = [0, 9, 1.5, '3', true, -1, Number.NaN, Infinity, [], {}].map(color => ({ workspaceId: 'w', color }))

describe('workspace color', () => {
  test('valid payloads parse and invalid ones throw', () => {
    for (const payload of VALID) expect(() => parseUpdateWorkspaceSettingsInput(payload)).not.toThrow()
    for (const payload of INVALID) expect(() => parseUpdateWorkspaceSettingsInput(payload)).toThrow(/color/)
  })

  test('the column CHECK refuses values outside 1–8 even past validation', () => {
    const db = openInMemoryDatabase()
    try {
      const ws = new WorkspaceService(db).create({ rootPath: 'C:/projects/check', layoutPreset: 1, autoStart: false })
      expect(() => db.prepare('UPDATE workspaces SET color = 9 WHERE id = ?').run(ws.id)).toThrow(/CHECK/)
      expect(() => db.prepare('UPDATE workspaces SET color = 0 WHERE id = ?').run(ws.id)).toThrow(/CHECK/)
      expect(() => db.prepare('UPDATE workspaces SET color = 4 WHERE id = ?').run(ws.id)).not.toThrow()
      expect(() => db.prepare('UPDATE workspaces SET color = NULL WHERE id = ?').run(ws.id)).not.toThrow()
    } finally { db.close() }
  })

  test('a refused payload leaves the stored color untouched', () => {
    const db = openInMemoryDatabase()
    try {
      const service = new WorkspaceService(db)
      const ws = service.create({ rootPath: 'C:/projects/keep', layoutPreset: 1, autoStart: false })
      service.updateSettings(parseUpdateWorkspaceSettingsInput({ workspaceId: ws.id, color: 2 }))
      expect(() => service.updateSettings(parseUpdateWorkspaceSettingsInput({ workspaceId: ws.id, color: 9 }))).toThrow()
      expect(service.get(ws.id)?.color).toBe(2)
      expect(service.list().find(item => item.id === ws.id)?.color).toBe(2)
    } finally { db.close() }
  })

  test('the migration sets user_version 93 and backfills nothing', () => {
    const db = openInMemoryDatabase()
    try {
      expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(93)
      const service = new WorkspaceService(db)
      service.create({ rootPath: 'C:/projects/a', layoutPreset: 1, autoStart: false })
      service.create({ rootPath: 'C:/projects/b', layoutPreset: 1, autoStart: false })
      expect(service.list().every(ws => ws.color === null)).toBe(true)
    } finally { db.close() }
  })

  test('the derived color is stable, in range and spreads across slots', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const ws = { id: `workspace-${i}`, color: null }
      const index = workspaceColorIndex(ws)
      expect(WORKSPACE_COLORS).toContain(index)
      expect(workspaceColorIndex({ ...ws })).toBe(index)
      expect(workspaceColorAttrs(ws)).toEqual({ 'data-ws': String(index) })
      seen.add(index)
    }
    expect(seen.size).toBe(8)
  })
})
