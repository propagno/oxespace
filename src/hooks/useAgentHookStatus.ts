import { useEffect } from 'react'
import { useTerminalStore } from '../store/terminal.store'

/**
 * Feeds the terminal store with status reported by the agents' own lifecycle
 * hooks. Optional by construction: without installed hooks (or a bridge that
 * predates them) nothing arrives and the output-timing heuristic stays in
 * charge.
 */
export function useAgentHookStatus(): void {
  useEffect(() => {
    const unsubscribe = window.oxe?.agentHooks?.onStatus?.((event) => {
      useTerminalStore.getState().setHookStatus(event.paneId, event.state, event.at)
    })
    return () => unsubscribe?.()
  }, [])
}
