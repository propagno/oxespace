// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-244, PM-02·2, CA-3), in the built app, with
// main's real AgentStateService driven by its e2e hook (the hook exists only with OXESPACE_E2E_MOCK_NATIVE=1,
// electron/main/e2e/agent-state-hook.ts, as e2e/acceptance/oxe152-f6/brd09-shell.spec.ts found: no paid agent and no
// stand-in can be made to wait in a real terminal otherwise). Written by the planner; the executor must not edit it. Red
// until T27 and the card's task.
// Contract: at 1440px, with a terminal waiting and the person in OxeChat, the OxeCode tab's count
// ([data-testid=attention-badge]) lies inside its own tab and inside the title bar (header.workbench-titlebar), never over
// the next tab, and is painted --attn-bg.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
const setAgentState = (app: ElectronApplication, input: HookInput): Promise<unknown> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)
/** The workspace's terminal panes, as main lists them. */
const terminals = async (page: Page): Promise<string[]> => {
  const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
    .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
  expect(panes.length, 'two terminal panes: one to focus, one to signal').toBeGreaterThan(1)
  return panes
}
const tokenColor = (page: Page, token: string): Promise<string> => page.evaluate(name => {
  const probe = document.createElement('div')
  probe.style.backgroundColor = `var(${name})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).backgroundColor
  probe.remove()
  return value
}, token)

test('PM-02·2 in the app: the waiting count sits inside its tab and the title bar', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    // CR OXE-297 (17/11): focus another pane before signalling panes.at(-1) so the signalled pane is not already seen on Windows.
    const panes = await terminals(page)
    await page.locator(`[data-testid="pane-container"][data-pane-id="${panes[0]}"]`).click()
    await setAgentState(app, { paneId: panes.at(-1)!, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    const tabs = page.locator('[data-ui="tabs"][role="tablist"]').filter({ has: page.locator('[data-app-mode]') })
    await tabs.locator('[data-app-mode="thread"]').click()
    const code = tabs.locator('[data-app-mode="code"]')
    const badge = code.getByTestId('attention-badge')
    await expect(badge).toBeVisible()
    const [b, tab, next, bar] = await Promise.all([badge.boundingBox(), code.boundingBox(), tabs.locator('[data-app-mode="thread"]').boundingBox(), page.locator('header.workbench-titlebar').boundingBox()])
    if (!b || !tab || !next || !bar) throw new Error('missing box')
    expect(b.y).toBeGreaterThanOrEqual(bar.y)
    expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height)
    expect(b.x).toBeGreaterThanOrEqual(tab.x)
    expect(b.x + b.width).toBeLessThanOrEqual(tab.x + tab.width)
    expect(b.x + b.width).toBeLessThanOrEqual(next.x)
    expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page, '--attn-bg'))
  } finally {
    await app.close()
  }
})
