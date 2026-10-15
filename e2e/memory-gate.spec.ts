import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { registerPackagedMemory } from './packaged-memory'

// The feature gate and (with OXESPACE_PACKAGED_MEMORY=1) the managed-runtime upgrade/rollback flow,
// against the built, unpackaged app in real mode so they run in the normal E2E job.
registerPackagedMemory({
  label: 'unpackaged',
  platform: process.platform,
  packaged: false,
  launch: (env, args) => electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs'), ...args], env: { ...process.env, ...env } })
})
