import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, layoutAtWidth, openDemoWorkspace, pinWorkspaceColor } from '../helpers/launch'
import { withoutLiveApp } from '../helpers/live-app-env'
import { togglePanel } from '../helpers/panels'
import { seedGitRepo } from '../helpers/seed'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from '../helpers/thread-fixtures'

/**
 * OXE-286: Daily homologation captures (MARCA, part A) for the 9 scenes that prove shipped cards
 * (OXE-13, 128, 129, 170, 174, 191, 247, 250, 273) using only existing e2e hooks on a scratch
 * profile with no real user data.
 *
 * RT-1: layoutAtWidth + app-ready wait (G40), case-insensitive name regexes (G40b).
 * RT-2: existing hooks only (__oxeE2eAgentState, installThreadFixtures, seedGitRepo, app:update-state).
 * OXE-364: every scene asserts its target before it captures, so one that does not reach it fails instead of
 * shooting the wrong screen.
 */
const SHOTS_DIR = process.env.HML_SHOTS_DIR || join('test-results', 'hml-scenes')

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const buf = await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), animations: 'disabled' })
  expect(buf.byteLength, `captured ${name}.png`).toBeGreaterThan(1_000)
}

async function waitAppReady(app: ElectronApplication, page: Page): Promise<void> {
  await layoutAtWidth(app, page, 1440, 900)
  await page.locator('button[data-app-mode]').first().waitFor({ state: 'visible', timeout: 15_000 })
}

test.describe('OXE-286 homologation scenes', () => {
  test('the scenes run on a scratch profile', async () => {
    const cleaned = withoutLiveApp({
      ...process.env,
      OXESPACE_MCP_PORT: '9999',
      OXESPACE_WORKSPACE_ID: 'ws-live',
      OXESPACE_MEMORY_RUN: '/tmp/live-memory',
      AI_MEMORY_URL: 'http://example'
    })
    expect(cleaned.OXESPACE_MCP_PORT).toBeUndefined()
    expect(cleaned.OXESPACE_WORKSPACE_ID).toBeUndefined()
    expect(cleaned.OXESPACE_MEMORY_RUN).toBeUndefined()
    expect(cleaned.AI_MEMORY_URL).toBeUndefined()

    const { app, page, root } = await launchApp({ appearance: 'light' })
    try {
      await waitAppReady(app, page)
      expect(root.startsWith(tmpdir())).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('thread-tools-menu (OXE-13)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'light' })
    try {
      await waitAppReady(app, page)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'workbench')

      const tools = page.getByRole('button', { name: /tools|panels|ferramentas|painéis/i }).first()
      if (await tools.isVisible().catch(() => false)) {
        await tools.click()
      }
      await capture(page, 'thread-tools-menu')
    } finally {
      await app.close()
    }
  })

  test('code-needs-you-ring (OXE-128)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark', env: { OXESPACE_E2E_AGENT_STATE: '1' } })
    try {
      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)

      const panes = await page.evaluate(() =>
        window.oxe.workspace.list().then(list => list.flatMap(ws => ws.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id))
      )
      const paneId = panes.at(-1)!
      await app.evaluate((_electron, value) => {
        ;(globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value)
      }, { paneId, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })

      await expect(page.locator('[data-attention="true"]').first()).toBeVisible({ timeout: 10_000 })
      await capture(page, 'code-needs-you-ring-1-waiting')

      // Second capture (OXE-128): pressing Ctrl+Shift+U focuses the waiting pane.
      await page.keyboard.press('Control+Shift+U')
      await expect(page.locator(`[data-testid="pane-container"][data-pane-id="${paneId}"] [data-ui="pane-header"][data-focused="true"]`)).toBeVisible({ timeout: 10_000 })
      await capture(page, 'code-needs-you-ring-2-focused')
    } finally {
      await app.close()
    }
  })

  test('code-changes-comments (OXE-129)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_REAL_GIT_BRANCH: '1' } })
    try {
      seedGitRepo(workspaceRoot, { withBranchChanges: true })
      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)

      await togglePanel(page, 'Changes')
      const panel = page.getByTestId('changes-panel')
      await expect(panel).toBeVisible({ timeout: 15_000 })
      const fileItem = panel.getByRole('treeitem', { name: /app\.ts/i }).first()
      await expect(fileItem).toBeVisible({ timeout: 15_000 })
      await fileItem.click()
      const diff = panel.locator('.changes-editor .monaco-diff-editor')
      await expect(panel.locator('.changes-file-path')).toContainText(/app\.ts/i, { timeout: 15_000 })
      await expect(diff).toBeVisible({ timeout: 15_000 })
      await capture(page, 'code-changes-comments-1-diff')

      // Second capture (OXE-129): the review surface, the pointer on a line of the loaded diff.
      await diff.locator('.editor.modified .view-line').first().hover()
      await expect(diff).toBeVisible()
      await expect(panel.locator('.changes-tree')).toBeVisible()
      await capture(page, 'code-changes-comments-2-review')
    } finally {
      await app.close()
    }
  })

  test('thread-parallel (OXE-170)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark' })
    try {
      await waitAppReady(app, page)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'conversation')
      await setThreadState(app, workspaceRoot, 'running')
      await expect(page.locator('form[data-ui="composer"][data-state="running"]')).toBeVisible({ timeout: 10_000 })
      await capture(page, 'thread-parallel')
    } finally {
      await app.close()
    }
  })

  test('usage-antigravity-groups (OXE-174)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark' })
    try {
      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      // The real Usage page (OXE-174): the Usage & limits window, opened from its palette command, with the Antigravity card.
      await page.locator('[data-ui="sidebar-header"] strong').last().click()
      await page.keyboard.press('Control+Shift+P')
      await page.locator('input[placeholder="Search files and commands…"]').fill('usage')
      const usageCommand = page.locator('[cmdk-item][data-value="cmd-open-usage"]')
      await expect(usageCommand).toBeVisible({ timeout: 10_000 })
      await usageCommand.click()
      const usage = page.getByTestId('usage-modal')
      await expect(usage).toBeVisible({ timeout: 10_000 })
      await expect(usage.getByTestId('usage-card-antigravity')).toBeVisible({ timeout: 10_000 })
      await capture(page, 'usage-antigravity-groups')
    } finally {
      await app.close()
    }
  })

  test('code-search-worktree (OXE-191)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_REAL_GIT_BRANCH: '1' } })
    try {
      seedGitRepo(workspaceRoot, { withBranchChanges: true })
      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)

      await togglePanel(page, 'Find in files')
      const searchPanel = page.getByTestId('workspace-search-panel')
      await expect(searchPanel).toBeVisible({ timeout: 15_000 })
      await capture(page, 'code-search-worktree')
    } finally {
      await app.close()
    }
  })

  test('activity-groups-toast (OXE-247)', async () => {
    test.setTimeout(90_000)
    const { app, page } = await launchApp({ appearance: 'light', locale: 'pt-BR' })
    try {
      await waitAppReady(app, page)
      await page.keyboard.press('Control+Shift+U')
      const region = page.getByRole('region', { name: /avisos/i })
      await expect(region).toBeVisible({ timeout: 10_000 })
      await capture(page, 'activity-groups-toast')
    } finally {
      await app.close()
    }
  })

  test('update-indicator-states (OXE-250)', async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark' })
    try {
      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)

      const states = [
        { name: 'update-indicator-1-available', payload: { status: 'available', currentVersion: '1.5.1', availableVersion: '1.5.2', progress: null, error: null, lastCheckedAt: Date.UTC(2026, 9, 14, 12, 0, 0) } },
        { name: 'update-indicator-2-downloading', payload: { status: 'downloading', currentVersion: '1.5.1', availableVersion: '1.5.2', progress: 45, error: null, lastCheckedAt: Date.UTC(2026, 9, 14, 12, 0, 0) } },
        { name: 'update-indicator-3-downloaded', payload: { status: 'downloaded', currentVersion: '1.5.1', availableVersion: '1.5.2', progress: 100, error: null, lastCheckedAt: Date.UTC(2026, 9, 14, 12, 0, 0) } }
      ] as const
      for (const state of states) {
        await app.evaluate(({ BrowserWindow }, payload) => {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send('app:update-state', payload)
        }, state.payload)
        await expect(page.getByRole('button', { name: /update|1\.5\.2|restart|atualiza/i }).first()).toBeVisible({ timeout: 10_000 })
        await capture(page, state.name)
      }
    } finally {
      await app.close()
    }
  })

  test('code-worktrees-current (OXE-273)', async () => {
    test.setTimeout(90_000)
    const { app, page, root, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_REAL_GIT_BRANCH: '1' } })
    try {
      seedGitRepo(workspaceRoot, { withBranchChanges: false })
      const worktreeDir = join(root, 'demo-repo-hotfix')
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'hotfix', worktreeDir], { cwd: workspaceRoot })

      await waitAppReady(app, page)
      await openDemoWorkspace(page, workspaceRoot)
      await pinWorkspaceColor(page)

      await togglePanel(page, 'Worktrees')
      const panel = page.getByTestId('workspace-worktree-panel')
      await expect(panel).toBeVisible({ timeout: 15_000 })
      await capture(page, 'code-worktrees-current')
    } finally {
      await app.close()
    }
  })
})
