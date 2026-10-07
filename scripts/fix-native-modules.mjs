/** Prepare packaged Node-API binaries and verify them in the pinned Electron. */
import { createRequire } from 'node:module'
import { rebuild } from '@electron/rebuild'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronVersion = require('electron/package.json').version
// SQLite 13 and node-pty 1.1 ship Node-API prebuilds. Do not overwrite these
// with an old Electron ABI binary, or rebuild SQLite's gypfile:false package.
const ptyRoot = dirname(require.resolve('node-pty/package.json'))
if (!existsSync(join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`))) {
  await rebuild({ buildPath: root, electronVersion, arch: process.arch,
    onlyModules: ['node-pty'], force: true })
}
for (const script of [join(ptyRoot, 'scripts', 'post-install.js'), join(root, 'scripts', 'run-native-verification.mjs')]) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Native modules verified for Electron ${electronVersion} (${process.platform}-${process.arch})`)
