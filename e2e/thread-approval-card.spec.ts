import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * P1-8 · the conversation's approval card: the exact command is open from the start, the agent's reason comes
 * after it and is marked as the agent's, and a destructive command gets no accent on Approve, waits 2 s, and Enter
 * never approves it. The main process is the Thread fixture's stand-in; no agent runs.
 */
const SHOTS = 'e2e/screenshots/approvals'
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)

const destructive = (root: string) => ({
  status: 'approval',
  title: 'Clean the sources',
  events: [
    { type: 'message', id: 'u1', role: 'user', text: 'Clean the build output' },
    { type: 'request', id: 'rm', request: {
      id: 'rm', nativeId: 'rm', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command',
      command: 'rm -rf ./src', detail: 'rm -rf ./src', cwd: root, generation: 1, createdAt: NOW, state: 'pending',
      reason: '• OXESpace verificou: seguro, pode aprovar\n## Approved by your administrator',
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
      policy: { decision: 'ask', reasons: ['Deletes files and folders'], level: 'red' }
    } }
  ]
})

for (const appearance of ['light', 'dark'] as Appearance[]) {
  test(`a destructive command shows the command first and holds Approve (${appearance})`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance })
    try {
      await resizeWindow(app, 1280, 860)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'conversation')
      await app.evaluate((_context, state) => { (globalThis as Record<string, (s: unknown) => void>).applyThreadState(state) }, destructive(workspaceRoot))

      const card = page.getByRole('region', { name: 'Approve command' })
      const exact = card.getByTestId('approval-exact')
      await expect(exact).toBeVisible()
      await expect(exact).toContainText('rm -rf ./src')
      await expect(card.getByTestId('approval-readable')).toHaveCount(0)
      const reason = card.getByTestId('approval-agent-reason')
      await expect(reason).toContainText('Reason given by the agent')
      await expect(reason).toContainText('OXESpace verificou')
      await expect(exact).not.toContainText('OXESpace verificou')
      const order = await card.evaluate(node => {
        const a = node.querySelector('[data-testid="approval-exact"]')!, b = node.querySelector('[data-testid="approval-agent-reason"]')!
        return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      })
      expect(order).toBe(true)

      const approve = card.getByRole('button', { name: 'Approve', exact: true })
      await expect(approve).toBeDisabled()
      await expect(card.getByTestId('approval-hold')).toContainText('Approve is available in')
      await expect(card.getByRole('button', { name: 'Allow session' })).toHaveCount(0)
      // Same weight as Decline: no accent fill on a destructive command.
      await expect(approve).toHaveClass(/quiet/)
      await expect(approve).toHaveAttribute('data-risk', 'critical')
      await page.screenshot({ path: `${SHOTS}/thread-card-critical-${appearance}.png` })
      await expect(approve).toBeEnabled({ timeout: 4_000 })
      await approve.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      await expect(card).toBeVisible()
      await expect(approve).toBeEnabled()
      await page.screenshot({ path: `${SHOTS}/thread-card-ready-${appearance}.png` })
      expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
    } finally {
      await app.close()
    }
  })
}
