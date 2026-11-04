import { useCallback } from 'react'
import type { SlashCommandDefinition } from '../../shared/types/slash'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

interface UseSlashDispatcherArgs {
  workspace: Workspace | null
  pane: WorkspacePane | null
}

/**
 * Dispatches a slash command chosen in a pane. What each command does lives in ./slashDispatch, loaded on the first
 * command rather than with the window (renderer entry headroom, after T52): the overlay that offers the commands is
 * itself opened later, so nothing on the first frame needs it.
 */
export function useSlashDispatcher({ workspace, pane }: UseSlashDispatcherArgs): (command: SlashCommandDefinition, argument: string) => Promise<void> {
  return useCallback(async (command: SlashCommandDefinition, argument: string): Promise<void> => {
    const { runSlashCommand } = await import('./slashDispatch')
    await runSlashCommand({ workspace, pane }, command, argument)
  }, [workspace, pane])
}
