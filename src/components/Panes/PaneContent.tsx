import { lazy, Suspense, type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { ReviewPane } from '../Review/ReviewPane'
import { TasksPane } from '../Tasks/TasksPane'
import { useWorkspaceStore } from '../../store/workspace.store'
import { TerminalPane } from './TerminalPane'

const LazyOxeGraphPanel = lazy(() =>
  import('../Oxe/OxeGraphPanel').then(m => ({ default: m.OxeGraphPanel }))
)

interface PaneContentProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
}

export function PaneContent({ autoStart, pane, workspaceId }: PaneContentProps): ReactElement {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === workspaceId) ?? null)

  switch (pane.type) {
    case 'terminal':
      return <TerminalPane pane={pane} workspaceId={workspaceId} autoStart={autoStart} />
    case 'tasks':
      return <TasksPane workspaceId={workspaceId} />
    case 'editor':
      return workspace ? <EditorPane workspaceId={workspaceId} rootPath={workspace.rootPath} /> : <StubPane label="Editor" />
    case 'swarm':
      return <StubPane label="Swarm" />
    case 'inspector':
      return <StubPane label="Inspector" />
    case 'graph':
      return workspace ? (
        <Suspense fallback={<StubPane label="Graph" />}>
          <LazyOxeGraphPanel workspaceId={workspaceId} rootPath={workspace.rootPath} />
        </Suspense>
      ) : <StubPane label="Graph" />
    case 'review':
      return workspace ? <ReviewPane workspaceId={workspaceId} rootPath={workspace.rootPath} /> : <StubPane label="Review" />
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
