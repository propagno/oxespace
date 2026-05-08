import { LayoutGrid, Plus } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../shared/types/agent'
import { AgentConfigModal } from './components/Agents/AgentConfigModal'
import { WorkspaceGrid } from './components/Grid/WorkspaceGrid'
import { Sidebar } from './components/Sidebar/Sidebar'
import { NewWorkspaceModal } from './components/Workspace/NewWorkspaceModal'
import { useAgentStore } from './store/agent.store'
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
    setActiveWorkspace,
    shellProfiles,
    splitPane,
    workspaces
  } = useWorkspaceStore()
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace)
  const { closeNewWorkspace, isSidebarCollapsed, isNewWorkspaceOpen, maximizedPaneId, openNewWorkspace, setMaximizedPane, toggleSidebar } = useUIStore()
  const { profiles: agentProfiles, readiness: agentReadiness, isDiscovering, discover, loadProfiles, loadReadiness, updateProfile, deleteProfile } = useAgentStore()
  const [configuredAgent, setConfiguredAgent] = useState<AgentProfile | null>(null)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    void loadProfiles()
    void loadReadiness()
  }, [loadProfiles, loadReadiness])

  return (
    <main className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onNewWorkspace={openNewWorkspace}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={(id) => void closeWorkspace(id)}
        agentProfiles={agentProfiles}
        agentReadiness={agentReadiness}
        isDiscoveringAgents={isDiscovering}
        onDiscoverAgents={() => void discover(true)}
        onConfigureAgent={setConfiguredAgent}
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
          <WorkspaceGrid
            workspace={activeWorkspace}
            maximizedPaneId={maximizedPaneId}
            onClosePane={(paneId) => void closePane(paneId)}
            onToggleMaximize={(paneId) => setMaximizedPane(maximizedPaneId === paneId ? null : paneId)}
            onSplitPane={(paneId, dir) => void splitPane(paneId, dir)}
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
      {configuredAgent ? (
        <AgentConfigModal
          profile={configuredAgent}
          readiness={agentReadiness.find((r) => r.provider === configuredAgent.provider)}
          isDiscovering={isDiscovering}
          onSave={async (id, input) => { await updateProfile(id, input) }}
          onDelete={deleteProfile}
          onHealthCheck={() => void discover(true)}
          onClose={() => setConfiguredAgent(null)}
        />
      ) : null}
    </main>
  )
}
