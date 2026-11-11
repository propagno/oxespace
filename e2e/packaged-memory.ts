import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Packaged-build check after R5 (1.5.0), shared by the Windows and Linux specs: AI Memory is gone from the shipped
 * binary. The window has no memory API and a fresh profile gets no memory runtime data. Needs only
 * OXESPACE_PACKAGED_EXECUTABLE.
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
  // OXESPACE_DB_PATH is for the unpackaged launcher (memory-gate.spec.ts); a packaged build ignores it (T50) and keeps
  // its database in the --user-data-dir below.
  const app = await (options.launch ?? shippedBinary)({ OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), ...env }, [`--user-data-dir=${userData}`])
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible', timeout: 30_000 })
  if (options.packaged !== false) expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true)
  return { app, page, userData }
}

export function registerPackagedMemory(options: PackagedMemoryOptions): void {
  const { label, platform } = options
  test(`packaged ${label} build ships without AI Memory`, async () => {
    test.setTimeout(90_000)
    test.skip(process.platform !== platform, `${label} packaged artifact check`)
    // The old opt-in flag must not bring anything back either.
    const { app, page, userData } = await launch(options, { OXESPACE_EXPERIMENTAL_MEMORY: '1' })
    try {
      const hasMemoryApi = await page.evaluate(() => 'memory' in (window.oxe as unknown as Record<string, unknown>))
      expect(hasMemoryApi).toBe(false)
      expect(existsSync(join(userData, 'memory', 'data'))).toBe(false)
    } finally { await app.close() }
  })
}
