import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'

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
    // The default 5 s is too tight when the machine is busy: a slow capture would fail
    // as a timeout even though nothing visual changed. This is the assertion-wide timeout.
    timeout: 20_000,
    // A small absolute tolerance absorbs anti-aliasing noise (Monaco diffs differ by ~14 px)
    // while still failing on a real change: a 20x20 icon is already 400 px.
    toHaveScreenshot: { maxDiffPixels: 60, animations: 'disabled' }
  }
})
