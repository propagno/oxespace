import type { AppDatabase } from '../../db'

/**
 * Settings > Terminal: whether the agents OXESpace starts in a terminal are started without permission prompts. On
 * until the person turns it off: the product owner's choice of 2026-11-12, with the access a new conversation starts
 * with. Kept in main, where only the window changes it; no agent hook or MCP tool reaches it.
 */
const KEY = 'terminal_agents_full_access'

export function terminalAgentsFullAccess(db: AppDatabase): boolean {
  try {
    const row = db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    return row?.value !== '0'
  } catch { return false }
}

export function setTerminalAgentsFullAccess(db: AppDatabase, enabled: boolean): boolean {
  db.prepare('INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(KEY, enabled ? '1' : '0', Date.now())
  return enabled
}

/** The option each agent's own CLI has for it (read from each `--help`, 2026-11-12). */
const FLAG: Record<string, string> = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  agy: '--dangerously-skip-permissions'
}
/** A command that already says how it asks, or where it runs, keeps its own choice. */
const OWN_CHOICE: Record<string, RegExp> = {
  claude: /^(--dangerously-skip-permissions|--allow-dangerously-skip-permissions|--permission-mode)(=|$)/,
  codex: /^(--dangerously-bypass-approvals-and-sandbox|--full-auto|--sandbox|-s|--ask-for-approval|-a)(=|$)/,
  agy: /^(--dangerously-skip-permissions|--sandbox)(=|$)/
}

/** The program a pane starts, as the name its agent is known by: `C:\tools\Claude.cmd` is `claude`. */
export function agentProgram(executable: string | undefined): string | undefined {
  return executable?.trim().replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase() || undefined
}

/**
 * The arguments of an agent started in a terminal, with the option that skips its permission prompts when the
 * setting is on. Only for the agents it knows, and never over a choice the command already makes.
 */
export function withFullAccess(agent: string | undefined, args: readonly string[], enabled: boolean): string[] {
  // Only its own entries: a program named like a property every object has (`constructor`) is not an agent.
  if (!enabled || !agent || !Object.hasOwn(FLAG, agent) || args.some(part => OWN_CHOICE[agent].test(part))) return [...args]
  return [FLAG[agent], ...args]
}
