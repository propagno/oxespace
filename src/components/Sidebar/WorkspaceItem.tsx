import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'

interface WorkspaceItemProps {
  workspace: Workspace
  isActive: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

const DOT_COLORS = ['green', 'blue', 'purple', 'yellow', 'orange'] as const
type DotColor = (typeof DOT_COLORS)[number]

function pickDotColor(id: string): DotColor {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return DOT_COLORS[Math.abs(hash) % DOT_COLORS.length]
}

export function WorkspaceItem({ workspace, isActive, onSelect, onClose }: WorkspaceItemProps): ReactElement {
  const dotColor = pickDotColor(workspace.id)

  return (
    <div
      className={`workspace-item${isActive ? ' active' : ''}`}
      data-testid="sidebar-workspace-item"
    >
      <button
        type="button"
        className="ws-select"
        data-testid="sidebar-workspace-select"
        onClick={() => onSelect(workspace.id)}
      >
        <span className={`ws-dot ${dotColor}`} aria-hidden="true" />
        <span className="ws-name">{workspace.name}</span>
        <span className="ws-path">{workspace.rootPath}</span>
        {workspace.panes.length > 0 ? (
          <span className="ws-badge">{workspace.panes.length}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="ws-close"
        aria-label={`Close ${workspace.name}`}
        title="Close workspace"
        onClick={() => onClose(workspace.id)}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  )
}
