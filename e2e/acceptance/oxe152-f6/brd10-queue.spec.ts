// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-73, BRD-10, with bug OXE-176), in the built app
// with real services: main's real AgentStateService driven by its e2e hook and main's agents overview (the hook exists
// only with OXESPACE_E2E_MOCK_NATIVE=1, electron/main/e2e/agent-state-hook.ts: no paid agent can be made to wait otherwise). Written by the planner; the executor must not edit it. Red until T37 and T29 land.
// Contract: a terminal that waits on its agent makes the pill say "1 needs you"; the pill opens the queue
// ([data-ui=needs-you-queue]) with exactly that one row, a pane row naming the workspace, and no Deny / Allow on it;
// "Go to terminal" (thread:f7.queue.goToPane) takes the person to that pane (its container gets the focus within); Esc
// closes the queue and the focus goes back to the pill. Requests of conversations are proved by the window and main tests
// (A26, A34): the conversation fixtures stand in for main's IPC, so they are not used here.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../../helpers/launch'

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
const setAgentState = (app: ElectronApplication, input: HookInput): Promise<unknown> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)

test('BRD-10 / OXE-176 in the app: a waiting terminal is the queue\'s one row, and Go to terminal reaches it', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
    expect(panes.length).toBeGreaterThanOrEqual(2)
    const waiting = panes.at(-1)!
    // Another pane is the active one, so going to the waiting pane is a visible move.
    await page.locator(`[data-testid="pane-container"][data-pane-id="${panes[0]}"]`).click()
    await setAgentState(app, { paneId: waiting, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })

    const pill = page.getByTestId('needs-you-pill')
    await expect(pill).toContainText('1 needs you')
    await pill.click()
    const queue = page.locator('[data-ui="needs-you-queue"]')
    await expect(queue).toHaveCount(1)
    const items = queue.locator('[data-ui="needs-you-item"]')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toHaveAttribute('data-kind', 'pane')
    await expect(items.first()).toContainText('demo-repo ›')
    await expect(items.first().getByRole('button', { name: /^(deny|allow once)$/i })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(queue).toHaveCount(0)
    await expect(pill).toBeFocused()

    await pill.click()
    await queue.locator('[data-ui="needs-you-item"]').first().getByRole('button', { name: /terminal/i }).click()
    await expect.poll(() => page.evaluate(id => Boolean(document.activeElement?.closest(`[data-testid="pane-container"][data-pane-id="${id}"]`)), waiting)).toBe(true)
  } finally {
    await app.close()
  }
})
