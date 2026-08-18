import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Fragment, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { getPaneAt, LAYOUTS } from './layouts'
import { PaneContainer } from './PaneContainer'

interface WorkspaceGridProps {
  workspace: Workspace
  agentProfiles?: AgentProfile[]
  maximizedPaneId: string | null
  activePaneId?: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
}

/**
 * Keep every pane mounted when maximizing. Replacing the tree with a single
 * PaneContainer (old behaviour) unmounted xterm mid-session — Grok/Claude on
 * the alt-screen lost scroll state and the remounted terminal could not scroll
 * up or down until the PTY was restarted.
 */
export function WorkspaceGrid({
  activePaneId,
  agentProfiles = [],
  maximizedPaneId,
  onActivatePane,
  onClosePane,
  onSplitPane,
  onToggleMaximize,
  workspace
}: WorkspaceGridProps): ReactElement {
  const layout = LAYOUTS[workspace.layout]
  const isMaximized = Boolean(maximizedPaneId)
  const maximizedPane = maximizedPaneId
    ? workspace.panes.find((pane) => pane.id === maximizedPaneId) ?? null
    : null

  return (
    <div
      className={`workspace-grid${isMaximized ? ' workspace-grid--maximized' : ''}`}
      data-testid="workspace-grid"
      data-maximized-pane={maximizedPaneId ?? undefined}
    >
      <PanelGroup direction="vertical" className="workspace-grid-vgroup">
        {Array.from({ length: layout.rows }, (_, rowIndex) => {
          const rowFocused = !maximizedPane || maximizedPane.rowIndex === rowIndex
          return (
            <Fragment key={rowIndex}>
              <Panel
                minSize={isMaximized ? 0 : 15}
                defaultSize={100 / layout.rows}
                className={[
                  'workspace-row-panel',
                  isMaximized ? (rowFocused ? 'workspace-row-panel--focused' : 'workspace-row-panel--suppressed') : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <PanelGroup direction="horizontal" className="workspace-grid-hgroup">
                  {Array.from({ length: layout.columns }, (_, columnIndex) => {
                    const pane = getPaneAt(workspace.panes, rowIndex, columnIndex)
                    const panelMaximized = Boolean(pane && pane.id === maximizedPaneId)
                    const panelSuppressed = Boolean(maximizedPaneId && (!pane || pane.id !== maximizedPaneId))
                    return (
                      <Fragment key={`${rowIndex}-${columnIndex}`}>
                        <Panel
                          minSize={isMaximized ? 0 : 10}
                          defaultSize={100 / layout.columns}
                          className={[
                            'workspace-panel',
                            panelMaximized ? 'workspace-panel--focused' : '',
                            panelSuppressed ? 'workspace-panel--suppressed' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          data-oxe-maximized={panelMaximized ? '1' : undefined}
                        >
                          {pane ? (
                            <PaneContainer
                              pane={pane}
                              workspace={workspace}
                              agentProfile={getAgentProfile(agentProfiles, pane.agentProfileId)}
                              autoStart={workspace.autoStart}
                              isMaximized={panelMaximized}
                              isActive={pane.id === activePaneId}
                              onClose={onClosePane}
                              onToggleMaximize={onToggleMaximize}
                              onActivate={onActivatePane}
                              onSplitVertical={(id) => onSplitPane?.(id, 'vertical')}
                              onSplitHorizontal={(id) => onSplitPane?.(id, 'horizontal')}
                            />
                          ) : null}
                        </Panel>
                        {columnIndex < layout.columns - 1 ? (
                          <PanelResizeHandle className="resize-handle resize-handle-vertical" />
                        ) : null}
                      </Fragment>
                    )
                  })}
                </PanelGroup>
              </Panel>
              {rowIndex < layout.rows - 1 ? (
                <PanelResizeHandle className="resize-handle resize-handle-horizontal" />
              ) : null}
            </Fragment>
          )
        })}
      </PanelGroup>
    </div>
  )
}

function getAgentProfile(agentProfiles: AgentProfile[], agentProfileId: string | null): AgentProfile | null {
  if (!agentProfileId) return null
  return agentProfiles.find((profile) => profile.agentProfileId === agentProfileId) ?? null
}
