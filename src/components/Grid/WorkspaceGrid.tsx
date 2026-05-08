import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Fragment, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { getPaneAt, LAYOUTS } from './layouts'
import { PaneContainer } from './PaneContainer'

interface WorkspaceGridProps {
  workspace: Workspace
  maximizedPaneId: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
}

export function WorkspaceGrid({ maximizedPaneId, onClosePane, onSplitPane, onToggleMaximize, workspace }: WorkspaceGridProps): ReactElement {
  const maximizedPane = maximizedPaneId ? workspace.panes.find((pane) => pane.id === maximizedPaneId) : null

  if (maximizedPane) {
    return (
      <div className="workspace-grid workspace-grid-maximized" data-testid="workspace-grid">
        <PaneContainer
          pane={maximizedPane}
          workspaceId={workspace.id}
          autoStart={workspace.autoStart}
          isMaximized
          onClose={onClosePane}
          onToggleMaximize={onToggleMaximize}
          onSplitVertical={(id) => onSplitPane?.(id, 'vertical')}
          onSplitHorizontal={(id) => onSplitPane?.(id, 'horizontal')}
        />
      </div>
    )
  }

  const layout = LAYOUTS[workspace.layout]

  return (
    <div className="workspace-grid" data-testid="workspace-grid">
      <PanelGroup direction="vertical">
        {Array.from({ length: layout.rows }, (_, rowIndex) => (
          <Fragment key={rowIndex}>
            <Panel minSize={15} defaultSize={100 / layout.rows}>
              <PanelGroup direction="horizontal">
                {Array.from({ length: layout.columns }, (_, columnIndex) => {
                  const pane = getPaneAt(workspace.panes, rowIndex, columnIndex)
                  return (
                    <Fragment key={`${rowIndex}-${columnIndex}`}>
                      <Panel minSize={10} defaultSize={100 / layout.columns}>
                        {pane ? (
                          <PaneContainer
                            pane={pane}
                            workspaceId={workspace.id}
                            autoStart={workspace.autoStart}
                            isMaximized={false}
                            onClose={onClosePane}
                            onToggleMaximize={onToggleMaximize}
                            onSplitVertical={(id) => onSplitPane?.(id, 'vertical')}
                            onSplitHorizontal={(id) => onSplitPane?.(id, 'horizontal')}
                          />
                        ) : null}
                      </Panel>
                      {columnIndex < layout.columns - 1 ? <PanelResizeHandle className="resize-handle resize-handle-vertical" /> : null}
                    </Fragment>
                  )
                })}
              </PanelGroup>
            </Panel>
            {rowIndex < layout.rows - 1 ? <PanelResizeHandle className="resize-handle resize-handle-horizontal" /> : null}
          </Fragment>
        ))}
      </PanelGroup>
    </div>
  )
}
