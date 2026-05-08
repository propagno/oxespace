import type { ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { TasksPane } from '../Tasks/TasksPane'
import { TerminalPane } from './TerminalPane'

interface PaneContentProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
}

export function PaneContent({ autoStart, pane, workspaceId }: PaneContentProps): ReactElement {
  switch (pane.type) {
    case 'terminal':
      return <TerminalPane pane={pane} workspaceId={workspaceId} autoStart={autoStart} />
    case 'tasks':
      return <TasksPane workspaceId={workspaceId} />
    case 'editor':
      return <EditorPane pane={pane} workspaceId={workspaceId} />
    case 'swarm':
      return <StubPane label="Swarm" />
    case 'inspector':
      return <StubPane label="Inspector" />
    default:
      return <StubPane label="Pane" />
  }
}

function StubPane({ label }: { label: string }): ReactElement {
  return (
    <div className="pane-placeholder" data-testid="pane-stub">
      <strong>{label}</strong>
      <span>Coming soon</span>
    </div>
  )
}
