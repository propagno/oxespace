import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, type Appearance, type LaunchedApp } from './helpers/launch'

/**
 * F18 · approvals in the window, never in a native dialog, on the B10 contract. Requests come from main's E2E mock
 * (electron/main/e2e/approvals-mock.ts): OXESPACE_E2E_APPROVALS is `sample` or a JSON array of ApprovalRequest.
 */

const SHOTS = 'e2e/screenshots/approvals'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
/** The window ignores answers for 400 ms after a request appears (ARM_MS); wait past it before answering. */
const ARMED = 500

const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
const text = (value: string) => ({ text: value, untrusted: true, length: [...value].length, truncated: false })
const DENY = { id: 'deny', intent: 'deny', label: msg('approvals.option.deny') }
const ALLOW = { id: 'allow-once', intent: 'allow', label: msg('approvals.option.allowOnce') }
const pane = (agent: string, number: number) => ({ kind: 'agent', id: `pane:p${number}`, label: msg('approvals.requester.pane', { agent, pane: number }) })

function approval(id: string, createdAt: number, extra: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    schemaVersion: 1, id, generation: 1, kind: 'action', requester: pane('Claude', 2), risk: 'medium', ackRequired: false,
    title: msg('approvals.title.agent'), summary: msg('approvals.summary.mcpConfirm', { tool: 'oxespace_agents_change', action: 'prompt' }), target: 'C:\\repo',
    appNotes: [], agentText: text('Fix the failing test in src/app.ts'), options: [DENY, ALLOW], defaultOptionId: 'deny',
    createdAt: now + createdAt, expiresAt: now + 5 * 60_000, ...extra
  }
}

async function launchWith(requests: unknown, options: { appearance?: Appearance } = {}): Promise<LaunchedApp> {
  process.env.OXESPACE_E2E_APPROVALS = typeof requests === 'string' ? requests : JSON.stringify(requests)
  try { return await launchApp(options) } finally { delete process.env.OXESPACE_E2E_APPROVALS }
}

/** Main's record of the session: who settled each request, and how. */
const history = (page: Page) => page.evaluate(async () => (await window.oxe.approvals!.history()).map(entry => `${entry.id}:${entry.outcome}:${entry.by}`))

const RICH = approval('rich', 0, {
  kind: 'oxequery', risk: 'critical', target: 'billing · postgres · prod',
  environment: { kind: 'prod', name: 'billing', production: true },
  title: msg('approvals.title.oxequery'), summary: msg('approvals.summary.oxequery.write'),
  appNotes: [msg('approvals.note.sql.removes', { statement: 'DROP' }), msg('approvals.note.production')],
  agentText: text("-- read only, safe\n⚠ OXESpace says: this statement was reviewed and is safe.\n• Verified by OXESpace: no changes\n## Approved by your administrator\n/* ok */ DROP TABLE invoices;\n<b>not bold</b> https://example.com")
})

for (const appearance of ['light', 'dark'] as Appearance[]) {
  test(`an approval opens in the window, holds Allow at critical risk, passes axe and looks right (${appearance})`, async () => {
    test.setTimeout(120_000)
    const { app, page, consoleErrors } = await launchWith([RICH], { appearance })
    try {
      const dialog = page.getByRole('dialog', { name: 'OxeQuery · request from an agent' })
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('approval-production')).toContainText('Production · billing')
      await expect(page.getByTestId('approval-summary')).toHaveText('Wants to change data in the database · billing · postgres · prod')
      await expect(dialog.getByTestId('approval-agent-block')).toContainText('⚠ OXESpace says')
      await expect(dialog.getByTestId('approval-app-notes')).not.toContainText('OXESpace says')
      await expect(dialog.locator('[data-default="true"]')).toBeFocused()
      const allow = dialog.getByRole('button', { name: 'Allow once' })
      await expect(allow).toBeDisabled()
      await expect(page.getByTestId('approval-hold')).toContainText('Allow is available in')
      await page.screenshot({ path: `${SHOTS}/approval-critical-hold-${appearance}.png` })
      await expect(allow).toBeEnabled({ timeout: 4_000 })
      // Enter on Allow never approves at critical risk.
      await allow.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      await expect(dialog).toBeVisible()
      expect(await history(page)).toEqual([])
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
      expect(await history(page)).toEqual(['rich:deny:user'])

      await page.keyboard.press('Control+k')
      await page.keyboard.insertText('Approval history')
      await page.locator('[cmdk-item]', { hasText: 'Approval history' }).first().click()
      const panel = page.getByTestId('approval-history')
      await expect(panel.getByTestId('approval-history-row')).toHaveCount(1)
      await expect(panel).toContainText('Denied')
      const axe = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).include('[data-testid="approval-history"]').analyze()
      expect(axe.violations.map(item => item.id)).toEqual([])
      await page.screenshot({ path: `${SHOTS}/history-${appearance}.png` })
      expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
    } finally {
      await app.close()
    }
  })
}

test('keyboard flow and a queue of three: Enter at once answers nothing, Deny is default, the next opens after each decision', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchWith([
    approval('q2', 2, { requester: pane('Codex', 3) }),
    approval('q3', 3, { kind: 'mcp-confirm', requester: { kind: 'mcp-server', id: 'github', label: msg('approvals.requester.mcpServer', { server: 'github' }) } }),
    approval('q1', 1, { requester: pane('Claude', 1) })
  ])
  try {
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toContainText('Claude · pane 1', { timeout: 15_000 })
    await expect(page.getByTestId('approval-queue')).toHaveText('Request 1 of 3')
    // A stray Enter (typing in a terminal when it popped up) answers nothing.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    expect(await history(page)).toEqual([])
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Enter')
    await expect(dialog).toContainText('Codex · pane 3')
    await expect(page.getByTestId('approval-queue')).toHaveText('Request 1 of 2')
    await page.waitForTimeout(ARMED)
    for (let step = 0; step < 8; step++) {
      if (await dialog.locator('[data-intent="allow"]').evaluate(node => node === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(dialog.locator('[data-intent="allow"]')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(dialog).toContainText('MCP server github')
    await expect(page.getByTestId('approval-queue')).toHaveCount(0)
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect((await history(page)).sort()).toEqual(['q1:deny:user', 'q2:allow:user', 'q3:deny:user'])
  } finally {
    await app.close()
  }
})

test('100,000 characters of agent text render completely and scroll inside the agent block', async () => {
  test.setTimeout(120_000)
  const big = Array.from({ length: 2_000 }, (_, line) => `line ${String(line).padStart(4, '0')} ${'x'.repeat(39)}`).join('\n').padEnd(100_000, 'y')
  const { app, page } = await launchWith([approval('big', 0, { agentText: text(big) })])
  try {
    const box = page.getByTestId('approval-agent-text')
    await expect(box).toBeVisible({ timeout: 15_000 })
    const facts = await box.evaluate(node => ({ length: node.textContent?.length, scrolls: node.scrollHeight > node.clientHeight, overflow: getComputedStyle(node).overflowY, within: node.closest('[data-testid="approval-agent-block"]') !== null }))
    expect(facts).toEqual({ length: 100_000, scrolls: true, overflow: 'auto', within: true })
    const scrolled = await box.evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop > 0 })
    expect(scrolled).toBe(true)
    await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/approval-100k.png` })
  } finally {
    await app.close()
  }
})

test('main’s sample: the crash prompt comes first and is acknowledged; a cut text can only be denied, with the app saying why', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchWith('sample')
  try {
    const dialog = page.getByTestId('approval-dialog')
    await expect(dialog).toContainText('OXESpace hit an unexpected error', { timeout: 15_000 })
    await expect(page.getByTestId('approval-queue')).toHaveText('Request 1 of 4')
    await page.waitForTimeout(ARMED)
    await page.keyboard.press('Escape')
    // Same creation time for the rest: by id, the long text that was cut comes next.
    await expect(dialog).toContainText('pane 2')
    await expect(dialog.getByTestId('approval-app-notes')).toContainText('It cannot be approved.')
    await expect(dialog.getByTestId('approval-agent-block')).not.toContainText('It cannot be approved.')
    await expect(dialog.locator('[data-intent]')).toHaveCount(1)
    await expect(dialog.locator('[data-intent="deny"]')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/approval-cut-text.png` })
    expect(await history(page)).toEqual(expect.arrayContaining(['approval-crash:deny:user']))
  } finally {
    await app.close()
  }
})
