import { create } from 'zustand'
import type { AgentHookAgent, AgentHooksStatus } from '../../shared/types/agent-hooks'
import type { PaneAgentResume } from '../../shared/types/ipc/terminal'

/**
 * F32 · What became of each agent pane's earlier session when the app reopened (B17, `terminal.status().agentResume`:
 * resumed, not resumed and why, or nothing recorded), and the one question about the agents' status hooks, without
 * which a pane cannot record its session (Codex has no other way). Main resumes; nothing here starts a session.
 */
export type ResumeAgent = 'claude' | 'codex'
export const HOOK_AGENT: Record<ResumeAgent, AgentHookAgent> = { claude: 'claude-code', codex: 'codex' }
const DONT_ASK_KEY = 'oxe.agentHooks.dontAsk'

function readDontAsk(): AgentHookAgent[] {
  try {
    const value = JSON.parse(localStorage.getItem(DONT_ASK_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((agent): agent is AgentHookAgent => agent === 'claude-code' || agent === 'codex') : []
  } catch { return [] }
}

/** "Don't ask again" for this agent's hooks; a UI preference, kept in this window's storage. */
export function dontAskHooks(agent: AgentHookAgent): void {
  const agents = readDontAsk()
  if (agents.includes(agent)) return
  try { localStorage.setItem(DONT_ASK_KEY, JSON.stringify([...agents, agent])) } catch { /* asked again next run */ }
}

interface AgentResumeState {
  /** The outcome main reported for each pane's first start in this run. */
  byPane: Record<string, PaneAgentResume>
  /** The agents' hook installs, read once per run. */
  hooks: Partial<Record<AgentHookAgent, AgentHooksStatus>>
  /** The agent whose hooks the window is asking about now, if any. */
  asking: AgentHookAgent | null
  /** Agents already asked about in this run ("Not now" lasts until the app restarts). */
  asked: Partial<Record<AgentHookAgent, true>>
  /** The pane whose "Start fresh" the window is confirming, outside the pane's menu (which closes). */
  freshAsk: { paneId: string; agent: ResumeAgent } | null
  askFresh: (ask: { paneId: string; agent: ResumeAgent } | null) => void
  /** Reads the pane's outcome once main has one; later calls are free. */
  load: (paneId: string) => Promise<PaneAgentResume | undefined>
  /** Forgets the pane's outcome and reads it again (after a restart). */
  reload: (paneId: string) => Promise<PaneAgentResume | undefined>
  /** Reads the hook installs once per run. */
  loadHooks: () => Promise<void>
  /** Asks about this agent's hooks, once per run, when they are missing and the person did not say "Don't ask again". */
  offerHooks: (agent: ResumeAgent, force?: boolean) => Promise<void>
  answerHooks: (answer: 'install' | 'notNow' | 'never') => Promise<AgentHooksStatus | null>
  hooksMissing: (agent: ResumeAgent) => boolean
  reset: () => void
}

export const useAgentResumeStore = create<AgentResumeState>((set, get) => ({
  byPane: {},
  hooks: {},
  asking: null,
  asked: {},
  freshAsk: null,

  askFresh: (freshAsk) => set({ freshAsk }),

  load: async (paneId) => {
    const known = get().byPane[paneId]
    if (known) return known
    const status = await window.oxe?.terminal?.status?.(paneId).catch(() => null)
    const outcome = status?.agentResume
    if (outcome) set(state => ({ byPane: { ...state.byPane, [paneId]: outcome } }))
    return outcome
  },

  reload: async (paneId) => {
    set(state => {
      const byPane = { ...state.byPane }
      delete byPane[paneId]
      return { byPane }
    })
    return get().load(paneId)
  },

  loadHooks: async () => {
    if (Object.keys(get().hooks).length) return
    const list = await window.oxe?.agentHooks?.status?.().catch(() => null)
    if (!Array.isArray(list)) return
    set({ hooks: Object.fromEntries(list.map(status => [status.agent, status])) })
  },

  hooksMissing: (agent) => {
    const status = get().hooks[HOOK_AGENT[agent]]
    return !!status && status.state !== 'installed'
  },

  offerHooks: async (agent, force = false) => {
    await get().loadHooks()
    const hook = HOOK_AGENT[agent]
    const state = get()
    if (!state.hooksMissing(agent) || state.asking) return
    if (!force && (state.asked[hook] || readDontAsk().includes(hook))) return
    set({ asking: hook, asked: { ...state.asked, [hook]: true } })
  },

  answerHooks: async (answer) => {
    const agent = get().asking
    if (!agent) return null
    set({ asking: null })
    if (answer === 'never') dontAskHooks(agent)
    if (answer !== 'install') return null
    const next = await window.oxe.agentHooks.install(agent)
    set(state => ({ hooks: { ...state.hooks, [agent]: next } }))
    return next
  },

  reset: () => set({ byPane: {}, hooks: {}, asking: null, asked: {}, freshAsk: null })
}))
