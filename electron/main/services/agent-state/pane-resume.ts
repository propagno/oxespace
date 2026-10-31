/**
 * B17 · How a pane's first start in an app run goes back to its agent's native session, and the Claude session id main
 * names when it starts Claude Code itself (so a pane is resumable even without the agent hooks installed).
 *
 * Everything here returns argument vectors built by main from a recorded UUID: nothing is typed into a shell.
 */
import { randomUUID } from 'node:crypto'
import { mainMessage } from '../../../../shared/messages'
import type { PaneAgentResume } from '../../../../shared/types/ipc/terminal'
import { agentFromCommand } from './agents'
import { resumeArgs, type PaneResumeRecord, type ResumableAgent } from './pane-sessions'

/** Arguments that already pick a session, or run something other than an interactive session, per provider. */
const OWN_SESSION: Record<ResumableAgent, RegExp> = {
  claude: /^(-r|--resume|-c|--continue|--session-id|--fork-session|-p|--print)(=|$)/,
  codex: /^(resume|fork|exec|e)$/
}
/** Claude Code subcommands: none of them is a conversation. */
const CLAUDE_SUBCOMMANDS = new Set(['mcp', 'config', 'doctor', 'update', 'install', 'migrate-installer', 'setup-token', 'plugin', 'plugins', 'agents'])

export interface PaneResumeStart {
  agentCommand?: string
  agentArgs?: string[]
  initialPrompt?: string
}

export interface PaneResumeDeps {
  /** False when the organization policy does not allow the provider here. */
  allowed(agent: ResumableAgent): boolean
  /** Whether the provider still has the session for that folder (see native-session-files.ts). */
  exists(agent: ResumableAgent, sessionId: string, cwd: string): Promise<boolean>
}

export interface PaneResumePlan {
  /** What this start reports to the window; undefined when it was not the pane's first start in this run. */
  status?: PaneAgentResume
  /** The agent command to start: the pane's own, or the provider itself for a shell pane whose agent was typed by hand. */
  agentCommand?: string
  /** Arguments to append, after the command's own. */
  extraArgs: string[]
}

function notResumed(agent: ResumableAgent, sessionId: string, code: 'sessionMissing' | 'otherAgent' | 'launchOverride' | 'blocked' | 'disabled'): PaneAgentResume {
  return { outcome: 'notResumed', agent, sessionId, message: mainMessage(`agents.resume.${code}`, {}) }
}

export async function planPaneResume(record: PaneResumeRecord | null, start: PaneResumeStart, cwd: string, deps: PaneResumeDeps): Promise<PaneResumePlan> {
  const unchanged = { agentCommand: start.agentCommand, extraArgs: [] }
  if (record === null) return unchanged
  if (record === 'none') return { ...unchanged, status: { outcome: 'nothingRecorded' } }
  const { agent, sessionId } = record
  const fail = (code: Parameters<typeof notResumed>[2]): PaneResumePlan => ({ ...unchanged, status: notResumed(agent, sessionId, code) })
  if (!record.wanted) return fail('disabled')
  const parts = start.agentCommand?.trim().split(/\s+/) ?? []
  if (start.agentArgs?.length || (!parts.length && start.initialPrompt)) return fail('launchOverride')
  if (parts.length && agentFromCommand(parts[0]) !== agent) return fail('otherAgent')
  if (parts.slice(1).some(part => OWN_SESSION[agent].test(part))) return fail('launchOverride')
  if (!deps.allowed(agent)) return fail('blocked')
  if (!(await deps.exists(agent, sessionId, cwd))) return fail('sessionMissing')
  return { agentCommand: start.agentCommand ?? agent, extraArgs: resumeArgs(agent, sessionId), status: { outcome: 'resumed', agent, sessionId } }
}

/**
 * When main starts Claude Code for a fresh conversation, it names the session (`--session-id <uuid>`, as Thread does)
 * and returns the id to record, so the pane can resume it later whether or not the hooks report. Null when the
 * command is not Claude, already picks a session, or runs a subcommand.
 */
export function claudeSessionToAssign(executable: string | undefined, args: string[]): string | null {
  if (agentFromCommand(executable) !== 'claude') return null
  if (args.some(arg => OWN_SESSION.claude.test(arg))) return null
  if (args[0] && CLAUDE_SUBCOMMANDS.has(args[0])) return null
  return randomUUID()
}
