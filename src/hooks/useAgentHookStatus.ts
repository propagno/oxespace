import { useEffect } from 'react'
import { useTerminalStore } from '../store/terminal.store'
import { invalidateGitBranch } from './useGitBranch'

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
    // The directory the agent works in, which can be another worktree than the pane's. Its branch is read
    // now rather than at the next poll, so the badge changes when the agent moves.
    const unsubscribeLocation = window.oxe?.agentHooks?.onLocation?.((event) => {
      useTerminalStore.getState().setLocation(event.paneId, { cwd: event.cwd, checkoutRoot: event.checkoutRoot, sameRepository: event.sameRepository })
      if (event.checkoutRoot) invalidateGitBranch(event.checkoutRoot)
    })
    // Lifecycle state read in the main process from hooks and the screen; it outranks the hook-only and timing guesses.
    const unsubscribeState = window.oxe?.agentState?.onChanged?.((event) => {
      useTerminalStore.getState().setAgentState(event.paneId, 'cleared' in event ? null : event.state)
    })
    void window.oxe?.agentState?.list?.().then(states => { for (const state of states ?? []) useTerminalStore.getState().setAgentState(state.paneId, state.state) }).catch(() => undefined)
    return () => { unsubscribe?.(); unsubscribeLocation?.(); unsubscribeState?.() }
  }, [])
}
