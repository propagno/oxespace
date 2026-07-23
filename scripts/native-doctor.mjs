import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const checks = []

try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE native_doctor (value TEXT)')
  } finally {
    db.close()
  }
  checks.push({ moduleName: 'better-sqlite3', runtime: 'Node', ok: true, detail: `loaded (ABI ${process.versions.modules})` })
} catch (error) {
  checks.push({ moduleName: 'better-sqlite3', runtime: 'Node', ok: false, detail: error instanceof Error ? error.message : String(error) })
}

try {
  const pty = require('node-pty')
  if (typeof pty.spawn !== 'function') throw new Error('spawn() is unavailable')
  checks.push({ moduleName: 'node-pty', runtime: 'Node', ok: true, detail: `loaded (ABI ${process.versions.modules})` })
} catch (error) {
  checks.push({ moduleName: 'node-pty', runtime: 'Node', ok: false, detail: error instanceof Error ? error.message : String(error) })
}

const electronPath = require('electron')
const probe = spawnSync(electronPath, ['-e', 'console.log(process.versions.modules)'], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
checks.push({
  moduleName: 'electron',
  runtime: 'Electron',
  ok: probe.status === 0,
  detail: probe.status === 0 ? `ABI ${probe.stdout.trim()}` : (probe.stderr || probe.error?.message || 'probe failed').trim()
})

for (const check of checks) {
  console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.runtime.padEnd(8)} ${check.moduleName}: ${check.detail}`)
}

if (checks.some((check) => !check.ok)) {
  console.error('\nRecovery: npm run rebuild:native:node (tests) or npm run rebuild:native:electron (app).')
  process.exit(1)
}
