// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-72, BRD-09), in the built app with real
// services: main's real AgentStateService driven by its e2e hook (as e2e/needs-decision.spec.ts
// uses it; the hook exists only with OXESPACE_E2E_MOCK_NATIVE=1, electron/main/e2e/agent-state-hook.ts, so this spec keeps
// the native mocks: no paid agent can be made to wait otherwise). Written by the planner; the executor must not edit it. Red until T27 and T28 land.
// Contract: the title bar's mode selector is one [data-ui=tabs] tablist with three tabs (data-app-mode code, thread,
// data); no needs-you pill while nothing waits; a terminal that starts waiting puts its count in the OxeCode tab and shows
// the pill; the status bar ([data-ui=status-bar]) names the workspace and shows neither "agents working" nor the version.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../../helpers/launch'

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
const setAgentState = (app: ElectronApplication, input: HookInput): Promise<unknown> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)

test('BRD-09 in the app: mode tabs with the needs-you count, the pill only when something waits, the status bar', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const tabs = page.locator('[data-ui="tabs"][role="tablist"]').filter({ has: page.locator('[data-app-mode]') })
    await expect(tabs).toHaveCount(1)
    await expect(tabs.getByRole('tab')).toHaveCount(3)
    await expect(tabs.locator('[data-app-mode="code"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('needs-you-pill')).toHaveCount(0)
    await expect(page.getByText('Nothing waiting')).toHaveCount(0)

    const status = page.locator('[data-ui="status-bar"]')
    await expect(status).toHaveCount(1)
    await expect(status).toContainText('demo-repo')
    await expect(status).not.toContainText(/agents? working/i)
    await expect(status).not.toContainText(/OXESpace/)

    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
    expect(panes.length).toBeGreaterThan(0)
    await setAgentState(app, { paneId: panes.at(-1)!, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    await expect(tabs.locator('[data-app-mode="code"]')).toContainText('1')
    await expect(page.getByTestId('needs-you-pill')).toContainText('1 needs you')
  } finally {
    await app.close()
  }
})
