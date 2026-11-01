#!/usr/bin/env node
// B13 (BE-M-02): reads the Electron fuses of a PACKAGED binary and fails when any differs from what
// electron-builder.yml asks for. The packaging step flips them; nothing else proves they landed in the exe that ships.
//
//   node scripts/check-fuses.mjs --app dist/win-unpacked/OXESpace.exe
//       the shipped tree: every fuse as configured; on Windows also the embedded asar integrity hash.
//   node scripts/check-fuses.mjs --app <test copy> --test-copy-of dist/win-unpacked/OXESpace.exe
//       the throwaway copy the packaged E2E launches: it must differ from the shipped exe in exactly one byte, the
//       EnableNodeCliInspectArguments fuse turned back on, which Playwright's _electron.launch needs (--inspect).
//
// Same reader as `npx @electron/fuses read --app <path>`, without parsing its coloured output.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
const { FuseState } = require('@electron/fuses/dist/constants')

/** Wanted state per fuse; a fuse not listed is not checked. Keep in step with electronFuses in electron-builder.yml. */
const EXPECTED_FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true
}
/** The one fuse the E2E copy turns back on. */
const TEST_COPY_FUSE = 'EnableNodeCliInspectArguments'

function option(name) {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] : undefined
}

function fail(message) {
  console.error(`check-fuses: ${message}`)
  process.exit(1)
}

const stateOf = state => state === FuseState.ENABLE ? true : state === FuseState.DISABLE ? false : undefined

const app = option('--app')
if (!app || !existsSync(app)) fail(`pass --app <packaged executable>; got ${app ?? 'nothing'}`)
const shipped = option('--test-copy-of')
const wire = await getCurrentFuseWire(app)

if (shipped) {
  if (!existsSync(shipped)) fail(`--test-copy-of ${shipped} does not exist`)
  const reference = await getCurrentFuseWire(shipped)
  const problems = []
  for (const name of Object.keys(FuseV1Options).filter(key => Number.isNaN(Number(key)))) {
    const index = FuseV1Options[name]
    const wanted = name === TEST_COPY_FUSE ? FuseState.ENABLE : reference[index]
    if (wire[index] !== wanted) problems.push(`${name}: ${wire[index]} (want ${wanted})`)
  }
  const a = readFileSync(app), b = readFileSync(shipped)
  let differing = a.length === b.length ? 0 : Infinity
  for (let index = 0; index < a.length && differing <= 1; index++) if (a[index] !== b[index]) differing++
  console.log(`[fuses] test copy: ${differing} byte(s) differ from the shipped binary`)
  if (problems.length) fail(`the test copy's fuses are wrong: ${problems.join('; ')}`)
  if (differing !== 1) fail(`the test copy differs from the shipped binary in ${differing} bytes; only the ${TEST_COPY_FUSE} fuse may differ`)
  console.log(`check-fuses: ${app} is the shipped binary with only ${TEST_COPY_FUSE} on`)
  process.exit(0)
}

const problems = []
for (const [name, wanted] of Object.entries(EXPECTED_FUSES)) {
  const actual = stateOf(wire[FuseV1Options[name]])
  console.log(`[fuses] ${name}: ${actual === undefined ? `unknown state ${wire[FuseV1Options[name]]}` : actual ? 'Enabled' : 'Disabled'} (want ${wanted ? 'Enabled' : 'Disabled'})`)
  if (actual !== wanted) problems.push(name)
}
if (problems.length) fail(`${app} has the wrong state for ${problems.join(', ')}. Check electronFuses in electron-builder.yml.`)

// Windows validates app.asar against a SHA-256 of its header embedded in the exe (resource INTEGRITY/ELECTRONASAR).
// The fuse alone proves nothing if the resource is missing or was taken before app.asar last changed.
if (app.toLowerCase().endsWith('.exe')) {
  const { NtExecutable, NtExecutableResource } = require('resedit')
  const { getRawHeader } = require('@electron/asar')
  const resource = NtExecutableResource.from(NtExecutable.from(readFileSync(app)))
  const entry = resource.entries.find(item => item.type === 'INTEGRITY' && item.id === 'ELECTRONASAR')
  if (!entry) fail(`${app} embeds no asar integrity resource (INTEGRITY/ELECTRONASAR)`)
  const list = JSON.parse(Buffer.from(entry.bin).toString('utf8'))
  const record = list.find(item => String(item.file).replace(/\//g, '\\').toLowerCase() === 'resources\\app.asar')
  if (!record || record.alg !== 'SHA256') fail(`the integrity resource has no SHA256 for resources\\app.asar: ${JSON.stringify(list)}`)
  const asar = join(dirname(app), 'resources', 'app.asar')
  const actual = createHash('sha256').update(getRawHeader(asar).headerString).digest('hex')
  console.log(`[fuses] asar integrity: embedded ${record.value}, app.asar header ${actual}`)
  if (record.value.toLowerCase() !== actual) fail('the embedded asar integrity hash does not match resources/app.asar')
}
console.log(`check-fuses: ${app}: ${Object.keys(EXPECTED_FUSES).length} fuses as configured`)
