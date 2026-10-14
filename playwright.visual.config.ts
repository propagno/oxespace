import { defineConfig } from '@playwright/test'

// Visual-regression suite. Kept out of `npm run test:e2e` until baselines are
// approved on both platforms; run it with `npm run test:visual`.
// Update baselines deliberately and review the diff: `npm run test:visual:update`.
export default defineConfig({
  testDir: './e2e/visual',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  // Baselines are split by platform: font rasterisation differs between Windows and Linux.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' }
  }
})
