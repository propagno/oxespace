import { modeButton, type AppMode } from './helpers/modes'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, type LaunchedApp } from './helpers/launch'

/**
 * Every entry point the app offers works or is gone (docs/validation/offer-audit-1.4.md).
 *
 * The palette and the application menu are walked from their registries, not from a hand-kept list: a
 * command or menu item without an expected effect below fails this spec, so nothing new ships untested.
 */

type Check = (page: Page) => Promise<void>

const dialog = (name: string | RegExp): Check => async page => { await expect(page.getByRole('dialog', { name }).first()).toBeVisible() }
const testId = (id: string): Check => async page => { await expect(page.getByTestId(id).first()).toBeVisible() }
// The mode's id, not a role or its name: a modal hides the rest of the page from the accessibility tree.
const view = (shell: AppMode): Check => async page => {
  await expect(modeButton(page, shell)).toHaveAttribute('aria-pressed', 'true')
}
const both = (...checks: Check[]): Check => async page => { for (const check of checks) await check(page) }
const toast = (title: string | RegExp): Check => async page => { await expect(page.locator('[data-toast], [role="status"], [role="alert"]').filter({ hasText: title }).first()).toBeVisible() }
const settingsPage = (label: string): Check => both(dialog('Settings'), async page => {
  await expect(page.locator('.settings-center nav[aria-label="Settings categories"] [aria-current="page"]')).toContainText(label)
})
const rootData = (key: 'mode' | 'density', value: string): Check => async page => {
  await expect.poll(() => page.evaluate(name => document.documentElement.dataset[name], key)).toBe(value)
}
const paneCount = (page: Page): Promise<number> => page.locator('[data-testid="pane-container"]:visible').count()
/** Runs twice: the first run changes something, the second puts it back. */
const SELF_RESTORING = new Set(['toggle-sidebar', 'toggle-split-layout', 'maximize-pane'])

const SETTINGS_LABELS: Record<string, string> = {
  general: 'General', providers: 'Agents', appearance: 'Appearance', terminal: 'Terminal', keyboard: 'Keyboard', voice: 'Voice',
  notifications: 'Notifications', updates: 'Updates', policy: 'Policy', devices: 'Devices', diagnostics: 'Diagnostics'
}

/** What each palette command visibly does. Exact ids first, then id prefixes. */
const PALETTE_EFFECTS: Record<string, Check> = {
  'oxequery.open': view('data'),
  'oxequery.newConnection': both(view('data'), dialog('New connection')),
  'oxequery.newQuery': both(view('data'), toast('Nothing to do here yet')),
  'oxequery.runAll': both(view('data'), toast('Nothing to do here yet')),
  'oxequery.searchObjects': both(view('data'), toast('Nothing to do here yet')),
  'oxequery.newTable': both(view('data'), toast('Nothing to do here yet')),
  'oxequery.exportConnections': both(view('data'), toast('Nothing to do here yet')),
  'oxequery.settings': both(view('data'), dialog('OxeQuery settings')),
  'oxequery.newDatabase': both(view('data'), dialog('New database')),
  'oxequery.activity': both(view('data'), async page => { await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true') }),
  'oxepod.open': view('pods'),
  'oxepod.filter': both(view('pods'), async page => { await expect(page.getByRole('searchbox', { name: 'Filter containers' })).toBeFocused() }),
  'oxepod.resources': both(view('pods'), async page => { await expect(page.getByRole('region', { name: 'Images, volumes and networks' })).toBeVisible() }),
  'oxepod.activity': both(view('pods'), async page => { await expect(page.locator('.pod-host').getByRole('region', { name: 'Agent activity' })).toBeVisible() }),
  'oxepod.pruneContainers': both(view('pods'), dialog('Remove every stopped container?')),
  'oxepost.open': view('post'),
  'oxepost.newRequest': both(view('post'), async page => { await expect(page.getByRole('textbox', { name: 'Request name' })).toHaveValue('New request') }),
  'oxepost.filter': both(view('post'), async page => { await expect(page.getByRole('searchbox', { name: 'Filter requests' })).toBeFocused() }),
  'oxepost.import': both(view('post'), dialog('Import requests')),
  'oxepost.environments': both(view('post'), dialog('Environments')),
  // Kept-ready workspaces is a General preference, shown once.
  'settings.general': both(settingsPage('General'), async page => { await expect(page.getByLabel('Recently visited workspaces kept ready')).toBeVisible() }),
  'settings.notifications': both(settingsPage('Notifications'), async page => { await expect(page.getByLabel('Number of workspaces to keep mounted')).toHaveCount(0) }),
  'help.shortcuts': dialog('Keyboard shortcuts'),
  // F18: the approval history; it opens even with no decision yet, and says so.
  'help.approvals': both(dialog('Approval decisions'), testId('approval-history')),
  'help.report-problem': both(dialog('Report a problem'), testId('report-problem')),
  'help.about': both(dialog('About OXESpace'), testId('about-dialog')),
  'activity.open': testId('activity-center'),
  'activity.markAllRead': toast(/Nothing to mark as read|All activity marked as read/),
  'new-workspace': dialog('Create new workspace'),
  'workspace-settings': both(view('code'), dialog('Settings'), async page => {
    await expect(page.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: /Current workspace/ })).toHaveAttribute('aria-pressed', 'true')
  }),
  'toggle-sidebar': async page => { await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/) },
  'tool-team': dialog('Team'),
  'tool-integration': both(view('code'), testId('workspace-integration-panel')),
  'tool-github': both(view('code'), testId('workspace-github-panel')),
  'tool-worktrees': both(view('code'), testId('workspace-worktree-panel')),
  'tool-scripts': both(view('code'), testId('workspace-scripts-panel')),
  'tool-search': both(view('code'), testId('workspace-search-panel')),
  'tool-web-preview': both(view('code'), testId('workspace-web-preview-panel')),
  'tool-background': both(view('code'), testId('workspace-background-panel')),
  'tool-editor': both(view('code'), testId('workspace-editor-panel')),
  'tool-review': both(view('code'), testId('workspace-review-panel')),
  'tool-slash': both(view('code'), dialog(/^Commands for/)),
  'tool-mcp': dialog('MCP servers'),
  'tool-skills': dialog('Skills'),
  'tool-semantic': dialog('Semantic activity'),
  'open-usage': both(dialog('Usage & rate limits'), testId('usage-modal')),
  'open-linear': both(dialog('Linear issues'), testId('linear-panel')),
  'design-system': dialog('Design system'),
  'toggle-split-layout': async page => { await expect(page.getByTestId('workspace-grid')).toBeVisible() },
  'maximize-pane': async page => { expect(await paneCount(page)).toBe(1) },
  // Equal sizes are already balanced; the command must at least keep every pane.
  'balance-pane-layout': async page => { expect(await paneCount(page)).toBeGreaterThan(0) },
  // The E2E mock never keeps a terminal session, so these can only prove they do not throw.
  // Splits add one pane; the loop compares the count before and after.
  'split-vertical': view('code'),
  'split-horizontal': view('code'),
  'restart-terminal': view('code'),
  'toggle-oxevoice': async () => undefined,
  'thread.new': both(view('thread'), dialog('Add project')),
  'thread.add-project': both(view('thread'), dialog('Add project'))
}
const PREFIX_EFFECTS: Array<[string, (id: string) => Check]> = [
  ['settings.', id => settingsPage(SETTINGS_LABELS[id.slice('settings.'.length)] ?? '?')],
  ['appearance-', id => id === 'appearance-system' ? async () => undefined : rootData('mode', id.slice('appearance-'.length))],
  // density-default resolves to the app-wide density, compact unless Settings › Appearance says otherwise.
  ['density-', id => both(view('code'), rootData('density', id === 'density-default' ? 'compact' : id.slice('density-'.length)))],
  ['layout-', id => async page => { await expect.poll(() => paneCount(page)).toBe(Number(id.slice('layout-'.length))) }]
]
/** Commands that hand off to the operating system (a native file dialog), proven by their target control instead. */
const NATIVE_DIALOG = new Set(['oxequery.importConnections'])

function effectFor(id: string): Check | undefined {
  return PALETTE_EFFECTS[id] ?? PREFIX_EFFECTS.find(([prefix]) => id.startsWith(prefix))?.[1](id)
}

const paletteInput = (page: Page): Locator => page.getByPlaceholder('Search files and commands…')

async function openPalette(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3 && !(await paletteInput(page).isVisible()); attempt++) {
    // The Code sidebar has a button; the other views use the shortcut.
    const button = page.getByRole('button', { name: 'Files & commands' }).first()
    if (await button.isVisible()) await button.click()
    else { await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press('Control+k') }
    await paletteInput(page).waitFor({ timeout: 2_000 }).catch(() => undefined)
  }
  await expect(paletteInput(page)).toBeVisible()
}

async function listedCommandIds(page: Page): Promise<string[]> {
  await openPalette(page)
  const ids = await page.locator('[cmdk-item][data-value^="cmd-"]').evaluateAll(items => items.map(item => item.getAttribute('data-value')!.slice(4)))
  await page.keyboard.press('Escape')
  return ids
}

async function runCommand(page: Page, id: string): Promise<boolean> {
  await openPalette(page)
  const item = page.locator(`[cmdk-item][data-value="cmd-${id}"]`)
  if (!(await item.count())) { await page.keyboard.press('Escape'); return false }
  await item.click()
  return true
}

/** Closes whatever a command opened, back to the work surface. */
async function dismiss(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const open = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [role="menu"]:visible')
    if (!(await open.count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function selectView(page: Page, mode: AppMode): Promise<void> {
  await modeButton(page, mode).click()
  // F7.2: the current view stays until the next one is in; wait for the switch to land before using the new view.
  await expect(modeButton(page, mode)).toHaveAttribute('aria-pressed', 'true')
  await expect(modeButton(page, mode)).not.toHaveAttribute('aria-busy', 'true')
}

async function launchWithWorkspace(): Promise<LaunchedApp> {
  const launched = await launchApp()
  const { page, workspaceRoot } = launched
  await page.evaluate(root => window.oxe.workspace.create({ rootPath: root, layoutPreset: 2, autoStart: false }), workspaceRoot)
  await page.reload()
  await page.waitForLoadState('load')
  await page.getByTestId('btn-new-workspace').first().waitFor()
  await expect(page.locator('[data-testid="pane-container"]').first()).toBeVisible()
  return launched
}

const pageErrors = (launched: LaunchedApp): string[] => launched.consoleErrors.filter(line => line.startsWith('pageerror:'))

test.describe('offer audit', () => {
  test.describe.configure({ timeout: 300_000 })

  test('every palette command has an expected effect and shows it', async () => {
    const launched = await launchWithWorkspace()
    const { app, page } = launched
    try {
      // OxeQuery's and OxePod's commands register after first paint.
      await expect.poll(async () => { const ids = await listedCommandIds(page); return ids.some(id => id.startsWith('oxequery.')) && ids.some(id => id.startsWith('oxepod.')) && ids.some(id => id.startsWith('oxepost.')) }).toBe(true)
      const ids = await listedCommandIds(page)
      const untested = ids.filter(id => !effectFor(id) && !NATIVE_DIALOG.has(id))
      expect(untested, 'palette commands without an expected effect in e2e/offer-audit.spec.ts').toEqual([])

      const failures: string[] = []
      for (const id of ids) {
        if (NATIVE_DIALOG.has(id)) continue
        await dismiss(page)
        const errorsBefore = pageErrors(launched).length
        const panesBefore = await paneCount(page)
        // A command that needs Code's workspace is offered there; come back to Code when the last command left it.
        if (!(await runCommand(page, id))) {
          await selectView(page, 'code')
          if (!(await runCommand(page, id))) { failures.push(`${id}: not offered in OxeCode`); continue }
        }
        try {
          if (id === 'split-vertical' || id === 'split-horizontal') await expect.poll(() => paneCount(page)).toBe(panesBefore + 1)
          else await effectFor(id)!(page)
        } catch (error) {
          failures.push(`${id}: ${(error as Error).message.split('\n')[0]}`)
        }
        const errors = pageErrors(launched).slice(errorsBefore)
        if (errors.length) failures.push(`${id}: page error ${errors[0]}`)
        if (SELF_RESTORING.has(id)) { await dismiss(page); await runCommand(page, id) }
        if (id.startsWith('layout-') || id.startsWith('split-')) { await dismiss(page); await runCommand(page, 'layout-2') }
      }
      expect(failures).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })

  test('every Thread command reaches the open conversation', async () => {
    const launched = await launchApp()
    const { app, page, workspaceRoot } = launched
    try {
      // A project with one finished conversation; the main process records the commands it receives.
      await app.evaluate(({ ipcMain, BrowserWindow }, rootPath) => {
        const received: string[] = []
        ;(globalThis as { offerAuditCommands?: string[] }).offerAuditCommands = received
        const thread = { id: 'session-1', workspaceId: 'thread:offer', projectId: 'offer', rootPath, provider: 'codex', nativeSessionId: null, title: 'Offer audit', status: 'idle', pinned: false, createdAt: Date.now(), updatedAt: Date.now() }
        const snapshot = { thread, events: [], turns: [{ id: 'turn-1', sequence: 1, status: 'completed', startedAt: Date.now(), completedAt: Date.now(), configuration: {} }] }
        for (const channel of ['list', 'read', 'command', 'commands', 'projects', 'models', 'turn-files']) ipcMain.removeHandler(`thread:${channel}`)
        ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'offer', displayName: 'offer-repo', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:offer', rootPath, label: 'offer-repo' }] }], unavailable: [] }))
        ipcMain.handle('thread:commands', () => ({ commands: [] }))
        ipcMain.handle('thread:models', () => ({ defaultModel: 'test-model', models: [{ id: 'test-model', label: 'Test model', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
        ipcMain.handle('thread:list', () => [thread])
        ipcMain.handle('thread:read', () => snapshot)
        ipcMain.handle('thread:turn-files', () => [])
        ipcMain.handle('thread:command', (_event, _id, command: string) => { received.push(command); return { kind: 'applied' } })
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: thread.id })
      }, workspaceRoot)
      await selectView(page, 'thread')
      await page.locator('.thread-navigation-item').filter({ hasText: 'Offer audit' }).click()
      const received = (): Promise<string[]> => app.evaluate(() => [...((globalThis as { offerAuditCommands?: string[] }).offerAuditCommands ?? [])])
      const sent = (text: string): Check => async () => { await expect.poll(received).toContain(text) }
      const THREAD_EFFECTS: Record<string, Check> = {
        'thread.new': both(view('thread'), dialog('New conversation')),
        'thread.add-project': both(view('thread'), dialog('Add project')),
        'thread.project.offer': both(view('thread'), async p => { await expect(p.locator('.thread-navigation-item[aria-current="page"]')).toContainText('Offer audit') }),
        'thread.resume': sent('/resume'), 'thread.rename': sent('/rename'), 'thread.spending': sent('/spending'),
        'thread.events': sent('/events'), 'thread.rules': sent('/rules'),
        'thread.undo-last-turn': toast('Nothing to undo'),
        'thread.accounts': dialog('Agent accounts')
      }
      await expect.poll(async () => (await listedCommandIds(page)).includes('thread.spending')).toBe(true)
      const ids = (await listedCommandIds(page)).filter(id => id.startsWith('thread.'))
      expect(ids.filter(id => !THREAD_EFFECTS[id]), 'Thread commands without an expected effect in e2e/offer-audit.spec.ts').toEqual([])
      const failures: string[] = []
      for (const id of ids) {
        await dismiss(page)
        const errorsBefore = pageErrors(launched).length
        if (!(await runCommand(page, id))) { failures.push(`${id}: not offered with a conversation open`); continue }
        await THREAD_EFFECTS[id](page).catch(error => failures.push(`${id}: ${(error as Error).message.split('\n')[0]}`))
        const errors = pageErrors(launched).slice(errorsBefore)
        if (errors.length) failures.push(`${id}: page error ${errors[0]}`)
      }
      expect(failures).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })

  test('a Code panel command run from Thread, OxeQuery or OxePod opens Code with the panel, and Ctrl+, opens Settings', async () => {
    const launched = await launchWithWorkspace()
    const { app, page } = launched
    try {
      for (const name of ['thread', 'data', 'pods'] as const) {
        await selectView(page, name)
        await runCommand(page, 'tool-editor')
        await view('code')(page)
        await testId('workspace-editor-panel')(page)
        // From another view, a second run must not close the panel left open in Code.
        await selectView(page, name)
        await runCommand(page, 'tool-editor')
        await testId('workspace-editor-panel')(page)
      }
      // Ctrl+, is "Open settings" in every menu, tooltip and the shortcut guide: it opens application Settings.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Control+,')
      await dialog('Settings')(page)
      await expect(page.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application' })).toHaveAttribute('aria-pressed', 'true')
      expect(pageErrors(launched)).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })

  test('every application menu item works', async () => {
    const launched = await launchWithWorkspace()
    const { app, page } = launched
    try {
      const trigger = page.getByRole('button', { name: 'Application menu' })
      /** Opens a submenu from its trigger: Radix names the submenu after the trigger's id. */
      const openSub = async (parent: Locator, name: string): Promise<Locator> => {
        const item = parent.getByRole('menuitem', { name, exact: true })
        await item.hover()
        await item.press('ArrowRight').catch(() => undefined)
        const sub = page.locator(`[role="menu"][aria-labelledby="${await item.getAttribute('id')}"]`)
        await expect(sub).toBeVisible()
        return sub
      }
      const openMenu = async (menu: string): Promise<Locator> => {
        await dismiss(page)
        await trigger.click()
        return openSub(page.locator('[role="menu"]').first(), menu)
      }
      /** What each item visibly does, by menu and label. Edit items run the browser's own editing commands. */
      const MENU_EFFECTS: Record<string, Check | 'native'> = {
        'File/New workspace…': dialog('Create new workspace'),
        'File/Settings': dialog('Settings'),
        'File/Workspace settings': dialog('Settings'),
        'File/Exit': 'native',
        'Edit/Undo': 'native', 'Edit/Redo': 'native', 'Edit/Cut': 'native', 'Edit/Copy': 'native', 'Edit/Paste': 'native', 'Edit/Select all': 'native',
        'View/Command palette…': async p => { await expect(paletteInput(p)).toBeVisible() },
        'View/OxeCode': view('code'), 'View/OxeChat': view('thread'), 'View/OxeQuery': view('data'), 'View/OxePod': view('pods'), 'View/OxePost': view('post'),
        'View/Toggle sidebar': async p => { await expect(p.locator('.app-shell')).toHaveClass(/sidebar-collapsed/) },
        'View/Files': testId('workspace-editor-panel'),
        'View/Commit & pull request': testId('workspace-github-panel'),
        'View/Background activity': testId('workspace-background-panel'),
        'View/Toggle split layout': testId('workspace-grid'),
        'View/Balance panes': async p => { expect(await paneCount(p)).toBeGreaterThan(0) },
        'View/Split pane right': async p => { expect(await paneCount(p)).toBe(3) },
        'View/Split pane down': async p => { expect(await paneCount(p)).toBe(3) },
        'View/Maximize / restore pane': async p => { expect(await paneCount(p)).toBe(1) },
        'Tools/MCP servers': dialog('MCP servers'),
        'Tools/Skills': dialog('Skills'),
        'Tools/Usage & limits': dialog('Usage & rate limits'),
        'Tools/Linear issues': dialog('Linear issues'),
        'Help/Keyboard shortcuts': dialog('Keyboard shortcuts'),
        'Help/Diagnostics': settingsPage('Diagnostics'),
        'Help/Report a problem…': dialog('Report a problem'),
        'Help/Check for updates…': settingsPage('Updates')
      }
      const SUBMENUS: Record<string, (label: string) => Check> = {
        Appearance: label => label === 'Follow system' ? async () => undefined : rootData('mode', label.toLowerCase()),
        // App default resolves to the app-wide density, compact unless Settings › Appearance says otherwise.
        Density: label => rootData('density', label === 'App default' ? 'compact' : label.toLowerCase()),
        Layout: label => async p => { await expect.poll(() => paneCount(p)).toBe(Number.parseInt(label, 10)) }
      }
      const failures: string[] = []
      for (const menu of ['File', 'Edit', 'View', 'Tools', 'Help']) {
        const sub = await openMenu(menu)
        const labels = (await sub.locator(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]').evaluateAll(items => items.map(item => {
          // The label without its key caps.
          const copy = item.cloneNode(true) as HTMLElement
          copy.querySelectorAll('kbd').forEach(kbd => kbd.remove())
          return copy.textContent?.trim() ?? ''
        })))
        await dismiss(page)
        for (const label of labels) {
          const errorsBefore = pageErrors(launched).length
          if (SUBMENUS[label]) {
            const children = await (await openSub(await openMenu(menu), label)).getByRole('menuitem').allTextContents()
            await dismiss(page)
            for (const child of children) {
              await (await openSub(await openMenu(menu), label)).getByRole('menuitem', { name: child, exact: true }).click()
              await SUBMENUS[label](child)(page).catch(error => failures.push(`${menu}/${label}/${child}: ${(error as Error).message.split('\n')[0]}`))
            }
            await runCommand(page, 'layout-2')
            continue
          }
          const key = label.startsWith('About OXESpace') ? 'Help/About' : `${menu}/${label}`
          const effect = key === 'Help/About' ? dialog('About OXESpace') : MENU_EFFECTS[key]
          if (!effect) { failures.push(`${key}: no expected effect in e2e/offer-audit.spec.ts`); continue }
          if (effect === 'native') continue
          const s = await openMenu(menu)
          const item = s.locator(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]').filter({ hasText: label }).first()
          if (await item.getAttribute('aria-disabled') === 'true') { failures.push(`${key}: disabled with a workspace open`); continue }
          await item.click()
          await effect(page).catch(error => failures.push(`${key}: ${(error as Error).message.split('\n')[0]}`))
          const errors = pageErrors(launched).slice(errorsBefore)
          if (errors.length) failures.push(`${key}: page error ${errors[0]}`)
          // Back to a known state: Code, two panes, sidebar shown, split layout on.
          await dismiss(page)
          if (label === 'Toggle sidebar' || label === 'Toggle split layout' || label.startsWith('Maximize')) await runCommand(page, label === 'Toggle sidebar' ? 'toggle-sidebar' : label.startsWith('Maximize') ? 'maximize-pane' : 'toggle-split-layout')
          if (label.startsWith('Split pane')) await runCommand(page, 'layout-2')
          if (await modeButton(page, 'code').getAttribute('aria-pressed') !== 'true') await selectView(page, 'code')
          await dismiss(page)
        }
      }
      expect(failures).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })

  test('workspace row menu: Move up/down are disabled at the ends, Rename and Workspace settings work', async () => {
    const launched = await launchWithWorkspace()
    const { app, page } = launched
    try {
      const row = page.getByTestId('sidebar-workspace-item').first()
      await row.locator('.ws-group-header').click({ button: 'right' })
      const menu = page.locator('.ws-group-context-menu')
      await expect(menu.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
      await expect(menu.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
      await menu.getByRole('menuitem', { name: 'Workspace settings' }).click()
      await dialog('Settings')(page)
      await dismiss(page)
      await row.locator('.ws-group-header').click({ button: 'right' })
      await menu.getByRole('menuitem', { name: 'Rename' }).click()
      await expect(page.getByRole('textbox', { name: /Rename workspace/ })).toBeFocused()
      await page.keyboard.press('Escape')
      expect(pageErrors(launched)).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })

  test('editor tab menu: right-click offers Move, Pin, Close other tabs and Close, and never discards a tab silently', async () => {
    const launched = await launchWithWorkspace()
    const { app, page, workspaceRoot } = launched
    try {
      for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) writeFileSync(join(workspaceRoot, name), `${name}
`)
      await runCommand(page, 'tool-editor')
      await testId('workspace-editor-panel')(page)
      for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) await page.locator('.editor-browser-file', { hasText: name }).click()
      const tabs = page.getByTestId('editor-tabs').locator('.editor-tab')
      await expect(tabs).toHaveCount(3)
      // A right-click used to close every other tab at once, without a menu.
      await tabs.filter({ hasText: 'beta.txt' }).click({ button: 'right' })
      const menu = page.getByTestId('editor-tab-menu')
      await expect(menu).toBeVisible()
      await expect(tabs).toHaveCount(3)
      await expect(menu.getByRole('menuitem').first()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      // Reordering without a drag (WCAG 2.5.7): the last tab moves left, and the first cannot.
      await tabs.filter({ hasText: 'gamma.txt' }).click({ button: 'right' })
      await menu.getByRole('menuitem', { name: 'Move left' }).click()
      await expect(tabs).toHaveText([/alpha/, /gamma/, /beta/])
      await tabs.filter({ hasText: 'alpha.txt' }).click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await tabs.filter({ hasText: 'alpha.txt' }).click({ button: 'right' })
      await menu.getByRole('menuitem', { name: 'Pin tab' }).click()
      await expect(tabs.filter({ hasText: 'alpha.txt' })).toHaveClass(/pinned/)
      await tabs.filter({ hasText: 'beta.txt' }).click({ button: 'right' })
      await menu.getByRole('menuitem', { name: 'Close other tabs' }).click()
      await expect(tabs).toHaveCount(2)
      await expect(tabs.filter({ hasText: 'gamma.txt' })).toHaveCount(0)
      await tabs.filter({ hasText: 'beta.txt' }).click({ button: 'right' })
      await menu.getByRole('menuitem', { name: 'Close tab' }).click()
      await expect(tabs).toHaveCount(1)
      expect(pageErrors(launched)).toEqual([])
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })
})
