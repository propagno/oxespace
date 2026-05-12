import { LayoutGrid, Plus } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../shared/types/agent'
import { AgentConfigModal } from './components/Agents/AgentConfigModal'
import { DesignSystemPage } from './components/DesignSystem/DesignSystemPage'
import { SettingsModal } from './components/Settings/SettingsModal'
import { ThemeProvider } from './components/Theme/ThemeProvider'
import { CommandPalette, type CommandPaletteAction } from './components/CommandPalette/CommandPalette'
import { Sidebar } from './components/Sidebar/Sidebar'
import { NewWorkspaceModal, type WizardLaunchInput } from './components/Workspace/NewWorkspaceModal'
import { WorkspaceSettingsModal } from './components/Workspace/WorkspaceSettingsModal'
import { WorkspaceSurface } from './components/Workspace/WorkspaceSurface'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES, WORKSPACE_THEMES } from './components/Workspace/workspaceOptions'
import { useAgentStore } from './store/agent.store'
import { useAgentWorkflowStore } from './store/agent-workflow.store'
import { useEditorStore } from './store/editor.store'
import { useTerminalStore } from './store/terminal.store'
import { useUIStore } from './store/ui.store'
import { selectActiveWorkspace, useWorkspaceStore } from './store/workspace.store'

const DEFAULT_ARTIFACT_EDITOR_WIDTH = 40

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
    updatePaneType,
    updateAgentsState,
    updateReviewState,
    updateEditorState,
    updateOxeState,
    updateSettings,
    workspaces
  } = useWorkspaceStore()
  const { clearEditor, hasDirtyEditor, openFile } = useEditorStore()
  const { createRun: createAgentWorkflowRun } = useAgentWorkflowStore()
  const getTerminalStatus = useTerminalStore((state) => state.getStatus)
  const setPendingCommand = useTerminalStore((state) => state.setPendingCommand)
  const updateTerminalActivity = useTerminalStore((state) => state.updateActivity)
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
  const { allProfiles: agentProfiles, readiness: agentReadiness, isDiscovering, discover, loadProfiles, loadReadiness, updateProfile, deleteProfile } = useAgentStore()
  const [configuredAgent, setConfiguredAgent] = useState<AgentProfile | null>(null)
  const [isDesignSystemOpen, setDesignSystemOpen] = useState(false)
  const activePane = activeWorkspace?.panes.find((pane) => pane.id === activePaneId) ?? activeWorkspace?.panes[0] ?? null

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    return window.oxe.terminal.onData((event) => {
      updateTerminalActivity(event.paneId, event.data)
    })
  }, [updateTerminalActivity])

  useEffect(() => {
    void loadProfiles()
    void loadReadiness()
  }, [loadProfiles, loadReadiness])

  const handleLaunch = async (input: WizardLaunchInput): Promise<void> => {
    const workspace = await createWorkspace({
      rootPath: input.rootPath,
      layoutPreset: input.layoutPreset,
      autoStart: true,
      agentBindings: input.agentBindings
    })
    input.agentSlots.forEach((cmd, i) => {
      if (cmd && workspace.panes[i]) {
        setPendingCommand(workspace.panes[i].id, cmd)
      }
    })
    closeNewWorkspace()
  }

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

  const toggleOxePanel = (): void => {
    if (!activeWorkspace) return
    void updateOxeState({
      workspaceId: activeWorkspace.id,
      oxePanelVisible: !activeWorkspace.oxePanelVisible,
      oxePanelExpanded: activeWorkspace.oxePanelVisible ? false : activeWorkspace.oxePanelExpanded
    })
  }

  const toggleAgentsPanel = (): void => {
    if (!activeWorkspace) return
    void updateAgentsState({
      workspaceId: activeWorkspace.id,
      agentsPanelVisible: !activeWorkspace.agentsPanelVisible,
      agentsPanelExpanded: activeWorkspace.agentsPanelVisible ? false : activeWorkspace.agentsPanelExpanded
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

  const openOxeArtifact = (relativePath: string): void => {
    if (!activeWorkspace) return
    void updateEditorState({
      workspaceId: activeWorkspace.id,
      editorVisible: true,
      editorExpanded: false,
      editorWidthPercent: DEFAULT_ARTIFACT_EDITOR_WIDTH
    })
    void openFile({ workspaceId: activeWorkspace.id, rootPath: activeWorkspace.rootPath, relativePath })
  }

  const openWorkflowArtifact = (content: string, title: string): void => {
    void title
    void navigator.clipboard?.writeText(content).catch(() => undefined)
  }

  const runOxeCommandInTerminal = async (command: string): Promise<void> => {
    const terminalPanes = activeWorkspace?.panes.filter((pane) => pane.type === 'terminal') ?? []
    const runningPane = terminalPanes.find((pane) => getTerminalStatus(pane.id).status === 'running') ?? null
    const targetPane = activePane?.type === 'terminal' ? activePane : runningPane ?? terminalPanes[0] ?? null
    if (!targetPane) {
      window.alert('Nenhum terminal visível para executar o comando OXE.')
      return
    }
    setActivePane(targetPane.id)
    const terminalStatus = getTerminalStatus(targetPane.id).status
    if (terminalStatus !== 'running' && terminalStatus !== 'starting') {
      await window.oxe.terminal.start({ paneId: targetPane.id, workspaceId: targetPane.workspaceId })
    }
    await window.oxe.terminal.write({ paneId: targetPane.id, data: `${command}\r` })
  }

  const commandActions: CommandPaletteAction[] = [
    { id: 'design-system', title: 'Design System: Open Viewer', subtitle: 'Ctrl+Shift+D', run: () => { setDesignSystemOpen(true) } },
    { id: 'workspace-settings', title: 'Open workspace settings', run: openWorkspaceSettings, disabled: !activeWorkspace },
    { id: 'new-workspace', title: 'Create workspace', run: openNewWorkspace },
    { id: 'toggle-editor', title: 'Toggle editor', run: toggleEditor, disabled: !activeWorkspace },
    { id: 'toggle-oxe-panel', title: 'OXE: Open panel', run: toggleOxePanel, disabled: !activeWorkspace },
    { id: 'toggle-agents-panel', title: 'Agents: Open workflow panel', run: toggleAgentsPanel, disabled: !activeWorkspace },
    {
      id: 'agents-new-run',
      title: 'Agents: New multi-agent run',
      disabled: !activeWorkspace,
      run: () => {
        if (!activeWorkspace) return
        void updateAgentsState({ workspaceId: activeWorkspace.id, agentsPanelVisible: true })
        void createAgentWorkflowRun({ workspaceId: activeWorkspace.id, title: 'New multi-agent run', sourceType: 'manual' })
      }
    },
    { id: 'agents-ask-duck', title: 'Agents: Ask Rubber Duck', run: toggleAgentsPanel, disabled: !activeWorkspace },
    { id: 'agents-run-planner', title: 'Agents: Run planner', run: toggleAgentsPanel, disabled: !activeWorkspace },
    { id: 'agents-run-reviewer', title: 'Agents: Run reviewer', run: toggleAgentsPanel, disabled: !activeWorkspace },
    { id: 'agents-run-verifier', title: 'Agents: Verify run', run: toggleAgentsPanel, disabled: !activeWorkspace },
    { id: 'oxe-status-terminal', title: 'OXE: Status in terminal', subtitle: 'Runs in visible terminal', run: () => void runOxeCommandInTerminal('npx oxe-cc status --json'), disabled: !activeWorkspace },
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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'd') {
        event.preventDefault()
        setDesignSystemOpen((prev) => !prev)
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
        activePaneId={activePaneId}
        agentProfiles={agentProfiles}
        appVersion={window.oxe.app.version}
        onNewWorkspace={openNewWorkspace}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={handleCloseWorkspace}
        onActivatePane={setActivePane}
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
            onUpdateOxeState={(input) => void updateOxeState(input)}
            onUpdateAgentsState={(input) => void updateAgentsState(input)}
            onUpdateReviewState={(input) => void updateReviewState(input)}
            onOpenOxeArtifact={openOxeArtifact}
            onRunOxeCommand={(command) => void runOxeCommandInTerminal(command)}
            onOpenWorkflowArtifact={openWorkflowArtifact}
            activePaneId={activePane?.id ?? null}
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
          agentProfiles={agentProfiles}
          shellProfiles={shellProfiles}
          onLaunch={handleLaunch}
          onPickFolder={() => window.oxe.workspace.pickFolder()}
          onClose={closeNewWorkspace}
        />
      ) : null}
      {isCommandPaletteOpen ? <CommandPalette actions={commandActions} onClose={closeCommandPalette} /> : null}
      {isWorkspaceSettingsOpen && activeWorkspace ? (
        <WorkspaceSettingsModal
          workspace={activeWorkspace}
          agentProfiles={agentProfiles}
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
          onClose={toggleSettings}
        />
      ) : null}
      {isDesignSystemOpen ? <DesignSystemPage onClose={() => { setDesignSystemOpen(false) }} /> : null}
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
