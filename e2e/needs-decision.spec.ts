import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow, setAppearance } from './helpers/launch'

/**
 * F29 (UX-01 + UX-07) acceptance: an agent waiting for a decision looks different from one that finished.
 * The states go through main's real AgentStateService (the e2e hook from #268, OXESPACE_E2E_AGENT_STATE=1), so
 * the window's events, the notification and "Why this status?" come from production code.
 * Screenshots: e2e/screenshots/needs-decision/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'needs-decision')
mkdirSync(OUT, { recursive: true })

type HookInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }
type HookResult = { ok: true; explain: { state: { state: string; source: string } | null } } | { ok: false; refusal: string }

const setAgentState = (app: ElectronApplication, input: HookInput): Promise<HookResult> =>
  app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => HookResult }).__oxeE2eAgentState?.(value) as HookResult, input)

const header = (page: Page, paneId: string) => page.locator(`[data-testid="pane-container"][data-pane-id="${paneId}"]`)
const row = (page: Page, paneId: string) => page.locator(`[data-testid="pane-session-row"][data-pane-id="${paneId}"]`)

test('a blocked pane reads "Needs your decision"; a finished one keeps its look', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await resizeWindow(app, 1440, 900)
    // Record the OS notifications the window asks main for.
    await app.evaluate(({ ipcMain }) => {
      const sent: unknown[] = []
      ;(globalThis as unknown as { __notified: unknown[] }).__notified = sent
      ipcMain.removeHandler('notifications:notify')
      ipcMain.handle('notifications:notify', (_event, payload) => { sent.push(payload); return true })
    })
    await openDemoWorkspace(page, workspaceRoot)
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
    expect(panes.length).toBeGreaterThanOrEqual(2)
    // Not the first pane: it is the active one, and looking at a finished pane marks it seen (done → idle).
    const [blocked, done] = [panes.at(-1)!, panes.at(-2)!]
    await expect(header(page, blocked)).toBeVisible()
    // Look at the first pane, so the blocked one is not "being viewed" (that pane is spared the OS ping).
    await header(page, panes[0]).getByTestId('pane-provider-chip').click()
    // The notification poll (1.5 s) must see each pane once before the change: a pane first seen already blocked
    // is listed but never pinged, so a reload does not burst.
    await page.waitForTimeout(2_000)

    const blockedResult = await setAgentState(app, { paneId: blocked, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    expect(blockedResult).toMatchObject({ ok: true, explain: { state: { state: 'blocked', source: 'hook' } } })
    await setAgentState(app, { paneId: done, state: 'working', agent: 'claude' })
    expect(await setAgentState(app, { paneId: done, state: 'done', agent: 'claude' })).toMatchObject({ ok: true, explain: { state: { state: 'done' } } })

    // Header: words, a different dot, and the origin.
    await expect(header(page, blocked).getByTestId('pane-decision-chip')).toHaveText('Needs your decision')
    await expect(header(page, done).getByTestId('pane-decision-chip')).toHaveCount(0)
    await expect(header(page, blocked)).toHaveAttribute('data-tone', 'needs-decision')
    await expect(header(page, done)).toHaveAttribute('data-tone', 'awaiting')
    await expect(header(page, blocked).getByTestId('pane-status-dot')).toHaveClass(/activity-needs-decision/)
    await expect(header(page, done).getByTestId('pane-status-dot')).toHaveClass(/activity-awaiting/)
    await expect(header(page, blocked).getByTestId('pane-status-text')).toHaveText("Needs your decision · Reported by the agent's hooks")
    // Screen readers: a polite status region, filled once on entry.
    const live = header(page, blocked).getByTestId('pane-decision-live')
    await expect(live).toHaveAttribute('role', 'status')
    await expect(live).toContainText('needs your decision: Needs your approval or answer')
    await expect(header(page, done).getByTestId('pane-decision-live')).toHaveText('')

    // Sidebar rows differ in words, not only in color.
    await expect(row(page, blocked).getByTestId('pane-row-status')).toContainText('Needs your decision')
    await expect(row(page, done).getByTestId('pane-row-status')).toContainText('Awaiting')
    await expect(row(page, blocked)).toContainText("needs your decision, Reported by the agent's hooks")

    // The Code button counts only the decision.
    const badge = page.getByTestId('attention-badge')
    await expect(badge).toHaveText('1')
    await expect(badge).toHaveAttribute('aria-label', '1 needs your decision')

    // Main was asked for an OS notification for the decision right away (no stability gate, no cooldown).
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __notified: Array<{ title: string; paneId: string }> }).__notified)).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining('needs your decision'), paneId: blocked })]))

    await page.screenshot({ path: join(OUT, 'panes-light.png') })

    // The activity center lists the request right away.
    await page.getByTestId('activity-bell').click()
    const center = page.getByTestId('activity-center')
    await expect(center).toContainText('the agent stopped and is waiting for your approval or answer')
    await page.screenshot({ path: join(OUT, 'activity-light.png') })
    await page.keyboard.press('Escape')

    // "Why this status?" shows what main read.
    await header(page, blocked).getByRole('button', { name: 'More pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Why this status?' }).click()
    const dialog = page.getByTestId('status-explain-dialog')
    await expect(dialog).toContainText('Waiting for a decision')
    await expect(dialog).toContainText("Reported by the agent's hooks")
    await page.screenshot({ path: join(OUT, 'explain-light.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Dark: the same states, read back from main after the reload.
    await setAppearance(page, 'dark')
    await expect(header(page, blocked).getByTestId('pane-decision-chip')).toHaveText('Needs your decision')
    await expect(page.getByTestId('attention-badge')).toHaveText('1')
    await page.screenshot({ path: join(OUT, 'panes-dark.png') })

    // Answered: the request leaves the counter.
    await setAgentState(app, { paneId: blocked, state: 'working', agent: 'claude' })
    await expect(header(page, blocked).getByTestId('pane-decision-chip')).toHaveCount(0)
    await expect(page.getByTestId('attention-badge')).toHaveCount(0)

    expect(consoleErrors.filter(text => !/ResizeObserver/.test(text))).toEqual([])
  } finally {
    await app.close()
  }
})
