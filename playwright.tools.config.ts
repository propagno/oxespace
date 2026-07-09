import { defineConfig } from '@playwright/test'

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
