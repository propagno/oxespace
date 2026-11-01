import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { scanSurface } from './helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * F14 · Conversation details (session panel) in the real renderer, against the Thread fixture's stand-in main
 * process: the numbers come from the context report the usage events left on the thread, Compact runs the
 * conversation's /compact, sections reorder by keyboard menu and by drag and keep their order, and the panel
 * reads well in light and dark.
 */
const SHOTS = join(process.cwd(), 'e2e', 'screenshots', 'session-panel')
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)

/** What a Claude context-usage event leaves on the thread (electron/main/services/conversation/thread-context.ts). */
const CONTEXT_REPORT = {
  model: 'claude-x', usedTokens: 64_000, windowTokens: 200_000, percentage: 32, autoCompactAtTokens: 167_000, capturedAt: NOW, source: 'claude-control',
  categories: [
    { name: 'System prompt', tokens: 3000, kind: 'used' }, { name: 'System tools', tokens: 12_000, kind: 'used' }, { name: 'MCP tools', tokens: 9000, kind: 'used' },
    { name: 'Memory files', tokens: 1000, kind: 'used' }, { name: 'Skills', tokens: 2000, kind: 'used' }, { name: 'Messages', tokens: 36_000, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 7000, kind: 'deferred' }, { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' }, { name: 'Free space', tokens: 103_000, kind: 'free' }
  ]
}

async function applySession(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_context, { root, report, now }) => {
    const user = (id: string, text: string) => ({ type: 'message', id, role: 'user', text })
    ;(globalThis as Record<string, (state: unknown) => void>).applyThreadState({
      status: 'idle', title: 'Conversation details', provider: 'claude',
      extra: {
        model: 'claude-x', contextReport: report,
        costReport: { totalUsd: 0.75, turns: 2, updatedAt: now, source: 'claude-result-step' },
        mcpServers: { servers: [{ name: 'oxespace', status: 'connected' }, { name: 'docs', status: 'needs-auth' }], checkedAt: now },
        background: { running: 1, since: now }
      },
      events: [
        user('u1', 'Tidy the session code'),
        { type: 'tool', id: 't1', name: 'Read', state: 'completed', detail: 'src/session.ts' },
        { type: 'tool', id: 't2', name: 'Bash', state: 'completed', detail: 'npm test' },
        { type: 'tool', id: 't3', name: 'Bash', state: 'failed', detail: 'npm run lint' },
        { type: 'tool', id: 't4', name: 'mcp__oxespace__oxespace_list_panes', state: 'completed', detail: '' },
        { type: 'tool', id: 'f1', name: 'Edit', state: 'completed', detail: 'src/session.ts', files: [{ path: `${root}/src/session.ts`, kind: 'update', state: 'completed', source: 'native-patch', additions: 12, deletions: 4 }] },
        { type: 'message', id: 'a1', role: 'assistant', text: 'The session code is tidier now.' },
        { type: 'completed', status: 'completed' }
      ]
    })
  }, { root, report: CONTEXT_REPORT, now: NOW })
}

async function stubCommands(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, report) => {
    const g = globalThis as Record<string, unknown>
    g.sessionCommands = []
    for (const channel of ['thread:command', 'thread:context-usage']) ipcMain.removeHandler(channel)
    ipcMain.handle('thread:command', (_event, _id, text: string) => { (g.sessionCommands as string[]).push(text); return { kind: 'applied' } })
    ipcMain.handle('thread:context-usage', () => report)
  }, CONTEXT_REPORT)
}

const sectionTitles = (page: Page): Promise<string[]> => page.getByTestId('thread-session-panel').locator('h3').allTextContents()

async function openPanel(page: Page): Promise<void> {
  await page.locator('.thread-heading').getByRole('button', { name: 'Conversation details' }).click()
  await expect(page.getByTestId('thread-session-panel')).toBeVisible()
}

/** The app follows the system mode ("system" appearance), so the emulated color scheme switches it in place. */
async function shoot(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: mode })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe(mode)
  const panel = page.getByTestId('thread-session-panel')
  await expect(panel).toBeVisible()
  // No tooltip or hover left from the steps before.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await panel.locator('li').first().scrollIntoViewIfNeeded()
  await page.locator('.thread-review-host').screenshot({ path: join(SHOTS, `session-panel-${mode}.png`), animations: 'disabled' })
  await page.screenshot({ path: join(SHOTS, `session-panel-${mode}-window.png`), animations: 'disabled' })
  await panel.locator('li[data-section]').last().scrollIntoViewIfNeeded()
  await page.locator('.thread-review-host').screenshot({ path: join(SHOTS, `session-panel-${mode}-bottom.png`), animations: 'disabled' })
}

test('Conversation details shows the session, compacts, and reorders its sections', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
    await page.emulateMedia({ colorScheme: 'light' })
  try {
    await resizeWindow(app, 1440, 900)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await stubCommands(app)
    await applySession(app, workspaceRoot)
    await openPanel(page)
    const panel = page.getByTestId('thread-session-panel')

    // The numbers are the context report's, the same the composer's ring shows.
    await expect(panel.getByText('64k of 200k · 32%')).toBeVisible()
    await expect(panel.getByRole('meter', { name: 'Context window' })).toHaveAttribute('aria-valuenow', '64000')
    const breakdown = panel.getByTestId('session-context-breakdown')
    for (const [name, tokens] of [['Messages', '36k'], ['Tools', '12k'], ['MCP', '9k'], ['System', '4k'], ['Skills', '2k'], ['Free', '103k'], ['Reserved for compaction', '33k']]) {
      await expect(breakdown.getByRole('row', { name: new RegExp(`^${name} ${tokens} `) })).toBeVisible()
    }
    await expect(panel.getByText('Reported cost so far: US$ 0.75 in 2 turns.')).toBeVisible()

    // Environment, tools and MCP, outputs and background work.
    const environment = panel.getByRole('region', { name: 'Environment' })
    await expect(environment).toContainText('demo-repo')
    await expect(environment).toContainText('Claude Code')
    await expect(environment).toContainText('claude-x')
    await expect(panel.getByRole('list', { name: 'Tools used in this conversation' }).getByRole('listitem').first()).toContainText('Bash2 calls · 1 failed')
    await expect(panel.getByRole('region', { name: /Connected/ })).toContainText('oxespace')
    await expect(panel.getByRole('list', { name: 'Changed files' })).toContainText('src/session.ts')
    await expect(panel.getByText('1 task running')).toBeVisible()

    // Compact runs the conversation's /compact.
    await panel.getByRole('button', { name: 'Compact' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).sessionCommands)).toEqual(['/compact'])

    // The side panel only: the conversation beside it is scanned by its own specs.
    const violations = await scanSurface(page, 'thread/session-panel', { exclude: ['.thread-view'] })
    expect(violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious'), JSON.stringify(violations, null, 2)).toEqual([])

    // Keyboard only (WCAG 2.5.7): the section menu moves Background work to the top; focus stays on its menu button.
    const backgroundMenu = panel.getByRole('button', { name: 'Move the Background work section' })
    await backgroundMenu.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Move to the top' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Move to the top' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => sectionTitles(page)).toEqual(['Background work', 'Environment', 'Context', 'Tools and MCP', 'Outputs'])
    await expect(backgroundMenu).toBeFocused()
    await expect(panel.getByRole('status').filter({ hasText: 'Background work moved to position 1 of 5' })).toHaveCount(1)

    // Drag with the mouse: Environment's grip onto the top half of Background work, both at the top of the panel.
    const background = panel.locator('li[data-section="background"]'), environmentItem = panel.locator('li[data-section="environment"]')
    await background.scrollIntoViewIfNeeded()
    const grip = environmentItem.getByTitle('Drag to move the Environment section')
    await expect(grip).toBeInViewport()
    const from = (await grip.boundingBox())!, to = (await background.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await expect(environmentItem).toHaveAttribute('data-dragging', 'true')
    await page.mouse.move(to.x + 40, to.y + 12, { steps: 8 })
    await expect(background).toHaveAttribute('data-drop', 'before')
    await page.mouse.up()
    const dragged = ['Environment', 'Background work', 'Context', 'Tools and MCP', 'Outputs']
    await expect.poll(() => sectionTitles(page)).toEqual(dragged)
    await expect(environmentItem).not.toHaveAttribute('data-dragging')

    // The order is kept when the panel opens again.
    await page.locator('.thread-heading').getByRole('button', { name: 'Conversation details' }).click()
    await expect(panel).toHaveCount(0)
    await openPanel(page)
    expect(await sectionTitles(page)).toEqual(dragged)
    await page.getByRole('button', { name: 'Move the Context section' }).click()
    await page.getByRole('menuitem', { name: 'Restore the default order' }).click()
    await expect.poll(() => sectionTitles(page)).toEqual(['Environment', 'Context', 'Tools and MCP', 'Outputs', 'Background work'])

    await shoot(page, 'light')
    await shoot(page, 'dark')
    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
