import { registerPackagedSmoke } from './packaged-smoke'

// Boots dist/linux-unpacked with real SQLite, node-pty and Bash before the
// AppImage/deb artifacts are allowed to upload.
registerPackagedSmoke({
  platform: 'linux',
  label: 'Linux',
  bootBudgetMs: 10_000
})
