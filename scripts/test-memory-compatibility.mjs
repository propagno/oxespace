#!/usr/bin/env node
// Native certification must fail on missing binaries, mismatched versions and
// skipped contracts. Hash is the executable digest from a verified archive.
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const args = process.argv.slice(2)
const argument = name => args[args.indexOf(name) + 1]
const exec = promisify(execFile)
let directory
try {
  for (const name of ['--binary', '--version', '--sha256']) if (!args.includes(name) || !argument(name)) throw Error(`Required: ${name}`)
  const version = argument('--version')
  if (!['2.1.0', '2.6.2'].includes(version)) throw Error('Only certified target versions 2.1.0 and 2.6.2 are accepted')
  const binary = resolve(argument('--binary'))
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex')
  if (digest !== argument('--sha256').toLowerCase()) throw Error('Executable SHA256 mismatch')
  const result = await exec(binary, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 4096 })
  if (result.stdout.trim() !== `ai-memory ${version}`) throw Error('Executable version mismatch')
  directory = await mkdtemp(join(tmpdir(), 'oxe-memory-certification-'))
  const report = join(directory, 'results.json')
  const require = createRequire(import.meta.url)
  const electron = require('electron')
  const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  const files = ['tests/unit/memory-hook.test.ts', 'tests/integration/ai-memory.native.test.ts',
    'tests/integration/memory-runtime.native.test.ts', 'tests/integration/memory-adapters.native.test.ts']
  if (version === '2.6.2') files.push('tests/integration/ai-memory-v26.native.test.ts')
  const started = Date.now()
  const child = spawn(electron, [vitest, 'run', ...files, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], {
    windowsHide: true, stdio: 'inherit', detached: process.platform !== 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OXESPACE_AI_MEMORY_TEST_BINARY: binary,
      OXESPACE_AI_MEMORY_V26_TEST_BINARY: version === '2.6.2' ? binary : '' }
  })
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    if (!child.pid) return
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
    else { try { process.kill(-child.pid, 'SIGKILL') } catch { /* exited already */ } }
  }, 180000)
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  }).finally(() => clearTimeout(timer))
  if (expired) throw Error('Certification exceeded its 180 second process-tree deadline')
  if (code !== 0) throw Error(`Native contract suite failed (${code})`)
  const summary = JSON.parse(await readFile(report, 'utf8'))
  const expected = version === '2.6.2' ? 21 : 12
  if (!summary.success || summary.numTotalTests !== expected || summary.numPassedTests !== expected || summary.numPendingTests !== 0 || summary.numTodoTests !== 0) {
    throw Error('Native certification requires every expected test to pass, without skips')
  }
  console.log(JSON.stringify({ version, platform: process.platform, arch: process.arch, executableSha256: digest,
    passed: summary.numPassedTests, skipped: summary.numPendingTests, durationMs: Date.now() - started }))
} catch (error) {
  console.error(`[memory:compatibility] ${error.message}`)
  process.exitCode = 1
} finally {
  if (directory) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-memory-certification-')) {
      console.error('[memory:compatibility] Invalid cleanup target; leaving it untouched')
      process.exitCode = 1
    } else await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
