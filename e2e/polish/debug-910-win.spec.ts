// THROWAWAY debug spec for #910 (OXE-245, pm-02-3:29 red on Windows only): never merged, never labelled. The same setup
// as pm-02-3, then it prints what the bell and the activity store see after the e2e agent-state hook.
import { test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
const setAgentState = (app: ElectronApplication, input: HookInput): Promise<unknown> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)
const say = (label: string, value: unknown): void => console.log(`[DEBUG-910] ${label}: ${JSON.stringify(value)}`)

test('DEBUG-910 what the bell sees after the agent-state hook', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', density: 'comfortable', env: { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    say('platform', process.platform)
    say('hook defined in main', await app.evaluate(() => typeof (globalThis as unknown as { __oxeE2eAgentState?: unknown }).__oxeE2eAgentState))
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string; shellProfileId?: string | null; agentName?: string | null }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).map(pane => ({ id: pane.id, type: pane.type, profile: pane.shellProfileId ?? null, agent: pane.agentName ?? null }))))
    say('panes', panes)
    const terminal = panes.filter(pane => pane.type === 'terminal').at(-1)
    say('target pane', terminal ?? null)
    if (!terminal) return
    say('hook result', await setAgentState(app, { paneId: terminal.id, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' }).catch(error => String(error)))
    for (const wait of [500, 2000, 5000]) {
      await page.waitForTimeout(wait)
      say(`after +${wait}ms`, await page.evaluate(() => ({
        countNodes: document.querySelectorAll('[data-testid="activity-count"]').length,
        bell: document.querySelector('[data-testid="activity-bell"]')?.outerHTML.slice(0, 400) ?? null,
        paneStates: [...document.querySelectorAll('[data-terminal-pane]')].map(el => ({ id: el.getAttribute('data-terminal-pane'), state: el.closest('[data-agent-state]')?.getAttribute('data-agent-state') ?? null })),
        notificationsPermission: typeof Notification === 'undefined' ? 'none' : Notification.permission
      })))
    }
    say('explain', await page.evaluate(id => (window as unknown as { oxe: { agentState?: { explain?: (id: string) => Promise<unknown> } } }).oxe.agentState?.explain?.(id) ?? 'no agentState.explain', terminal.id).catch(error => String(error)))
    await page.getByTestId('activity-bell').click().catch(() => undefined)
    await page.waitForTimeout(800)
    say('activity panel text', ((await page.locator('[role="dialog"], [data-testid="activity-panel"]').first().textContent().catch(() => '')) ?? '').slice(0, 600))
    await page.screenshot({ path: test.info().outputPath('debug-910.png') })
  } finally {
    await app.close()
  }
})
