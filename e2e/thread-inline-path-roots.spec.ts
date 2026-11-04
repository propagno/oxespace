import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * T70, from the user: the agent wrote gravar-poc-prd.js in the subfolder prd-0311 and named it `gravar-poc-prd.js`
 * in its answer; the click said the file did not exist, because inline paths were looked up in the project root.
 * Here the turn worked in that subfolder (its approval names the folder): the file opens from there, and a name no
 * place has says where it was looked for.
 */
test("an inline path opens from the turn's folder, and a missing one names the places looked in", async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    const folder = join(workspaceRoot, 'prd-0311')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'gravar-poc-prd.js'), 'console.log("written in prd-0311")\n')
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    const now = Date.now()
    await app.evaluate((_context, payload) => { (globalThis as Record<string, (s: unknown) => void>).applyThreadState(payload) }, {
      status: 'idle', title: 'Authentication flow', provider: 'claude', events: [
        { type: 'message', id: 'u-t70', role: 'user', text: 'Write the PoC script in prd-0311.' },
        { type: 'request', id: 'r-t70', request: { id: 'r-t70', nativeId: 'n-t70', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Run node', command: 'node gravar-poc-prd.js', cwd: folder, generation: 1, createdAt: now, state: 'resolved' } },
        { type: 'request-resolved', id: 'r-t70', state: 'resolved', resolution: 'approved', resolvedAt: now },
        { type: 'message', id: 'a-t70', role: 'assistant', text: 'Wrote `gravar-poc-prd.js`. The old `nowhere-t70.js` is gone.' },
        { type: 'completed', status: 'completed' }
      ]
    })

    const timeline = page.locator('.thread-timeline')
    await timeline.getByRole('button', { name: 'gravar-poc-prd.js', exact: true }).click()
    await expect(page.getByRole('tab', { name: /gravar-poc-prd\.js/ })).toBeVisible()
    await expect(page.locator('.cm-content, .monaco-editor').first()).toContainText('written in prd-0311')

    await timeline.getByRole('button', { name: 'nowhere-t70.js', exact: true }).click()
    const notice = page.locator('[data-toast]').filter({ hasText: 'nowhere-t70.js was not found' })
    await expect(notice).toBeVisible()
    const slashes = (path: string) => path.replace(/\\/g, '/')
    await expect(notice).toContainText(`Looked in: ${slashes(folder)}/nowhere-t70.js; ${slashes(workspaceRoot)}/nowhere-t70.js`)
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
