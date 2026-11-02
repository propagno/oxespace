import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/android/avd-rc-pass.sh keeps the team's memory floor (docs/validation/mobile-avd-rc-pass.md): no boot under
 * 4 GB free. RC_FAKE_FREE_MB stands in for the machine's memory, and the SDK points nowhere, so no emulator or adb can
 * start whatever happens.
 */
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0
let root: string

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'oxe-rc-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(phase: string, freeMb: number) {
  const env = { PATH: process.env.PATH ?? '', RC_ROOT: join(root, 'rc'), OUT: join(root, 'out'), RC_FAKE_FREE_MB: String(freeMb), ANDROID_SDK_ROOT: join(root, 'no-sdk'), APK: join(root, 'none.apk') }
  return spawnSync('sh', [join('scripts', 'android', 'avd-rc-pass.sh'), phase], { env, encoding: 'utf8', timeout: 20_000 })
}

describe.runIf(hasSh)('avd-rc-pass.sh memory floor', () => {
  it('preflight passes with 4 GB free and touches no emulator', () => {
    const result = run('preflight', 5000)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/memory: ok \(5000 MB free\)/)
    expect(existsSync(join(root, 'out', 'emulator.log'))).toBe(false)
  })

  it('refuses to boot with less than 4 GB free, and says why in fail.txt', () => {
    for (const phase of ['preflight', 'pair', 'script']) {
      const result = run(phase, 3000)
      expect(result.status, phase).toBe(1)
      expect(readFileSync(join(root, 'rc', 'fail.txt'), 'utf8')).toMatch(/^memory: 3000 MB free, 4096 MB needed/)
      expect(existsSync(join(root, 'out', 'emulator.log')), phase).toBe(false)
    }
  })

  it('rejects an unknown phase', () => {
    expect(run('boot', 5000).status).toBe(2)
  })
})
