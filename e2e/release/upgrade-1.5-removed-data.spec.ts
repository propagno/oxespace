import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * A40 / HML-RM-4 (F2, R0b + FE-R0b) · A person on 1.4.3 who used OxePost, AI Memory and Automations installs 1.5.0
 * over it. Black box, on the installed app, over the DevTools port (the B13 fuse, see upgrade-over-1.3.3.spec.ts).
 * Like that spec it touches the installed app's real userData, so it runs only on a CI runner and only when
 * OXESPACE_UPGRADE_STEP is set; the install-over job installs between the steps.
 *
 *   seed-removed      after `OXESpace-1.4.3-x64.exe /S`: a workspace through the wizard; an OxePost request and an
 *                     environment with one secret through the app; one automation, created DISABLED (never runs an
 *                     agent); then, with the app closed, one AI Memory note in the database (1.4.3 writes notes only
 *                     from a running memory service, which a CI runner doesn't have). Hashes of the person's files.
 *   verify-removed    after the 1.5.0 candidate's installer over it: the band once, its dialog, the export file and
 *                     its content, no secret value anywhere, the secrets and request files byte-identical, Settings ›
 *                     Data, keyboard only, and the band dismissed.
 *   verify-relaunch   a second start: no band, the same single export file, the person's files still identical.
 *
 * Inputs (env): OXESPACE_UPGRADE_STEP, OXESPACE_UPGRADE_STATE, FROM_TAG (v1.4.3), OXESPACE_EXPECT_VERSION; optional
 * OXESPACE_INSTALL_DIR, OXESPACE_USER_DATA, OXESPACE_EXECUTABLE, OXESPACE_INSTALL_KIND (as upgrade-over-1.3.3).
 */
const STEP = process.env.OXESPACE_UPGRADE_STEP ?? ''
const STATE = process.env.OXESPACE_UPGRADE_STATE ?? ''
const KIND = (process.env.OXESPACE_INSTALL_KIND ?? (process.platform === 'win32' ? 'nsis' : 'deb')) as 'nsis' | 'deb' | 'appimage'
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
const ROAMING = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const CONFIG = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
const INSTALL_DIR = process.env.OXESPACE_INSTALL_DIR ?? (KIND === 'nsis' ? join(LOCAL, 'Programs', 'OXESpace') : '/opt/OXESpace')
const EXE = process.env.OXESPACE_EXECUTABLE ?? (KIND === 'nsis' ? join(INSTALL_DIR, 'OXESpace.exe') : join(INSTALL_DIR, 'oxespace'))
const LAUNCH_ARGS = KIND === 'appimage' ? ['--no-sandbox'] : []
const LAUNCH_ENV: Record<string, string> = KIND === 'appimage' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}
const FROM_VERSION = (process.env.FROM_TAG ?? 'v1.4.3').replace(/^v/, '')

/** Markers a person would recognise as theirs, searched in the export file. */
const MARK = {
  requestName: 'HML A40 list orders',
  requestUrl: 'https://example.invalid/hml-a40/orders',
  envName: 'HML A40 staging',
  secretName: 'HML_A40_TOKEN',
  // Never printed; only searched for. Unique so a hit can't be a coincidence.
  secretValue: 'hml-a40-secret-7d1f0c9e2b4a',
  automationName: 'HML A40 nightly summary',
  memoryText: 'HML A40 memory: the orders API pages with ?cursor=, not ?page='
}

const BAND_SAVED = { en: 'OXESpace 1.5 removed some features. Your data was saved.', pt: 'O OXESpace 1.5 removeu alguns recursos. Seus dados foram salvos.' }
const BAND_NOT_SAVED = 'Your data isn\'t saved yet'
const ROWS = [/OxePost\s*→\s*HTTP calls panel/, /AI Memory\s*→\s*CLAUDE\.md and AGENTS\.md/, /Automations\s*→\s*\/loop and scheduled routines/,
  /File editing\s*→\s*Open in editor/, /Skills manager\s*→\s*Read-only list, run with \//]

test.skip(STEP === '' || process.env.GITHUB_ACTIONS !== 'true', 'runs only inside the release upgrade job on a CI runner')

function userData(): string {
  if (process.env.OXESPACE_USER_DATA) return process.env.OXESPACE_USER_DATA
  const base = process.platform === 'win32' ? ROAMING : CONFIG
  for (const name of ['OXESpace', 'oxespace']) if (existsSync(join(base, name, 'oxespace.sqlite3'))) return join(base, name)
  return join(base, 'OXESpace')
}
const dbPath = () => join(userData(), 'oxespace.sqlite3')
const secretsPath = () => join(userData(), 'oxepost-secrets.json')
const exportsDir = () => join(userData(), 'exports')
const stateFile = () => join(STATE, 'seed-removed.json')
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
/** Every file under a folder, with its hash, keyed by its path relative to that folder. */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(dir)) return out
  const walk = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).replace(/\\/g, '/')] = sha256(p) } }
  walk(dir)
  return out
}
const exportFiles = () => existsSync(exportsDir()) ? readdirSync(exportsDir()).filter(f => /^1\.5-removed-.*\.json$/.test(f)) : []

interface Installed { proc: ChildProcess; browser: Browser }
async function openInstalled(): Promise<{ app: Installed; page: Page }> {
  const port = 9300 + Math.floor(Math.random() * 500)
  const proc = spawn(EXE, [...LAUNCH_ARGS, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { env: { ...process.env as Record<string, string>, ...LAUNCH_ENV, OXESPACE_DISABLE_SINGLE_INSTANCE: '1' }, stdio: 'ignore' })
  let spawnError: Error | undefined
  proc.once('error', e => { spawnError = e })
  let browser: Browser | undefined
  for (let i = 0; i < 90 && !browser && proc.exitCode === null && !spawnError; i++) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)
  }
  if (spawnError) throw new Error(`could not start ${EXE}: ${spawnError.message}`)
  if (!browser) throw new Error(`no DevTools endpoint on ${port} (exit ${proc.exitCode})`)
  let page: Page | null = null
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => !p.url().startsWith('devtools')) ?? null
    if (!page) await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!page) throw new Error('the installed app opened no window')
  await page.locator('[data-testid="btn-new-workspace"], [data-app-mode]').first().waitFor({ timeout: 60_000 })
  return { app: { proc, browser }, page }
}
async function close(app: Installed): Promise<void> {
  await app.browser.close().catch(() => undefined)
  if (app.proc.exitCode === null && app.proc.pid) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(app.proc.pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(app.proc.pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
  await new Promise(resolve => setTimeout(resolve, 1_500))
}
const versionOf = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { app: { version: string } } }).oxe.app.version)
/** The data-export state, as the renderer gets it (ids and booleans only). */
type ExportState = { file: string | null; exportedAt: string | null; shownNotice: boolean; upgrade: boolean; error: string | null; removed: Array<{ id: string; hadData: boolean; hadSettings: boolean }> }
const exportState = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { dataExport?: { state(): Promise<unknown> } } }).oxe.dataExport?.state() ?? null) as Promise<ExportState | null>
const band = (page: Page) => page.getByRole('status').filter({ hasText: /OXESpace 1\.5 (removed some features|removeu alguns recursos)/ })
const flush = (name: string, data: unknown) => { writeFileSync(join(STATE, `${name}.json`), JSON.stringify(data, null, 2)); console.log(`A40-${name.toUpperCase()}`, JSON.stringify(data)) }

test('A40 1.4.3 with removed-feature data: seed', async () => {
  test.skip(STEP !== 'seed-removed')
  test.setTimeout(300_000)
  mkdirSync(STATE, { recursive: true })
  const repo = join(STATE, 'repo-a40'); mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const seeded: Record<string, unknown> = { repo }
  const { app, page } = await openInstalled()
  try {
    seeded.installed = await versionOf(page)
    expect(seeded.installed, `the installed build is ${FROM_VERSION}`).toBe(FROM_VERSION)
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    // The job's G4 seed may have made a workspace already: find this one by its folder.
    const findId = () => page.evaluate(`window.oxe.workspace.list().then(l => (l.find(w => /repo-a40/i.test(w.rootPath)) || {}).id || null)`) as Promise<string | null>
    await expect.poll(findId, { timeout: 20_000, message: 'the workspace exists in 1.4.3' }).not.toBeNull()
    const workspaceId = (await findId()) as string
    // 1.4.3's own OxePost API, as its page calls it: a request, an environment with a secret, the secret's value.
    const post = (op: string, input: unknown) => page.evaluate(([o, i]) => (window as unknown as { oxe: { oxePost: { call(op: string, input: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> } } }).oxe.oxePost.call(o as string, i), [op, input] as const)
    const saved = await post('save', { workspaceId, request: { name: MARK.requestName, method: 'GET', url: MARK.requestUrl, headers: [{ name: 'Authorization', value: `Bearer {{${MARK.secretName}}}` }] } })
    expect(saved.ok, `OxePost saves the request: ${saved.error?.message ?? ''}`).toBe(true)
    const env = await post('envSave', { workspaceId, environment: { name: MARK.envName, production: false, variables: { base: 'https://example.invalid' }, secrets: [MARK.secretName] } })
    expect(env.ok, `OxePost saves the environment: ${env.error?.message ?? ''}`).toBe(true)
    const envId = (env.value as { id: string }).id
    const secret = await post('secretSet', { workspaceId, environment: envId, name: MARK.secretName, value: MARK.secretValue })
    // Linux runners may have no keyring: 1.4.3 then refuses secrets. Record it; the secret checks are skipped then.
    seeded.secretSet = secret.ok
    seeded.secretRefusal = secret.ok ? null : secret.error?.message ?? 'refused'
    // Disabled on purpose: this must never start an agent on the runner.
    const automation = await page.evaluate(([name, root]) => (window as unknown as { oxe: { automations: { create(i: unknown): Promise<{ id: string; enabled: boolean }> } } }).oxe.automations.create({
      name, prompt: 'Summarise yesterday\'s commits.', rootPath: root, agent: 'claude', schedule: { kind: 'daily', hour: 3, minute: 0 }, enabled: false
    }), [MARK.automationName, repo] as const)
    expect(automation.enabled, 'the seeded automation is disabled').toBe(false)
    seeded.automationId = automation.id
    // R15/R14: the person last worked in OxePost; 1.4.3 remembers the view and 1.5.0 must open OxeCode instead.
    await page.locator('button[data-app-mode="post"]').first().click({ timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(1_000)
    seeded.lastView = await page.locator('button[data-app-mode][aria-pressed="true"]').getAttribute('data-app-mode').catch(() => null)
    await page.waitForTimeout(3_000)
  } finally { await close(app) }
  // AI Memory: one note, as 1.4.3's own tables hold it.
  const db = new DatabaseSync(dbPath())
  try {
    seeded.dbVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    const now = Date.now()
    db.prepare('INSERT OR IGNORE INTO memory_projects (id, identity, settings_json) VALUES (?, ?, ?)').run('hml-a40', `path:${repo}`, '{"enabled":true,"automaticCapture":false,"automaticContext":false}')
    db.prepare('INSERT INTO memory_notes (project_id, path, title, text, origin_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('hml-a40', 'notes/orders-api.md', 'Orders API paging', MARK.memoryText, 'user', now, now)
  } finally { db.close() }
  seeded.userData = userData()
  seeded.secretsSha = existsSync(secretsPath()) ? sha256(secretsPath()) : null
  seeded.requestFiles = hashTree(join(repo, '.oxespace'))
  expect(Object.keys(seeded.requestFiles as object).length, 'OxePost wrote files under .oxespace').toBeGreaterThan(0)
  if (seeded.secretSet) expect(seeded.secretsSha, 'the secret is in oxepost-secrets.json').not.toBeNull()
  expect(exportFiles(), '1.4.3 writes no 1.5 export').toEqual([])
  flush('seed-removed', seeded)
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2))
})

type Seeded = { repo: string; userData: string; secretSet: boolean; secretsSha: string | null; requestFiles: Record<string, string>; automationId: string; dbVersion: number }

test('A40 install 1.5.0 over it: the band, the dialog and the export', async () => {
  test.skip(STEP !== 'verify-removed')
  test.setTimeout(300_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as Seeded
  const result: Record<string, unknown> = { fromDbVersion: seeded.dbVersion }
  const { app, page } = await openInstalled()
  try {
    result.version = await versionOf(page)
    result.openedIn = await page.locator('button[data-app-mode][aria-pressed="true"]').getAttribute('data-app-mode').catch(() => null)
    expect.soft(result.openedIn, `a remembered ${(seeded as { lastView?: string }).lastView ?? 'post'} view opens OxeCode`).toBe('code')
    expect.soft(await page.locator('button[data-app-mode]').evaluateAll(b => b.map(x => x.getAttribute('data-app-mode'))), 'three modes').toEqual(['code', 'thread', 'data'])
    if (process.env.OXESPACE_EXPECT_VERSION) expect.soft(result.version, 'the candidate is installed').toBe(process.env.OXESPACE_EXPECT_VERSION)
    // The export runs after the window shows: give it time, as a person would read the screen.
    await expect.poll(async () => (await exportState(page))?.file ?? (await exportState(page))?.error ?? null, { timeout: 60_000, message: 'the export ran' }).not.toBeNull()
    const state = await exportState(page)
    result.state = state && { ...state, file: state.file ? state.file.split(/[\\/]/).pop() : null }
    expect.soft(state?.upgrade, 'an upgrade from 1.4.3 is recognised').toBe(true)
    expect.soft(state?.error, 'the export succeeded').toBeNull()
    expect.soft(state?.shownNotice, 'the notice has not been dismissed yet').toBe(false)
    for (const id of ['oxepost', 'memory', 'automations']) expect.soft(state?.removed.some(r => r.id === id && r.hadData), `${id} is reported with data`).toBe(true)
    expect.soft(JSON.stringify(state), 'the renderer state carries no content').not.toContain(MARK.memoryText)

    // The band: one, under the title bar, announced politely, saying the data was saved.
    await expect.soft(band(page), 'one band').toHaveCount(1, { timeout: 15_000 })
    result.bandText = (await band(page).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    expect.soft(String(result.bandText), 'the band says the data was saved').toContain(BAND_SAVED.en)
    expect.soft(String(result.bandText), 'not the failure wording').not.toContain(BAND_NOT_SAVED)
    expect.soft(await band(page).first().getAttribute('aria-live').catch(() => null) ?? 'polite', 'announced politely').toBe('polite')
    expect.soft(await page.getByRole('dialog').count(), 'not a modal: no dialog on start').toBe(0)
    await page.screenshot({ path: join(STATE, 'a40-band.png') }).catch(() => undefined)
    // Without a band there is nothing to open: the dialog checks then fail fast instead of waiting out the test.
    const hasBand = (await band(page).count()) > 0
    result.hasBand = hasBand

    // Keyboard only: Tab reaches See what changed, Enter opens the dialog.
    let reached = false
    for (let i = 0; i < 40 && !reached && hasBand; i++) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(() => /See what changed/.test(document.activeElement?.textContent ?? ''))
    }
    expect.soft(reached, 'Tab reaches See what changed').toBe(true)
    if (reached) await page.keyboard.press('Enter'); else if (hasBand) await band(page).getByRole('button', { name: 'See what changed' }).click({ timeout: 5_000 }).catch(() => undefined)
    const dialog = page.getByRole('dialog', { name: 'What changed in 1.5' })
    await expect.soft(dialog, 'the dialog opens').toBeVisible({ timeout: hasBand ? 10_000 : 1_000 })
    const dialogText = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ')
    result.dialogText = dialogText.slice(0, 1500)
    for (const row of ROWS) expect.soft(dialogText, `row ${row}`).toMatch(row)
    const fileName = state?.file?.split(/[\\/]/).pop() ?? '(none)'
    expect.soft(dialogText, 'the footer names the export file').toContain(fileName)
    expect.soft(dialogText, 'the footer says secrets are not in the file').toMatch(/Secrets aren.t in the file/)
    expect.soft(dialogText, 'the footer says which workspaces').toMatch(/open workspaces/)
    expect.soft(await dialog.getByRole('button', { name: 'Show in folder' }).count(), 'Show in folder').toBe(1)
    expect.soft(await dialog.getByRole('button', { name: 'Open' }).count(), 'Open').toBe(1)
    await page.screenshot({ path: join(STATE, 'a40-dialog.png') }).catch(() => undefined)
    await page.keyboard.press('Escape')
    await expect.soft(dialog, 'Escape closes the dialog').toBeHidden({ timeout: 5_000 })
    result.focusAfterEscape = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName} ${a.getAttribute('role') ?? ''} ${(a.textContent ?? '').slice(0, 60)}` : null })
    expect.soft(String(result.focusAfterEscape), 'focus is back on the band, not lost to <body>').not.toMatch(/^BODY/)

    // Settings › Data: the section, saved, with Show in folder.
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: /^Data$/ }).first().click({ timeout: 10_000 }).catch(() => undefined)
    const settingsText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect.soft(settingsText, 'Settings › Data has Removed in 1.5').toContain('Removed in 1.5')
    expect.soft(settingsText, 'Export removed data').toContain('Export removed data')
    expect.soft(settingsText, 'it says when and where it was saved').toMatch(new RegExp(`Saved .*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await page.screenshot({ path: join(STATE, 'a40-settings-data.png') }).catch(() => undefined)
    await page.keyboard.press('Escape')

    // Dismiss: the band goes and the choice is kept.
    await band(page).getByRole('button', { name: 'Dismiss' }).click({ timeout: 10_000 }).catch(() => undefined)
    await expect.soft(band(page), 'Dismiss hides the band').toHaveCount(0, { timeout: 5_000 })
    await expect.poll(async () => (await exportState(page))?.shownNotice, { timeout: 10_000, message: 'the dismissal is remembered' }).toBe(true)
    result.automationsInUi = await page.getByText(MARK.automationName).count()
    expect.soft(result.automationsInUi, 'the removed automation is not shown anywhere').toBe(0)
  } finally { await close(app) }

  // The file itself: one, private to the person, holding their three kinds of data and no secret value.
  const files = exportFiles()
  result.exportFiles = files
  expect.soft(files.length, 'exactly one export file').toBe(1)
  if (files[0]) {
    const path = join(exportsDir(), files[0])
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    result.exportSections = Object.keys(parsed)
    result.exportBytes = raw.length
    expect.soft(raw, 'the OxePost request').toContain(MARK.requestUrl)
    expect.soft(raw, 'the request name').toContain(MARK.requestName)
    expect.soft(raw, 'the environment').toContain(MARK.envName)
    expect.soft(raw, 'the secret NAME').toContain(MARK.secretName)
    expect.soft(raw.includes(MARK.secretValue), 'no secret VALUE in the export').toBe(false)
    expect.soft(raw, 'the memory note').toContain(MARK.memoryText)
    expect.soft(raw, 'the automation').toContain(MARK.automationName)
    expect.soft(typeof parsed.secretsNote === 'string' && parsed.secretsNote.length > 0, 'secretsNote').toBe(true)
    if (process.platform !== 'win32') expect.soft((statSync(path).mode & 0o077).toString(8), 'not readable by others').toBe('0')
  }
  expect.soft(existsSync(exportsDir()) ? readdirSync(exportsDir()).filter(f => f.endsWith('.tmp')) : [], 'no temp file left').toEqual([])
  // Nothing of the person's was touched.
  if (seeded.secretsSha) expect.soft(existsSync(secretsPath()) ? sha256(secretsPath()) : null, 'oxepost-secrets.json byte-identical').toBe(seeded.secretsSha)
  expect.soft(hashTree(join(seeded.repo, '.oxespace')), 'the request files byte-identical').toEqual(seeded.requestFiles)
  // And a secret value is nowhere in userData outside the encrypted file (logs included).
  const leaks: string[] = []
  const scan = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); const st = statSync(p); if (st.isDirectory()) { if (!/Cache|GPUCache|Code Cache|blob_storage/.test(name)) scan(p) } else if (st.size < 20_000_000 && readFileSync(p).includes(MARK.secretValue)) leaks.push(relative(userData(), p)) } }
  scan(userData())
  result.secretValueFoundIn = leaks
  expect.soft(leaks, 'the secret value is in no plain file').toEqual([])
  flush('verify-removed', result)
})

test('A40 a second start of 1.5.0: no band, nothing new, nothing touched', async () => {
  test.skip(STEP !== 'verify-relaunch')
  test.setTimeout(180_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as Seeded
  const before = exportFiles()
  const result: Record<string, unknown> = { exportFilesBefore: before }
  const { app, page } = await openInstalled()
  try {
    await page.waitForTimeout(10_000)
    const state = await exportState(page)
    result.state = state && { ...state, file: state.file ? state.file.split(/[\\/]/).pop() : null }
    expect.soft(state?.shownNotice, 'still dismissed').toBe(true)
    expect.soft(state?.upgrade, 'still an upgrade (it sticks)').toBe(true)
    expect.soft(await band(page).count(), 'no band on the second start').toBe(0)
    await page.screenshot({ path: join(STATE, 'a40-relaunch.png') }).catch(() => undefined)
  } finally { await close(app) }
  expect.soft(exportFiles(), 'no second export file').toEqual(before)
  if (seeded.secretsSha) expect.soft(sha256(secretsPath()), 'oxepost-secrets.json still identical').toBe(seeded.secretsSha)
  expect.soft(hashTree(join(seeded.repo, '.oxespace')), 'the request files still identical').toEqual(seeded.requestFiles)
  flush('verify-relaunch', result)
})
