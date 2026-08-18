#!/usr/bin/env node
/**
 * Packages for the HOST platform.
 *
 * `npm run dist` used to be a hard alias for the Windows target, so running it
 * on Linux silently attempted an NSIS build and failed deep inside
 * electron-builder. Resolving the target here keeps the short command honest and
 * gives an actionable error on an unsupported host.
 *
 * Usage: npm run dist   (or node scripts/dist-host.mjs)
 */
import { spawn } from 'node:child_process'

const TARGETS = {
  win32: 'dist:win',
  linux: 'dist:linux'
}

const script = TARGETS[process.platform]
if (!script) {
  console.error(
    `No packaging target for ${process.platform}. ` +
    `Supported hosts: ${Object.keys(TARGETS).join(', ')}. ` +
    `Run "npm run dist:win" or "npm run dist:linux" explicitly to cross-check a config.`
  )
  process.exit(1)
}

console.log(`dist: host is ${process.platform} → npm run ${script}`)

// shell:true so the platform's npm shim (npm.cmd on Windows) resolves.
const child = spawn('npm', ['run', script], { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error(`dist: failed to launch npm — ${error.message}`)
  process.exit(1)
})
