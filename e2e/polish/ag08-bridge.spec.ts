// Acceptance test for 1.5.2 OxeChat/OxeCode bridge (Jira OXE-190, AG-08, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0).
// Contract: selecting terminal output in OxeCode and choosing "Send selection to OxeChat" switches to OxeChat
// and appends a fenced ```text block to the draft without sending automatically.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('AG-08 in the app: sends terminal selection to matching OxeChat thread draft without auto-sending', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    realClock: true,
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    execFileSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' })
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)

    const terminal = page.locator('[data-testid="pane-container"] .xterm').first()
    await expect(terminal).toBeVisible({ timeout: 20_000 })
    await terminal.click()
    await page.keyboard.type('echo OXE190_BRIDGE_OK')
    await page.keyboard.press('Enter')

    // Select all output via context menu, then reopen context menu and send selection to OxeChat.
    await terminal.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Select all' }).click()
    await terminal.click({ button: 'right' })
    const sendItem = page.getByRole('menuitem', { name: 'Send selection to OxeChat' })
    await expect(sendItem).toBeVisible()
    await sendItem.click()

    // App switches to OxeChat (main.thread-shell) and opens the matching conversation composer or new-conversation dialog
    // with the fenced ```text draft preserved (without sending automatically).
    await expect(page.locator('main.thread-shell')).toBeVisible({ timeout: 15_000 })
    const newThreadForm = page.locator('#new-thread-form')
    const composer = page.locator('[data-thread-composer="true"]').first()
    await expect(newThreadForm.or(composer).first()).toBeVisible({ timeout: 15_000 })
    if (await newThreadForm.isVisible()) {
      await page.getByRole('button', { name: 'Create conversation', exact: true }).click()
    }
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(composer).toHaveValue(/```text/, { timeout: 10_000 })
  } finally {
    await app.close()
  }
})
