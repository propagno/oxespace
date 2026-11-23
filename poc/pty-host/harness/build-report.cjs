'use strict'
// OXE-400 CA-5: the cold build time of the Rust host and the bytes each arm adds next to what node-pty ships today.
//   node build-report.cjs <cargo build seconds> <cargo --version>
const { readdirSync, statSync } = require('node:fs')
const { dirname, join } = require('node:path')

function bytes(path) {
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((sum, name) => sum + bytes(join(path, name)), 0)
}

const root = join(__dirname, '..', '..', '..')
const dist = join(__dirname, '..', 'dist')
const ptyRoot = dirname(require.resolve('node-pty/package.json', { paths: [root] }))
const exe = process.platform === 'win32' ? '.exe' : ''
const platformDir = process.platform === 'win32' ? join(ptyRoot, 'prebuilds', `win32-${process.arch}`) : join(ptyRoot, 'build', 'Release')
const kb = value => Math.round(value / 1024)

process.stdout.write(`${JSON.stringify({
  os: process.platform,
  cargo: process.argv[3],
  cargoBuildSeconds: Number(process.argv[2]),
  // electron-builder unpacks all of node_modules/node-pty (asarUnpack), so that is what ships today.
  nodePtyPackageKb: kb(bytes(ptyRoot)),
  nodePtyPlatformFilesKb: kb(bytes(platformDir)),
  rustNapiModuleKb: kb(bytes(join(dist, 'pty_napi_host.node'))),
  rustBinaryKb: kb(bytes(join(dist, `pty-bin-host${exe}`))),
}, null, 2)}\n`)
