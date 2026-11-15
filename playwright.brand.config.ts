import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a run from an OXESpace terminal must never reach the running app (e2e/helpers/live-app-env.ts).
scrubLiveAppEnv()

/**
 * The brand conformance run (OXE-149): the built app measured against src/design/targets. CI runs it once per
 * platform (ci.yml, E2E shard 2) and posts the result as the `marca/conformidade` status; the smoke config ignores it.
 */
export default defineConfig({
  testDir: './e2e/brand',
  timeout: 300000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts'
})
