import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a run from an OXESpace terminal must never reach the running app (e2e/helpers/live-app-env.ts).
scrubLiveAppEnv()

/**
 * Config for the manual e2e DEV TOOLS (perf benchmark, screenshot capture) that
 * are excluded from the CI smoke run. Longer timeout for the per-panel relaunch
 * benchmark. Use via `npm run bench:ui` / `npm run shots:ui`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts'
})
