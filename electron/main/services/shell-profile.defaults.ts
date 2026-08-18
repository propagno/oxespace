import type { ShellProfile } from '../../../shared/types/workspace'

/**
 * Which built-in shell profile belongs to the host platform.
 *
 * The rows themselves are seeded by migrations (001/002/031 seed the Windows
 * set; 046 adds the POSIX one and repoints existing references). This module is
 * the single place that knows WHICH builtin id the host should use, so the
 * DB-backed services and the DB-less code paths — the native-failure IPC
 * fallbacks and the E2E mock layer in index.ts — can never disagree.
 */

export const WINDOWS_SHELL_PROFILE_ID = 'builtin-powershell'
export const POSIX_SHELL_PROFILE_ID = 'builtin-bash'

/**
 * Executable + args for the POSIX neutral shell. Must stay in lockstep with
 * migration 046_shell_profiles_posix.sql, which seeds the same values.
 *
 * `-l` (login shell) is deliberate: when the app is launched from a desktop
 * entry rather than a terminal, it inherits a minimal environment, and a login
 * shell is what restores the user's real PATH (nvm, ~/.local/bin, pnpm).
 */
export const POSIX_SHELL_EXECUTABLE = '/bin/bash'
export const POSIX_SHELL_ARGS: string[] = ['-l']

/** The neutral (non-agent) built-in shell — what a fresh split pane gets. */
export function defaultSplitShellProfileId(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? WINDOWS_SHELL_PROFILE_ID : POSIX_SHELL_PROFILE_ID
}

/** The builtin ids the shell-profile picker lists, in display order. */
export function builtinShellProfileIds(platform: NodeJS.Platform = process.platform): string[] {
  return [defaultSplitShellProfileId(platform), 'builtin-claude', 'builtin-copilot']
}

/** Static profile list for the code paths that run without a database. */
export function fallbackShellProfiles(platform: NodeJS.Platform = process.platform): ShellProfile[] {
  const neutral: ShellProfile = platform === 'win32'
    ? { id: WINDOWS_SHELL_PROFILE_ID, name: 'PowerShell', executable: 'powershell.exe', args: ['-NoLogo'], isBuiltin: true }
    : { id: POSIX_SHELL_PROFILE_ID, name: 'Bash', executable: POSIX_SHELL_EXECUTABLE, args: [...POSIX_SHELL_ARGS], isBuiltin: true }

  return [
    neutral,
    { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
    { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
  ]
}
