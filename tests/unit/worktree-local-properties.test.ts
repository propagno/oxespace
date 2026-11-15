// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { ensureLocalProperties, sdkDirLine } from '../../scripts/heavy-lock.mjs'

const root = mkdtempSync(join(tmpdir(), 'oxe-114-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** An Android folder like mobile/android: settings.gradle.kts and, optionally, a local.properties. */
const android = (name: string, local?: string) => {
  const dir = join(root, name, 'mobile', 'android')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.gradle.kts'), '')
  if (local !== undefined) writeFileSync(join(dir, 'local.properties'), local)
  return dir
}

describe('a worktree finds the Android SDK (OXE-114)', () => {
  it('local.properties no worktree', () => {
    const main = android('main', 'sdk.dir=C\\:\\\\Android\\\\Sdk\n')
    // A new worktree without the file gets the main checkout's.
    const copied = android('wt-copy')
    expect(ensureLocalProperties(copied, main, {})).toBe('copied')
    expect(readFileSync(join(copied, 'local.properties'), 'utf8')).toBe('sdk.dir=C\\:\\\\Android\\\\Sdk\n')

    // With no main file, sdk.dir comes from ANDROID_HOME, escaped the way Android Studio writes it.
    const fromEnv = android('wt-env')
    expect(ensureLocalProperties(fromEnv, android('main-bare'), { ANDROID_HOME: 'C:\\Android\\Sdk' })).toBe('written')
    expect(readFileSync(join(fromEnv, 'local.properties'), 'utf8')).toBe(`${sdkDirLine('C:\\Android\\Sdk')}\n`)
    expect(sdkDirLine('C:\\Android\\Sdk')).toBe('sdk.dir=C\\:\\\\Android\\\\Sdk')

    // An existing file is never touched; a folder that is not Android, or no SDK known, writes nothing.
    const kept = android('wt-kept', 'sdk.dir=/opt/sdk\n')
    expect(ensureLocalProperties(kept, main, { ANDROID_HOME: 'x' })).toBe('kept')
    expect(readFileSync(join(kept, 'local.properties'), 'utf8')).toBe('sdk.dir=/opt/sdk\n')
    const plain = join(root, 'plain')
    mkdirSync(plain)
    expect(ensureLocalProperties(plain, main, {})).toBe('not-android')
    const lost = android('wt-lost')
    expect(ensureLocalProperties(lost, null, {})).toBe('no-sdk')
    expect(existsSync(join(lost, 'local.properties'))).toBe(false)
  })

  it('the file it writes is not versioned', () => {
    // mobile/android/.gitignore keeps local.properties out of git, so the written file never reaches a commit.
    expect(readFileSync(join(process.cwd(), 'mobile', 'android', '.gitignore'), 'utf8')).toMatch(/^local\.properties$/m)
  })
})
