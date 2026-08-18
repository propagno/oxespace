#!/usr/bin/env node
/**
 * Runs vitest under Electron's Node ABI.
 *
 * better-sqlite3 is built for Electron (NODE_MODULE_VERSION 125), so `vitest run`
 * on system Node (127) cannot load it and every DB-backed test fails with a
 * module-version error. That looks like ~49 broken tests when nothing is broken.
 * ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node with the
 * matching ABI, so the whole suite runs locally the way it does in CI.
 *
 * Extra args are forwarded: `npm run test:electron -- tests/integration/foo.test.ts`
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = require.resolve('vitest/vitest.mjs')

const child = spawn(electron, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error('[test:electron] failed to launch Electron:', error.message)
  process.exit(1)
})
