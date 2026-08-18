/**
 * Shell command used to run a discovered workspace script.
 *
 * Shared because the Scripts panel (renderer) and the internal MCP
 * `oxespace_list_scripts` tool (main) must offer the user and the agent exactly
 * the same command — they previously carried two hand-synced copies of this
 * logic, both of which emitted cmd.exe syntax unconditionally.
 *
 * The command is handed to a shell, so every interpolated path is quoted.
 */

export type ScriptExtension = 'ps1' | 'sh' | 'npm'

/** Runnable script file extensions (`npm` entries are synthesised, not files). */
export type ScriptFileExtension = Extract<ScriptExtension, 'ps1' | 'sh'>

export function escapeDoubleQuotes(value: string): string {
  return value.replace(/"/g, '\\"')
}

export function buildScriptCommand(
  fullPath: string,
  extension: ScriptFileExtension,
  platform: NodeJS.Platform
): string {
  const script = escapeDoubleQuotes(fullPath)
  if (platform === 'win32') {
    return extension === 'ps1'
      ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}"`
      : buildWindowsShellScriptCommand(script)
  }
  // POSIX: bash is guaranteed present; PowerShell is `pwsh` when the user
  // installed it, and the shell reports a clear "command not found" if not.
  return extension === 'ps1'
    ? `pwsh -NoProfile -File "${script}"`
    : `bash "${script}"`
}

/** Windows has no system bash — fall back to the one Git for Windows ships. */
function buildWindowsShellScriptCommand(script: string): string {
  return [
    'if exist "%ProgramFiles%\\Git\\bin\\bash.exe" ("%ProgramFiles%\\Git\\bin\\bash.exe" "' + script + '")',
    'else if exist "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" ("%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" "' + script + '")',
    'else (echo Git Bash not found. Install Git for Windows to run .sh scripts. & exit /b 1)'
  ].join(' ')
}

/** Joins a workspace root with a relative path using the root's own separator. */
export function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`
}
