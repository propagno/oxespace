import { useEffect, useState } from 'react'
import type { CustomAgentDefinition, CustomAgentHandoff } from '../../../shared/types/custom-agents'
import type { ThreadConfiguration } from '../../../shared/types/thread'

export const NO_CUSTOM_AGENTS: CustomAgentDefinition[] = []

/** Loads project/user custom agents for `rootPath` via read-only IPC. */
export function useCustomAgents(rootPath?: string): CustomAgentDefinition[] {
  const [state, setState] = useState<{ rootPath?: string; agents: CustomAgentDefinition[] }>({
    rootPath: undefined,
    agents: NO_CUSTOM_AGENTS
  })

  useEffect(() => {
    const listCustomAgents = window.oxe?.thread?.listCustomAgents
    if (!rootPath || typeof listCustomAgents !== 'function') {
      return
    }
    let cancelled = false
    void listCustomAgents(rootPath)
      .then(result => {
        if (!cancelled) {
          setState({ rootPath, agents: Array.isArray(result) && result.length ? result : NO_CUSTOM_AGENTS })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ rootPath, agents: NO_CUSTOM_AGENTS })
      })
    return () => { cancelled = true }
  }, [rootPath])

  return rootPath && state.rootPath === rootPath ? state.agents : NO_CUSTOM_AGENTS
}

/** Maps a custom agent's declared mode to `ThreadConfiguration.mode`. */
export function toThreadMode(mode: CustomAgentDefinition['mode']): NonNullable<ThreadConfiguration['mode']> {
  if (mode === 'plan') return 'plan'
  if (mode === 'ask') return 'ask'
  return 'default'
}

/** Resolves the target mode + custom agent patch for a declarative handoff. */
export function resolveHandoffConfiguration(
  handoff: CustomAgentHandoff,
  customAgents: readonly CustomAgentDefinition[],
  current?: Pick<ThreadConfiguration, 'mode' | 'customAgentId'> | null
): Pick<ThreadConfiguration, 'mode' | 'customAgentId'> {
  const rawTarget = handoff.agent?.trim()
  if (rawTarget) {
    const lower = rawTarget.toLowerCase()
    const matchedAgent = customAgents.find(agent => agent.id === lower || agent.name.toLowerCase() === lower)
    if (matchedAgent) {
      return {
        mode: handoff.mode ? toThreadMode(handoff.mode) : toThreadMode(matchedAgent.mode),
        customAgentId: matchedAgent.id
      }
    }
    if (lower === 'agent' || lower === 'default') return { mode: 'default', customAgentId: null }
    if (lower === 'plan') return { mode: 'plan', customAgentId: null }
    if (lower === 'ask') return { mode: 'ask', customAgentId: null }
  }
  if (handoff.mode) {
    return { mode: toThreadMode(handoff.mode), customAgentId: null }
  }
  return {
    mode: current?.mode ?? 'default',
    customAgentId: current?.customAgentId ?? null
  }
}
