import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * G4 (release gate 1.4.0) · Install over 1.3.3, then uninstall: the CHECKS of the job SRE runs on a clean Windows
 * runner. The job installs and uninstalls (silent NSIS); this spec checks each stage. It touches the installed app's
 * real userData (%APPDATA%), so it only runs on a GitHub Actions runner (GITHUB_ACTIONS=true), never on a person's
 * machine, and only when OXESPACE_UPGRADE_STEP is set (otherwise it is skipped, so smoke runs never pick it up).
 *
 * Steps, in the job's order (state between steps in OXESPACE_UPGRADE_STATE, a folder the job keeps):
 *   seed            after `OXESpace-1.3.3-x64.exe /S`: the installed 1.3.3 opens, a workspace is created through its
 *                   wizard, as a person would; the database is version 77.
 *   verify-upgrade  after main's installer `/S` over it: the installed build reports the expected version; Desktop and
 *                   Start Menu shortcuts point at it; it opens; the database is OXESPACE_EXPECT_DB_VERSION (88 today),
 *                   passes integrity_check and still holds the workspace; db-backups holds the verified v77 backup with
 *                   the same workspace; nothing reached a native dialog.
 *   verify-refuse   (G8, rollback runbook) after v1.3.3's installer `/S` over the candidate, before anything is
 *                   restored: 1.3.3 started on the upgraded database refuses it (a dialog, an error or an exit) and
 *                   leaves oxespace.sqlite3 byte-identical (SHA-256 before = after). What it showed is recorded.
 *   verify-rollback (G8) after the runbook's restore (quit; delete oxespace.sqlite3 and its -wal/-shm; copy the newest
 *                   db-backups/oxespace-v77-*.sqlite3 to oxespace.sqlite3): 1.3.3 opens it; user_version 77,
 *                   integrity_check ok, the seeded workspace there and open; no native dialog.
 *   verify-uninstall after `Uninstall OXESpace.exe /S`: the install folder and both shortcuts are gone; the person's data
 *                   (userData database and backups) is kept.
 *
 * Inputs (env): OXESPACE_UPGRADE_STEP, OXESPACE_UPGRADE_STATE, OXESPACE_EXPECT_VERSION (main's package version; 1.3.3 for verify-rollback),
 * OXESPACE_EXPECT_DB_VERSION (default 88); optional OXESPACE_INSTALL_DIR, OXESPACE_USER_DATA.
 * Linux (SRE's matrix, every step under xvfb-run): OXESPACE_INSTALL_KIND = nsis | deb | appimage (default nsis on
 * Windows, deb elsewhere) and OXESPACE_EXECUTABLE (deb: /opt/OXESpace/oxespace; appimage: the AppImage, run with
 * APPIMAGE_EXTRACT_AND_RUN=1 and --no-sandbox, since an extracted AppImage has no setuid chrome-sandbox). The shortcut
 * checks become, for deb: /usr/share/applications/oxespace.desktop, and chrome-sandbox owned by root with mode 4755
 * (the v0.7.0 bug); after `apt-get remove`, /opt/OXESpace and the .desktop entry are gone. AppImage has no install,
 * shortcut or uninstall step.
 */
const STEP = process.env.OXESPACE_UPGRADE_STEP ?? ''
const STATE = process.env.OXESPACE_UPGRADE_STATE ?? ''
const KIND = (process.env.OXESPACE_INSTALL_KIND ?? (process.platform === 'win32' ? 'nsis' : 'deb')) as 'nsis' | 'deb' | 'appimage'
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
const ROAMING = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const CONFIG = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
const INSTALL_DIR = process.env.OXESPACE_INSTALL_DIR ?? (KIND === 'nsis' ? join(LOCAL, 'Programs', 'OXESpace') : '/opt/OXESpace')
const EXE = process.env.OXESPACE_EXECUTABLE ?? (KIND === 'nsis' ? join(INSTALL_DIR, 'OXESpace.exe') : join(INSTALL_DIR, 'oxespace'))
/** What the installer puts where a person finds the app (Desktop and Start Menu; the deb's .desktop entry). */
const SHORTCUTS = KIND === 'nsis'
  ? [join(homedir(), 'Desktop', 'OXESpace.lnk'), join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'OXESpace.lnk')]
  : KIND === 'deb' ? ['/usr/share/applications/oxespace.desktop'] : []
const LAUNCH_ARGS = KIND === 'appimage' ? ['--no-sandbox'] : []
const LAUNCH_ENV: Record<string, string> = KIND === 'appimage' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}
const EXPECT_DB = Number(process.env.OXESPACE_EXPECT_DB_VERSION ?? '88')

test.skip(STEP === '' || process.env.GITHUB_ACTIONS !== 'true', 'runs only inside the release upgrade job on a CI runner')

/** The installed app's userData, as Electron names it (product name, then package name). */
function userData(): string {
  if (process.env.OXESPACE_USER_DATA) return process.env.OXESPACE_USER_DATA
  const base = process.platform === 'win32' ? ROAMING : CONFIG
  for (const name of ['OXESpace', 'oxespace']) if (existsSync(join(base, name, 'oxespace.sqlite3'))) return join(base, name)
  return join(base, 'OXESpace')
}
/** deb only: the setuid sandbox helper Chromium needs (missing setuid broke v0.7.0 on Linux). */
function chromeSandbox(): { path: string; uid: number; mode: string } | null {
  const path = join(INSTALL_DIR, 'chrome-sandbox')
  if (!existsSync(path)) return null
  const st = statSync(path)
  return { path, uid: st.uid, mode: (st.mode & 0o7777).toString(8) }
}
const dbPath = () => join(userData(), 'oxespace.sqlite3')
const read = <T>(file: string, fn: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(file, { readOnly: true }); try { return fn(db) } finally { db.close() } }
const version = (file: string) => read(file, db => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
const workspaceRoots = (file: string) => read(file, db => (db.prepare('SELECT root_path FROM workspaces').all() as Array<{ root_path: string }>).map(r => r.root_path))
const stateFile = () => join(STATE, 'seed.json')

/** Opens the installed app on its own userData (no test database), with native dialogs counted and held. */
async function openInstalled() {
  const app = await electron.launch({ executablePath: EXE, args: LAUNCH_ARGS, env: { ...process.env as Record<string, string>, ...LAUNCH_ENV, OXESPACE_DISABLE_SINGLE_INSTANCE: '1' } })
  await app.evaluate(({ dialog }) => {
    const g = globalThis as Record<string, unknown>; g.upNative = 0
    dialog.showMessageBox = (() => { g.upNative = (g.upNative as number) + 1; return new Promise(() => undefined) }) as typeof dialog.showMessageBox
    dialog.showMessageBoxSync = (() => { g.upNative = (g.upNative as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
    dialog.showErrorBox = (() => { g.upNative = (g.upNative as number) + 1 }) as typeof dialog.showErrorBox
  })
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 60_000 })
  return { app, page }
}
/**
 * Quits the installed app and releases Playwright's handle within 15 s: app.exit, then close, then the process tree.
 * A handle left open made the worker wait 5 min at teardown (run 41315768133) after every check had passed.
 */
async function close(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  const proc = app.process()
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 10_000))])
  if (proc.exitCode === null && proc.pid) { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ } }
  await new Promise(resolve => setTimeout(resolve, 1_000))
}

test('G4 install over 1.3.3: seed', async () => {
  test.skip(STEP !== 'seed')
  test.setTimeout(240_000)
  mkdirSync(STATE, { recursive: true })
  expect(existsSync(EXE), `1.3.3 is installed at ${EXE}`).toBe(true)
  const repo = join(STATE, 'repo-seeded'); mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const { app, page } = await openInstalled()
  let installed: string
  try {
    installed = await app.evaluate(({ app }) => app.getVersion())
    expect(installed, 'the installed build is 1.3.3').toBe('1.3.3')
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await expect.poll(() => page.evaluate('window.oxe.workspace.list().then(l => l.length)'), { timeout: 20_000, message: 'the workspace exists in 1.3.3' }).toBe(1)
    await page.waitForTimeout(3_000)
  } finally { await close(app) }
  const db = dbPath()
  expect(existsSync(db), `1.3.3 wrote its database at ${db}`).toBe(true)
  const seeded = { installed, userData: userData(), db, dbVersion: version(db), roots: workspaceRoots(db) }
  expect(seeded.dbVersion, '1.3.3 database version').toBe(77)
  expect(seeded.roots.some(r => r.toLowerCase().includes('repo-seeded')), 'the workspace is in the 1.3.3 database').toBe(true)
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2))
  console.log('G4-SEED', JSON.stringify(seeded))
})

test('G4 install over 1.3.3: verify the upgrade', async () => {
  test.skip(STEP !== 'verify-upgrade')
  test.setTimeout(240_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { userData: string; db: string; roots: string[] }
  const result: Record<string, unknown> = {}
  expect(existsSync(EXE), 'the new build is installed in the same folder').toBe(true)
  for (const lnk of SHORTCUTS) expect.soft(existsSync(lnk), `shortcut ${lnk}`).toBe(true)
  if (KIND === 'deb') {
    const sandbox = chromeSandbox()
    result.chromeSandbox = sandbox
    expect.soft(sandbox?.uid, 'chrome-sandbox is owned by root').toBe(0)
    expect.soft(sandbox?.mode, 'chrome-sandbox is setuid (4755)').toBe('4755')
  }
  const { app, page } = await openInstalled()
  try {
    result.version = await app.evaluate(({ app }) => app.getVersion())
    if (process.env.OXESPACE_EXPECT_VERSION) expect.soft(result.version, 'the installed build is main\'s').toBe(process.env.OXESPACE_EXPECT_VERSION)
    // main's package.json still says 1.3.3: the job builds with the RC version and passes it in OXESPACE_EXPECT_VERSION.
    result.workspaces = await page.evaluate('window.oxe.workspace.list().then(l => l.map(w => w.rootPath))')
    expect.soft(JSON.stringify(result.workspaces), 'the 1.3.3 workspace opens in the new build').toContain('repo-seeded')
    await page.waitForTimeout(3_000)
    result.nativeDialogs = await app.evaluate(() => (globalThis as Record<string, unknown>).upNative)
    expect.soft(result.nativeDialogs, 'no native dialog (no upgrade error box)').toBe(0)
  } finally { await close(app) }
  expect.soft(userData(), 'the same userData folder').toBe(seeded.userData)
  result.dbVersion = version(seeded.db)
  expect.soft(result.dbVersion, 'the database is migrated').toBe(EXPECT_DB)
  result.integrity = read(seeded.db, db => (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check)
  expect.soft(result.integrity, 'integrity_check').toBe('ok')
  expect.soft(workspaceRoots(seeded.db).some(r => r.toLowerCase().includes('repo-seeded')), 'the workspace row survived the migration').toBe(true)
  const backups = join(seeded.userData, 'db-backups')
  const v77 = existsSync(backups) ? readdirSync(backups).filter(f => /^oxespace-v77-.*\.sqlite3$/.test(f)) : []
  result.backups = v77
  expect.soft(v77.length, 'a pre-upgrade backup of the v77 database exists').toBeGreaterThan(0)
  if (v77[0]) {
    const backup = join(backups, v77[0])
    expect.soft(version(backup), 'the backup is the v77 database').toBe(77)
    expect.soft(workspaceRoots(backup).some(r => r.toLowerCase().includes('repo-seeded')), 'the backup holds the workspace').toBe(true)
  }
  writeFileSync(join(STATE, 'verify-upgrade.json'), JSON.stringify(result, null, 2))
  console.log('G4-UPGRADE', JSON.stringify(result))
})

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

test('G8 rollback: 1.3.3 refuses the upgraded database and leaves it untouched', async () => {
  test.skip(STEP !== 'verify-refuse')
  test.setTimeout(180_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { db: string }
  const before = sha256(seeded.db)
  const result: Record<string, unknown> = { dbVersionBefore: version(seeded.db), shaBefore: before }
  // Whatever 1.3.3 does with a newer database: a dialog (recorded, held), an error, or an exit. The start may already
  // have shown its dialog before the stub is in place; the bytes are the check either way.
  let app: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    app = await electron.launch({ executablePath: EXE, args: LAUNCH_ARGS, env: { ...process.env as Record<string, string>, ...LAUNCH_ENV, OXESPACE_DISABLE_SINGLE_INSTANCE: '1' }, timeout: 60_000 })
    const exited = new Promise<number | null>(resolve => app!.process().once('exit', code => resolve(code)))
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>; g.upSeen = []
      const seen = (kind: string, a: unknown, b?: unknown) => { (g.upSeen as unknown[]).push({ kind, a: JSON.stringify(a).slice(0, 400), b: b === undefined ? undefined : JSON.stringify(b).slice(0, 400) }) }
      dialog.showMessageBox = ((w: unknown, o?: unknown) => { seen('messageBox', o ?? w); return new Promise(() => undefined) }) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = ((w: unknown, o?: unknown) => { seen('messageBoxSync', o ?? w); return 0 }) as typeof dialog.showMessageBoxSync
      dialog.showErrorBox = ((title: string, content: string) => { seen('errorBox', title, content) }) as typeof dialog.showErrorBox
    }).catch(e => { result.stubError = String(e).slice(0, 200) })
    result.version = await app.evaluate(({ app }) => app.getVersion()).catch(() => null)
    const settled = await Promise.race([exited.then(code => ({ exited: true, code })), new Promise<{ exited: false }>(r => setTimeout(() => r({ exited: false }), 20_000))])
    result.exit = settled
    result.dialogs = await app.evaluate(() => (globalThis as Record<string, unknown>).upSeen).catch(() => null)
    result.windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getTitle())).catch(() => null)
    const page = app.windows()[0]
    result.screen = page ? (await page.locator('body').innerText().catch(() => '')).slice(0, 600) : null
    if (page) await page.screenshot({ path: join(STATE, 'verify-refuse.png') }).catch(() => undefined)
  } catch (e) { result.launchError = String(e).slice(0, 300) } finally {
    if (app) await close(app)
  }
  result.shaAfter = sha256(seeded.db)
  result.dbVersionAfter = version(seeded.db)
  writeFileSync(join(STATE, 'verify-refuse.json'), JSON.stringify(result, null, 2))
  console.log('G8-REFUSE', JSON.stringify(result))
  expect(result.version ?? '1.3.3', 'the build started is 1.3.3').toBe('1.3.3')
  expect(result.dbVersionBefore, 'the database was upgraded before this step').toBe(EXPECT_DB)
  expect(result.shaAfter, '1.3.3 leaves the upgraded database byte-identical').toBe(before)
  const refused = (Array.isArray(result.dialogs) && result.dialogs.length > 0) || (result.exit as { exited: boolean } | undefined)?.exited === true
    || !!result.launchError || !/repo-seeded/.test(String(result.screen ?? ''))
  expect.soft(refused, '1.3.3 refuses the newer database (dialog, error or exit), it does not open the workspace').toBe(true)
})

test('G8 rollback: 1.3.3 opens the restored v77 backup', async () => {
  test.skip(STEP !== 'verify-rollback')
  test.setTimeout(180_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { db: string }
  const result: Record<string, unknown> = { dbVersion: version(seeded.db) }
  expect(result.dbVersion, 'the restored database is v77').toBe(77)
  const { app, page } = await openInstalled()
  try {
    result.version = await app.evaluate(({ app }) => app.getVersion())
    expect.soft(result.version, 'the rolled-back build').toBe(process.env.OXESPACE_EXPECT_VERSION ?? '1.3.3')
    result.workspaces = await page.evaluate('window.oxe.workspace.list().then(l => l.map(w => w.rootPath))')
    expect.soft(JSON.stringify(result.workspaces), 'the seeded workspace opens in 1.3.3 again').toContain('repo-seeded')
    await page.waitForTimeout(3_000)
    result.nativeDialogs = await app.evaluate(() => (globalThis as Record<string, unknown>).upNative)
    expect.soft(result.nativeDialogs, 'no native dialog').toBe(0)
  } finally { await close(app) }
  result.dbVersionAfter = version(seeded.db)
  result.integrity = read(seeded.db, db => (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check)
  expect.soft(result.dbVersionAfter, '1.3.3 keeps it at v77').toBe(77)
  expect.soft(result.integrity, 'integrity_check').toBe('ok')
  expect.soft(workspaceRoots(seeded.db).some(r => r.toLowerCase().includes('repo-seeded')), 'the workspace row is there').toBe(true)
  writeFileSync(join(STATE, 'verify-rollback.json'), JSON.stringify(result, null, 2))
  console.log('G8-ROLLBACK', JSON.stringify(result))
})

test('G4 install over 1.3.3: verify the uninstall', async () => {
  test.skip(STEP !== 'verify-uninstall' || KIND === 'appimage', 'an AppImage has no uninstall')
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { userData: string; db: string }
  const result = {
    kind: KIND,
    // Windows: the program (the uninstaller may leave an empty folder); deb: the whole /opt/OXESpace.
    installDirGone: !existsSync(KIND === 'nsis' ? EXE : INSTALL_DIR),
    shortcutsGone: SHORTCUTS.map(l => !existsSync(l)),
    dataKept: existsSync(seeded.db),
    backupsKept: existsSync(join(seeded.userData, 'db-backups'))
  }
  expect.soft(result.installDirGone, 'the program is removed').toBe(true)
  for (const [i, gone] of result.shortcutsGone.entries()) expect.soft(gone, `shortcut removed: ${SHORTCUTS[i]}`).toBe(true)
  expect.soft(result.dataKept, 'the person\'s database is kept (deleteAppDataOnUninstall is off)').toBe(true)
  expect.soft(result.backupsKept, 'the backups are kept').toBe(true)
  writeFileSync(join(STATE, 'verify-uninstall.json'), JSON.stringify(result, null, 2))
  console.log('G4-UNINSTALL', JSON.stringify(result))
})
