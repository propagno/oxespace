import { registerPackagedSmoke } from './packaged-smoke'

// Windows counterpart of packaged-linux.spec.ts. Until this existed, the NSIS
// build — the artifact that actually ships today — was the only packaged output
// never launched by CI, so a broken asarUnpack or extraResource would have been
// found by users rather than by the pipeline.
//
// A larger boot budget than Linux is deliberate: the GitHub Windows runner is
// slower off cold start, with Defender scanning the freshly written binary.
registerPackagedSmoke({
  platform: 'win32',
  label: 'Windows',
  bootBudgetMs: 15_000
})
