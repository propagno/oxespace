import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { registerMaturityFlows } from './maturity-flows'

// The same flows the packaged smoke runs against the shipped binary, here against the built,
// unpackaged app so they run in the normal E2E job on both platforms. Real mode (no mock IPC).
registerMaturityFlows({
  label: 'unpackaged',
  packaged: false,
  launch: env => electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, ...env }
  })
})
