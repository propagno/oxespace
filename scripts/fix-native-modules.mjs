/**
 * Downloads prebuilt binaries for native modules targeting Electron.
 * Run this after `npm install` and before `npm run dist`.
 *
 * Usage: node scripts/fix-native-modules.mjs
 */

import https from 'node:https'
import { createWriteStream, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import tar from 'tar'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Electron 31.7.7 → electron ABI 125
const ELECTRON_VERSION = '31.7.7'
const ELECTRON_ABI = '125'
const ARCH = 'x64'

const MODULES = [
  {
    name: 'better-sqlite3',
    version: '12.9.0',
    url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v12.9.0/better-sqlite3-v12.9.0-electron-v${ELECTRON_ABI}-win32-${ARCH}.tar.gz`,
    nodeFile: `node_modules/better-sqlite3/build/Release/better_sqlite3.node`,
    extractTo: `node_modules/better-sqlite3`
  }
]

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'oxespace-build' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject)
      }
      resolve(res)
    }).on('error', reject)
  })
}

for (const mod of MODULES) {
  const nodeFile = join(ROOT, mod.nodeFile)
  const extractTo = join(ROOT, mod.extractTo)

  console.log(`→ ${mod.name}: downloading electron-v${ELECTRON_ABI} prebuilt...`)

  // Delete old binary so extraction overwrites it. During Codex Desktop runs the
  // host process can keep the native module loaded from this workspace; in that
  // case the file is already usable for Electron and cannot be unlinked on
  // Windows, so leave it in place and continue packaging.
  let canExtract = true
  if (existsSync(nodeFile)) {
    try {
      rmSync(nodeFile)
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
      canExtract = false
      console.warn(`! ${mod.name}: native binary is locked; keeping existing ${nodeFile}`)
    }
  }
  mkdirSync(dirname(nodeFile), { recursive: true })

  if (canExtract) {
    const res = await get(mod.url)
    await new Promise((resolve, reject) =>
      res.pipe(tar.extract({ cwd: extractTo })).on('finish', resolve).on('error', reject)
    )
  }

  console.log(`✓ ${mod.name} installed for Electron ${ELECTRON_VERSION} (ABI ${ELECTRON_ABI})`)
}

console.log('\nAll native modules ready for Electron packaging.')
