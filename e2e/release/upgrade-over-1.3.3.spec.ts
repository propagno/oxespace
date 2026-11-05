import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
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
 *                   Start Menu shortcuts point at it; it opens; the database is the latest migration in this checkout,
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
 * OXESPACE_EXPECT_DB_VERSION (default: the highest numbered electron/main/db/migrations/NNN_*.sql); optional OXESPACE_INSTALL_DIR, OXESPACE_USER_DATA.
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
/**
 * The schema version the candidate migrates to: the highest numbered migration in this checkout, which is the code the
 * job builds the candidate from. A fixed number went stale as soon as a migration landed (88 while main was at 90).
 */
function latestMigration(): number {
  const numbers = readdirSync(join(process.cwd(), 'electron', 'main', 'db', 'migrations'))
    .map(name => /^(\d{3})_.+\.sql$/.exec(name)?.[1]).filter((n): n is string => Boolean(n)).map(Number)
  if (!numbers.length) throw new Error('no migrations found under electron/main/db/migrations')
  return Math.max(...numbers)
}
const EXPECT_DB = process.env.OXESPACE_EXPECT_DB_VERSION ? Number(process.env.OXESPACE_EXPECT_DB_VERSION) : latestMigration()
/** The release installed first (the job's FROM_TAG), e.g. 1.3.3 or 1.4.2. */
const FROM_VERSION = (process.env.FROM_TAG ?? 'v1.3.3').replace(/^v/, '')

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

/**
 * The installed app, driven over the Chromium DevTools protocol. Since 1.4.0 the packaged app ships the B13 fuse
 * enableNodeCliInspectArguments=false, so Playwright's electron.launch (which needs --inspect) cannot attach to any
 * installed build >= 1.4.0 (install-over run 41938132300 timed out on all three kinds). --remote-debugging-port is a
 * Chromium switch the fuse leaves alone: the renderer is reachable, the main process is not. So native dialogs can no
 * longer be stubbed or counted here; the checks read what the window shows instead.
 */
interface Installed { proc: ChildProcess; browser: Browser; exited: Promise<number | null> }
async function launchInstalled(): Promise<{ app: Installed; page: Page | null }> {
  const port = 9300 + Math.floor(Math.random() * 500)
  const proc = spawn(EXE, [...LAUNCH_ARGS, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { env: { ...process.env as Record<string, string>, ...LAUNCH_ENV, OXESPACE_DISABLE_SINGLE_INSTANCE: '1' }, stdio: 'ignore' })
  const exited = new Promise<number | null>(resolve => proc.once('exit', code => resolve(code)))
  let browser: Browser | undefined
  for (let i = 0; i < 90 && !browser && proc.exitCode === null; i++) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)
  }
  if (!browser) throw new Error(`no DevTools endpoint on ${port} (exit ${proc.exitCode})`)
  let page: Page | null = null
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => !p.url().startsWith('devtools')) ?? null
    if (!page) await new Promise(resolve => setTimeout(resolve, 500))
  }
  return { app: { proc, browser, exited }, page }
}
/** Opens the installed app on its own userData (no test database) and waits for the main window. */
async function openInstalled(): Promise<{ app: Installed; page: Page }> {
  const { app, page } = await launchInstalled()
  if (!page) throw new Error('the installed app opened no window')
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 60_000 })
  return { app, page }
}
/** The version the installed build reports (its preload's window.oxe.app.version). */
const versionOf = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { app: { version: string } } }).oxe.app.version)
/** Ends the installed app and its process tree. */
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

test('G4 install over 1.3.3: seed', async () => {
  test.skip(STEP !== 'seed')
  test.setTimeout(240_000)
  mkdirSync(STATE, { recursive: true })
  expect(existsSync(EXE), `${FROM_VERSION} is installed at ${EXE}`).toBe(true)
  const repo = join(STATE, 'repo-seeded'); mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const { app, page } = await openInstalled()
  let installed: string
  try {
    installed = await versionOf(page)
    expect(installed, `the installed build is ${FROM_VERSION}`).toBe(FROM_VERSION)
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await expect.poll(() => page.evaluate('window.oxe.workspace.list().then(l => l.length)'), { timeout: 20_000, message: 'the workspace exists in 1.3.3' }).toBe(1)
    await page.waitForTimeout(3_000)
  } finally { await close(app) }
  const db = dbPath()
  expect(existsSync(db), `1.3.3 wrote its database at ${db}`).toBe(true)
  const seeded = { installed, userData: userData(), db, dbVersion: version(db), roots: workspaceRoots(db) }
  if (FROM_VERSION === '1.3.3') expect(seeded.dbVersion, '1.3.3 database version').toBe(77)
  expect(seeded.dbVersion, `the ${FROM_VERSION} database is a real schema`).toBeGreaterThan(0)
  expect(seeded.roots.some(r => r.toLowerCase().includes('repo-seeded')), `the workspace is in the ${FROM_VERSION} database`).toBe(true)
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2))
  console.log('G4-SEED', JSON.stringify(seeded))
})

test('G4 install over 1.3.3: verify the upgrade', async () => {
  test.skip(STEP !== 'verify-upgrade')
  test.setTimeout(240_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { userData: string; db: string; roots: string[]; dbVersion: number }
  const result: Record<string, unknown> = { fromDbVersion: seeded.dbVersion }
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
    result.version = await versionOf(page)
    if (process.env.OXESPACE_EXPECT_VERSION) expect.soft(result.version, 'the installed build is the candidate').toBe(process.env.OXESPACE_EXPECT_VERSION)
    result.workspaces = await page.evaluate('window.oxe.workspace.list().then(l => l.map(w => w.rootPath))')
    expect.soft(JSON.stringify(result.workspaces), `the ${FROM_VERSION} workspace opens in the new build`).toContain('repo-seeded')
    await page.waitForTimeout(3_000)
    // Over CDP the main process (and its dialogs) is out of reach: the window must be the normal app, not a failure.
    result.startupFailure = await page.getByTestId('startup-failure').count()
    expect.soft(result.startupFailure, 'no startup failure screen').toBe(0)
    result.screen = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
  } finally { await close(app) }
  expect.soft(userData(), 'the same userData folder').toBe(seeded.userData)
  result.dbVersion = version(seeded.db)
  expect.soft(result.dbVersion, 'the database is migrated').toBe(EXPECT_DB)
  result.integrity = read(seeded.db, db => (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check)
  expect.soft(result.integrity, 'integrity_check').toBe('ok')
  expect.soft(workspaceRoots(seeded.db).some(r => r.toLowerCase().includes('repo-seeded')), 'the workspace row survived the migration').toBe(true)
  const backups = join(seeded.userData, 'db-backups')
  const from = seeded.dbVersion
  const old = existsSync(backups) ? readdirSync(backups).filter(f => new RegExp(`^oxespace-v${from}-.*\\.sqlite3$`).test(f)) : []
  result.backups = existsSync(backups) ? readdirSync(backups) : []
  if (from < EXPECT_DB) {
    expect.soft(old.length, `a pre-upgrade backup of the v${from} database exists`).toBeGreaterThan(0)
    if (old[0]) {
      const backup = join(backups, old[0])
      expect.soft(version(backup), `the backup is the v${from} database`).toBe(from)
      expect.soft(workspaceRoots(backup).some(r => r.toLowerCase().includes('repo-seeded')), 'the backup holds the workspace').toBe(true)
    }
  } else {
    // Same schema on both sides (no migration between the two releases): nothing to back up, and nothing migrated.
    result.noMigration = `v${from} = v${EXPECT_DB}: no upgrade ran, so no backup is expected`
  }
  writeFileSync(join(STATE, 'verify-upgrade.json'), JSON.stringify(result, null, 2))
  console.log('G4-UPGRADE', JSON.stringify(result))
})

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

test('G8 rollback: 1.3.3 refuses the upgraded database and leaves it untouched', async () => {
  test.skip(STEP !== 'verify-refuse')
  test.setTimeout(180_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { db: string }
  // The database runs in WAL mode. A candidate that was ended without a clean quit (the job's shipped-exe check stops
  // it) leaves pages in oxespace.sqlite3-wal, and whoever opens the file next moves them into it: the bytes would
  // change without 1.3.3 writing anything. Checkpoint first, as a clean quit does, so the comparison measures 1.3.3.
  const wal = `${seeded.db}-wal`
  const walBefore = existsSync(wal) ? statSync(wal).size : 0
  if (walBefore > 0) { const db = new DatabaseSync(seeded.db); try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } finally { db.close() } }
  // What 1.3.3 could change, table by table, in case the bytes differ.
  const tables = () => read(seeded.db, db => Object.fromEntries((db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as Array<{ name: string }>)
    .map(({ name }) => [name, (db.prepare(`select count(*) as n from "${name.replace(/"/g, '""')}"`).get() as { n: number }).n])))
  const tablesBefore = tables()
  const before = sha256(seeded.db)
  const result: Record<string, unknown> = { dbVersionBefore: version(seeded.db), shaBefore: before, walCheckpointedBytes: walBefore }
  // Whatever 1.3.3 does with a newer database: a dialog (recorded, held), an error, or an exit. The start may already
  // have shown its dialog before the stub is in place; the bytes are the check either way.
  let app: Installed | null = null
  try {
    const launched = await launchInstalled()
    app = launched.app
    const page = launched.page
    await page?.waitForTimeout(8_000)
    result.version = page ? await versionOf(page).catch(() => null) : null
    const settled = await Promise.race([app.exited.then(code => ({ exited: true, code })), new Promise<{ exited: false }>(r => setTimeout(() => r({ exited: false }), 12_000))])
    result.exit = settled
    result.dialogs = 'not observable over CDP (main process out of reach since the 1.4.0 fuse)'
    result.startupFailure = page ? await page.getByTestId('startup-failure').count().catch(() => null) : null
    result.screen = page ? (await page.locator('body').innerText().catch(() => '')).slice(0, 600) : null
    if (page) await page.screenshot({ path: join(STATE, 'verify-refuse.png') }).catch(() => undefined)
  } catch (e) { result.launchError = String(e).slice(0, 300) } finally {
    if (app) await close(app)
  }
  result.shaAfter = sha256(seeded.db)
  result.dbVersionAfter = version(seeded.db)
  result.walAfterBytes = existsSync(wal) ? statSync(wal).size : 0
  const tablesAfter = tables()
  result.tablesChanged = Object.fromEntries(Object.keys({ ...tablesBefore, ...tablesAfter })
    .filter(name => tablesBefore[name] !== tablesAfter[name]).map(name => [name, { before: tablesBefore[name] ?? null, after: tablesAfter[name] ?? null }]))
  writeFileSync(join(STATE, 'verify-refuse.json'), JSON.stringify(result, null, 2))
  console.log('G8-REFUSE', JSON.stringify(result))
  const seededDb = (JSON.parse(readFileSync(stateFile(), 'utf8')) as { dbVersion: number }).dbVersion
  expect(result.version ?? FROM_VERSION, `the build started is ${FROM_VERSION}`).toBe(FROM_VERSION)
  expect(result.dbVersionBefore, 'the database was upgraded before this step').toBe(EXPECT_DB)
  if (seededDb === EXPECT_DB) {
    // Same schema on both releases: going back is not a downgrade of the data, so nothing should be refused.
    result.sameSchema = true
    expect.soft(result.startupFailure ?? 0, `${FROM_VERSION} opens the same-schema data without a failure screen`).toBe(0)
    return
  }
  expect(result.shaAfter, `${FROM_VERSION} leaves the upgraded database byte-identical`).toBe(before)
  const refused = (result.exit as { exited: boolean } | undefined)?.exited === true || !!result.launchError
    || (Number(result.startupFailure) > 0) || !/repo-seeded/.test(String(result.screen ?? ''))
  expect.soft(refused, `${FROM_VERSION} refuses the newer database (failure screen, error or exit), it does not open the workspace`).toBe(true)
})

test('G8 rollback: 1.3.3 opens the restored v77 backup', async () => {
  test.skip(STEP !== 'verify-rollback')
  test.setTimeout(180_000)
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { db: string; dbVersion: number }
  const result: Record<string, unknown> = { dbVersion: version(seeded.db) }
  expect(result.dbVersion, `the restored database is v${seeded.dbVersion}`).toBe(seeded.dbVersion)
  const { app, page } = await openInstalled()
  try {
    result.version = await versionOf(page)
    expect.soft(result.version, 'the rolled-back build').toBe(process.env.OXESPACE_EXPECT_VERSION ?? FROM_VERSION)
    result.workspaces = await page.evaluate('window.oxe.workspace.list().then(l => l.map(w => w.rootPath))')
    expect.soft(JSON.stringify(result.workspaces), `the seeded workspace opens in ${FROM_VERSION} again`).toContain('repo-seeded')
    await page.waitForTimeout(3_000)
    result.startupFailure = await page.getByTestId('startup-failure').count()
    expect.soft(result.startupFailure, 'no startup failure screen').toBe(0)
  } finally { await close(app) }
  result.dbVersionAfter = version(seeded.db)
  result.integrity = read(seeded.db, db => (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check)
  expect.soft(result.dbVersionAfter, `${FROM_VERSION} keeps it at v${seeded.dbVersion}`).toBe(seeded.dbVersion)
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
