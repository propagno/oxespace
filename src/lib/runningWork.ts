import type { RunningTurn } from './closeGuard'
import { useTerminalStore } from '../store/terminal.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { derivePaneDisplayState } from '../utils/paneDisplay'

/**
 * OXE-368: the terminal agents that closing the window stops. Loaded only when a close is asked and a terminal pane has
 * a state (closeGuard imports it lazily): it reads the pane status rules, which the guard itself must not pull into the
 * entry chunk. Background jobs are asked of main by the guard itself.
 */

/**
 * Terminal panes of every workspace, mounted or detached, whose agent is working or stopped on a decision. A pane is
 * an agent's as derivePaneDisplayState decides it: bound to one, or reported by its lifecycle or hooks. A plain shell
 * that prints is never one, and neither is an agent that finished its turn.
 */
export function runningAgents(): RunningTurn[] {
  const { workspaces } = useWorkspaceStore.getState()
  const states = useTerminalStore.getState().panes
  const found: RunningTurn[] = []
  for (const workspace of workspaces) {
    workspace.panes.forEach((pane, paneIndex) => {
      const terminal = states[pane.id]
      if (pane.type !== 'terminal' || !terminal) return
      const display = derivePaneDisplayState({ pane, workspace, terminal, profile: null, paneIndex })
      const agent = display.providerKey !== 'shell' || Boolean(pane.agentProfileId || terminal.hookState || (terminal.agentState && terminal.agentState !== 'unknown'))
      if (!agent) return
      if (display.statusTone !== 'thinking' && display.statusTone !== 'needs-decision') return
      found.push({ id: `pane:${pane.id}`, title: display.providerLabel, kind: 'agent', workspace: workspace.name })
    })
  }
  return found
}
