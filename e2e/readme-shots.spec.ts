import { modeButton } from './helpers/modes'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { launchApp, resizeWindow, type Appearance } from './helpers/launch'
import { installThreadFixtures } from './helpers/thread-fixtures'

/**
 * Captures the README images from a small, believable demo project. Skipped unless
 * OXESPACE_README_SHOTS=1; run after `npm run build`. Writes docs/assets/screenshots/<surface>-<theme>.png.
 */
const OUT = join(process.cwd(), 'docs', 'assets', 'screenshots')
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const THEMES: Appearance[] = ['light', 'dark']

test.skip(!process.env.OXESPACE_README_SHOTS, 'README captures run on demand')

/** A short path keeps the status bar readable and keeps the user's profile out of the images. */
function demoParent(): string {
  const preferred = process.platform === 'win32' ? 'C:\\oxe-demo' : '/tmp/oxe-demo'
  try { mkdirSync(preferred, { recursive: true }); return preferred } catch { return join(tmpdir(), 'oxe-demo') }
}

function seedDemoRepo(repo: string): void {
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true })
  mkdirSync(join(repo, 'src', 'auth'), { recursive: true })
  mkdirSync(join(repo, 'test'), { recursive: true })
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Ana Souza', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana Souza', GIT_COMMITTER_EMAIL: 'ana@example.com' }
  let day = 1
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, env: { ...env, GIT_AUTHOR_DATE: `2026-10-0${day}T10:00:00Z`, GIT_COMMITTER_DATE: `2026-10-0${day}T10:00:00Z` }, stdio: 'ignore' }) }
  const commit = (message: string): void => { git('add', '.'); git('commit', '-qm', message); day++ }

  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'acme-web', version: '2.4.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n')
  writeFileSync(join(repo, 'README.md'), '# acme-web\n\nStorefront API and checkout.\n')
  commit('chore: project skeleton')
  writeFileSync(join(repo, 'src', 'auth', 'login.js'), LOGIN_BEFORE)
  commit('feat(auth): email and password sign-in')
  writeFileSync(join(repo, 'test', 'login.test.js'), LOGIN_TEST)
  commit('test(auth): sign-in happy path')

  git('checkout', '-qb', 'feat/login-rate-limit')
  writeFileSync(join(repo, 'src', 'auth', 'rate-limit.js'), RATE_LIMIT)
  writeFileSync(join(repo, 'src', 'auth', 'login.js'), LOGIN_AFTER)
  writeFileSync(join(repo, 'test', 'rate-limit.test.js'), RATE_LIMIT_TEST)
  commit('feat(auth): limit sign-in attempts per account and address')
}

/** Fails the run if the user's name or profile path reached the window. */
async function assertNoPersonalData(page: Page): Promise<void> {
  const name = userInfo().username
  const text = await page.evaluate(() => document.body.innerText)
  expect(text.includes(name) || text.includes('AppData'), `personal data on screen (${name})`).toBe(false)
}

async function shoot(page: Page, name: string, theme: Appearance): Promise<void> {
  await page.mouse.move(900, 880)
  await page.waitForTimeout(500)
  await assertNoPersonalData(page)
  await page.screenshot({ path: join(OUT, `${name}-${theme}.png`) })
}

/** Real output of real commands in the demo repo, as a shell session would print it. */
function terminalTranscripts(repo: string): string[] {
  const prompt = `PS ${repo}> `
  const run = (file: string, args: string[]): string => execFileSync(file, args, { cwd: repo, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1' }, shell: process.platform === 'win32' })
  const session = (command: string, output: string): string => `${prompt}${command}\n${output.trimEnd()}\n\n${prompt}`.replace(/\r?\n/g, '\r\n')
  return [
    session('git log --oneline --decorate --graph', run('git', ['log', '--oneline', '--decorate', '--graph', '--color=always', '--all'])),
    session('node --test', run('node', ['--test', '--test-reporter=spec']))
  ]
}

/** The E2E double has no shell: each pane replays one transcript and reports the branch. */
async function installTerminalDemo(app: ElectronApplication, transcripts: string[]): Promise<void> {
  await app.evaluate(({ ipcMain }, transcripts) => {
    const panes: string[] = []
    const replayFor = (paneId: string): string => {
      if (!panes.includes(paneId)) panes.push(paneId)
      return transcripts[panes.indexOf(paneId)] ?? ''
    }
    for (const channel of ['terminal:start', 'terminal:attach', 'terminal:status', 'git:get-branch', 'agent-account:read']) ipcMain.removeHandler(channel)
    ipcMain.handle('terminal:start', () => undefined)
    ipcMain.handle('terminal:attach', (_event, input: { paneId: string }) => ({ running: true, seq: 1, prologue: '', replay: replayFor(input.paneId), truncated: false, altScreen: false }))
    ipcMain.handle('terminal:status', () => ({ running: true, seq: 1, altScreen: false }))
    ipcMain.handle('git:get-branch', () => ({ branch: 'feat/login-rate-limit', detached: false, shortSha: null }))
    ipcMain.handle('agent-account:read', (_event, context: Record<string, unknown>) => ({ ...context, state: 'connected', method: 'subscription', planLabel: 'Pro', checkedAt: Date.now() }))
  }, transcripts)
}

async function installThreadDemo(app: ElectronApplication, rootPath: string): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, { now, rootPath }) => {
    const g = globalThis as Record<string, unknown>
    const changed = () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
    const minutes = (n: number) => now - n * 60_000
    const others = [
      { id: 'demo-2', title: 'Why is checkout slow on mobile?', provider: 'claude', updatedAt: minutes(42) },
      { id: 'demo-3', title: 'Migrate orders to the new schema', provider: 'codex', updatedAt: minutes(180) },
      { id: 'demo-4', title: 'Write release notes for 2.4', provider: 'claude', updatedAt: minutes(60 * 26) }
    ].map(t => ({ ...t, workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath, nativeSessionId: null, pinned: false, status: 'idle', createdAt: t.updatedAt }))
    ipcMain.removeHandler('thread:list')
    ipcMain.handle('thread:list', async () => {
      const read = (await (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers?.get('thread:read')?.({}, 'e2e-thread')) as { thread?: unknown } | null
      return read?.thread ? [read.thread, ...others] : others
    })
    ipcMain.removeHandler('thread:models')
    ipcMain.handle('thread:models', () => ({ defaultModel: 'gpt-5.5', models: [{ id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier model', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }] }))
    ipcMain.removeHandler('github:get-pull-request-status')
    ipcMain.handle('github:get-pull-request-status', () => ({
      number: 128, title: 'Limit sign-in attempts', state: 'OPEN', isDraft: false, url: 'https://github.com/acme/acme-web/pull/128', headRefName: 'feat/login-rate-limit', baseRefName: 'main',
      mergeable: 'MERGEABLE', reviewDecision: null, autoMerge: false,
      checks: [{ name: 'build', workflow: 'CI', state: 'success', url: null }, { name: 'test', workflow: 'CI', state: 'success', url: null }, { name: 'e2e', workflow: 'CI', state: 'pending', url: null }]
    }))
    ipcMain.removeHandler('git:get-status')
    ipcMain.handle('git:get-status', () => ({ branch: 'feat/login-rate-limit', ahead: 1, behind: 0, checkedAt: now, files: [] }))
    changed()
  }, { now: NOW - 5 * 60_000, rootPath })
}

const threadEvents = (): unknown[] => [
  { type: 'message', id: 'u1', role: 'user', text: 'Limit sign-in attempts: 5 per account and 20 per IP address every 15 minutes. Answer 429 with Retry-After, and add tests.' },
  { type: 'tool', id: 'r1', name: 'commandExecution', state: 'completed', detail: 'rg -n "signIn" src test', output: 'src/auth/login.js:4:export async function signIn(store, { email, password, ip }) {\ntest/login.test.js:5:  const result = await signIn(store, credentials)', exitCode: 0 },
  { type: 'tool', id: 'r2', name: 'commandExecution', state: 'completed', detail: 'cat src/auth/login.js', output: LOGIN_BEFORE, exitCode: 0 },
  { type: 'plan', id: 'plan', steps: [
    { label: 'Add a sliding-window limiter keyed by account and by address', status: 'completed' },
    { label: 'Check both keys before verifying the password', status: 'completed' },
    { label: 'Cover the limit, the reset and Retry-After with tests', status: 'completed' }
  ] },
  ...[['src/auth/rate-limit.js', 'add', 31, 0], ['src/auth/login.js', 'update', 9, 2], ['test/rate-limit.test.js', 'add', 28, 0]].map(([path, kind, additions, deletions], index) => ({
    type: 'tool', id: `file-${index}`, name: 'fileChange', state: 'completed', detail: path,
    files: [{ path, kind, state: 'completed', source: 'native-patch', artifactId: `artifact-${index}`, additions, deletions }]
  })),
  { type: 'tool', id: 't1', name: 'commandExecution', state: 'completed', detail: 'npm test', output: '✔ signs in with the right password\n✔ blocks the sixth attempt for an account\n✔ blocks an address after 20 attempts\n✔ sends Retry-After in seconds\nℹ tests 4\nℹ pass 4\nℹ fail 0', exitCode: 0 },
  { type: 'message', id: 'a1', role: 'assistant', text: 'Sign-in is now rate limited.\n\n- **`rate-limit.js`** keeps a sliding 15-minute window per key in memory.\n- **`signIn`** checks the account and the address *before* the password, so a blocked caller learns nothing about it.\n- A blocked call answers **429** with `Retry-After` in seconds.\n\nAll 4 tests pass. The limiter is per process: with more than one instance, move the counters to Redis.' },
  { type: 'completed', status: 'completed' }
]

for (const theme of THEMES) {
  test(`README captures — ${theme}`, async () => {
    test.setTimeout(240_000)
    mkdirSync(OUT, { recursive: true })
    const repo = join(demoParent(), 'acme-web')
    seedDemoRepo(repo)
    const { app, page } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1440, 900)
      await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'normal'))
      await installThreadFixtures(app, repo)
      await installTerminalDemo(app, terminalTranscripts(repo))

      // Code: two terminals and the review panel with a line comment.
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-layout-card-2').click()
      await page.getByTestId('wizard-launch-btn').click()
      await expect(page.getByTestId('terminal-pane')).toHaveCount(2)
      await page.waitForTimeout(3000)
      await togglePanel(page, 'Changes')
      const panel = page.getByTestId('changes-panel')
      await panel.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'login.js' }).click()
      await expect(panel.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(1000)
      await panel.locator('.monaco-diff-editor .modified .view-line', { hasText: 'isLimited' }).first().hover()
      await panel.locator('.oxe-diff-add-glyph').first().click()
      await panel.locator('.oxe-line-composer textarea').fill('Log blocked attempts so we can see abuse in the dashboard.')
      await panel.locator('.oxe-line-composer button.is-primary').click()
      await shoot(page, 'code-review', theme)

      // Connections catalog.
      await openConnections(page)
      await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible()
      await shoot(page, 'mcp-catalog', theme)
      await page.keyboard.press('Escape')

      // Thread: a finished task with its plan, edits, tests and the pull request's checks.
      const workspace = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
      await app.evaluate(({ ipcMain }, { workspaceId, rootPath }) => {
        ;(globalThis as Record<string, unknown>).e2eWorkspaceId = workspaceId
        ipcMain.removeHandler('thread:projects')
        ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'e2e-project', displayName: 'acme-web', identityLabel: rootPath, contexts: [{ workspaceId, rootPath, label: 'acme-web' }] }], unavailable: [] }))
      }, { workspaceId: workspace.id, rootPath: repo })
      await installThreadDemo(app, repo)
      await modeButton(page, 'thread').click()
      await page.getByRole('button', { name: /^New thread in/ }).first().click()
      await page.getByRole('button', { name: 'Create thread', exact: true }).click()
      await page.locator('.thread-timeline').waitFor()
      await app.evaluate((_context, payload) => {
        ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState(payload)
      }, { status: 'idle', title: 'Limit sign-in attempts', provider: 'codex', events: threadEvents() })
      await expect(page.locator('.thread-view')).toContainText('Sign-in is now rate limited')
      // The sidebar may have tried a demo row before the main thread existed; selecting it clears that.
      await page.locator('.thread-navigation-row', { hasText: 'Limit sign-in attempts' }).first().click()
      const close = page.getByRole('button', { name: 'Close workbench panel' })
      if (await close.isVisible()) await close.click()
      await page.locator('.thread-timeline').evaluate(node => { node.scrollTop = node.scrollHeight })
      await shoot(page, 'thread', theme)

      // OxeQuery: the demo PostgreSQL connection and a table.
      await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
      await connectFromContainer(page, 'pg-dev')
      await page.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
      await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
      await shoot(page, 'oxequery', theme)
    } finally {
      await app.close()
    }
  })
}

const LOGIN_BEFORE = `import { verifyPassword } from './password.js'
import { createSession } from './session.js'

export async function signIn(store, { email, password, ip }) {
  const user = await store.users.findByEmail(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { status: 401, error: 'Wrong email or password' }
  }
  return { status: 200, session: await createSession(store, user) }
}
`

const LOGIN_AFTER = `import { verifyPassword } from './password.js'
import { createSession } from './session.js'
import { isLimited, record } from './rate-limit.js'

export async function signIn(store, { email, password, ip }) {
  const keys = [\`account:\${email.toLowerCase()}\`, \`ip:\${ip}\`]
  const blocked = keys.map(isLimited).find(Boolean)
  if (blocked) return { status: 429, headers: { 'Retry-After': blocked.retryAfter } }
  keys.forEach(record)
  const user = await store.users.findByEmail(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { status: 401, error: 'Wrong email or password' }
  }
  return { status: 200, session: await createSession(store, user) }
}
`

const RATE_LIMIT = `const WINDOW_MS = 15 * 60 * 1000
const LIMITS = { account: 5, ip: 20 }
const attempts = new Map()

function recent(key, now) {
  const list = (attempts.get(key) ?? []).filter(at => now - at < WINDOW_MS)
  attempts.set(key, list)
  return list
}

export function record(key, now = Date.now()) {
  recent(key, now).push(now)
}

export function isLimited(key, now = Date.now()) {
  const list = recent(key, now)
  const limit = LIMITS[key.split(':')[0]]
  if (list.length < limit) return null
  return { retryAfter: Math.ceil((list[0] + WINDOW_MS - now) / 1000) }
}

export function resetForTests() {
  attempts.clear()
}
`

const LOGIN_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

test('signs in with the right password', () => {
  assert.equal(1 + 1, 2)
})
`

const RATE_LIMIT_TEST = `import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isLimited, record, resetForTests } from '../src/auth/rate-limit.js'
import { togglePanel, openConnections } from './helpers/panels'
import { connectFromContainer } from './helpers/oxepod'

beforeEach(resetForTests)

test('blocks the sixth attempt for an account', () => {
  for (let i = 0; i < 5; i++) record('account:ana@example.com', 0)
  assert.ok(isLimited('account:ana@example.com', 1000))
})

test('blocks an address after 20 attempts', () => {
  for (let i = 0; i < 20; i++) record('ip:203.0.113.7', 0)
  assert.ok(isLimited('ip:203.0.113.7', 1000))
})

test('sends Retry-After in seconds', () => {
  for (let i = 0; i < 5; i++) record('account:ana@example.com', 0)
  assert.equal(isLimited('account:ana@example.com', 60_000).retryAfter, 840)
})
`
