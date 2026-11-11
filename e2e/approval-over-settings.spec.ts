import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * DESIGN 1.4.1: an approval that arrives while Settings is open opens ON TOP of it.
 * 1. Settings stays mounted under the approval, which is the layer on top.
 * 2. Once answered, focus comes back to the same control in Settings, on the same page, at the same scroll.
 * 3. Escape answers only the approval (as Deny), never Settings.
 * The request comes from main's E2E double, raised at the moment the spec chooses (electron/main/e2e/approvals-mock.ts).
 */

const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
/** The window ignores answers for 400 ms after a request appears (ARM_MS). */
const ARMED = 500

function approval(id: string) {
  const now = Date.now()
  return {
    schemaVersion: 1, id, generation: 1, kind: 'action', risk: 'medium', ackRequired: false, allowDelayMs: 0, enterDisabled: false,
    requester: { kind: 'agent', id: 'pane:p2', label: msg('approvals.requester.pane', { agent: 'Claude', pane: 2 }) },
    title: msg('approvals.title.agent'), summary: msg('approvals.summary.mcpConfirm', { tool: 'oxespace_agents_change', action: 'prompt', target: 'C:\\repo' }), target: 'C:\\repo',
    appNotes: [], agentText: { text: 'Fix the failing test', untrusted: true, length: 20, truncated: false },
    options: [{ id: 'deny', intent: 'deny', label: msg('approvals.option.deny') }, { id: 'allow-once', intent: 'allow', label: msg('approvals.option.allowOnce') }],
    defaultOptionId: 'deny', createdAt: now, expiresAt: now + 5 * 60_000
  }
}

/** The element in Settings' page that scrolls, as a selector-free handle: the first scrolling box inside the page. */
const scroller = (page: Page) => page.locator('.settings-center-main').evaluateHandle(main => {
  const boxes = [main, ...main.querySelectorAll<HTMLElement>('*')]
  return boxes.find(node => node.scrollHeight > node.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(node).overflowY)) ?? main
})

test('an approval that arrives while Settings is open opens on top; Esc denies only it; focus, page and scroll come back', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    // Small, so the General page scrolls.
    await resizeWindow(app, 1024, 560)
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('.sidebar-section-header').first().click()
    await page.keyboard.press('Control+,')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    await settings.locator('nav[aria-label="Settings categories"] button').filter({ hasText: 'General' }).first().click()
    const field = settings.getByLabel('Recently visited workspaces kept ready')
    await field.focus()
    const box = await scroller(page)
    const scrolled = await box.evaluate(node => { const element = node as HTMLElement; element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight); return element.scrollTop })
    await field.focus()
    const before = { scroll: await box.evaluate(node => (node as HTMLElement).scrollTop), page: await settings.locator('[aria-current="page"]').getAttribute('aria-label') }
    console.log(`[AOS] before ${JSON.stringify({ ...before, scrolled })}`)

    // The approval arrives.
    await app.evaluate((_electron, request) => (globalThis as { __oxeRaiseApproval?: (r: unknown) => void }).__oxeRaiseApproval?.(request), approval('over-settings'))
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toBeVisible()
    // 1. Settings is still there, under it: the approval is the top layer. While the approval is open, Settings is
    // hidden from assistive tech (the approval is modal), so it is found by its surface, not by its role.
    const surface = page.locator('.settings-center')
    await expect(surface).toHaveCount(1)
    await expect(surface).toBeVisible()
    const onTop = await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return node.contains(hit)
    })
    expect(onTop, 'the approval is the layer on top').toBe(true)
    await page.screenshot({ path: test.info().outputPath('approval-over-settings.png') })

    // 3. Escape answers the approval as Deny, and only it.
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const history = await page.evaluate(async () => (await window.oxe.approvals!.history()).map(entry => `${entry.id}:${entry.outcome}`))
    expect(history).toContain('over-settings:deny')
    await expect(settings).toBeVisible()

    // 2. Focus is back on the same control, on the same page, at the same scroll.
    await expect(field).toBeFocused()
    expect(await settings.locator('[aria-current="page"]').getAttribute('aria-label')).toBe(before.page)
    expect(await box.evaluate(node => (node as HTMLElement).scrollTop)).toBe(before.scroll)

    // And Settings itself still closes with Escape afterwards, as usual.
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('the same holds for workspace Settings opened from the palette (HML batch-3b path)', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('.sidebar-section-header').first().click()
    await page.keyboard.press('Control+Shift+P')
    await page.locator('[cmdk-item][data-value="cmd-workspace-settings"]').click()
    const surface = page.locator('.settings-center')
    await expect(surface).toBeVisible()
    // The first control of the page the workspace scope opens on.
    const control = surface.locator('.settings-center-main').locator('button:not([disabled]), input:not([disabled]), select:not([disabled])').first()
    await control.focus()
    const name = await control.evaluate(node => node.getAttribute('aria-label') ?? node.id ?? node.textContent)
    await app.evaluate((_electron, request) => (globalThis as { __oxeRaiseApproval?: (r: unknown) => void }).__oxeRaiseApproval?.(request), approval('over-workspace-settings'))
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toBeVisible()
    await expect(surface).toBeVisible()
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await expect(control).toBeFocused()
    expect(await control.evaluate(node => node.getAttribute('aria-label') ?? node.id ?? node.textContent)).toBe(name)
  } finally {
    await app.close()
  }
})
