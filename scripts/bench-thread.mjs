#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const output = 'docs/plans/thread-professional-v2/benchmark.json'
await mkdir('docs/plans/thread-professional-v2', { recursive: true })
const child = spawn(electron, [vitest, 'bench', '--run', 'tests/bench/thread-history.bench.ts', '--outputJson', output], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.on('exit', code => process.exit(code ?? 1))
child.on('error', error => { console.error('[bench:thread] failed:', error.message); process.exit(1) })
