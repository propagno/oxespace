import type { ThreadProvider } from './types/thread'

/** Only names with a concrete integrated handler belong here. */
export const DESKTOP_COMMANDS = new Set(['model', 'effort', 'permissions', 'approvals', 'allowed-tools', 'plan', 'status', 'capabilities', 'delegations', 'delegation', 'new', 'clear', 'reset', 'resume', 'rename', 'name', 'archive', 'delete', 'copy', 'export', 'help', 'skills', 'accounts', 'login', 'logout', 'settings', 'config', 'pwd', 'cwd', 'stop', 'quit', 'exit', 'diff', 'review', 'compact', 'checkpoint'])
export const CODEX_DESKTOP_COMMANDS = new Set(['usage', 'mcp', 'apps', 'plugins', 'plugin', 'fork', 'rewind', 'hooks', 'experimental', 'debug-config', 'ps', 'goal', 'memories'])
export function hasDesktopCommand(provider: ThreadProvider, name: string): boolean {
  return DESKTOP_COMMANDS.has(name) || provider === 'codex' && CODEX_DESKTOP_COMMANDS.has(name)
}
