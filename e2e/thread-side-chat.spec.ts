import { expect, test } from '@playwright/test'
import { scanSurface } from './helpers/a11y'
import { modeButton } from './helpers/modes'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * F15 / B1.2: the side chat drawer. Ctrl+. opens a read-only copy of the conversation beside it; a question there gets
 * the mock's answer (electron/main/e2e/mock-ipc.ts) and never reaches the conversation; its cost stays in view; Escape
 * gives the composer its focus back. T60: leaving the conversation, ✕ and Ctrl+. only hide it, and the copy with its
 * answers is there on return; "Discard and close…" asks, with Keep focused, and main drops the copy.
 */
test('the side chat asks a read-only copy, shows its cost, and leaves the conversation alone', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    // Anything that reaches the conversation goes through thread:send; record it to prove nothing does.
    await app.evaluate(({ ipcMain }) => {
      const store = globalThis as typeof globalThis & { __threadSends?: unknown[] }
      store.__threadSends = []
      ipcMain.removeHandler('thread:send')
      ipcMain.handle('thread:send', (_event, ...args: unknown[]) => { store.__threadSends!.push(args) })
    })

    const composer = page.locator('[data-thread-composer="true"]').first()
    await composer.focus()
    await page.keyboard.press('Control+.')
    const drawer = page.getByTestId('thread-side-chat')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('Read-only copy')
    await expect(drawer.getByTestId('thread-side-chat-cost')).toHaveText('Cost so far: nothing yet')
    const input = drawer.getByRole('textbox', { name: 'Ask the side chat' })
    await expect(input).toBeFocused()

    await input.fill('Why did the last turn stop?')
    await page.keyboard.press('Enter')
    const log = drawer.getByTestId('thread-side-chat-log')
    await expect(log).toContainText('Why did the last turn stop?')
    await expect(log).toContainText('E2E side chat reply.')

    // The provider reports what the turn cost, then that it finished.
    const sideId = await drawer.getAttribute('data-side-id')
    expect(sideId).toBeTruthy()
    await app.evaluate(({ BrowserWindow }, id) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('thread:side-event', { sideId: id, event: { type: 'turn-cost', usd: 0.03, inputTokens: 4200, outputTokens: 300 } })
        window.webContents.send('thread:side-event', { sideId: id, event: { type: 'completed', status: 'completed' } })
      }
    }, sideId)
    await expect(drawer.getByTestId('thread-side-chat-cost')).toHaveText('Cost so far: ≈ US$ 0.03 · 5k tokens')
    await expect(drawer.getByRole('status')).toHaveCount(0)
    // Nothing reached the conversation.
    expect(await app.evaluate(() => ((globalThis as typeof globalThis & { __threadSends?: unknown[] }).__threadSends ?? []).length)).toBe(0)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/thread-side-chat.png' })
    const findings = await scanSurface(page, 'thread-side-chat')
    expect(findings.filter(item => item.nodes.some(node => /thread-side-chat|_(drawer|header|note|cost|log|question|answer|status|composer|input)_/i.test(node)))).toEqual([])

    const copies = () => app.evaluate(() => ((globalThis as Record<string, unknown>).__oxeSideChats as Map<string, string> | undefined)?.size ?? 0)
    expect(await copies()).toBe(1)

    // Escape gives the composer its focus back; the drawer stays.
    await input.focus()
    await page.keyboard.press('Escape')
    await expect(composer).toBeFocused()
    await expect(drawer).toBeVisible()

    // T60: leaving the conversation and coming back finds the drawer open, with the same copy and its answers.
    await modeButton(page, 'code').click()
    await expect(drawer).toHaveCount(0)
    await modeButton(page, 'thread').click()
    await expect(drawer).toBeVisible()
    await expect(drawer).toHaveAttribute('data-side-id', sideId!)
    await expect(log).toContainText('E2E side chat reply.')
    await expect(drawer.getByTestId('thread-side-chat-cost')).toHaveText('Cost so far: ≈ US$ 0.03 · 5k tokens')
    expect(await copies()).toBe(1)

    // ✕ hides it and keeps the copy; Ctrl+. shows the same one again.
    await drawer.getByTestId('thread-side-chat-close').click()
    await expect(drawer).toHaveCount(0)
    expect(await copies()).toBe(1)
    await composer.focus()
    await page.keyboard.press('Control+.')
    await expect(drawer).toHaveAttribute('data-side-id', sideId!)
    await expect(log).toContainText('E2E side chat reply.')

    // "Discard and close…" asks first (there is an answer), Keep focused; Discard closes it and main drops the copy.
    await drawer.getByTestId('thread-side-chat-actions').click()
    await page.getByRole('menuitem', { name: 'Discard and close…' }).click()
    const confirm = page.getByRole('dialog', { name: 'Discard this side chat?' })
    await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Discard' }).click()
    await expect(drawer).toHaveCount(0)
    await expect.poll(copies).toBe(0)

    // The header's menu opens a new copy, without the old answers.
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /^Side chat/ }).click()
    await expect(drawer).toBeVisible()
    await expect(drawer).not.toHaveAttribute('data-side-id', sideId!)
    await expect(log).not.toContainText('E2E side chat reply.')
    await drawer.getByTestId('thread-side-chat-close').click()
    await expect(drawer).toHaveCount(0)

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
