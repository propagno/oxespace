import { existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Playwright global setup for the Electron e2e suite.
 *
 * When Playwright launches Electron with `e2e/electron-main.cjs`, Electron
 * resolves `app.getAppPath()` to the `e2e/` directory — so the app looks for its
 * preload + renderer under `e2e/out/*`, which don't exist (the real build is in
 * `<root>/out`). A directory junction `e2e/out → ../out` makes both resolve, so
 * `window.oxe` (preload bridge) and the renderer load exactly as in a real boot.
 */
export default function globalSetup(): void {
  const link = join(process.cwd(), 'e2e', 'out')
  if (existsSync(link)) return
  try {
    symlinkSync(join(process.cwd(), 'out'), link, 'junction')
  } catch {
    // Already exists / race — fine.
  }
}
