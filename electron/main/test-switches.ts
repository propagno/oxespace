import { resolve } from 'node:path'

/**
 * T50: the two test switches the app reads from its environment, and what a packaged build does with them.
 * An installed app must not let a variable move or share the person's data:
 * - OXESPACE_DB_PATH (any database file) is honored only by an unpackaged run. A packaged test isolates its data
 *   with Chromium's --user-data-dir instead, so the database stays the app's own `<userData>/oxespace.sqlite3`.
 * - OXESPACE_DISABLE_SINGLE_INSTANCE=1 (a second instance) is honored by a packaged build only together with a
 *   --user-data-dir that is not the default one, so two instances never share the person's profile.
 * Pure on purpose: index.ts and db/index.ts pass app.isPackaged and the paths, tests/unit/test-switches.test.ts
 * covers both modes.
 */
export function testDatabasePath(env: Record<string, string | undefined>, isPackaged: boolean): string | undefined {
  if (isPackaged) return undefined
  return env.OXESPACE_DB_PATH || undefined
}

export interface SingleInstanceInput {
  env: Record<string, string | undefined>
  isPackaged: boolean
  /** `app.commandLine.getSwitchValue('user-data-dir')`: empty when the switch is absent. */
  userDataDirSwitch: string
  /** The profile a packaged build uses without the switch: `<appData>/<app name>`. */
  defaultUserData: string | (() => string)
  platform?: NodeJS.Platform
  /** Resolves junctions, symlinks and 8.3 names of a path that exists; throws when it does not. index.ts passes
   *  `realpathSync.native`; this module stays pure (no fs: tests/integration/fs-allowlist.test.ts). Without it the
   *  comparison is on the path text. */
  realpath?: (path: string) => string
}

export function singleInstanceDisabled({ env, isPackaged, userDataDirSwitch, defaultUserData, platform = process.platform, realpath = (path: string) => path }: SingleInstanceInput): boolean {
  if (env.OXESPACE_DISABLE_SINGLE_INSTANCE !== '1') return false
  if (!isPackaged) return true
  if (!userDataDirSwitch.trim()) return false
  const normalize = (path: string) => {
    // Another spelling of the person's profile (junction, symlink, short name, \\?\ prefix) must still count as theirs.
    let full = resolve(path)
    try { full = realpath(full) } catch { /* A folder that does not exist yet cannot be the existing profile. */ }
    full = full.replace(/^\\\\\?\\/, '').replace(/[\\/.]+$/, '')
    return platform === 'win32' || platform === 'darwin' ? full.toLowerCase() : full
  }
  // Read only now: app.getPath('appData') throws in some environments, and a normal start never needs it. When it
  // cannot be read, keep the single instance (fail closed).
  let profile: string
  try { profile = typeof defaultUserData === 'function' ? defaultUserData() : defaultUserData } catch { return false }
  return normalize(userDataDirSwitch) !== normalize(profile)
}
