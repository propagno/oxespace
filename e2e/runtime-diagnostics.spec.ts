import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('compact diagnostics retain process metadata and aggregate GPU failures across restart', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-runtime-diagnostics-e2e-'))
  const report = join(root, 'diagnostics.md')
  const launch = () => electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3') } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor()
    await page.evaluate(async root => {
      const project = await window.oxe.thread!.addProject(root)
      const snapshot = await window.oxe.thread!.create({ projectId: project.projectId, provider: 'codex' })
      const paneId = `thread-shell:${snapshot.thread.id}:1`
      await window.oxe.terminal.start({ workspaceId: snapshot.thread.workspaceId, paneId, cols: 80, rows: 24, disableRtk: true })
      await window.oxe.terminal.stop({ paneId })
    }, root)
    await app.evaluate(({ app }) => {
      for (let i = 0; i < 1000; i++) app.emit('child-process-gone', {}, { type: 'GPU', reason: 'launch-failed', exitCode: 1002, serviceName: 'private-provider-content' })
    })
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor()
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, report)
    expect(await page.evaluate(() => window.oxe.diagnostics.exportReport())).toBe(report)
    const text = readFileSync(report, 'utf8')
    expect(text).toContain('"event":"process-start"')
    expect(text).toContain('"event":"process-stop"')
    expect(text).toContain('"event":"app-stop"')
    expect(text).toContain('"kind":"GPU"')
    expect(text).toContain('"repeats":999')
    expect(text).not.toContain('private-provider-content')
    expect(text).not.toContain(root)
    expect(Buffer.byteLength(text)).toBeLessThan(20 * 1024)
  } finally { await app.close() }
})
