import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from './helpers/thread-fixtures'

/**
 * OXE-290 (CA-1): a pending approval request that arrives AFTER the conversation's status has already
 * transitioned to 'approval' shows the sidebar row's mini card ([data-ui=row-attention]) immediately
 * without reloading the window. Uses the existing Thread IPC stand-in; no real agent or user data.
 */
test('a request that arrives after the state change shows on the sidebar row', async () => {
  test.setTimeout(90_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'dark', density: 'compact' })
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')

    // 1. Transition the conversation to 'approval' BEFORE any pending request exists.
    await app.evaluate(() => {
      ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState({
        status: 'approval',
        title: 'Update the Thread guide',
        events: [{ type: 'message', id: 'u1', role: 'user', text: 'Update the Thread guide' }]
      })
    })

    const row = page.locator('[data-thread-row="e2e-thread"]')
    await expect(row.locator('[data-ui="sidebar-row"]')).toHaveAttribute('data-status', 'attention', { timeout: 5_000 })
    await expect(row.locator('[data-ui="row-attention"]')).toHaveCount(0)

    // 2. Now the pending request arrives while status is already 'approval' (waitingKey does not change).
    await setThreadState(app, workspaceRoot, 'approval')

    const attention = row.locator('[data-ui="row-attention"]')
    await expect(attention).toBeVisible({ timeout: 5_000 })
    await expect(attention).toHaveAttribute('data-kind', 'permission')
    await expect(attention).toContainText('npm run typecheck')
    await expect(attention.getByRole('button', { name: 'Allow once', exact: true })).toHaveAttribute('data-ui', 'button')
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
