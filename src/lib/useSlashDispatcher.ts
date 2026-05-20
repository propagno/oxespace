import { useCallback } from 'react'
import type { AgentProfile } from '../../shared/types/agent'
import type { SlashCommandDefinition, SlashCommandId } from '../../shared/types/slash'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { useAgentStore } from '../store/agent.store'
import { useBackgroundStore } from '../store/background.store'
import { useSkillStore } from '../store/skill.store'
import { useUIStore } from '../store/ui.store'
import { useWorkspaceStore } from '../store/workspace.store'

interface UseSlashDispatcherArgs {
  workspace: Workspace | null
  pane: WorkspacePane | null
}

export function useSlashDispatcher({ workspace, pane }: UseSlashDispatcherArgs): (command: SlashCommandDefinition, argument: string) => Promise<void> {
  const splitPane = useWorkspaceStore((s) => s.splitPane)
  const updatePaneName = useWorkspaceStore((s) => s.updatePaneName)
  const setPaneAgent = useWorkspaceStore((s) => s.setPaneAgent)
  const allProfiles = useAgentStore((s) => s.allProfiles)
  const openContextUsage = useUIStore((s) => s.openContextUsage)
  const openWorktreeMenu = useUIStore((s) => s.openWorktreeMenu)
  const openMcpPanel = useUIStore((s) => s.openMcpPanel)
  const startBackgroundJob = useBackgroundStore((s) => s.startJob)
  const invokeSkill = useSkillStore((s) => s.invoke)

  return useCallback(async (command: SlashCommandDefinition, argument: string): Promise<void> => {
    if (!pane || !workspace) return
    const paneId = pane.id

    // User-defined skill — write the rendered prompt to the pane.
    if (command.skillName) {
      await invokeSkill(command.skillName, paneId, argument)
      return
    }

    const id = command.id as SlashCommandId
    switch (id) {
      case 'clear':
        // ANSI clear: ESC [ 2 J (erase whole screen) + ESC [ H (cursor home)
        await window.oxe.terminal.write({ paneId, data: '\x1b[2J\x1b[H' })
        return
      case 'restart':
        await window.oxe.terminal.restart({ paneId })
        return
      case 'new':
        // Send Ctrl+C first to interrupt anything running, then restart fresh.
        await window.oxe.terminal.write({ paneId, data: '\x03' })
        await new Promise((resolve) => setTimeout(resolve, 80))
        await window.oxe.terminal.restart({ paneId })
        return
      case 'fork':
        await splitPane(paneId, 'vertical')
        return
      case 'stop':
        await window.oxe.terminal.stop({ paneId })
        return
      case 'agent': {
        const arg = argument.trim()
        if (!arg) return
        const match = findAgentProfile(allProfiles, arg)
        if (!match) {
          throw new Error(`Agent "${arg}" não encontrado. Tente: ${allProfiles.map((p) => p.name).slice(0, 4).join(', ')}…`)
        }
        await setPaneAgent(paneId, match.agentProfileId)
        // Restart pane so the new agent's CLI is launched
        try { await window.oxe.terminal.restart({ paneId }) } catch { /* may not be running */ }
        return
      }
      case 'rename':
        if (argument.trim()) await updatePaneName(paneId, argument.trim())
        return
      case 'bg': {
        const command = argument.trim()
        if (!command) throw new Error('/bg requer um comando, ex: /bg npm run build')
        await startBackgroundJob({
          workspaceId: workspace.id,
          workspaceRootPath: workspace.rootPath,
          command,
          paneRootPath: pane.rootPath ?? null,
          confirmed: true
        })
        return
      }
      case 'worktree':
        openWorktreeMenu(paneId)
        return
      case 'mcp':
        openMcpPanel()
        return
      case 'help':
        // No-op — the overlay itself is the help screen.
        return
      default: {
        const exhaustive: never = id
        throw new Error(`Unhandled slash command: ${String(exhaustive)}`)
      }
    }
  }, [pane, workspace, splitPane, updatePaneName, setPaneAgent, allProfiles, openContextUsage, openWorktreeMenu, openMcpPanel, startBackgroundJob, invokeSkill])
}

/**
 * Fuzzy-match an agent by id, exact name (case-insensitive), provider name, or substring.
 * Priority: exact id > exact name > provider match > substring of name.
 */
function findAgentProfile(profiles: AgentProfile[], query: string): AgentProfile | null {
  const q = query.toLowerCase().trim()
  if (!q) return null

  // 1. exact id
  const byId = profiles.find((p) => p.agentProfileId === query)
  if (byId) return byId

  // 2. exact name (case-insensitive)
  const byName = profiles.find((p) => p.name.toLowerCase() === q)
  if (byName) return byName

  // 3. exact provider (e.g. "claude", "codex")
  const byProvider = profiles.find((p) => p.provider === q && p.isBuiltin)
  if (byProvider) return byProvider

  // 4. substring of name
  const bySubstring = profiles.find((p) => p.name.toLowerCase().includes(q))
  if (bySubstring) return bySubstring

  return null
}
