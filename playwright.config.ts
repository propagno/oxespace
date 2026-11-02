import { defineConfig } from '@playwright/test'
// Workers import this config: makes every spec's Electron close() finish on Windows (see the helper).
import './e2e/helpers/electron-close'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a run from an OXESpace terminal must never reach the running app (e2e/helpers/live-app-env.ts).
scrubLiveAppEnv()

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
  testIgnore: [
    '**/perf-benchmark.spec.ts',
    '**/memory-footprint.spec.ts',
    '**/browser-preview-performance.spec.ts',
    '**/screenshots.spec.ts',
    // Pixel-regression suite has its own config and per-platform baselines.
    '**/visual/**',
    // Homologation passes (docs/validation/homologacao-1.4.md), run by hand with playwright.tools.config.ts.
    '**/homologation/**',
    // Packaged-artifact smokes need a built installer and are driven by the
    // release leg of CI with OXESPACE_PACKAGED_EXECUTABLE set.
    '**/packaged-linux.spec.ts',
    '**/packaged-win.spec.ts'
  ]
})
