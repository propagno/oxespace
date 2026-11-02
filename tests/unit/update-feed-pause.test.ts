import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

/**
 * The bad-release runbook (docs/ci-cd.md, "Stop the spread") pauses an update by adding `stagingPercentage: 0` to
 * the release's latest*.yml. This proves, against the electron-updater version we ship, that the edit the runbook
 * describes is read the way the runbook says: 0 stops every install, 100 or no field lets every install through,
 * and a partial value splits installs by their staging id. Release gate G8, part B.
 */
const require = createRequire(import.meta.url)
const { AppUpdater } = require('electron-updater/out/AppUpdater') as {
  AppUpdater: { prototype: { isStagingMatch(this: unknown, info: Record<string, unknown>): Promise<boolean> } }
}
const yaml = require('js-yaml') as { load(text: string): Record<string, unknown> }
const { version: updaterVersion } = require('electron-updater/package.json') as { version: string }

// The shape of the published v1.3.3 latest.yml (values shortened).
const MANIFEST = [
  'version: 1.3.4',
  'files:',
  '  - url: OXESpace-1.3.4-x64.exe',
  '    sha512: AAAA',
  '    size: 205071810',
  'path: OXESpace-1.3.4-x64.exe',
  'sha512: AAAA',
  "releaseDate: '2026-10-25T03:35:24.126Z'",
  ''
].join('\n')

/** What the runbook tells the release owner to do: add one line to the downloaded manifest. */
const paused = (percentage: number) => `${MANIFEST}stagingPercentage: ${percentage}\n`

// The staging id is a UUID kept in the install's userData; its last 4 bytes decide where it falls in 0–100 %.
const LOW_ID = '00000000-0000-4000-8000-000000000001' // ~0 %
const HIGH_ID = '00000000-0000-4000-8000-0000fffffff0' // ~100 %

function updaterWith(stagingId: string) {
  return {
    stagingUserIdPromise: { value: Promise.resolve(stagingId) },
    _logger: { info: () => undefined, warn: () => undefined }
  }
}

const matches = (manifest: string, stagingId: string) =>
  AppUpdater.prototype.isStagingMatch.call(updaterWith(stagingId), yaml.load(manifest))

describe(`update feed pause (electron-updater ${updaterVersion})`, () => {
  test('stagingPercentage: 0 stops every install, whatever its staging id', async () => {
    expect(await matches(paused(0), LOW_ID)).toBe(false)
    expect(await matches(paused(0), HIGH_ID)).toBe(false)
  })

  test('without the field, or at 100, every install updates (the runbook is undone by removing the line)', async () => {
    expect(await matches(MANIFEST, LOW_ID)).toBe(true)
    expect(await matches(MANIFEST, HIGH_ID)).toBe(true)
    expect(await matches(paused(100), HIGH_ID)).toBe(true)
  })

  test('a partial value lets through only the installs below it (a staged rollout)', async () => {
    expect(await matches(paused(50), LOW_ID)).toBe(true)
    expect(await matches(paused(50), HIGH_ID)).toBe(false)
  })

  test('the edited manifest still parses as the same release', () => {
    const info = yaml.load(paused(0))
    expect(info.version).toBe('1.3.4')
    expect(info.path).toBe('OXESpace-1.3.4-x64.exe')
    expect(info.stagingPercentage).toBe(0)
  })
})
