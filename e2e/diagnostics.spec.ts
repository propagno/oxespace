import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers/launch'

/**
 * Help › Diagnostics (F11) against the B8.3 E2E mock (electron/main/e2e/diagnostics-mock.ts): health cards measured
 * while the page is open, the problem journal filtered by area, export with a preview first, and "Ask for analysis"
 * landing in a new conversation with the summary in its draft, unsent.
 */

async function openHelpDiagnostics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Application menu' }).click()
  const help = page.locator('[role="menu"]').first().getByRole('menuitem', { name: 'Help', exact: true })
  await help.hover()
  await help.press('ArrowRight').catch(() => undefined)
  const sub: Locator = page.locator(`[role="menu"][aria-labelledby="${await help.getAttribute('id')}"]`)
  await expect(sub).toBeVisible()
  await sub.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click()
}

test('Help › Diagnostics: cards, journal, export with preview, ask for analysis', async () => {
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    // One Thread project, so the new conversation dialog can create a conversation in it.
    await app.evaluate(({ ipcMain }, rootPath) => {
      const thread = { id: 'diagnostics-thread', workspaceId: 'thread:diag', projectId: 'diag', rootPath, provider: 'claude', nativeSessionId: null, title: 'New thread', status: 'idle', pinned: false, createdAt: Date.now(), updatedAt: Date.now() }
      const snapshot = { thread, events: [], turns: [] }
      const sent: unknown[] = []
      ;(globalThis as { diagnosticsSent?: unknown[] }).diagnosticsSent = sent
      for (const channel of ['list', 'read', 'create', 'send', 'commands', 'projects', 'models']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'diag', displayName: 'diag-repo', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:diag', rootPath, label: 'diag-repo' }] }], unavailable: [] }))
      ipcMain.handle('thread:list', () => [])
      ipcMain.handle('thread:create', () => snapshot)
      ipcMain.handle('thread:read', () => snapshot)
      ipcMain.handle('thread:send', (_event, ...args: unknown[]) => { sent.push(args); return snapshot })
      ipcMain.handle('thread:commands', () => ({ commands: [] }))
      ipcMain.handle('thread:models', () => ({ defaultModel: 'test-model', models: [{ id: 'test-model', label: 'Test model', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
    }, workspaceRoot)
    await page.evaluate(root => window.oxe.workspace.create({ rootPath: root, layoutPreset: 1, autoStart: false }), workspaceRoot)
    await page.reload()
    await page.waitForLoadState('load')

    await openHelpDiagnostics(page)
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    const panel = page.getByTestId('diagnostics-panel')

    // Cards from the mock's measurement: everything normal, MCP quarantine named with what to do.
    const cards = panel.getByTestId('diagnostics-health')
    await expect(cards).toBeVisible()
    for (const id of ['cpu', 'memory', 'disk', 'database', 'processes', 'network']) await expect(panel.getByTestId(`diagnostics-card-${id}`)).toBeVisible()
    await expect(panel.getByTestId('diagnostics-card-processes')).toContainText('1 MCP server is quarantined after it changed.')
    await expect(panel.getByTestId('diagnostics-card-processes')).toContainText('What to do:')
    await expect(panel.getByTestId('diagnostics-card-network')).toContainText('Online')
    await expect(panel.getByRole('meter', { name: 'OXESpace CPU use' })).toBeVisible()

    // Journal: both seeded incidents, then only MCP.
    const journal = panel.getByTestId('diagnostics-incidents')
    await expect(journal.getByRole('listitem')).toHaveCount(2)
    await expect(journal).toContainText('An MCP server was quarantined after it changed.')
    await panel.getByRole('combobox', { name: 'Area' }).selectOption('mcp')
    await expect(journal.getByRole('listitem')).toHaveCount(1)
    await expect(journal).not.toContainText('OxeQuery request')

    // Export: the preview comes first; Save opens the save dialog (the mock answers "cancelled").
    await panel.getByRole('button', { name: 'Export bundle' }).click()
    const preview = page.getByRole('dialog', { name: 'Export diagnostics bundle' })
    await expect(preview).toContainText('snapshot.json')
    await expect(preview).toContainText('main-log-tail.txt')
    await expect(preview).toContainText('3 values were redacted')
    await preview.getByRole('button', { name: 'Save bundle…' }).click()
    await expect(preview).toContainText('Export cancelled.')
    await preview.getByRole('button', { name: 'Cancel' }).click()
    await expect(preview).toHaveCount(0)

    // Ask for analysis: Settings closes, the new conversation dialog says the summary goes to the draft.
    await panel.getByRole('button', { name: 'Ask for analysis' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
    const create = page.getByRole('dialog', { name: 'New thread' })
    await expect(create.getByTestId('new-thread-pending-draft')).toContainText('The diagnostics summary goes into this conversation')
    await create.getByRole('button', { name: 'Create thread' }).click()
    const composer = page.locator('textarea[data-thread-composer="true"]').first()
    await expect(composer).toHaveValue(/# OXESpace diagnostics/)
    await expect(composer).toHaveValue(/incident\.mcp\.quarantined \(mcp\): 2/)
    // The bundle's file list is not what was attached, and nothing was sent.
    await expect(composer).not.toHaveValue(/main-log-tail\.txt/)
    expect(await app.evaluate(() => (globalThis as { diagnosticsSent?: unknown[] }).diagnosticsSent?.length ?? 0)).toBe(0)

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
