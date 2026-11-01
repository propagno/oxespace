import { packagedLauncher, registerMaturityFlows } from './maturity-flows'
import { registerPackagedSmoke } from './packaged-smoke'
import { registerPackagedMemory } from './packaged-memory'
import { registerPackagedFuses } from './packaged-fuses'

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

// The same 1.0 maturity flows as the unpackaged E2E (window hardening, stable database version,
// first-run card, file tree), against the shipped binary.
registerMaturityFlows({
  label: 'Windows packaged',
  platform: 'win32',
  packaged: true,
  launch: packagedLauncher()
})

// Shared Project Memory ships off: the shipped binary must say so. With OXESPACE_PACKAGED_MEMORY=1 and the two
// official executables (OXESPACE_MEMORY_BIN_210 / _262) it also proves install, upgrade and rollback.
registerPackagedMemory({ label: 'Windows', platform: 'win32' })

// B13: RunAsNode is off in this binary (T2), closing a terminal neither starts a second OXESpace nor leaves its tree
// behind (T3), and the MCP bridge the app writes runs on the system node (T4). The fuses themselves: check-fuses.mjs.
registerPackagedFuses({ platform: 'win32', label: 'Windows' })
