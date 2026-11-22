import type { ThreadProvider } from './types/thread'

/**
 * What the preload's sendTyped and steerTyped append: the person just typed this text. It is the only thing that gives
 * a send or steer from the window the authority to run one of the commands below.
 */
export const THREAD_TEXT_TYPED = 'typed'

/** Only names with a concrete integrated handler belong here. */
export const DESKTOP_COMMANDS = new Set(['model', 'effort', 'permissions', 'approvals', 'allowed-tools', 'plan', 'status', 'capabilities', 'delegations', 'delegation', 'new', 'clear', 'reset', 'resume', 'rename', 'name', 'archive', 'delete', 'copy', 'export', 'help', 'skills', 'accounts', 'login', 'logout', 'settings', 'config', 'pwd', 'cwd', 'stop', 'quit', 'exit', 'diff', 'review', 'compact', 'checkpoint', 'instructions', 'rules', 'spending', 'work', 'events'])
export const CODEX_DESKTOP_COMMANDS = new Set(['usage', 'mcp', 'apps', 'plugins', 'plugin', 'fork', 'hooks', 'experimental', 'debug-config', 'ps', 'goal', 'memories'])
export function hasDesktopCommand(provider: ThreadProvider, name: string): boolean {
  return DESKTOP_COMMANDS.has(name) || provider === 'codex' && CODEX_DESKTOP_COMMANDS.has(name)
}
