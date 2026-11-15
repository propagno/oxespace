// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-245, PM-02·3, CA-3), in the built app, with
// main's real AgentStateService driven by its e2e hook to put an unread item in Activity (the hook exists only with
// OXESPACE_E2E_MOCK_NATIVE=1, electron/main/e2e/agent-state-hook.ts; see brd09-shell.spec.ts). Written by the planner; the
// executor must not edit it. Red until the card's task (after T27).
// Contract: in the comfortable density the title bar (header.workbench-titlebar) is 40px tall (--bar-lg), and the bell's
// count ([data-testid=activity-count]) lies wholly inside the bar and inside the bell's own box.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
const setAgentState = (app: ElectronApplication, input: HookInput): Promise<unknown> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)
const lastTerminal = async (page: Page): Promise<string> => {
  const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
    .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
  expect(panes.length, 'a terminal pane').toBeGreaterThan(0)
  return panes.at(-1) as string
}

test('PM-02·3 in the app: the title bar is 40px in comfortable and the bell\'s count is whole', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', density: 'comfortable', env: { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await setAgentState(app, { paneId: await lastTerminal(page), state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    const bar = page.locator('header.workbench-titlebar')
    const count = page.getByTestId('activity-count')
    await expect(count).toBeVisible()
    const [barBox, countBox, bellBox] = await Promise.all([bar.boundingBox(), count.boundingBox(), page.getByTestId('activity-bell').boundingBox()])
    if (!barBox || !countBox || !bellBox) throw new Error('missing box')
    expect(Math.round(barBox.height)).toBe(40)
    expect(countBox.y).toBeGreaterThanOrEqual(barBox.y)
    expect(countBox.y + countBox.height).toBeLessThanOrEqual(barBox.y + barBox.height)
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(barBox.x + barBox.width)
    // Nothing clips it: the count's own box is what is painted (no ancestor of it hides overflow inside the bar).
    const clipped = await count.evaluate(el => { const bar = el.closest('header'); let node = el.parentElement; while (node && node !== bar) { if (getComputedStyle(node).overflow.includes('hidden')) return true; node = node.parentElement } return false })
    expect(clipped).toBe(false)
  } finally {
    await app.close()
  }
})
