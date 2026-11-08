// Frozen acceptance test for the 1.5.0 F2 gap G1, backend side (OXE program, phase F2, second batch): a workspace whose
// stored panes name a removed panel still loads; those panes are dropped and nothing throws. Written by the planner;
// the executor must not edit it. In-memory database only. The saved renderer layouts (localStorage) are FE-G1.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/g1-removed-pane-types-load.native.test.ts
import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'

const PANE_TYPES = ['terminal', 'tasks', 'editor', 'review']

describe('G1 (backend) · stored panes that name a removed panel', () => {
  test('G1: the workspace loads with only the known pane types; list() and get() never throw', () => {
    const db = openInMemoryDatabase()
    try {
      const shell = db.prepare('SELECT id FROM shell_profiles LIMIT 1').get() as { id: string }
      db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('w1', 'Mine', 'C:/work', 'grid', ?)").run(shell.id)
      const pane = db.prepare('INSERT INTO panes (id, workspace_id, type, row_index, column_index) VALUES (?, ?, ?, ?, ?)')
      const kinds = ['terminal', 'linear', 'semantic', 'oxepost', 'team', 'skills', 'editor']
      kinds.forEach((kind, index) => pane.run(`p-${kind}`, 'w1', kind, Math.floor(index / 3), index % 3))
      const service = new WorkspaceService(db)
      expect(() => service.list()).not.toThrow()
      const workspace = service.get('w1')
      expect(workspace).not.toBeNull()
      expect(workspace!.panes.map(item => item.id).sort()).toEqual(['p-editor', 'p-terminal'])
      expect(workspace!.panes.every(item => PANE_TYPES.includes(item.type))).toBe(true)
      expect(service.list().find(item => item.id === 'w1')?.panes.map(item => item.type).sort()).toEqual(['editor', 'terminal'])
    } finally { db.close() }
  })
})
