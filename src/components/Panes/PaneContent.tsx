import { type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { ReviewPane } from '../Review/ReviewPane'
import { useWorkspaceStore } from '../../store/workspace.store'
import { TerminalPane } from './TerminalPane'

interface PaneContentProps {
  pane: WorkspacePane
  workspaceId: string
  workspaceRootPath: string
  autoStart: boolean
}

export function PaneContent({ autoStart, pane, workspaceId, workspaceRootPath }: PaneContentProps): ReactElement {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === workspaceId) ?? null)

  switch (pane.type) {
    case 'editor':
      return workspace
        ? <EditorPane workspaceId={workspaceId} rootPath={workspace.rootPath} />
        : <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
    case 'review':
      return workspace
        ? <ReviewPane workspaceId={workspaceId} rootPath={workspace.rootPath} />
        : <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
    case 'terminal':
    case 'tasks':
    default:
      // Issues/tasks UI was removed; legacy 'tasks' panes fall back to terminal.
      // Other deprecated types (graph/swarm/inspector) are migrated by SQL and
      // still land here if a partial migration left them behind.
      return <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
  }
}
