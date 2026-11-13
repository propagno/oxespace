import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { dirname, join } from 'node:path'

/**
 * Performance baseline (OXE-105): one launcher for the benchmark specs, so the same spec measures the built app
 * (e2e/electron-main.cjs over out/, the CI gate's way) or the packaged binary named by OXESPACE_PACKAGED_EXECUTABLE
 * (the packaged smoke's way). Without that variable it launches exactly what the specs launched before.
 *
 * A packaged build ignores OXESPACE_DB_PATH and every OXESPACE_E2E_* mock switch (T48, T50): its data is isolated by
 * --user-data-dir = the database's folder, so the database is <folder>/oxespace.sqlite3, and it runs with its real
 * database, terminals and services. playwright.tools.config.ts's electron-close helper stubs its native dialogs.
 */
export function packagedExecutable(): string | undefined {
  return process.env.OXESPACE_PACKAGED_EXECUTABLE || undefined
}

export async function launchForPerf(env: NodeJS.ProcessEnv): Promise<ElectronApplication> {
  const executablePath = packagedExecutable()
  if (!executablePath) {
    return electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env })
  }
  const dbPath = env.OXESPACE_DB_PATH
  const args = dbPath ? [`--user-data-dir=${dirname(dbPath)}`] : []
  // e2e/electron-main.cjs pins the locale for the unpackaged run; the specs read English text.
  return electron.launch({ executablePath, args, env: { ...env, OXESPACE_LOCALE: env.OXESPACE_LOCALE || 'en-US' } })
}
