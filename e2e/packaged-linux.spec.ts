import { packagedLauncher, registerMaturityFlows } from './maturity-flows'
import { registerPackagedSmoke } from './packaged-smoke'
import { registerPackagedMemory } from './packaged-memory'
import { registerPackagedFuses } from './packaged-fuses'

// Boots dist/linux-unpacked with real SQLite, node-pty and Bash before the
// AppImage/deb artifacts are allowed to upload.
registerPackagedSmoke({
  platform: 'linux',
  label: 'Linux',
  bootBudgetMs: 10_000
})

// The same 1.0 maturity flows as the unpackaged E2E (window hardening, stable database version,
// first-run card, file tree), against the shipped binary.
registerMaturityFlows({
  label: 'Linux packaged',
  platform: 'linux',
  packaged: true,
  launch: packagedLauncher()
})

// Shared Project Memory ships off: the shipped binary must say so. With OXESPACE_PACKAGED_MEMORY=1 and the two
// official executables (OXESPACE_MEMORY_BIN_210 / _262) it also proves install, upgrade and rollback.
registerPackagedMemory({ label: 'Linux', platform: 'linux' })

// B13: RunAsNode is off in this binary (T2), closing a terminal neither starts a second OXESpace nor leaves its tree
// behind (T3), and the MCP bridge the app writes runs on the system node (T4). The fuses themselves: check-fuses.mjs.
registerPackagedFuses({ platform: 'linux', label: 'Linux' })
