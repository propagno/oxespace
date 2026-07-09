import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const verificationScript = fileURLToPath(new URL('./verify-native-modules.cjs', import.meta.url))
const result = spawnSync(electronPath, [verificationScript], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
