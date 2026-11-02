// @vitest-environment node
// T50: a packaged build neither moves the person's database nor shares their profile with a second instance.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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

  it('treats another spelling of the profile as the profile: junction, short name, \\\\?\\ prefix, trailing dot', () => {
    // A fake realpath stands in for the file system: both spellings resolve to the same folder.
    const realpath = (path: string) => (/OXESPA~1|profile-link/i.test(path) ? DEFAULT : path)
    for (const spelling of ['C:\\Users\\person\\AppData\\Roaming\\OXESPA~1', 'C:\\Temp\\profile-link', '\\\\?\\C:\\Users\\person\\AppData\\Roaming\\OXESpace', `${DEFAULT}.`]) {
      expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: spelling, defaultUserData: DEFAULT, platform: 'win32', realpath }), spelling).toBe(false)
    }
    // A different folder is still different, under the Windows rules, on whatever machine runs this.
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: 'C:\\Temp\\own-profile', defaultUserData: DEFAULT, platform: 'win32', realpath })).toBe(true)
  })

  it('treats another spelling of the profile as the profile on Linux: symlink, trailing slash, ..', () => {
    const profile = '/home/person/.config/OXESpace'
    const realpath = (path: string) => (path === '/tmp/profile-link' ? profile : path)
    for (const spelling of ['/tmp/profile-link', `${profile}/`, '/home/person/.config/../.config/OXESpace', '/home/person/./.config/OXESpace']) {
      expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: spelling, defaultUserData: profile, platform: 'linux', realpath }), spelling).toBe(false)
    }
    // Linux paths are case-sensitive: another case is another folder.
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: '/home/person/.config/oxespace', defaultUserData: profile, platform: 'linux', realpath })).toBe(true)
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: '/tmp/oxe/user-data', defaultUserData: profile, platform: 'linux', realpath })).toBe(true)
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

  it("reads the default profile only when it decides, and keeps the lock when it can't be read", () => {
    // app.getPath('appData') throws in some environments (e2e/mcp-import.spec.ts): a normal start must not ask.
    const never = () => { throw new Error("Failed to get 'appData' path") }
    expect(singleInstanceDisabled({ env: ON, isPackaged: false, userDataDirSwitch: '', defaultUserData: never })).toBe(true)
    expect(singleInstanceDisabled({ env: {}, isPackaged: true, userDataDirSwitch: 'C:\\Temp\\x', defaultUserData: never })).toBe(false)
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: '', defaultUserData: never })).toBe(false)
    // Packaged, the variable and a switch: the profile is needed, and failing to read it fails closed.
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: 'C:\\Temp\\x', defaultUserData: never })).toBe(false)
    expect(singleInstanceDisabled({ env: ON, isPackaged: true, userDataDirSwitch: 'C:\\Temp\\x', defaultUserData: () => DEFAULT, platform: 'win32' })).toBe(true)
  })
})

describe('the app reads both switches only through test-switches.ts', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'electron', 'main', file), 'utf8')

  it('db/index.ts and index.ts pass app.isPackaged and read no variable directly', () => {
    expect(read('db/index.ts')).toContain('testDatabasePath(process.env, app.isPackaged)')
    expect(read('db/index.ts')).not.toMatch(/process\.env(\.|\[['"])OXESPACE_DB_PATH/)
    const entry = read('index.ts')
    expect(entry).toMatch(/singleInstanceDisabled\(\{\s*env: process\.env,\s*isPackaged: app\.isPackaged,\s*userDataDirSwitch: app\.commandLine\.getSwitchValue\('user-data-dir'\)/)
    // The default profile is a getter (read only when needed) and the real realpath resolves its other spellings.
    expect(entry).toContain("defaultUserData: () => join(app.getPath('appData'), app.getName()),")
    expect(entry).toContain('realpath: realpathSync.native,')
    expect(read('test-switches.ts')).not.toMatch(/from 'node:fs/)
    expect(entry).not.toMatch(/OXESPACE_DISABLE_SINGLE_INSTANCE/)
    // The only other read: dev mode keeps its own profile unless a test moved the database.
    expect([...entry.matchAll(/OXESPACE_DB_PATH/g)]).toHaveLength(1)
    expect(entry).toMatch(/if \(isDev && !process\.env\.OXESPACE_DB_PATH\)/)
  })

  it('no other file in electron/ reads either variable, however it is written', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return files(path)
      return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : []
    })
    const electron = join(process.cwd(), 'electron')
    const readers = files(electron)
      .map(path => relative(electron, path).split(sep).join('/'))
      .filter(file => file !== 'main/test-switches.ts')
      .filter(file => /OXESPACE_DB_PATH|OXESPACE_DISABLE_SINGLE_INSTANCE|['"`]OXESPACE_['"`]\s*\+|`OXESPACE_\$\{/.test(readFileSync(join(electron, file), 'utf8')))
    // index.ts keeps the dev-only line above; nothing else may read them.
    expect(readers).toEqual(['main/index.ts'])
  })
})
