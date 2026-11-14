import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modeButton } from '../helpers/modes'
import { installThreadFixtures, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * Verification of three 1.5.0 user reports that #771 says it fixed (Jira OXE-11, OXE-13, OXE-14), on the PACKAGED app
 * built from main, in en and pt-BR, as a person drives it:
 *   - OXE-11: Edit › Select all with no field focused must not select the whole window; the item says it needs a field.
 *   - OXE-13: More actions › Show every tool call must show it is on (checked, announced as checked) and show the calls.
 *   - OXE-14: Details › Compact must say what changed (context before and after), and the context indicator must show
 *     the new value within 1 s of the Compact finishing, without waiting for another message.
 * The conversation runs against the Thread fixture's stand-in main (e2e/helpers/thread-fixtures.ts), as the session
 * panel spec does: no provider, no account. Its context report is what main's contextUsage() stores and announces.
 *
 * Runs only on a CI runner against OXESPACE_PACKAGED_EXECUTABLE (the hml-packaged-pass.yml test copy, inspect fuse on)
 * with a throwaway --user-data-dir. Live OXESPACE_* / AI_MEMORY_* variables never reach it.
 */
const EXE = process.env.OXESPACE_PACKAGED_EXECUTABLE ?? ''
test.skip(!EXE || process.env.GITHUB_ACTIONS !== 'true', 'runs only on a CI runner against the packaged app')

type Locale = 'en-US' | 'pt-BR'
type Catalog = Record<string, unknown>
const LOCALES: Locale[] = ['en-US', 'pt-BR']
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const BEFORE = { model: 'claude-x', usedTokens: 120_000, windowTokens: 200_000, percentage: 60, capturedAt: NOW, source: 'claude-control',
  categories: [{ name: 'Messages', tokens: 120_000, kind: 'used' }, { name: 'Free space', tokens: 80_000, kind: 'free' }] }
const AFTER_PERCENT = 12

/** The words on screen, from the app's own catalogs, so both languages are driven by what a person reads. */
function words(locale: Locale): (ns: 'common' | 'thread', key: string, vars?: Record<string, string | number>) => string {
  const dir = locale === 'en-US' ? 'en' : 'pt-BR'
  const catalogs: Record<string, Catalog> = {
    common: JSON.parse(readFileSync(join(process.cwd(), 'shared', 'locales', dir, 'common.json'), 'utf8')) as Catalog,
    thread: JSON.parse(readFileSync(join(process.cwd(), 'shared', 'locales', dir, 'thread.json'), 'utf8')) as Catalog
  }
  return (ns, key, vars = {}) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Catalog | undefined)?.[part], catalogs[ns])
    if (typeof value !== 'string') throw Error(`no ${ns}:${key} in ${locale}`)
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => String(vars[name] ?? `{{${name}}}`))
  }
}
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function cleanEnv(locale: Locale): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(OXESPACE_|AI_MEMORY_)/i.test(k))) as Record<string, string>
  return { ...env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_LOCALE: locale, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }
}

async function launch(locale: Locale, name: string): Promise<{ app: ElectronApplication; page: Page; root: string }> {
  const root = mkdtempSync(join(tmpdir(), `verify-${name}-${locale}-`))
  const env = cleanEnv(locale)
  env.CLAUDE_CONFIG_DIR = join(root, 'claude-config'); env.CODEX_HOME = join(root, 'codex-home')
  const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${join(root, 'user-data')}`], env })
  const page = await app.firstWindow()
  // Wide enough for the inline menu bar (File, Edit, View…), which shows from 1121 px.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setContentSize(1280, 800); w.center() })
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(800)
  return { app, page, root }
}

async function quit(app: ElectronApplication): Promise<void> {
  let pid: number | undefined
  try { pid = app.process().pid } catch { return }
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await Promise.race([app.close().catch(() => undefined), new Promise(r => setTimeout(r, 10_000))])
  if (pid) { try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
}

const shot = (page: Page, name: string): Promise<unknown> => page.screenshot({ path: test.info().outputPath(`${name}.png`) }).catch(() => undefined)

/**
 * A workspace on a fresh git repo and a conversation in it, through the real wizard and the real New conversation
 * dialog. The Thread fixture stands in for main; on top of it this conversation keeps turns, runs /compact as a turn
 * that the test finishes, and answers context-usage the way main's contextUsage() does (stores the report, announces it).
 */
async function openConversation(app: ElectronApplication, page: Page, root: string, w: ReturnType<typeof words>): Promise<void> {
  const repo = join(root, 'repo'); mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# Verify\n')
  execFileSync('git', ['-c', 'user.email=verify@example.invalid', '-c', 'user.name=verify', 'add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=verify@example.invalid', '-c', 'user.name=verify', 'commit', '-q', '-m', 'init'], { cwd: repo })
  await installThreadFixtures(app, repo)
  await app.evaluate(({ ipcMain, BrowserWindow }, { fixtureRoot, now, before, afterPercent }) => {
    const g = globalThis as Record<string, unknown>
    let snapshot: { thread: Record<string, unknown>; events: Array<Record<string, unknown>>; turns: Array<Record<string, unknown>> } | null = null
    let compacted = false
    const changed = (): void => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
    for (const channel of ['thread:create', 'thread:list', 'thread:read', 'thread:command', 'thread:context-usage']) ipcMain.removeHandler(channel)
    ipcMain.handle('thread:create', (_event, input: { provider: string }) => {
      snapshot = {
        thread: { id: 'e2e-thread', workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: fixtureRoot, provider: input.provider, nativeSessionId: null, title: 'Verify', pinned: false, status: 'idle', model: 'claude-x', contextReport: before, createdAt: now, updatedAt: now },
        events: [
          { type: 'message', id: 'u1', role: 'user', text: 'How should sessions be stored?' },
          { type: 'tool', id: 't1', name: 'Read', state: 'completed', detail: 'README.md' },
          { type: 'tool', id: 't2', name: 'Grep', state: 'completed', detail: 'session' },
          { type: 'message', id: 'a1', role: 'assistant', text: 'Use an HttpOnly cookie.' },
          { type: 'completed', status: 'completed' }
        ],
        turns: [{ id: 'u1', sequence: 1, status: 'completed', startedAt: now, completedAt: now + 1000, configuration: {} }]
      }
      changed(); return snapshot
    })
    ipcMain.handle('thread:list', () => snapshot ? [snapshot.thread] : [])
    ipcMain.handle('thread:read', () => snapshot)
    // /compact starts a turn whose message is /compact, as main does; the test finishes it (finishCompact).
    ipcMain.handle('thread:command', (_event, _id, text: string) => {
      if (snapshot && text.trim() === '/compact') {
        snapshot.events = [...snapshot.events, { type: 'message', id: 'turn-compact', role: 'user', text: '/compact' }]
        snapshot.turns = [...snapshot.turns, { id: 'turn-compact', sequence: 2, status: 'running', startedAt: Date.now(), configuration: {} }]
        snapshot.thread.status = 'running'
        changed()
      }
      return { kind: 'applied' }
    })
    // main's contextUsage(): while busy the stored report; idle, the provider's fresh one, stored and announced.
    ipcMain.handle('thread:context-usage', () => {
      if (!snapshot) return null
      if (compacted && snapshot.thread.status !== 'running') {
        const after = { ...before, usedTokens: before.windowTokens * afterPercent / 100, percentage: afterPercent, capturedAt: Date.now(), categories: [] }
        if ((snapshot.thread.contextReport as { percentage?: number } | undefined)?.percentage !== afterPercent) { snapshot.thread.contextReport = after; changed() }
        return after
      }
      return snapshot.thread.contextReport ?? null
    })
    g.finishCompact = () => {
      if (!snapshot) return
      compacted = true
      snapshot.turns = snapshot.turns.map(turn => turn.id === 'turn-compact' ? { ...turn, status: 'completed', completedAt: Date.now() } : turn)
      snapshot.events = [...snapshot.events, { type: 'completed', status: 'completed' }]
      snapshot.thread.status = 'idle'
      changed()
    }
  }, { fixtureRoot: repo, now: NOW - 5 * 60_000, before: BEFORE, afterPercent: AFTER_PERCENT })
  await page.getByTestId('btn-new-workspace').first().click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId('wizard-layout-card-1').click({ timeout: 3_000 }).catch(() => undefined)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 30_000 }).catch(() => page.waitForTimeout(3_000))
  await registerThreadProject(app, page, repo)
  await modeButton(page, 'thread').first().click()
  await page.getByRole('button', { name: w('thread', 'sidebar.newInNamed', { name: 'repo' }) }).first().click()
  await page.getByRole('button', { name: w('thread', 'dialogs.create'), exact: true }).click()
  await page.locator('.thread-timeline').waitFor({ timeout: 30_000 })
  await expect(page.locator('.thread-timeline')).toContainText('Use an HttpOnly cookie.')
}

const moreActions = (page: Page, w: ReturnType<typeof words>) => page.locator('.thread-heading').getByRole('button', { name: w('thread', 'header.moreActions'), exact: true })

for (const locale of LOCALES) {
  test.describe(`${locale}`, () => {
    test(`OXE-11 · Edit › Select all with no field focused selects nothing and says it needs a text field · ${locale}`, async () => {
      test.setTimeout(180_000)
      const w = words(locale)
      const { app, page } = await launch(locale, 'oxe-11')
      try {
        // Nothing focused: no field, editor or terminal has the focus, and nothing is selected.
        await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.getSelection()?.removeAllRanges() })
        expect(await page.evaluate(() => document.activeElement?.tagName ?? '')).not.toMatch(/^(INPUT|TEXTAREA)$/)
        // The inline menu bar (File, Edit…) shows from 1121 px; on a smaller screen (the Windows runner's is 1024×768)
        // Edit is a submenu of the Application menu button.
        const inlineEdit = page.locator('.app-menubar-inline').getByRole('button', { name: w('common', 'menu.edit'), exact: true })
        if (await inlineEdit.isVisible()) await inlineEdit.click()
        else {
          await page.getByRole('button', { name: w('common', 'nav.applicationMenu'), exact: true }).click()
          await page.getByRole('menuitem', { name: w('common', 'menu.edit'), exact: true }).click()
        }
        const item = page.getByRole('menuitem', { name: new RegExp(`^${escape(w('common', 'menu.selectAll'))}`) })
        await expect(item).toBeVisible()
        await shot(page, `oxe-11-${locale}-edit-menu`)
        const reason = w('common', 'menu.needsTextField')
        await expect.soft(item, 'Select all says it needs a text field (visible second line)').toContainText(reason)
        await expect.soft(item, 'Select all is announced as unavailable').toHaveAttribute('aria-disabled', 'true')
        // A person can still click it (aria-disabled keeps it reachable); Playwright would wait for it to be enabled.
        await item.click({ force: true })
        await page.waitForTimeout(500)
        await shot(page, `oxe-11-${locale}-after-select-all`)
        const selected = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length)
        expect(selected, 'Edit › Select all with no field focused selected text in the window').toBe(0)
        await expect.soft(page.getByText(reason, { exact: true }).last(), 'choosing it says the reason again').toBeVisible()
      } finally { await quit(app) }
    })

    test(`OXE-13 · Show every tool call shows that it is on · ${locale}`, async () => {
      test.setTimeout(240_000)
      const w = words(locale)
      const { app, page, root } = await launch(locale, 'oxe-13')
      try {
        await openConversation(app, page, root, w)
        const label = w('thread', 'moreActions.showEveryToolCall')
        const menu = page.getByRole('menu', { name: w('thread', 'header.moreActions') })
        const item = menu.locator('[role^="menuitem"]', { hasText: label })
        await moreActions(page, w).click()
        await expect(item).toBeVisible()
        const offState = await item.getAttribute('aria-checked')
        test.info().annotations.push({ type: 'before', description: `role=${await item.getAttribute('role')} aria-checked=${offState}` })
        await shot(page, `oxe-13-${locale}-menu-off`)
        await item.click()
        await expect(menu).toBeHidden()
        // The calls show: the turn's actions as their own group (Read README.md, Grep), the finished turn not folded.
        await expect.soft(page.locator('.thread-timeline').locator('.thread-activity-group, .thread-activity-single').first(), 'the tool calls show in the conversation').toBeVisible()
        await expect.soft(page.getByTestId('thread-turn-fold'), 'every tool call shows: no folded turn').toHaveCount(0)
        await shot(page, `oxe-13-${locale}-conversation-on`)
        // Opened again, the item shows it is on and is announced as checked.
        await moreActions(page, w).click()
        await expect(item).toBeVisible()
        await shot(page, `oxe-13-${locale}-menu-on`)
        const role = await item.getAttribute('role')
        const checked = await item.getAttribute('aria-checked')
        test.info().annotations.push({ type: 'after', description: `role=${role} aria-checked=${checked}` })
        expect(checked, `"${label}" reopened after turning it on: role=${role}, aria-checked=${checked}`).toBe('true')
        await page.keyboard.press('Escape')
      } finally { await quit(app) }
    })

    test(`OXE-14 · Compact says what changed and the context indicator shows the new value within 1 s · ${locale}`, async () => {
      test.setTimeout(240_000)
      const w = words(locale)
      const { app, page, root } = await launch(locale, 'oxe-14')
      try {
        await openConversation(app, page, root, w)
        const ring = page.locator('.thread-usage-ring')
        await expect(ring).toHaveAttribute('aria-label', new RegExp(`\\b${BEFORE.percentage}%`))
        await moreActions(page, w).click()
        await page.getByRole('menu', { name: w('thread', 'header.moreActions') }).locator('[role^="menuitem"]', { hasText: w('thread', 'moreActions.details') }).first().click()
        const panel = page.getByTestId('thread-session-panel')
        await expect(panel).toBeVisible()
        await panel.getByRole('button', { name: w('thread', 'sessionPanel.context.compact'), exact: true }).click()
        // The Compact turn runs…
        await expect(page.locator('.thread-stop')).toBeVisible({ timeout: 10_000 })
        await page.waitForTimeout(500)
        await shot(page, `oxe-14-${locale}-running`)
        // …and finishes.
        await app.evaluate(() => { (globalThis as unknown as Record<string, () => void>).finishCompact() })
        const finished = Date.now()
        const want = new RegExp(`\\b${AFTER_PERCENT}%`)
        let shownAfter = -1
        while (Date.now() - finished < 10_000) {
          if (want.test(await ring.getAttribute('aria-label') ?? '')) { shownAfter = Date.now() - finished; break }
          await page.waitForTimeout(50)
        }
        test.info().annotations.push({ type: 'indicator', description: shownAfter < 0 ? 'not updated within 10 s' : `updated ${shownAfter} ms after the Compact finished` })
        const message = w('thread', 'compactFeedback.done', { before: BEFORE.percentage, after: AFTER_PERCENT })
        await expect.soft(page.getByText(message, { exact: true }).first(), 'the end of the Compact says the context before and after').toBeVisible({ timeout: 5_000 })
        await shot(page, `oxe-14-${locale}-finished`)
        const label = await ring.getAttribute('aria-label')
        expect(shownAfter >= 0 && shownAfter <= 1_000, `context indicator shows ${AFTER_PERCENT}% within 1 s of the Compact finishing: ${shownAfter < 0 ? 'not within 10 s' : `after ${shownAfter} ms`}; label now "${label}"`).toBe(true)
      } finally { await quit(app) }
    })
  })
}
