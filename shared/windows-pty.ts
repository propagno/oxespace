/**
 * Windows ConPTY build-number plumbing shared by main, preload, and renderer
 * so `@xterm/xterm` receives accurate `windowsPty` configuration (OXE-436).
 */

export const WINDOWS_BUILD_ARG = '--oxe-win-build='

/** Windows 11 22H2 fallback when the exact OS build number is unavailable. */
export const DEFAULT_WINDOWS_CONPTY_BUILD = 22621

export interface WindowsPtyOption {
  backend: 'conpty'
  buildNumber: number
}

/**
 * Extracts a Windows OS build number from either `os.release()` (`"10.0.26200"`)
 * or a plain integer string (`"26200"`).
 */
export function parseWindowsBuildNumber(releaseString: string | undefined): number | undefined {
  if (!releaseString) return undefined
  const trimmed = releaseString.trim()
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  const parts = trimmed.split('.')
  if (parts.length < 3 || !/^\d+$/.test(parts[2])) return undefined
  const parsed = Number.parseInt(parts[2], 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Reads the Windows build number in the sandboxed preload: prefers the
 * `--oxe-win-build=<n>` argument forwarded by main, falling back to Electron's
 * `process.getSystemVersion()` when present.
 */
export function readWindowsBuildFromArgv(
  argv: readonly string[],
  platform: NodeJS.Platform,
  systemVersion?: string
): number | undefined {
  if (platform !== 'win32') return undefined
  const rawArg = argv.find((arg) => arg.startsWith(WINDOWS_BUILD_ARG))?.slice(WINDOWS_BUILD_ARG.length)
  return parseWindowsBuildNumber(rawArg) ?? parseWindowsBuildNumber(systemVersion)
}

/**
 * Builds the `@xterm/xterm` `windowsPty` option on Windows ConPTY hosts.
 * Passing this aligns xterm's `Buffer.resize()` scrollback behavior with ConPTY
 * instead of assuming a POSIX PTY.
 */
export function resolveWindowsPty(
  app?: { platform?: string; windowsBuildNumber?: number }
): WindowsPtyOption | undefined {
  if (app?.platform !== 'win32') return undefined
  const build = app.windowsBuildNumber
  return {
    backend: 'conpty',
    buildNumber: typeof build === 'number' && Number.isFinite(build) && build > 0
      ? Math.floor(build)
      : DEFAULT_WINDOWS_CONPTY_BUILD
  }
}
