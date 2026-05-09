import { LayoutGrid, Plus } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../shared/types/agent'
import { AgentConfigModal } from './components/Agents/AgentConfigModal'
import { SettingsModal } from './components/Settings/SettingsModal'
import { ThemeProvider } from './components/Theme/ThemeProvider'
import { CommandPalette, type CommandPaletteAction } from './components/CommandPalette/CommandPalette'
import { Sidebar } from './components/Sidebar/Sidebar'
import { NewWorkspaceModal } from './components/Workspace/NewWorkspaceModal'
import { WorkspaceSettingsModal } from './components/Workspace/WorkspaceSettingsModal'
import { WorkspaceSurface } from './components/Workspace/WorkspaceSurface'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES, WORKSPACE_THEMES } from './components/Workspace/workspaceOptions'
import { useAgentStore } from './store/agent.store'
import { useEditorStore } from './store/editor.store'
import { useUIStore } from './store/ui.store'
import { selectActiveWorkspace, useWorkspaceStore } from './store/workspace.store'

export function App(): ReactElement {
  const {
    activeWorkspaceId,
    bootstrap,
    closePane,
    closeWorkspace,
    createWorkspace,
    error,
    isLoading,
    loadShellProfiles,
    setActiveWorkspace,
    shellProfiles,
    splitPane,
    updateEditorState,
    updateSettings,
    workspaces
  } = useWorkspaceStore()
  const { clearEditor, hasDirtyEditor } = useEditorStore()
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace)
  const {
    closeNewWorkspace,
    closeCommandPalette,
    closeWorkspaceSettings,
    activePaneId,
    isCommandPaletteOpen,
    isSettingsOpen,
    isSidebarCollapsed,
    isNewWorkspaceOpen,
    isWorkspaceSettingsOpen,
    openCommandPalette,
    openWorkspaceSettings,
    maximizedPaneId,
    setActivePane,
    openNewWorkspace,
    setMaximizedPane,
    toggleSettings,
    toggleSidebar
  } = useUIStore()
  const { profiles: agentProfiles, readiness: agentReadiness, isDiscovering, discover, loadProfiles, loadReadiness, updateProfile, deleteProfile } = useAgentStore()
  const [configuredAgent, setConfiguredAgent] = useState<AgentProfile | null>(null)
  const activePane = activeWorkspace?.panes.find((pane) => pane.id === activePaneId) ?? activeWorkspace?.panes[0] ?? null

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    void loadProfiles()
    void loadReadiness()
  }, [loadProfiles, loadReadiness])

  const handleClosePane = (paneId: string): void => {
    void closePane(paneId)
  }

  const handleCloseWorkspace = (workspaceId: string): void => {
    if (hasDirtyEditor(workspaceId) && !window.confirm('Discard unsaved editor changes?')) {
      return
    }
    clearEditor(workspaceId)
    void closeWorkspace(workspaceId)
  }

  const toggleEditor = (): void => {
    if (!activeWorkspace) return
    void updateEditorState({
      workspaceId: activeWorkspace.id,
      editorVisible: !activeWorkspace.editorVisible,
      editorExpanded: activeWorkspace.editorVisible ? false : activeWorkspace.editorExpanded
    })
  }

  const splitActivePane = (direction: 'vertical' | 'horizontal'): void => {
    if (!activePane) return
    void splitPane(activePane.id, direction)
  }

  const toggleActivePaneMaximize = (): void => {
    if (!activePane) return
    setMaximizedPane(maximizedPaneId === activePane.id ? null : activePane.id)
  }

  const commandActions: CommandPaletteAction[] = [
    { id: 'workspace-settings', title: 'Open workspace settings', run: openWorkspaceSettings, disabled: !activeWorkspace },
    { id: 'new-workspace', title: 'Create workspace', run: openNewWorkspace },
    { id: 'toggle-editor', title: 'Toggle editor', run: toggleEditor, disabled: !activeWorkspace },
    { id: 'toggle-sidebar', title: 'Toggle sidebar', run: toggleSidebar },
    ...WORKSPACE_THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Theme: ${theme.label}`,
      subtitle: 'Workspace theme',
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, themeId: theme.id })
      }
    })),
    ...WORKSPACE_DENSITIES.map((density) => ({
      id: `density-${density.id}`,
      title: `Density: ${density.label}`,
      subtitle: 'Workspace density',
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, uiDensity: density.id })
      }
    })),
    ...LAYOUT_PRESETS.map((preset) => ({
      id: `layout-${preset}`,
      title: `Layout: ${preset} panes`,
      subtitle: 'Workspace layout preset',
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, layoutPreset: preset })
      }
    })),
    { id: 'split-vertical', title: 'Split active pane vertical', disabled: !activePane, run: () => splitActivePane('vertical') },
    { id: 'split-horizontal', title: 'Split active pane horizontal', disabled: !activePane, run: () => splitActivePane('horizontal') },
    { id: 'maximize-pane', title: 'Maximize or restore active pane', disabled: !activePane, run: toggleActivePaneMaximize },
    { id: 'restart-terminal', title: 'Restart active terminal', disabled: !activePane || activePane.type !== 'terminal', run: () => activePane && void window.oxe.terminal.restart({ paneId: activePane.id }) },
    { id: 'stop-terminal', title: 'Stop active terminal', disabled: !activePane || activePane.type !== 'terminal', run: () => activePane && void window.oxe.terminal.stop({ paneId: activePane.id }) }
  ]

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      const isCommandPalette = (event.ctrlKey || event.metaKey) && (key === 'k' || (event.shiftKey && key === 'p'))
      if (isCommandPalette) {
        event.preventDefault()
        openCommandPalette()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === ',') {
        event.preventDefault()
        openWorkspaceSettings()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'e') {
        event.preventDefault()
        toggleEditor()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '\\') {
        event.preventDefault()
        splitActivePane('vertical')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '-') {
        event.preventDefault()
        splitActivePane('horizontal')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        toggleActivePaneMaximize()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'r' && activePane?.type === 'terminal') {
        event.preventDefault()
        void window.oxe.terminal.restart({ paneId: activePane.id })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePane, activeWorkspace, maximizedPaneId, openCommandPalette, openWorkspaceSettings, splitPane, toggleSidebar, updateEditorState])

  return (
    <ThemeProvider themeId={activeWorkspace?.themeId} density={activeWorkspace?.uiDensity}>
      <main className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion={window.oxe.app.version}
        onNewWorkspace={openNewWorkspace}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={handleCloseWorkspace}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={toggleSettings}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      <section className="workspace-surface">
        {error ? <div className="error-banner">{error}</div> : null}
        {isLoading ? (
          <div className="empty-state">
            <h3>Loading workspaces</h3>
          </div>
        ) : activeWorkspace ? (
          <WorkspaceSurface
            workspace={activeWorkspace}
            maximizedPaneId={maximizedPaneId}
            onClosePane={handleClosePane}
            onToggleMaximize={(paneId) => setMaximizedPane(maximizedPaneId === paneId ? null : paneId)}
            onSplitPane={(paneId, dir) => void splitPane(paneId, dir)}
            onActivatePane={setActivePane}
            onOpenCommandPalette={openCommandPalette}
            onOpenWorkspaceSettings={openWorkspaceSettings}
            onUpdateEditorState={(input) => void updateEditorState(input)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <LayoutGrid size={24} aria-hidden="true" />
            </div>
            <h3>No workspace open</h3>
            <p>Select a folder to start your first agentic terminal workspace.</p>
            <button type="button" className="empty-state-cta" onClick={openNewWorkspace}>
              <Plus size={14} aria-hidden="true" />
              New workspace
            </button>
          </div>
        )}
      </section>
      {isNewWorkspaceOpen ? (
        <NewWorkspaceModal
          shellProfiles={shellProfiles}
          onCreate={createWorkspace}
          onPickFolder={() => window.oxe.workspace.pickFolder()}
          onClose={closeNewWorkspace}
        />
      ) : null}
      {isCommandPaletteOpen ? <CommandPalette actions={commandActions} onClose={closeCommandPalette} /> : null}
      {isWorkspaceSettingsOpen && activeWorkspace ? (
        <WorkspaceSettingsModal
          workspace={activeWorkspace}
          shellProfiles={shellProfiles}
          onClose={closeWorkspaceSettings}
          onSave={updateSettings}
        />
      ) : null}
      {isSettingsOpen ? (
        <SettingsModal
          agentProfiles={agentProfiles}
          agentReadiness={agentReadiness}
          isDiscoveringAgents={isDiscovering}
          onDiscoverAgents={() => void discover(true)}
          onConfigureAgent={setConfiguredAgent}
          onClose={toggleSettings}
        />
      ) : null}
      {configuredAgent ? (
        <AgentConfigModal
          profile={configuredAgent}
          readiness={agentReadiness.find((r) => r.provider === configuredAgent.provider)}
          isDiscovering={isDiscovering}
          onSave={async (id, input) => {
            await updateProfile(id, input)
            await loadShellProfiles()
            await discover(true)
          }}
          onDelete={deleteProfile}
          onHealthCheck={() => void discover(true)}
          onClose={() => setConfiguredAgent(null)}
        />
      ) : null}
      </main>
    </ThemeProvider>
  )
}
