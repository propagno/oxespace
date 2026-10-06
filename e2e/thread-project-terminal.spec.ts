import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Thread owns a real shell that survives panel detach without creating a Code workspace', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-thread-terminal-e2e-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  try {
    const page = await app.firstWindow()
    const ids = await page.evaluate(async root => {
      const project = await window.oxe.thread!.addProject(root)
      const snapshot = await window.oxe.thread!.create({ projectId: project.projectId, provider: 'codex' })
      return { workspaceId: snapshot.thread.workspaceId, paneId: `thread-shell:${snapshot.thread.id}:1` }
    }, root)
    await page.evaluate(async ids => {
      await window.oxe.terminal.start({ ...ids, cols: 100, rows: 24, disableRtk: true })
      await window.oxe.terminal.write({ paneId: ids.paneId, data: 'echo OXE_THREAD_SHELL_READY\r' })
    }, ids)
    await expect.poll(() => page.evaluate(async ids => (await window.oxe.terminal.attach({ paneId: ids.paneId })).replay, ids)).toContain('OXE_THREAD_SHELL_READY')
    const before = await page.evaluate(ids => window.oxe.terminal.status(ids.paneId), ids)
    await page.evaluate(async ids => {
      await window.oxe.terminal.detach({ paneId: ids.paneId })
      await window.oxe.terminal.resize({ paneId: ids.paneId, cols: 70, rows: 16 })
      await window.oxe.terminal.attach({ paneId: ids.paneId })
    }, ids)
    expect(await page.evaluate(ids => window.oxe.terminal.status(ids.paneId), ids)).toMatchObject({ running: true, pid: before.pid })
    expect(await page.evaluate(() => window.oxe.workspace.list())).toEqual([])
    await page.evaluate(ids => window.oxe.terminal.stop({ paneId: ids.paneId }), ids)
    expect(await page.evaluate(ids => window.oxe.terminal.status(ids.paneId), ids)).toMatchObject({ running: false })
  } finally { await app.close() }
})
