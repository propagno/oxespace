import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Packaged-build checks for Shared Project Memory, shared by the Windows and Linux specs.
 *
 * 1. Always: the shipped binary has the feature OFF by default (nothing is served over IPC and
 *    the interface learns it is unavailable). Needs only OXESPACE_PACKAGED_EXECUTABLE.
 * 2. Opt-in with OXESPACE_PACKAGED_MEMORY=1: with the flag on, the shipped binary installs a managed
 *    runtime from a LOCAL, checksum-verified executable, upgrades 2.1.0 -> 2.6.2 keeping a snapshot,
 *    and restores the previous runtime (rollback). No network, no model calls, synthetic data only.
 *    Requires OXESPACE_MEMORY_BIN_210 and OXESPACE_MEMORY_BIN_262 (absolute paths of the official
 *    executables); with the opt-in set, a missing binary FAILS the test instead of skipping it.
 *
 * Every launch gets its own --user-data-dir, so the user's real profile is never touched.
 */
export interface PackagedMemoryOptions {
  label: string
  platform: NodeJS.Platform
  /** Opens the app with extra environment and extra command-line arguments. Defaults to the shipped binary. */
  launch?: (env: Record<string, string>, args: string[]) => Promise<ElectronApplication>
  /** True (default) also asserts app.isPackaged. */
  packaged?: boolean
}

type MemoryStatus = { featureEnabled?: boolean; health: { status: string }; settings: { enabled: boolean }; runtime: { executable: string }; rollbackAvailable?: boolean }

function shippedBinary(env: Record<string, string>, args: string[]): Promise<ElectronApplication> {
  const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE
  expect(executablePath, 'OXESPACE_PACKAGED_EXECUTABLE').toBeTruthy()
  expect(existsSync(executablePath!), `packaged executable ${executablePath}`).toBe(true)
  return electron.launch({ executablePath, args, env: { ...process.env, ...env } })
}

async function launch(options: PackagedMemoryOptions, env: Record<string, string>): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const root = mkdtempSync(join(tmpdir(), 'oxe-packaged-memory-'))
  const userData = join(root, 'user-data')
  mkdirSync(userData, { recursive: true })
  const app = await (options.launch ?? shippedBinary)({ OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_EXPERIMENTAL_MEMORY: '', ...env }, [`--user-data-dir=${userData}`])
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible', timeout: 30_000 })
  if (options.packaged !== false) expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true)
  return { app, page, userData }
}

export function registerPackagedMemory(options: PackagedMemoryOptions): void {
  const { label, platform } = options
  test(`packaged ${label} build ships Shared Project Memory off by default`, async () => {
    test.setTimeout(90_000)
    test.skip(process.platform !== platform, `${label} packaged artifact check`)
    const { app, page, userData } = await launch(options, {})
    try {
      const status = await page.evaluate(() => window.oxe.memory.status('any-workspace')) as MemoryStatus
      expect(status.featureEnabled).toBe(false)
      expect(status.health.status).toBe('disabled')
      expect(status.settings.enabled).toBe(false)
      await expect(page.evaluate(() => window.oxe.memory.search({ workspaceId: 'any-workspace', query: 'x' }))).rejects.toThrow(/not enabled/)
      await expect(page.evaluate(() => window.oxe.memory.install())).rejects.toThrow(/not enabled/)
      // No memory runtime, outbox or service data appears while the feature is off.
      expect(existsSync(join(userData, 'memory', 'data'))).toBe(false)
    } finally { await app.close() }
  })

  test(`packaged ${label} build installs, upgrades 2.1.0 to 2.6.2 and rolls back the memory runtime when the flag is on`, async () => {
    test.setTimeout(240_000)
    test.skip(process.platform !== platform, `${label} packaged artifact check`)
    test.skip(process.env.OXESPACE_PACKAGED_MEMORY !== '1', 'Set OXESPACE_PACKAGED_MEMORY=1 with OXESPACE_MEMORY_BIN_210 and OXESPACE_MEMORY_BIN_262')
    const old = process.env.OXESPACE_MEMORY_BIN_210
    const current = process.env.OXESPACE_MEMORY_BIN_262
    for (const [name, path] of [['OXESPACE_MEMORY_BIN_210', old], ['OXESPACE_MEMORY_BIN_262', current]] as const) {
      expect(path, name).toBeTruthy()
      expect(existsSync(path!), `${name} ${path}`).toBe(true)
    }
    const { app, page, userData } = await launch(options, { OXESPACE_EXPERIMENTAL_MEMORY: '1' })
    const project = mkdtempSync(join(tmpdir(), 'oxe-packaged-memory-project-'))
    try {
      const workspace = await page.evaluate(root => window.oxe.workspace.create({ rootPath: root, layout: '1x2', autoStart: false }), project)
      const on = await page.evaluate(id => window.oxe.memory.status(id), workspace.id) as MemoryStatus
      expect(on.featureEnabled).not.toBe(false)
      // Existing 2.1.0 data first, as an installed user would have.
      const first = await page.evaluate(([id, executable]) => window.oxe.memory.configure({ workspaceId: id, settings: { enabled: true, automaticCapture: false, automaticContext: false }, runtime: { mode: 'managed', executable, url: 'http://127.0.0.1:49374' } }), [workspace.id, old!]) as MemoryStatus
      expect(first.health.status).toBe('ready')
      expect(first.runtime.executable).toBe(old)
      expect(existsSync(join(userData, 'memory', 'data'))).toBe(true)

      // Upgrade: the complete stopped data directory is copied, validated, then swapped.
      const upgraded = await page.evaluate(([id, executable]) => window.oxe.memory.configure({ workspaceId: id, settings: { enabled: true, automaticCapture: false, automaticContext: false }, runtime: { mode: 'managed', executable, url: 'http://127.0.0.1:49374' } }), [workspace.id, current!]) as MemoryStatus
      expect(upgraded.health.status).toBe('ready')
      expect(upgraded.runtime.executable).toBe(current)
      expect(upgraded.rollbackAvailable).toBe(true)

      // Rollback restores the previous runtime and its data; the later data is kept apart.
      const restored = await page.evaluate(id => window.oxe.memory.rollback(id), workspace.id) as MemoryStatus
      expect(restored.runtime.executable).toBe(old)
      expect(restored.rollbackAvailable).toBeFalsy()
      expect(restored.health.status).toBe('ready')
    } finally { await app.close() }
  })
}
