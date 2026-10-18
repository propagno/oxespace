/**
 * Pure knowledge about the agents' hook vocabularies: which events exist for
 * which Claude version, and what each event means for a pane's status.
 */
import type { AgentHookAgent, AgentHookState } from '../../../../shared/types/agent-hooks'

/**
 * First Claude Code release that knows each hook event. Claude validates
 * `hooks` against a closed enum and discards the WHOLE settings.json (env,
 * permissions, every user hook) on one unknown event name, so an event may only
 * be written for a Claude that knows it. Values are Orca's measurements.
 */
export const CLAUDE_HOOK_EVENT_FIRST_VERSIONS: Readonly<Record<string, string>> = {
  PreToolUse: '1.0.23',
  PostToolUse: '1.0.23',
  Stop: '1.0.31',
  UserPromptSubmit: '1.0.53',
  SessionStart: '1.0.62',
  SessionEnd: '1.0.85',
  PermissionRequest: '2.0.45',
  PostToolUseFailure: '2.0.56',
  PostCompact: '2.1.76',
  StopFailure: '2.1.78'
}

/** Events that carry a `matcher` (tool-scoped); the rest take none. */
const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest'])

/**
 * Version assumed when `claude --version` cannot be read: the first release
 * that has the core lifecycle events. Nothing newer is written on a guess.
 */
export const UNRESOLVED_CLAUDE_VERSION = '1.0.64'

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
] as const

export function parseVersion(text: string | null | undefined): string | null {
  return text?.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null
}

export function versionReaches(version: string, floor: string): boolean {
  const a = version.split('.').map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return true
}

export interface HookEventPlan {
  eventName: string
  matcher?: string
}

function plan(eventName: string): HookEventPlan {
  return MATCHER_EVENTS.has(eventName) ? { eventName, matcher: '*' } : { eventName }
}

export function claudeEventPlan(claudeVersion: string | null | undefined): HookEventPlan[] {
  const version = parseVersion(claudeVersion) ?? UNRESOLVED_CLAUDE_VERSION
  return Object.entries(CLAUDE_HOOK_EVENT_FIRST_VERSIONS)
    .filter(([, first]) => versionReaches(version, first))
    .map(([eventName]) => plan(eventName))
}

export function codexEventPlan(): HookEventPlan[] {
  return CODEX_HOOK_EVENTS.map((eventName) => plan(eventName))
}

export interface HookPayload {
  hook_event_name?: unknown
  tool_name?: unknown
  agent_id?: unknown
  session_id?: unknown
  source?: unknown
  [key: string]: unknown
}

/**
 * Maps one hook delivery to a pane state, or null when it says nothing about
 * the lead agent's state.
 */
export function mapHookEvent(agent: AgentHookAgent, payload: HookPayload): AgentHookState | null {
  const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : ''
  // Subagent events describe a child, not the lead; only a permission prompt
  // is worth surfacing since it blocks the whole turn.
  if (typeof payload.agent_id === 'string' && payload.agent_id && event !== 'PermissionRequest') return null

  switch (event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return 'working'
    case 'PreToolUse': {
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : ''
      return tool === 'AskUserQuestion' || tool === 'request_user_input' ? 'waiting' : 'working'
    }
    case 'PermissionRequest':
      return 'waiting'
    case 'Stop':
    case 'StopFailure':
    case 'PostCompact':
      return 'done'
    case 'SessionStart': {
      // Claude also emits SessionStart on compact; only a fresh, resumed or
      // cleared session is an idle prompt.
      const source = typeof payload.source === 'string' ? payload.source : 'startup'
      if (agent === 'claude-code' && !['startup', 'resume', 'clear'].includes(source)) return null
      return 'done'
    }
    case 'SessionEnd':
      return 'ended'
    default:
      return null
  }
}
