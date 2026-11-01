import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
 *   verify-uninstall after `Uninstall OXESpace.exe /S`: the install folder and both shortcuts are gone; the person's data
 *                   (userData database and backups) is kept.
 *
 * Inputs (env): OXESPACE_UPGRADE_STEP, OXESPACE_UPGRADE_STATE, OXESPACE_EXPECT_VERSION (main's package version),
 * OXESPACE_EXPECT_DB_VERSION (default 88); optional OXESPACE_INSTALL_DIR, OXESPACE_USER_DATA.
 */
const STEP = process.env.OXESPACE_UPGRADE_STEP ?? ''
const STATE = process.env.OXESPACE_UPGRADE_STATE ?? ''
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
const ROAMING = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const INSTALL_DIR = process.env.OXESPACE_INSTALL_DIR ?? join(LOCAL, 'Programs', 'OXESpace')
const EXE = join(INSTALL_DIR, 'OXESpace.exe')
const SHORTCUTS = [
  join(homedir(), 'Desktop', 'OXESpace.lnk'),
  join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'OXESpace.lnk')
]
const EXPECT_DB = Number(process.env.OXESPACE_EXPECT_DB_VERSION ?? '88')

test.skip(STEP === '' || process.env.GITHUB_ACTIONS !== 'true', 'runs only inside the release upgrade job on a CI runner')

/** The installed app's userData, as Electron names it (product name, then package name). */
function userData(): string {
  if (process.env.OXESPACE_USER_DATA) return process.env.OXESPACE_USER_DATA
  for (const name of ['OXESpace', 'oxespace']) if (existsSync(join(ROAMING, name, 'oxespace.sqlite3'))) return join(ROAMING, name)
  return join(ROAMING, 'OXESpace')
}
const dbPath = () => join(userData(), 'oxespace.sqlite3')
const read = <T>(file: string, fn: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(file, { readOnly: true }); try { return fn(db) } finally { db.close() } }
const version = (file: string) => read(file, db => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
const workspaceRoots = (file: string) => read(file, db => (db.prepare('SELECT root_path FROM workspaces').all() as Array<{ root_path: string }>).map(r => r.root_path))
const stateFile = () => join(STATE, 'seed.json')

/** Opens the installed app on its own userData (no test database), with native dialogs counted and held. */
async function openInstalled() {
  const app = await electron.launch({ executablePath: EXE, args: [], env: { ...process.env as Record<string, string>, OXESPACE_DISABLE_SINGLE_INSTANCE: '1' } })
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
const close = (app: Awaited<ReturnType<typeof openInstalled>>['app']) => app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)

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

test('G4 install over 1.3.3: verify the uninstall', async () => {
  test.skip(STEP !== 'verify-uninstall')
  const seeded = JSON.parse(readFileSync(stateFile(), 'utf8')) as { userData: string; db: string }
  const result = {
    installDirGone: !existsSync(EXE),
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
