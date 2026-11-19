import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import { Suspense, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../../shared/types/workspace'
import { ReviewPane } from '../Review/ReviewPane'
import { PanelScopeBadge } from './PanelScopeBadge'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { DockPanel, IconButton, SegmentedControl, Skeleton } from '../../ui'
import { lazyFrom } from '../../lib/chunk'
import { CHANGES_PANEL_CHUNK } from './panelChunks'

// Over the shared chunk the surface warms at idle: once it has arrived, the Changes view opens without a fallback.
const ChangesPanel = lazyFrom(CHANGES_PANEL_CHUNK, module => module.ChangesPanel)

interface WorkspaceReviewPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceReviewPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceReviewPanelProps): ReactElement {
  const { t: tc } = useTranslation('code')
  // "Changes" is the new branch diff; "Classic" keeps per-line review comments
  // until they are ported to the Monaco diff.
  const [view, setView] = useState<'changes' | 'classic'>('changes')
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-review-panel"
      className="workspace-editor-panel"
      title={tc('panels.changes')}
      count={<PanelScopeBadge workspaceId={workspace.id} scope={scope} />}
      actions={<>
        <SegmentedControl
          value={view}
          onChange={setView}
          label={tc('workspace.review.viewLabel')}
          options={[
            { value: 'changes', label: tc('workspace.review.changesOption') },
            { value: 'classic', label: tc('workspace.review.classicOption') }
          ]}
        />
        <IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />
      </>}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        {view === 'classic'
          ? <ReviewPane workspaceId={workspace.id} rootPath={scope.rootPath} />
          : <Suspense fallback={<Skeleton lines={6} />}><ChangesPanel workspaceId={workspace.id} rootPath={scope.rootPath} onSendComments={async text => (await pasteIntoAgentTerminal(workspace.id, text)).ok} /></Suspense>}
      </div>
    </DockPanel>
  )
}
