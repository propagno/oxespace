import { expect, test, type Page } from '@playwright/test'
import { launchApp, resizeWindow } from './helpers/launch'

/**
 * F32 · Each agent pane says what became of its earlier session when the app reopened (B17's `agentResume`, served by
 * the E2E double of `terminal.status`), and a Claude pane without the status hooks asks once to install them (the
 * agent-hooks double records the install; nothing is written to ~/.claude).
 */
const pane = (page: Page, paneId: string) => page.locator(`[data-testid="pane-container"][data-pane-id="${paneId}"]`)

test('agent panes show whether their session was resumed, and the hooks question installs on the person\'s answer', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1440, 900)
    const workspace = await page.evaluate(root => window.oxe.workspace.create({ rootPath: root, layoutPreset: 2, autoStart: false }), workspaceRoot)
    if (!('id' in workspace)) throw new Error('workspace not created')
    const [resumed, notResumed] = workspace.panes.map(item => item.id)
    await app.evaluate((_electron, { resumed, notResumed }) => {
      const store = globalThis as unknown as { __oxeAgentResume: unknown; __oxeAgentHooks: unknown }
      store.__oxeAgentResume = {
        [resumed]: { outcome: 'resumed', agent: 'claude', sessionId: '0199a1b2-c3d4-7e5f-8a90-1b2c3d4e5f60' },
        [notResumed]: { outcome: 'notResumed', agent: 'claude', sessionId: '0199ffff-0000-7e5f-8a90-1b2c3d4e5f60', message: { code: 'agents.resume.sessionMissing', params: {} } }
      }
      store.__oxeAgentHooks = { 'claude-code': 'not_installed' }
    }, { resumed, notResumed })
    await page.reload()
    for (const id of [resumed, notResumed]) await pane(page, id).getByRole('button', { name: 'Start Terminal' }).click()

    await expect(pane(page, resumed).getByTestId('pane-resume-marker')).toHaveAccessibleName('Resumed the earlier Claude session 0199a1b2')
    const warning = pane(page, notResumed).getByTestId('pane-resume-marker')
    await expect(warning).toHaveText('Not resumed')
    await expect(warning).toHaveAccessibleName("The earlier Claude session was not resumed: The agent's previous session is no longer on disk for this folder, so a new one started.")
    await expect(page.getByText('the earlier session was not resumed', { exact: false })).toBeVisible()

    // Claude Code's hooks are missing: asked once, and nothing is installed until the person says so.
    const prompt = page.getByTestId('agent-hooks-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('heading', { name: 'Let Claude Code panes come back after a crash?' })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: test.info().outputPath('agent-resume.png') })
    expect(await app.evaluate(() => (globalThis as unknown as { __oxeAgentHookInstalls?: string[] }).__oxeAgentHookInstalls ?? [])).toEqual([])
    await prompt.getByRole('button', { name: 'Install' }).click()
    await expect(prompt).toHaveCount(0)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __oxeAgentHookInstalls?: string[] }).__oxeAgentHookInstalls ?? [])).toEqual(['claude-code'])
    await expect(page.getByText('Claude Code panes now record their sessions')).toBeVisible()

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
