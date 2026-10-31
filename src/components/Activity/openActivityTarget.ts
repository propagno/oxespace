import type { ActivityTarget } from '../../store/activity.store'
import { useBackgroundStore } from '../../store/background.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'

export type ActivityView = import('../../keyboard/keybindings').AppView

/**
 * Takes the person to what an entry is about: the conversation, the pane, the job, or the Settings
 * page for quotas and updates. It only navigates; approving or answering stays where it always was.
 */
export function openActivityTarget(target: ActivityTarget, selectView: (view: ActivityView) => void): void {
  switch (target.type) {
    case 'thread':
      selectView('thread')
      void useThreadStore.getState().select(target.threadId)
      return
    case 'pane':
      selectView('code')
      showWorkspace(target.workspaceId)
      useTerminalStore.getState().setActivePaneId(target.paneId)
      return
    case 'background':
      selectView('code')
      showWorkspace(target.workspaceId)
      void useWorkspaceStore.getState().updateBackgroundState({ workspaceId: target.workspaceId, backgroundPanelVisible: true, backgroundPanelExpanded: true })
      useBackgroundStore.getState().setExpanded(target.jobId)
      return
    case 'quota':
      useUIStore.getState().openSettingsPage('providers')
      return
    case 'update':
      useUIStore.getState().openSettingsPage('updates')
  }
}

function showWorkspace(workspaceId: string): void {
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) void useWorkspaceStore.getState().setActiveWorkspace(workspaceId)
}
