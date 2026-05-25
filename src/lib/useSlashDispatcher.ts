import { useCallback } from 'react'
import type { AgentProfile } from '../../shared/types/agent'
import type { SlashCommandDefinition, SlashCommandId } from '../../shared/types/slash'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { useAgentStore } from '../store/agent.store'
import { useBackgroundStore } from '../store/background.store'
import { findMemberForPane, useIntegrationStore } from '../store/integration.store'
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
  // Note: openContextUsage was dropped when the Usage popover feature was
  // removed — the slash dispatcher never actually invoked it (no /usage
  // case), so the binding was effectively dead. Keeping this comment so a
  // future "/usage" slash command doesn't get re-wired to a missing store
  // method by accident.
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
          throw new Error(`Agent "${arg}" not found. Try: ${allProfiles.map((p) => p.name).slice(0, 4).join(', ')}…`)
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
      case 'integration': {
        // Sub-commands live in `argument` because the slash overlay only
        // surfaces top-level commands. We parse on dispatch so the overlay
        // doesn't need to know about every sub-form.
        await dispatchIntegrationSubcommand({
          paneId,
          workspaceId: workspace.id,
          argument
        })
        return
      }
      case 'help':
        // No-op — the overlay itself is the help screen.
        return
      default: {
        const exhaustive: never = id
        throw new Error(`Unhandled slash command: ${String(exhaustive)}`)
      }
    }
  }, [pane, workspace, splitPane, updatePaneName, setPaneAgent, allProfiles, openWorktreeMenu, openMcpPanel, startBackgroundJob, invokeSkill])
}

/**
 * Handles `/integration` and its sub-commands. Reads the latest integration
 * store snapshot (no need to subscribe — this only fires on user dispatch)
 * and reuses the existing IPC helpers via the store.
 *
 *   /integration                       → full context markdown of the active
 *                                        group, written to the pane.
 *   /integration members               → compact one-liner per sibling.
 *   /integration handoff <role> <msg>  → create + log a handoff to the
 *                                        member with that role.
 *
 * Output is written to the pane via `terminal.write` (same channel skills
 * use). When the pane isn't part of any integration, we still write a
 * friendly hint so the agent knows nothing happened.
 */
async function dispatchIntegrationSubcommand(input: { paneId: string; workspaceId: string; argument: string }): Promise<void> {
  const { paneId, workspaceId, argument } = input
  const trimmed = argument.trim()
  const state = useIntegrationStore.getState()
  const found = findMemberForPane(state.groups, workspaceId, paneId)
  if (!found) {
    await writeLines(paneId, [
      '# Integration',
      'This pane is not part of any integration group yet. Open the Integration panel to create one and add this workspace as a member.'
    ])
    return
  }
  const group = state.groups.find((g) => g.id === found.groupId)
  if (!group) return

  // Sub-command routing. First token decides the action; the remainder is
  // the action's argument.
  const [sub, ...rest] = trimmed.split(/\s+/)
  const remainder = rest.join(' ')

  if (!sub || sub.toLowerCase() === 'context') {
    const ctx = await state.buildContext(group.id, found.memberId)
    await writeLines(paneId, [ctx.text])
    return
  }

  if (sub.toLowerCase() === 'members') {
    const lines = group.members.map((member) => {
      const branch = member.branch ? `branch=${member.branch}` : 'branch=?'
      const session = member.activeSessionId ? `agent=${member.activeProvider}` : 'agent=—'
      return `- ${member.role}/${member.alias ?? member.workspaceName ?? member.workspaceId} · ${branch} · ${session}`
    })
    await writeLines(paneId, [`# Integration: ${group.name} (${group.members.length} members)`, ...lines])
    return
  }

  if (sub.toLowerCase() === 'handoff') {
    const [role, ...messageParts] = rest
    const message = messageParts.join(' ').trim()
    if (!role || !message) {
      await writeLines(paneId, ['# Integration handoff', 'Usage: /integration handoff <role> <message>'])
      return
    }
    const target = group.members.find((m) => m.role.toLowerCase() === role.toLowerCase())
    if (!target) {
      await writeLines(paneId, [`# Integration handoff`, `No member with role "${role}" in "${group.name}".`])
      return
    }
    await state.createHandoff({
      groupId: group.id,
      fromMemberId: found.memberId,
      toMemberId: target.id,
      title: `${found.memberId.slice(0, 6)} → ${target.role}`,
      content: message,
      status: 'sent'
    })
    await writeLines(paneId, [`# Integration handoff queued for ${target.role}`, message])
    return
  }

  await writeLines(paneId, ['# Integration', `Unknown sub-command "${sub}". Try: /integration, /integration members, /integration handoff <role> <message>`])
}

async function writeLines(paneId: string, lines: string[]): Promise<void> {
  // Trailing newline ensures the agent CLI processes the block as one turn.
  const data = lines.join('\n') + '\n'
  await window.oxe.terminal.write({ paneId, data })
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
