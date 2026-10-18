import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSurface, writeReport, type Violation } from '../helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState, THREAD_STATES, type ThreadStateName } from '../helpers/thread-fixtures'

/**
 * Accessibility scan (axe, WCAG 2.0/2.1 A and AA) over the surfaces the visual suite already
 * reaches, in both themes. Run with `npm run test:a11y`.
 *
 * Informative for 1.0: it records what it finds in a JSON-lines report and does not fail. Set
 * OXE_A11Y_STRICT=1 to fail on any violation. The report goes to OXE_A11Y_REPORT, default
 * <tmp>/oxespace-a11y-report.jsonl: not under test-results, which Playwright empties on every run.
 */
const REPORT = process.env.OXE_A11Y_REPORT ?? join(tmpdir(), 'oxespace-a11y-report.jsonl')
const STRICT = process.env.OXE_A11Y_STRICT === '1'
const THEMES: Appearance[] = ['light', 'dark']
const THREAD_SURFACES: ThreadStateName[] = ['empty', 'conversation', 'approval', 'question', 'usage-failure', 'workbench']

test.beforeAll(() => { rmSync(REPORT, { force: true }) })

async function record(violations: Violation[], found: Violation[]): Promise<void> {
  found.push(...violations)
  writeReport(REPORT, violations)
}

/**
 * Opens a surface and scans it. If the surface cannot be reached the failure is recorded as a
 * finding, not swallowed: a scan that silently skips a screen would overstate its coverage.
 */
async function reach(surface: string, found: Violation[], page: Page, open: () => Promise<void>): Promise<void> {
  try {
    await open()
    await record(await scanSurface(page, surface), found)
  } catch (error) {
    const firstLine = String(error).split(String.fromCharCode(10))[0].slice(0, 140)
    await record([{ surface, rule: 'scan-not-reached', impact: 'minor', help: `Could not open this surface: ${firstLine}`, nodes: [] }], found)
  }
}

async function openTool(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId('btn-open-tools').click()
  await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name }).click()
}

for (const theme of THEMES) {
  test(`a11y: empty state and Code surfaces — ${theme}`, async () => {
    test.setTimeout(180_000)
    const found: Violation[] = []
    const { app, page, root } = await launchApp({ appearance: theme })
    // Playwright's default for clicks and fills is no limit, so one control that never becomes actionable
    // would hold the whole test until it times out. 10 s turns that into a recorded 'scan-not-reached'.
    page.setDefaultTimeout(10_000)
    try {
      await resizeWindow(app, 1280, 800)
      await page.waitForSelector('[data-testid="btn-new-workspace"]')
      await record(await scanSurface(page, `${theme}/empty`), found)

      const repo = `${root}/repo`
      seedGitRepo(repo, { withBranchChanges: true })
      // A linked worktree, so the Worktrees panel offers a removal to confirm.
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'a11y/tree', `${root}/repo-tree`], { cwd: repo })
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-layout-card-1').click()
      await record(await scanSurface(page, `${theme}/new-workspace-wizard`), found)
      await page.getByTestId('wizard-launch-btn').click()
      await expect(page.getByTestId('terminal-pane')).toHaveCount(1)
      await record(await scanSurface(page, `${theme}/workspace`), found)

      await page.getByTestId('btn-open-tools').click()
      await expect(page.getByRole('menu', { name: 'Panels' })).toBeVisible()
      await record(await scanSurface(page, `${theme}/tools-menu`), found)
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      await record(await scanSurface(page, `${theme}/command-palette`), found)
      await page.keyboard.press('Escape')

      await openTool(page, /^Changes$/)
      const panel = page.getByTestId('changes-panel')
      await expect(panel).toBeVisible()
      await panel.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'app.ts' }).click()
      await expect(panel.locator('.monaco-diff-editor')).toContainText('unmodified lines', { timeout: 15_000 })
      await record(await scanSurface(page, `${theme}/changes`), found)

      // The Review panel is the active one right now. Reopened later it sits behind other panels in the
      // stack, and its "Classic" switch is then hidden, so this is scanned here.
      await reach(`${theme}/review-classic`, found, page, async () => {
        await page.getByText('Classic', { exact: true }).first().click()
        await expect(page.getByText('Changes', { exact: true }).first()).toBeVisible()
      })

      await reach(`${theme}/github`, found, page, async () => {
        await openTool(page, /^Commit & pull request$/)
        await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
      })

      await reach(`${theme}/find-in-files`, found, page, async () => {
        await openTool(page, /^Find in files$/)
        await expect(page.getByTestId('workspace-search-panel')).toBeVisible()
      })
      await reach(`${theme}/editor`, found, page, async () => {
        await openTool(page, /^Files$/)
        const editor = page.getByTestId('workspace-editor-panel')
        await expect(editor).toBeVisible()
        await editor.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' }).click()
        await expect(editor.getByRole('tab', { name: /README\.md/ })).toBeVisible()
      })
      await reach(`${theme}/web-preview`, found, page, async () => {
        await openTool(page, /^Browser$/)
        await expect(page.getByTestId('workspace-web-preview-panel')).toBeVisible()
      })
      // Dialogs moved onto the ui Dialog (feat/ui-dialogs-1.1). Each is opened, scanned and closed.
      const dialogScan = async (name: string, open: () => Promise<void>, dialog: () => ReturnType<Page['getByRole']>): Promise<void> => {
        await reach(`${theme}/dialog-${name}`, found, page, async () => {
          await open()
          await expect(dialog()).toBeVisible()
        })
        await page.keyboard.press('Escape')
        await expect(dialog()).toHaveCount(0, { timeout: 5_000 }).catch(() => undefined)
      }
      await dialogScan('team', () => page.getByRole('button', { name: 'Team', exact: true }).click(), () => page.getByRole('dialog', { name: 'Team', exact: true }))
      await dialogScan('delegated-work', () => page.getByRole('button', { name: 'Delegated work', exact: true }).click(), () => page.getByRole('dialog', { name: 'Delegated work', exact: true }))
      await dialogScan('worktree-removal', async () => {
        await openTool(page, /^Worktrees$/)
        await page.getByRole('button', { name: /^Remove worktree / }).first().click()
      }, () => page.getByRole('dialog').filter({ hasText: /Remove/ }).first())
      await reach(`${theme}/settings`, found, page, async () => {
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await expect(page.locator('.settings-center')).toBeVisible()
      })
      // Every page of the settings center, in each scope. Three things made the earlier loop time out on five
      // entries, and none of them was the app:
      //  - `.settings-center-nav button` also matches the scope buttons, "Back to work" and a compact copy of the
      //    category list (`.settings-compact-category`) that is `display: none` at this width, so clicking those
      //    entries waited for a visibility that never came;
      //  - the scope buttons rewrite the list of pages, so positions read before a scope change pointed at
      //    other entries, or past the end;
      //  - "Back to work" leaves the settings center.
      // So only the visible "Settings categories" navigation is used, and it is read again after each scope change.
      const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      for (const scope of ['application', 'workspace'] as const) {
        const scopeButton = scope === 'application'
          ? page.locator('.settings-scope-choices button').first()
          : page.locator('.settings-scope-choices button', { hasText: 'Current workspace' })
        await reach(`${theme}/settings-scope-${scope}`, found, page, async () => {
          await scopeButton.click()
          await expect(scopeButton).toHaveAttribute('aria-pressed', 'true')
        })
        // A scope that did not switch would label the previous scope's pages with the wrong name.
        if ((await scopeButton.getAttribute('aria-pressed').catch(() => null)) !== 'true') continue
        const categories = page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button')
        const count = Math.min(await categories.count().catch(() => 0), 12)
        for (let index = 0; index < count; index++) {
          const label = (await categories.nth(index).locator('span').first().innerText().catch(() => `page ${index}`)).trim()
          await reach(`${theme}/settings-${scope}-${slug(label)}`, found, page, async () => {
            await categories.nth(index).click()
            await page.waitForTimeout(250)
          })
        }
      }
      await dialogScan('agent-config', async () => {
        // The mock lists no agents, so the configuration opens for a new custom agent (General page).
        await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /General/ }).first().click()
        await page.getByTestId('btn-new-custom-agent').click()
      }, () => page.getByRole('dialog').last())
      await page.getByRole('button', { name: 'Close settings', exact: true }).click().catch(() => undefined)
      await reach(`${theme}/oxequery`, found, page, async () => {
        await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
        await expect(page.locator('.oq-view')).toBeVisible({ timeout: 15_000 })
      })
      await reach(`${theme}/oxequery-containers`, found, page, async () => {
        await page.getByRole('button', { name: 'All containers' }).click()
        await expect(page.locator('.oq-containers')).toBeVisible()
      })
      await reach(`${theme}/oxequery-connection-dialog`, found, page, async () => {
        await page.getByRole('button', { name: 'New connection' }).first().click()
        await expect(page.getByRole('dialog')).toBeVisible()
      })
      // The mock answers a test through an SSH tunnel with an unknown host key.
      await reach(`${theme}/dialog-ssh-host-key`, found, page, async () => {
        const connection = page.getByRole('dialog', { name: 'New connection' })
        await connection.getByLabel('Name').fill('Behind bastion')
        await connection.getByLabel('Host', { exact: true }).fill('db.private')
        await connection.getByRole('button', { name: /SSH tunnel/ }).click()
        await connection.getByRole('checkbox', { name: /Connect through an SSH server/ }).check()
        await connection.getByLabel('SSH host').fill('bastion.example.com')
        await connection.getByLabel('SSH user').fill('deploy')
        await connection.getByRole('button', { name: 'Choose file…' }).click()
        await expect(connection.getByText('sshKey.pem')).toBeVisible()
        await connection.getByRole('button', { name: 'Test connection' }).click()
        await expect(page.getByRole('dialog', { name: 'Trust this SSH host key?' })).toBeVisible()
      })
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    } finally {
      await app.close()
    }
    if (STRICT) expect(found, JSON.stringify(found.map(v => `${v.surface} ${v.rule}`))).toEqual([])
  })

  test(`a11y: Thread states — ${theme}`, async () => {
    test.setTimeout(180_000)
    const found: Violation[] = []
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
    try {
      await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'verbose'))
      await page.reload()
      await page.waitForLoadState('load')
      await resizeWindow(app, 1280, 800)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, THREAD_SURFACES[0])
      for (const state of THREAD_SURFACES) {
        await setThreadState(app, workspaceRoot, state)
        await expect(page.locator('.thread-view')).toContainText(THREAD_STATES[state].title.split(' ')[0])
        await record(await scanSurface(page, `${theme}/thread-${state}`), found)
      }
      // Thread dialogs on the ui Dialog. Each is opened, scanned and closed; one that cannot be opened in the
      // scripted state is recorded as 'scan-not-reached', not as clean.
      const dialogScan = async (name: string, open: () => Promise<void>, dialog: () => ReturnType<Page['getByRole']>): Promise<void> => {
        await reach(`${theme}/dialog-${name}`, found, page, async () => {
          await open()
          await expect(dialog()).toBeVisible()
        })
        await page.keyboard.press('Escape')
        await expect(dialog()).toHaveCount(0, { timeout: 5_000 }).catch(() => undefined)
      }
      page.setDefaultTimeout(10_000)
      await dialogScan('thread-new', () => page.getByRole('button', { name: /^New thread/ }).first().click(), () => page.getByRole('dialog', { name: 'New thread' }))
      await dialogScan('thread-new-worktree', async () => {
        await page.getByRole('button', { name: /^New thread/ }).first().click()
        await page.getByRole('dialog', { name: 'New thread' }).getByRole('checkbox', { name: 'Create in a new worktree' }).check()
      }, () => page.getByRole('dialog', { name: 'New thread' }))
      // Row actions show on hover; the row is hovered first, as a person would.
      const rowMenu = async (item: string): Promise<void> => {
        const row = page.locator('.thread-navigation-row').first()
        await row.hover()
        await row.locator('button[aria-label^="Actions for "]').click()
        await page.getByRole('menuitem', { name: item }).click()
      }
      await dialogScan('thread-rename', () => rowMenu('Rename conversation…'), () => page.getByRole('dialog').first())
      await dialogScan('thread-project-settings', async () => {
        const actions = page.locator('button[data-project-actions]').first()
        await actions.locator('xpath=..').hover()
        await actions.click()
        await page.getByRole('menuitem', { name: 'Project settings' }).click()
      }, () => page.getByRole('dialog', { name: /^Thread project/ }))
      await dialogScan('thread-accounts', () => page.getByRole('button', { name: 'Agent accounts', exact: true }).click(), () => page.getByRole('dialog', { name: 'Agent accounts' }))
      // Command confirmations come from the real command router; Escape cancels them, so nothing is archived.
      // The fixtures stand in for the main process, so the confirmations are opened from the row menu (the
      // same dialogs /archive and /delete raise).
      await dialogScan('thread-confirm-archive', () => rowMenu('Archive conversation'), () => page.getByRole('dialog', { name: /^Archive/ }))
      await dialogScan('thread-confirm-delete', () => rowMenu('Delete conversation'), () => page.getByRole('dialog', { name: /^Delete/ }))
      await dialogScan('delegation-create', async () => {
        await page.getByRole('button', { name: 'More actions' }).first().click()
        await page.getByRole('menuitem', { name: 'Delegate work' }).click()
      }, () => page.getByRole('dialog', { name: 'Delegate work' }))
      await dialogScan('thread-confirm-full-access', async () => {
        await page.getByRole('button', { name: 'Permissions', exact: true }).click()
        await page.locator('.thread-config-popover').getByRole('button', { name: /Full access/ }).click()
      }, () => page.getByRole('dialog', { name: 'Allow expanded access?' }))
    } finally {
      await app.close()
    }
    if (STRICT) expect(found, JSON.stringify(found.map(v => `${v.surface} ${v.rule}`))).toEqual([])
  })
}
