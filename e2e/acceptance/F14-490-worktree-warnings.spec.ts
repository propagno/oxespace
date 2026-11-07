import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * #490 · Conversation details › Environment › Worktree lists the warnings from creating the conversation's worktree
 * (a worktree.copyFiles refusal, a failed setup) as one alert, in the opening screen's words; the info lines (created,
 * hooks skipped) stay out. Over the Thread fixture (no agent): the conversation's ownedWorktree carries the notices
 * main kept (#487), after a first message, so the opening screen is gone.
 */
test('#490: worktree warnings show under Environment › Worktree; info lines do not', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'en-US' })
  const out: Record<string, unknown> = {}
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    const notices = [
      { code: 'worktree.created', params: { path: workspaceRoot, branch: 'feat/hml-490' } },
      { code: 'git.hooks.skipped', params: {} },
      { code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../secrets.env', '.git/config'] } },
      { code: 'worktree.copyFiles.notIgnored', params: { paths: ['tracked.txt'] } }
    ]
    await app.evaluate((_c, { root, notices }) => {
      ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState({ status: 'idle', title: 'Worktree warnings', provider: 'claude',
        extra: { model: 'claude-x', ownedWorktree: { path: root, branch: 'feat/hml-490', projectRoot: root, baseSha: '0000000', createdAt: Date.now(), notices } },
        events: [{ type: 'message', id: 'u1', role: 'user', text: 'first message' }, { type: 'message', id: 'a1', role: 'assistant', text: 'ok' }, { type: 'completed', status: 'completed' }] })
    }, { root: workspaceRoot, notices })
    await page.waitForTimeout(800)
    await page.locator('.thread-heading').getByRole('button', { name: 'Conversation details' }).click()
    const panel = page.getByTestId('thread-session-panel')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const environment = panel.getByRole('region', { name: 'Environment' })
    const alert = environment.getByRole('alert')
    await expect.soft(alert, 'the warnings are one alert under Environment').toHaveCount(1, { timeout: 5_000 })
    const text = await alert.first().innerText().catch(() => '')
    out.alert = text.replace(/\s+/g, ' ').slice(0, 600)
    out.environment = (await environment.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 900)
    expect.soft(text, 'the outside-the-repo refusal, by name').toMatch(/\.\.\/secrets\.env/)
    expect.soft(text, 'the not-ignored refusal').toMatch(/tracked\.txt/)
    expect.soft(text, 'no creation line').not.toMatch(/Worktree created/)
    expect.soft(text, 'no hooks line').not.toMatch(/hooks don.t run|Git hooks/i)
    expect.soft(consoleErrors.filter(l => l.startsWith('pageerror')), 'no page error').toEqual([])
  } finally {
    console.log('F14-490', JSON.stringify(out))
    await app.close()
  }
})
