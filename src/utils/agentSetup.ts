import type { AgentProvider, AgentReadiness } from '../../shared/types/agent'

/**
 * What the first-run card says about the agent CLIs on this machine. Kept apart from the
 * component so every state, and the wording that goes with it, can be tested directly.
 *
 * Thread talks only to Claude Code and Codex; Code can run any of the others too. The
 * summary says so, because "a CLI was found" is not enough to use Thread.
 */
export type AgentSetupState = 'unchecked' | 'checking' | 'ready' | 'needs-attention' | 'none'

export interface AgentSetupSummary {
  state: AgentSetupState
  headline: string
  detail: string
  /** Display names of the CLIs that are ready. */
  ready: string[]
  /** True when Claude Code or Codex is ready, the two Thread can use. */
  threadReady: boolean
}

const LABELS: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot CLI',
  cursor: 'Cursor',
  grok: 'Grok',
  antigravity: 'Antigravity'
}
const THREAD_PROVIDERS: AgentProvider[] = ['claude', 'codex']

export function agentLabel(provider: AgentProvider): string {
  return LABELS[provider] ?? provider
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function summarizeAgentSetup(readiness: AgentReadiness[], checking: boolean): AgentSetupSummary {
  const ready = readiness.filter(entry => entry.status === 'ready')
  const partial = readiness.filter(entry => entry.status === 'partial')
  const missing = readiness.filter(entry => entry.status === 'missing')
  const readyNames = ready.map(entry => agentLabel(entry.provider))
  const threadReady = ready.some(entry => THREAD_PROVIDERS.includes(entry.provider))

  if (ready.length > 0) {
    return {
      state: 'ready',
      headline: `${joinNames(readyNames)} ${ready.length === 1 ? 'is' : 'are'} ready`,
      detail: threadReady
        ? 'Code and Thread can use it.'
        : 'Code can run it. Thread needs Claude Code or Codex.',
      ready: readyNames,
      threadReady
    }
  }
  if (checking) {
    return { state: 'checking', headline: 'Checking for agent CLIs…', detail: 'Looking for the commands on your PATH.', ready: [], threadReady: false }
  }
  if (partial.length > 0) {
    const names = partial.map(entry => agentLabel(entry.provider))
    return {
      state: 'needs-attention',
      headline: `${joinNames(names)} ${partial.length === 1 ? 'was' : 'were'} found but not ready`,
      detail: partial.find(entry => entry.details)?.details ?? 'Open Agents settings to see what is missing.',
      ready: [],
      threadReady: false
    }
  }
  if (missing.length > 0) {
    return {
      state: 'none',
      headline: 'No agent CLI found',
      detail: 'OXESpace runs agents as local CLIs. Install Claude Code or Codex, make sure the command is on your PATH, then check again.',
      ready: [],
      threadReady: false
    }
  }
  return { state: 'unchecked', headline: 'Agent CLIs not checked yet', detail: 'Check which agent CLIs are installed on this machine.', ready: [], threadReady: false }
}
