import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pinned = require('../package.json').devDependencies.electron
const installed = require('electron/package.json').version
if (!/^\d+\.\d+\.\d+$/.test(pinned) || installed !== pinned) throw Error('Electron must match the exact reviewed version in package.json')
const response = await fetch('https://registry.npmjs.org/electron/latest', { signal: AbortSignal.timeout(20000) })
if (!response.ok) throw Error(`Cannot verify Electron support: registry HTTP ${response.status}`)
const latest = (await response.json()).version
if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest)) throw Error('Invalid Electron stable version from registry')
const distance = Number(latest.split('.')[0]) - Number(installed.split('.')[0])
// Electron supports the latest three stable major lines. Fail closed on lookup
// failure; a stale runtime is not silently accepted when audit omits devDeps.
if (distance < 0 || distance > 2) throw Error(`Electron ${installed} is outside the supported stable majors (latest ${latest})`)
console.log(`Electron ${installed}: supported major line; latest stable ${latest}`)
