import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Creates the e2e/out junction so the Electron renderer + preload load.
  globalSetup: './e2e/global-setup.ts',
  // Dev tools, not CI smoke — excluded from `npm run test:e2e`. The perf
  // benchmark relaunches Electron per panel (slow) and the screenshot capture is
  // for design review. Run them via `npm run bench:ui` / `npm run shots:ui`.
  testIgnore: ['**/perf-benchmark.spec.ts', '**/screenshots.spec.ts']
})
