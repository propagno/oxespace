import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { ShellProfileService } from '../../electron/main/services/shell-profile.service'

describe('ShellProfileService', () => {
  test('lists built-in shell profiles with parsed args', () => {
    const db = openInMemoryDatabase()
    const service = new ShellProfileService(db)

    const profiles = service.list()

    expect(profiles).toEqual(
      [
        expect.objectContaining({ id: 'builtin-claude', name: 'claude', executable: 'claude', args: [] }),
        expect.objectContaining({ id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [] })
      ]
    )

    db.close()
  })
})
