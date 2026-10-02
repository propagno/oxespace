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

  test('reassembles output across process chunks and flushes the final line', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: process.cwd(), layoutPreset: 1 })
    const output: string[] = []
    let resolveFinished!: () => void
    const finished = new Promise<void>(resolve => { resolveFinished = resolve })
    const manager = new BackgroundManager(db, {
      emitOutput: event => output.push(event.data),
      emitUpdate: event => { if (event.job.status === 'exited' || event.job.status === 'failed') resolveFinished() }
    })
    const job = manager.start({
      workspaceId: workspace.id,
      workspaceRootPath: process.cwd(),
      command: 'node -e "process.stdout.write(\'hel\'); setTimeout(() => { process.stdout.write(\'lo\' + String.fromCharCode(10)); process.stdout.write(\'tail\') }, 20)"',
      confirmed: true
    })
    await finished
    expect(manager.list(workspace.id).find(item => item.id === job.id)?.status).toBe('exited')
    expect(output).toEqual(['hello', 'tail'])
    expect(manager.getOutput(job.id).lines).toEqual(['hello', 'tail'])
    db.close()
  })
})
