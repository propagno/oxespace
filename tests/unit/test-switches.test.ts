// @vitest-environment node
// T50: a packaged build neither moves the person's database nor shares their profile with a second instance.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { singleInstanceDisabled, testDatabasePath } from '../../electron/main/test-switches'

const DEFAULT = 'C:\\Users\\person\\AppData\\Roaming\\OXESpace'
const ON = { OXESPACE_DISABLE_SINGLE_INSTANCE: '1' }

describe('OXESPACE_DB_PATH', () => {
  it('is ignored by a packaged build', () => {
    expect(testDatabasePath({ OXESPACE_DB_PATH: 'D:\\elsewhere\\db.sqlite3' }, true)).toBeUndefined()
  })

  it('still moves the database of an unpackaged run, as the dev E2E specs need', () => {
    expect(testDatabasePath({ OXESPACE_DB_PATH: '/tmp/e2e/db.sqlite3' }, false)).toBe('/tmp/e2e/db.sqlite3')
    expect(testDatabasePath({ OXESPACE_DB_PATH: '' }, false)).toBeUndefined()
    expect(testDatabasePath({}, false)).toBeUndefined()
  })
})

describe('OXESPACE_DISABLE_SINGLE_INSTANCE', () => {
  const packaged = (userDataDirSwitch: string, platform: NodeJS.Platform = 'win32') =>
    singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch, defaultUserData: DEFAULT, platform })

  it("is ignored by a packaged build on the person's own profile", () => {
    expect(packaged('')).toBe(false)
    expect(packaged('   ')).toBe(false)
    expect(packaged(DEFAULT)).toBe(false)
    // The same folder written differently is still the person's profile.
    expect(packaged('c:\\users\\PERSON\\appdata\\roaming\\oxespace\\')).toBe(false)
  })

  it('lets a packaged build run a second instance on its own --user-data-dir', () => {
    expect(packaged('C:\\Temp\\oxe-packaged-win32-1\\user-data')).toBe(true)
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: '/tmp/oxe/user-data', defaultUserData: '/home/person/.config/OXESpace', platform: 'linux' })).toBe(true)
  })

  it('keeps the unpackaged behaviour, and is off without the variable', () => {
    expect(singleInstanceDisabled({ env: ON, isPackaged: false, userDataDirSwitch: '', defaultUserData: DEFAULT })).toBe(true)
    expect(singleInstanceDisabled({ env: {}, isPackaged: false, userDataDirSwitch: 'C:\\Temp\\x', defaultUserData: DEFAULT })).toBe(false)
    expect(singleInstanceDisabled({ env: { OXESPACE_DISABLE_SINGLE_INSTANCE: 'true' }, isPackaged: true, userDataDirSwitch: 'C:\\Temp\\x', defaultUserData: DEFAULT })).toBe(false)
  })
})

describe('the app reads both switches only through test-switches.ts', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'electron', 'main', file), 'utf8')

  it('db/index.ts and index.ts pass app.isPackaged and read no variable directly', () => {
    expect(read('db/index.ts')).toContain('testDatabasePath(process.env, app.isPackaged)')
    expect(read('db/index.ts')).not.toMatch(/process\.env(\.|\[['"])OXESPACE_DB_PATH/)
    const entry = read('index.ts')
    expect(entry).toMatch(/singleInstanceDisabled\(\{\s*env: process\.env,\s*isPackaged: app\.isPackaged,\s*userDataDirSwitch: app\.commandLine\.getSwitchValue\('user-data-dir'\)/)
    expect(entry).not.toMatch(/OXESPACE_DISABLE_SINGLE_INSTANCE/)
    // The only other read: dev mode keeps its own profile unless a test moved the database.
    expect([...entry.matchAll(/OXESPACE_DB_PATH/g)]).toHaveLength(1)
    expect(entry).toMatch(/if \(isDev && !process\.env\.OXESPACE_DB_PATH\)/)
  })
})
