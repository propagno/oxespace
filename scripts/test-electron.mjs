#!/usr/bin/env node
/**
 * Runs vitest under Electron's Node ABI.
 *
 * SQLite and PTY now ship Node-API binaries, usable in Node and Electron.
 * This runner additionally exercises the exact Node runtime embedded in the
 * pinned Electron through ELECTRON_RUN_AS_NODE.
 *
 * Extra args are forwarded: `npm run test:electron -- tests/integration/foo.test.ts`
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

const child = spawn(electron, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error('[test:electron] failed to launch Electron:', error.message)
  process.exit(1)
})
