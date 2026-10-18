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
    return () => { unsubscribe?.(); unsubscribeLocation?.() }
  }, [])
}
