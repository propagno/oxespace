import { packagedLauncher, registerMaturityFlows } from './maturity-flows'
import { registerPackagedSmoke } from './packaged-smoke'

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
