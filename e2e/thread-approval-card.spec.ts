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
      // In the height-capped request dock the boxes keep their height and the card scrolls; they used to collapse to a
      // line, which is the "empty preview" the audit saw.
      expect((await exact.boundingBox())!.height).toBeGreaterThan(60)
      expect((await card.getByTestId('approval-agent-reason').boundingBox())!.height).toBeGreaterThan(60)
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
      // An approval is denied, not declined (DESIGN, RC; F18's word).
      await expect(card.getByRole('button', { name: 'Deny', exact: true })).toBeVisible()
      // The capped dock scrolls the card's middle: while more is below, it fades out at the bottom (DESIGN, RC); at
      // the bottom the fade is gone and the agent's reason is in reach.
      const content = card.locator('.thread-approval-content')
      const overflows = await content.evaluate(node => node.scrollHeight > node.clientHeight + 1)
      if (overflows) {
        await expect(content).toHaveAttribute('data-more-below', 'true')
        await page.screenshot({ path: `${SHOTS}/thread-card-more-below-${appearance}.png` })
        await content.evaluate(node => { node.scrollTop = node.scrollHeight })
        await expect(content).not.toHaveAttribute('data-more-below')
        await expect(reason).toBeInViewport()
      }
      console.log(`[CARD-FADE] ${appearance}: overflows ${overflows}`)

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

// T67 (DESIGN #568 C-01): at 900×620 the dock showed ~100 px of the command in its own scroll, so a long command was
// approved unseen. Now the command has no scroll of its own, the card takes up to 60% of the conversation, past that
// the details scroll as one with "Copy exact text" kept in view, and the title is said once.
const longCommand = Array.from({ length: 40 }, (_, line) => `echo "step ${line + 1}: rebuild package ${line + 1} and check its output"`).join(' &&\n  ')
const longApproval = (root: string) => ({
  status: 'approval',
  title: 'Rebuild everything',
  events: [
    { type: 'message', id: 'u1', role: 'user', text: 'Rebuild every package' },
    { type: 'request', id: 'long', request: {
      id: 'long', nativeId: 'long', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command',
      command: longCommand, detail: longCommand, cwd: root, generation: 1, createdAt: NOW, state: 'pending', reason: 'Rebuild after the version bump'
    } }
  ]
})

for (const [width, height] of [[900, 620], [1440, 900]] as const) {
  test(`a long command is read whole in the dock, with Copy in view (${width}×${height})`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp()
    try {
      await resizeWindow(app, width, height)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'conversation')
      await app.evaluate((_context, state) => { (globalThis as Record<string, (s: unknown) => void>).applyThreadState(state) }, longApproval(workspaceRoot))

      const card = page.getByRole('region', { name: 'Approve command' })
      const exact = card.getByTestId('approval-exact')
      const copy = exact.getByRole('button', { name: 'Copy exact text' })
      await expect(exact).toBeVisible()
      // No scroll of its own: the command box is as tall as the command.
      expect(await exact.locator('pre').evaluate(pre => pre.scrollHeight <= pre.clientHeight + 1)).toBe(true)
      await expect(copy).toBeInViewport()
      // Inline in the conversation timeline (G6): the command has no scroll of its own and Copy stays in view.
      const content = card.locator('.thread-approval-content')
      await content.evaluate(node => { node.scrollTop = node.scrollHeight })
      const end = await content.evaluate(node => {
        const pre = node.querySelector('[data-testid="approval-exact"] pre')!.getBoundingClientRect(), box = node.getBoundingClientRect()
        return { preBottom: pre.bottom, boxBottom: box.bottom }
      })
      expect(end.preBottom).toBeLessThanOrEqual(end.boxBottom + 1)
      await card.scrollIntoViewIfNeeded()
      await expect(copy).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/thread-card-long-${width}x${height}.png` })
      expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
    } finally {
      await app.close()
    }
  })
}
