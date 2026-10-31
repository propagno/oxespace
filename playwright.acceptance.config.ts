import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'

/**
 * Acceptance specs (S0.4): one per open roadmap item, written from the row's acceptance before the code, red until the
 * item lands. Run with `npx playwright test --config playwright.acceptance.config.ts [e2e/acceptance/<item>.spec.ts]`.
 */
export default defineConfig({
  testDir: './e2e/acceptance',
  timeout: 180000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts'
})
