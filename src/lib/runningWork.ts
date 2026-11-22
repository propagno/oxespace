import type { RunningTurn } from './closeGuard'
import { useTerminalStore } from '../store/terminal.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { derivePaneDisplayState } from '../utils/paneDisplay'

/**
 * OXE-368: what works in OxeCode outside a conversation, and that closing the window stops. Loaded only when a close
 * is asked (closeGuard imports it lazily): it reads the stores and the pane status rules, which the guard itself
 * must not pull into the entry chunk.
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

/** Background jobs still running, asked of main for each workspace. A workspace whose list fails counts as none. */
export async function runningJobs(): Promise<RunningTurn[]> {
  const list = window.oxe?.background?.list
  if (!list) return []
  const { workspaces } = useWorkspaceStore.getState()
  const perWorkspace = await Promise.all(workspaces.map(async (workspace): Promise<RunningTurn[]> => {
    try {
      const jobs = await list(workspace.id)
      if (!Array.isArray(jobs)) return []
      return jobs.filter(job => job.status === 'running')
        .map(job => ({ id: `job:${job.id}`, title: job.label?.trim() || job.command, kind: 'job' as const, workspace: workspace.name }))
    } catch {
      // The question is a courtesy: a list that fails does not hold the close.
      return []
    }
  }))
  return perWorkspace.flat()
}

/**
 * Agents and jobs together. The agents are known at once, from the stores; the jobs are main's, so they wait no longer
 * than `late` (the guard's lookup deadline, resolving null) and then count as none.
 */
export async function runningWork(late: Promise<null>): Promise<RunningTurn[]> {
  const agents = runningAgents()
  const jobs = await Promise.race([runningJobs(), late])
  return [...agents, ...(jobs ?? [])]
}
