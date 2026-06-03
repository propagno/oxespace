import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { BackgroundManager } from '../../electron/main/services/background.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

describe('BackgroundManager gates', () => {
  test('requires explicit confirmation before starting a command', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layoutPreset: 1 })
    const manager = new BackgroundManager(db)

    expect(() => manager.start({
      workspaceId: workspace.id,
      workspaceRootPath: 'C:/repo',
      command: 'npm test'
    })).toThrow('explicit user confirmation')

    db.close()
  })
})
