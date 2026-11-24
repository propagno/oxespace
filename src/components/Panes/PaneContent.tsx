import { Suspense, type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useWorkspaceStore } from '../../store/workspace.store'
import { TerminalPane } from './TerminalPane'
import { i18n } from '../../i18n'
import { Spinner } from '../../ui'
import { chunk, lazyFrom } from '../../lib/chunk'
import { SHARED_PANEL_CHUNKS } from '../../lib/panelChunks'

// Editor and Review panes (Monaco, diff cards) are only needed once such a pane exists, so they stay out of the entry chunk.
// The editor is the same chunk the dock and OxeChat open (OXE-308): once any of them has it, a pane renders at once.
const EditorPane = lazyFrom(SHARED_PANEL_CHUNKS.files, m => m.EditorPane)
const ReviewPane = lazyFrom(chunk(() => import('../Review/ReviewPane')), m => m.ReviewPane)
const Loading = (): ReactElement => <Spinner label={i18n.t('ui.loading')} />
const loading = <Loading />

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
        ? <Suspense fallback={loading}><EditorPane workspaceId={workspaceId} rootPath={workspace.rootPath} /></Suspense>
        : <TerminalPane pane={pane} workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} autoStart={autoStart} />
    case 'review':
      return workspace
        ? <Suspense fallback={loading}><ReviewPane workspaceId={workspaceId} rootPath={workspace.rootPath} /></Suspense>
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
