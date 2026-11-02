// @vitest-environment node
/**
 * What electron-builder.yml's `files:` puts in app.asar, computed by electron-builder itself:
 * its config loader (which regroups and merges the `files:` entries), its main file matchers
 * and its file walk, run on a fake project that holds a built out/ tree. No packaging, no
 * Electron. CI's package step checks the real app.asar too, but only when it packages; this
 * runs on every PR.
 *
 * Guards the bug where the `!out/**\/*.map` exclude sat after the migrations FileSet, got
 * merged ahead of `out/**\/*` and did nothing, so every main-process source map shipped.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const req = createRequire(join(ROOT, 'package.json'))
const { getConfig } = req('app-builder-lib/out/util/config/config')
const { getMainFileMatchers } = req('app-builder-lib/out/fileMatcher')
const { computeFileSets, getDestinationPath } = req('app-builder-lib/out/util/appFileCopier')

const FAKE_FILES = [
  'out/main/index.js',
  'out/main/index.js.map',
  'out/main/chunks/activity-x1.js',
  'out/main/chunks/activity-x1.js.map',
  'out/preload/index.mjs',
  'out/renderer/index.html',
  'out/renderer/assets/index-x2.js',
  'electron/main/db/migrations/001_init.sql',
  'src/App.tsx'
]

let project: string
let packaged: string[]

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'oxespace-package-files-'))
  for (const file of FAKE_FILES) {
    mkdirSync(dirname(join(project, file)), { recursive: true })
    writeFileSync(join(project, file), '')
  }
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'oxespace', version: '0.0.0', main: 'out/main/index.js' }))
  writeFileSync(join(project, 'electron-builder.yml'), readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8'))

  // The same override CI and the dist scripts pass on the command line, so the merge runs as it does there.
  const config = await getConfig(project, join(project, 'electron-builder.yml'), { npmRebuild: false })
  const destination = join(project, 'stage')
  const info = { projectDir: project, appDir: project, buildResourcesDir: 'build', isPrepackedAppAsar: false, config, debugLogger: { isEnabled: false } }
  const matchers = getMainFileMatchers(project, destination, (s: string) => s, {}, { info }, join(project, 'dist'), false)
  const fileSets = await computeFileSets(matchers, null, { info }, false)
  packaged = fileSets.flatMap((set: { files: string[]; metadata: Map<string, { isFile(): boolean }> }) =>
    set.files
      .filter(file => set.metadata.get(file)?.isFile())
      .map(file => relative(destination, getDestinationPath(file, set)).replace(/\\/g, '/'))
  )
})

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true })
})

describe('electron-builder files', () => {
  test('no source map under out/ reaches the package', () => {
    expect(packaged.filter(file => file.startsWith('out/') && file.endsWith('.map'))).toEqual([])
  })

  test('the built app, package.json and the migrations still ship', () => {
    expect(packaged).toEqual(expect.arrayContaining([
      'package.json',
      'out/main/index.js',
      'out/main/chunks/activity-x1.js',
      'out/preload/index.mjs',
      'out/renderer/index.html',
      'out/renderer/assets/index-x2.js',
      'out/main/migrations/001_init.sql'
    ]))
  })

  test('sources outside out/ stay out', () => {
    expect(packaged).not.toContain('src/App.tsx')
    expect(packaged).not.toContain('electron-builder.yml')
  })
})
