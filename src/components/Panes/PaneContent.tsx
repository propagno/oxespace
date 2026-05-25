import { type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { ReviewPane } from '../Review/ReviewPane'
import { TasksPane } from '../Tasks/TasksPane'
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
    case 'tasks':
      return <TasksPane workspaceId={workspaceId} />
    case 'editor':
      return workspace
        ? <EditorPane workspaceId={workspaceId} rootPath={workspace.rootPath} />
        : <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
    case 'review':
      return workspace
        ? <ReviewPane workspaceId={workspaceId} rootPath={workspace.rootPath} />
        : <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
    case 'terminal':
    default:
      // Legacy panes persisted with deprecated types (graph/swarm/inspector) are
      // migrated to 'terminal' by 025_drop_legacy_pane_types.sql; this default
      // catches anything that survives a partial migration.
      return <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
  }
}
