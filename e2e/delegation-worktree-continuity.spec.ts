import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Code and Thread share delegation creation, exact recovery and session details', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-delegation-ui-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    const ws = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
    await app.evaluate(({ ipcMain }, id) => {
      const state = globalThis as Record<string, unknown>
      state.delegationCalls = []
      const task = { id: 'task-fixture', workspaceId: id, originWorkspaceId: id, objective: 'Implement authentication',
        branch: 'feature/CARD-142', path: 'C:/projects/repo-worktrees/CARD-142', baseSha: 'abcdef123456', state: 'interrupted',
        surface: 'thread', agentProfileId: 'codex', destinationThreadId: 'delegated-thread', updatedAt: Date.now(),
        handoff: 'Preserve JWT HttpOnly cookies', nativeSession: { provider: 'codex', nativeSessionId: 'exact-native-session', generation: 1, resumable: true },
        recoveryActions: ['open', 'resume', 'new-session', 'cancel'] }
      for (const name of ['status', 'preview', 'create', 'control']) ipcMain.removeHandler(`delegation:${name}`)
      ipcMain.removeHandler('agent:list')
      ipcMain.handle('agent:list', () => [{ agentProfileId: 'codex', provider: 'codex', name: 'Codex', command: 'codex', isBuiltin: true }])
      ipcMain.handle('delegation:status', () => ({ enabled: true, tasks: [task], nextCursor: null }))
      ipcMain.handle('delegation:preview', (_event, workspaceId, objective, intent) => ({ previewId: 'preview-id', targetWorkspaceId: workspaceId, targetName: 'repo', ready: true,
        checkout: { branch: intent.name, baseRef: 'main', baseSha: 'abcdef123456', path: 'C:/projects/repo-worktrees/new-task', createBranch: true }, effects: [] }))
      ipcMain.handle('delegation:create', (_event, workspaceId, owner, input) => { state.delegationRequest = { workspaceId, owner, input }; return task })
      ipcMain.handle('delegation:control', (_event, workspaceId, taskId, action) => { (state.delegationCalls as unknown[]).push({ workspaceId, taskId, action }) })
      ipcMain.removeHandler('thread:projects')
      ipcMain.removeHandler('thread:list')
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'fixture', displayName: 'repo', identityLabel: 'repo', contexts: [{ workspaceId: id, rootPath: 'C:/projects/repo', label: 'repo' }] }], unavailable: [] }))
      ipcMain.handle('thread:list', () => [1, 2].map(number => ({ id: `00000000-0000-4000-8000-00000000000${number}`, workspaceId: id, projectId: 'fixture', rootPath: 'C:/projects/repo',
        provider: number === 1 ? 'codex' : 'claude', nativeSessionId: null, title: `Source conversation ${number}`, pinned: false, status: 'idle', createdAt: 1, updatedAt: number })))
    }, ws.id)
    await page.getByRole('button', { name: 'Delegated work', exact: true }).click()
    const central = page.getByRole('dialog', { name: 'Delegated work', exact: true })
    await expect(central.getByText('feature/CARD-142', { exact: true })).toBeVisible()
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).delegationCalls)).toEqual([])
    await central.getByText('Session and handoff details').click()
    await expect(central.getByText('exact-native-session', { exact: true })).toBeVisible()
    await central.getByRole('button', { name: 'Resume exact session' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).delegationCalls)).toEqual([{ workspaceId: ws.id, taskId: 'task-fixture', action: 'resume' }])
    for (const width of [850, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await central.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await central.screenshot({ path: test.info().outputPath(`delegated-work-${width}.png`) })
    }
    await central.getByRole('button', { name: 'Delegate work', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Delegate work', exact: true })
    await create.getByLabel('Objective', { exact: true }).fill('Fix callback')
    await create.getByLabel('Handoff', { exact: true }).fill('Preserve session cookies')
    await create.getByLabel('Acceptance criteria', { exact: true }).fill('Authentication tests pass')
    await create.getByLabel('Exact branch').fill('feature/CARD-143')
    await create.getByRole('button', { name: 'Preview checkout' }).click()
    await expect(create.getByText('Ready to delegate')).toBeVisible()
    await create.screenshot({ path: test.info().outputPath('create-delegation.png') })
    await page.setViewportSize({ width: 900, height: 800 })
    const taskHeading = await create.getByRole('heading', { name: 'Task brief' }).boundingBox()
    const checkoutHeading = await create.getByRole('heading', { name: 'Checkout' }).boundingBox()
    expect(taskHeading && checkoutHeading && checkoutHeading.x > taskHeading.x && Math.abs(checkoutHeading.y - taskHeading.y) < 4).toBe(true)
    expect(await create.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await create.screenshot({ path: test.info().outputPath('create-delegation-900.png') })
    await create.locator('.delegation-sources summary').click()
    await expect(create.getByRole('checkbox', { name: /Include relevant AI Memory/ })).toBeVisible()
    await create.getByRole('checkbox', { name: /Source conversation 1/ }).check()
    await create.getByRole('checkbox', { name: /Source conversation 2/ }).check()
    await create.screenshot({ path: test.info().outputPath('create-delegation-sources.png') })
    await create.getByRole('button', { name: 'Create delegation' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).delegationRequest)).toMatchObject({ workspaceId: ws.id, owner: { kind: 'pane' }, input: { agentProfileId: 'codex', objective: 'Fix callback', surface: 'thread', includeMemory: true,
      sourceThreadIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], branchIntent: { strategy: 'create', name: 'feature/CARD-143' } } })
    await page.getByRole('button', { name: 'Close delegated work' }).click()
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await page.getByRole('button', { name: 'Delegated work', exact: true }).click()
    await expect(central.getByText('Implement authentication', { exact: true })).toBeVisible()
  } finally { await app.close() }
})
