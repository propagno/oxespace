import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import { lazy, Suspense, useState, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { ReviewPane } from '../Review/ReviewPane'
import { PanelScopeBadge } from './PanelScopeBadge'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { i18n } from '../../i18n'
import { LoadingState } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

const ChangesPanel = lazy(() => import('../Changes/ChangesPanel').then(module => ({ default: module.ChangesPanel })))

interface WorkspaceReviewPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceReviewPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceReviewPanelProps): ReactElement {
  // "Changes" is the new branch diff; "Classic" keeps per-line review comments
  // until they are ported to the Monaco diff.
  const [view, setView] = useState<'changes' | 'classic'>('changes')
  return (
    <section className="workspace-editor-panel" data-testid="workspace-review-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <span>{tc('panels.changes')}</span>
          <PanelScopeBadge workspaceId={workspace.id} scope={scope} />
        </div>
        <div className="workspace-editor-actions" aria-label={tc('workspace.panel.actions')}>
          <button
            type="button"
            className="tile-btn"
            aria-pressed={view === 'classic'}
            style={{ width: 'auto', padding: '0 8px', fontSize: 'var(--fs-xs)' }}
            title={view === 'classic' ? tc('workspace.review.back') : tc('workspace.review.classic')}
            onClick={() => setView(value => value === 'classic' ? 'changes' : 'classic')}
          >
            {view === 'classic' ? 'Changes' : 'Classic'}
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            title={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} onClick={onCollapse}>
            <ChevronsRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        {view === 'classic'
          ? <ReviewPane workspaceId={workspace.id} rootPath={scope.rootPath} />
          : <Suspense fallback={<LoadingState label={tc('changes.loading')} />}><ChangesPanel workspaceId={workspace.id} rootPath={scope.rootPath} onSendComments={async text => (await pasteIntoAgentTerminal(workspace.id, text)).ok} /></Suspense>}
      </div>
    </section>
  )
}
