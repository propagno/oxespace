#!/usr/bin/env node
// B13 (BE-M-02): reads the Electron fuses of a PACKAGED binary and fails when any differs from what
// electron-builder.yml asks for. The packaging step flips them; nothing else proves they landed in the exe that ships.
//
//   node scripts/check-fuses.mjs --app dist/win-unpacked/OXESpace.exe
//
// Same reader as `npx @electron/fuses read --app <path>`, without parsing its coloured output.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
const { FuseState } = require('@electron/fuses/dist/constants')

/** Wanted state per fuse; a fuse not listed is not checked. Keep in step with electronFuses in electron-builder.yml. */
const EXPECTED_FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  // Stays on in 1.4: Playwright's _electron.launch needs --inspect for every packaged spec (see electron-builder.yml).
  EnableNodeCliInspectArguments: true,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true
}

const appIndex = process.argv.indexOf('--app')
const app = appIndex > 0 ? process.argv[appIndex + 1] : undefined
if (!app || !existsSync(app)) {
  console.error(`check-fuses: pass --app <packaged executable>; got ${app ?? 'nothing'}`)
  process.exit(1)
}

const wire = await getCurrentFuseWire(app)
const problems = []
for (const [name, wanted] of Object.entries(EXPECTED_FUSES)) {
  const state = wire[FuseV1Options[name]]
  const actual = state === FuseState.ENABLE ? true : state === FuseState.DISABLE ? false : undefined
  console.log(`[fuses] ${name}: ${actual === undefined ? `unknown state ${state}` : actual ? 'Enabled' : 'Disabled'} (want ${wanted ? 'Enabled' : 'Disabled'})`)
  if (actual !== wanted) problems.push(name)
}
if (problems.length) {
  console.error(`check-fuses: ${app} has the wrong state for ${problems.join(', ')}. Check electronFuses in electron-builder.yml.`)
  process.exit(1)
}
console.log(`check-fuses: ${app}: ${Object.keys(EXPECTED_FUSES).length} fuses as configured`)
