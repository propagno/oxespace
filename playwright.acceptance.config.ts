import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a run from an OXESpace terminal must never reach the running app (e2e/helpers/live-app-env.ts).
// Test switches (OXESPACE_E2E_*, OXESPACE_ACCEPT_FIREWALL) are kept.
scrubLiveAppEnv()

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
