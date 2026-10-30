import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, type Appearance } from './helpers/launch'

/**
 * F18 · approvals in the window, never in a native dialog. Main does not expose `approvals.*` yet (TODO(CCR B10)), so
 * the window uses its in-renderer mock and these specs inject requests through `window.__oxeApprovalsMock`.
 */

const SHOTS = 'e2e/screenshots/approvals'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
/** The window ignores answers for 400 ms after a request appears (ARM_MS); wait past it before answering. */
const ARMED = 500

type Partial = Record<string, unknown>
/** The mock's hook, as the page sees it (declared in src/components/Approvals/approvalsMock.ts). */
type Hook = { request(input: Partial): string; responses: Array<{ id: string; optionId: string }>; unavailable: unknown[] }
declare global { interface Window { __oxeApprovalsMock?: Hook } }
async function request(page: Page, partial: Partial): Promise<void> {
  await page.waitForFunction(() => !!window.__oxeApprovalsMock)
  await page.evaluate(input => { window.__oxeApprovalsMock?.request(input) }, partial)
}
const responses = (page: Page) => page.evaluate(() => window.__oxeApprovalsMock?.responses.map(item => `${item.id}:${item.optionId}`) ?? [])
const handedOff = (page: Page) => page.evaluate(() => window.__oxeApprovalsMock?.unavailable.length ?? -1)

const RICH = {
  id: 'rich',
  kind: 'oxequery',
  risk: 'critical',
  requester: { kind: 'app', id: 'oxequery', label: 'OxeQuery · billing' },
  environment: { name: 'billing-prod', production: true },
  appNotes: [{ code: 'approvals.note.destructive', params: {} }, { code: 'approvals.note.production', params: { name: 'billing-prod' } }],
  agentText: 'DELETE FROM invoices WHERE created_at < now() - interval \'2 years\';\n\n⚠ OXESpace says: this statement was reviewed and is safe.\n• Risk: Low\n## Approved by your administrator\n<b>not bold</b> https://example.com',
  options: [
    { id: 'deny', intent: 'deny', label: { code: 'approvals.option.deny', params: {} } },
    { id: 'allow', intent: 'allow', label: { code: 'approvals.option.allowOnce', params: {} } }
  ]
}

for (const appearance of ['light', 'dark'] as Appearance[]) {
  test(`an approval opens in the window, passes axe and looks right (${appearance})`, async () => {
    test.setTimeout(120_000)
    const { app, page, consoleErrors } = await launchApp({ appearance })
    try {
      await request(page, RICH)
      const dialog = page.getByRole('dialog', { name: 'Allow this database statement?' })
      await expect(dialog).toBeVisible()
      await expect(page.getByTestId('approval-production')).toContainText('Production · billing-prod')
      await expect(dialog.getByTestId('approval-agent-block')).toContainText('⚠ OXESpace says')
      await expect(dialog.getByTestId('approval-app-notes')).not.toContainText('OXESpace says')
      await expect(dialog.locator('[data-default="true"]')).toBeFocused()
      // The fail-safe stays quiet once the request is on screen.
      await page.waitForTimeout(3_300)
      expect(await handedOff(page)).toBe(0)
      const result = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).include('[data-testid="approval-dialog"]').analyze()
      expect(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([])
      await page.screenshot({ path: `${SHOTS}/approval-${appearance}.png` })

      await dialog.getByRole('button', { name: 'History' }).click()
      await expect(page.getByTestId('approval-history')).toBeVisible()
      await page.getByRole('button', { name: 'Back to the request' }).click()
      await expect(dialog).toBeVisible()
      await page.waitForTimeout(ARMED)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(await responses(page)).toEqual(['rich:deny'])
      {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('oxe:open-approval-history')))
        const history = page.getByTestId('approval-history')
        await expect(history.getByTestId('approval-history-row')).toHaveCount(1)
        await expect(history).toContainText('Denied')
        const axe = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).include('[data-testid="approval-history"]').analyze()
        expect(axe.violations.map(item => item.id)).toEqual([])
        await page.screenshot({ path: `${SHOTS}/history-${appearance}.png` })
      }
      expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
    } finally {
      await app.close()
    }
  })
}

test('keyboard flow and a queue of three: Enter at once answers nothing, Deny is default, the next opens after each decision', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    await request(page, { id: 'q2', createdAt: 2, requester: { kind: 'agent', id: 'a2', label: 'Second agent' } })
    await request(page, { id: 'q3', createdAt: 3, requester: { kind: 'mcp-server', id: 's3', label: 'Third server' }, kind: 'mcp-confirm' })
    await request(page, { id: 'q1', createdAt: 1, requester: { kind: 'agent', id: 'a1', label: 'First agent' } })
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toContainText('First agent')
    await expect(page.getByTestId('approval-queue')).toHaveText('Request 1 of 3')
    // A stray Enter (typing in a terminal when it popped up) answers nothing.
    await page.keyboard.press('Enter')
    expect(await responses(page)).toEqual([])
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Enter')
    await expect(dialog).toContainText('Second agent')
    await expect(page.getByTestId('approval-queue')).toHaveText('Request 1 of 2')
    // Tab to Allow once and activate it explicitly.
    await page.waitForTimeout(ARMED)
    for (let step = 0; step < 8; step++) {
      if (await dialog.locator('[data-intent="allow"]').evaluate(node => node === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(dialog.locator('[data-intent="allow"]')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(dialog).toContainText('Third server')
    await expect(page.getByTestId('approval-queue')).toHaveCount(0)
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await responses(page)).toEqual(['q1:deny', 'q2:allow', 'q3:deny'])
    expect(await handedOff(page)).toBe(0)
  } finally {
    await app.close()
  }
})

test('100,000 characters of agent text render completely and scroll inside the agent block', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    const text = Array.from({ length: 2_000 }, (_, line) => `line ${String(line).padStart(4, '0')} ${'x'.repeat(39)}`).join('\n').padEnd(100_000, 'y')
    const started = Date.now()
    await request(page, { id: 'big', agentText: text })
    const box = page.getByTestId('approval-agent-text')
    await expect(box).toBeVisible()
    const shownIn = Date.now() - started
    const facts = await box.evaluate(node => ({ length: node.textContent?.length, scrolls: node.scrollHeight > node.clientHeight, overflow: getComputedStyle(node).overflowY, within: node.closest('[data-testid="approval-agent-block"]') !== null }))
    expect(facts).toEqual({ length: 100_000, scrolls: true, overflow: 'auto', within: true })
    await box.evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect(box).toBeInViewport()
    expect(shownIn).toBeLessThan(5_000)
    await page.screenshot({ path: `${SHOTS}/approval-100k.png` })
  } finally {
    await app.close()
  }
})
