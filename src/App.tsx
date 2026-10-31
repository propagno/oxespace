import { Activity, Palette } from 'lucide-react'
import { useContributedCommands } from './utils/commandRegistry'
import './commands/settings.commands'
import { useCodeCommands } from './commands/code.commands'
import { sayAddProjectFirst, useThreadCommands } from './commands/thread.commands'
import { DataHosts, DataSidebar, isDataView, useModeActions } from './components/Navigation/ModeViews'
import { NoWorkspaceStart } from './components/Onboarding/NoWorkspaceStart'
import { TeamButton } from './components/Teams/TeamButton'
import { DelegationNotice } from './components/Delegation/DelegationNotice'
import { useTranslation } from 'react-i18next'
import type { ToolId } from './components/Workspace/toolCatalog'
import { panelMenuEntries, type WorkbenchPanelItem } from './components/Workbench/WorkbenchPanelMenu'
import { Button, cx, Toaster, TitleTooltips, TooltipProvider, LoadingState } from './ui'
import { reportSplitRefused } from './components/Grid/splitRefusal'
import titleBar from './components/Navigation/TitleBar.module.css'
import { ModeSwitch } from './components/Navigation/ModeSwitch'
import { ActivityCenter } from './components/Activity/ActivityCenter'
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentProfile } from '../shared/types/agent'
import type { DelegationTask } from '../shared/types/delegation'
import { isSameRootPath } from '../shared/utils/path'
import { OxeLogo } from './components/Brand/OxeLogo'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ThemeProvider } from './components/Theme/ThemeProvider'
import { humanizeError } from './utils/humanizeError'
// Modals/overlays are user-triggered and infrequent — lazy-load them so they're not in the first-paint bundle.
const AgentConfigModal = lazy(() => import('./components/Agents/AgentConfigModal').then((m) => ({ default: m.AgentConfigModal })))
const DesignSystemPage = lazy(() => import('./components/DesignSystem/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })))
const SettingsCenter = lazy(() => import('./components/Settings/SettingsCenter').then((m) => ({ default: m.SettingsCenter })))
const DelegatedWorkDialog = lazy(() => import('./components/Delegation/DelegatedWorkDialog').then(m => ({ default: m.DelegatedWorkDialog })))
const TeamDialog = lazy(() => import('./components/Teams/TeamDialog').then(m => ({ default: m.TeamDialog })))
const ThreadGrid = lazy(() => import('./components/Threads/ThreadGrid').then(m => ({ default: m.ThreadGrid })))
const ThreadSidebar = lazy(() => import('./components/Threads/ThreadSidebar').then(m => ({ default: m.ThreadSidebar })))
const ProviderAccountsPanel = lazy(() => import('./components/Threads/ProviderAccountsPanel').then(m => ({ default: m.ProviderAccountsPanel })))
const NewThreadDialog = lazy(() => import('./components/Threads/ThreadDialogs').then(m => ({ default: m.NewThreadDialog })))
const AddThreadProjectDialog = lazy(() => import('./components/Threads/ThreadDialogs').then(m => ({ default: m.AddThreadProjectDialog })))
const SlashOverlay = lazy(() => import('./components/SlashOverlay/SlashOverlay').then(m => ({ default: m.SlashOverlay })))
const CommandMenu = lazy(() => import('./components/CommandMenu/CommandMenu').then(m => ({ default: m.CommandMenu })))
const UsageModal = lazy(() => import('./components/Usage/UsageModal').then(m => ({ default: m.UsageModal })))
const McpPanel = lazy(() => import('./components/MCP/McpPanel').then((m) => ({ default: m.McpPanel })))
const LinearPanel = lazy(() => import('./components/Linear/LinearPanel').then((m) => ({ default: m.LinearPanel })))
const SemanticActivityPanel = lazy(() => import('./components/Semantic/SemanticActivityPanel').then((m) => ({ default: m.SemanticActivityPanel })))
const SkillsBrowser = lazy(() => import('./components/Skills/SkillsBrowser').then((m) => ({ default: m.SkillsBrowser })))
import { useBackgroundStore } from './store/background.store'
import { useMcpStore } from './store/mcp.store'
import { useSkillStore } from './store/skill.store'
import { useSlashDispatcher } from './lib/useSlashDispatcher'
import { useAccountStore } from './store/account.store'
import { useThreadStore } from './store/thread.store'
import { useThreadWorkbenchStore } from './store/thread-workbench.store'
import { useNavigationPrefs } from './store/navigation-prefs.store'
import { Sidebar } from './components/Sidebar/Sidebar'
import type { WizardLaunchInput } from './components/Workspace/NewWorkspaceModal'
const NewWorkspaceModal = lazy(() => import('./components/Workspace/NewWorkspaceModal').then((m) => ({ default: m.NewWorkspaceModal })))
import { WorkspaceSurface } from './components/Workspace/WorkspaceSurface'
import './components/Threads/ThreadView.css'
import { AppStatusBar } from './components/Workspace/AppStatusBar'
import { UpdateBanner } from './components/Updates/UpdateBanner'
import { AppUpdateIndicator } from './components/Updates/AppUpdateIndicator'
import { useAgentStore } from './store/agent.store'
import { useEditorStore } from './store/editor.store'
import { useTerminalStore } from './store/terminal.store'
import { useUIStore } from './store/ui.store'
import { selectActiveWorkspace, useWorkspaceStore } from './store/workspace.store'
import { usePaneLayoutStore } from './store/pane-layout.store'
import { selectWorkspacesToEvict } from './components/Terminal/webglBudget'
import { useSettingsStore, VISITED_WORKSPACES_CAP_DEFAULT } from './store/settings.store'
import { useIntegrationStore } from './store/integration.store'
import { useWorktreeStore } from './store/worktree.store'
import { useVoiceStore } from './store/voice.store'
import { useActivitySources } from './hooks/useActivitySources'
import { useAgentHookStatus } from './hooks/useAgentHookStatus'
import { THREAD_NOTIFICATION_PANE_PREFIX } from './hooks/useThreadAttention'
import { useThreadShortcuts } from './hooks/useThreadShortcuts'
import { matchesHotkey } from './keyboard/chords'
import { setKeyboardView, useKeybindings, type AppView } from './keyboard/keybindings'
import { QUOTA_NOTIFICATION_PANE_PREFIX } from './hooks/useQuotaAlerts'
import { useTerminalPrefsStore, TERMINAL_PREFS_DEFAULTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from './store/terminal-prefs.store'

/** macOS keeps its native application menu; Windows/Linux draw it in the title bar. */
const AppMenuBar = lazy(() => import('./components/Navigation/AppMenuBar').then(module => ({ default: module.AppMenuBar })))
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export function App(): ReactElement {
  const { t } = useTranslation()
  const appVersion = window.oxe?.app?.version ?? 'dev'
  const [applicationView, setApplicationView] = useState<AppView>('code')
  const [delegatedWorkOpen, setDelegatedWorkOpen] = useState(false)
  const [teamScope, setTeamScope] = useState<import('../shared/types/team').TeamScope | null>(null)
  const [delegationTarget, setDelegationTarget] = useState<{ workspaceId: string; taskId: string } | null>(null)
  const [hasOpenedThread, setHasOpenedThread] = useState(false)
  const selectMode = (mode: AppView): void => {
    if (mode === 'thread') setHasOpenedThread(true)
    setApplicationView(mode)
  }
  useModeActions(selectMode)
  const [newThreadWorkspaceId, setNewThreadWorkspaceId] = useState<string | null | undefined>(undefined)
  const [newThreadRootPath, setNewThreadRootPath] = useState<string | undefined>()
  const [isThreadProjectOpen, setThreadProjectOpen] = useState(false)
  const threadSnapshot = useThreadStore(state => state.snapshot)
  const threadSelection = useThreadStore(state => state.selectedId)
  const codeSidebarWidth = useNavigationPrefs(state => state.width)
  const [accountsOpen, setAccountsOpen] = useState(false)
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
    updateGitHubState,
    updateReviewState,
    updateEditorState,
    updateBackgroundState,
    updateWorktreeState,
    updateSettings,
    workspaces
  } = useWorkspaceStore(useShallow((state) => ({
    activeWorkspaceId: state.activeWorkspaceId,
    bootstrap: state.bootstrap,
    closePane: state.closePane,
    closeWorkspace: state.closeWorkspace,
    createWorkspace: state.createWorkspace,
    error: state.error,
    isLoading: state.isLoading,
    loadShellProfiles: state.loadShellProfiles,
    setActiveWorkspace: state.setActiveWorkspace,
    shellProfiles: state.shellProfiles,
    splitPane: state.splitPane,
    updateGitHubState: state.updateGitHubState,
    updateReviewState: state.updateReviewState,
    updateEditorState: state.updateEditorState,
    updateBackgroundState: state.updateBackgroundState,
    updateWorktreeState: state.updateWorktreeState,
    updateSettings: state.updateSettings,
    workspaces: state.workspaces
  })))
  const { clearEditor, hasDirtyEditor } = useEditorStore(useShallow((state) => ({
    clearEditor: state.clearEditor,
    hasDirtyEditor: state.hasDirtyEditor
  })))
  const getTerminalStatus = useTerminalStore((state) => state.getStatus)
  const setPendingCommand = useTerminalStore((state) => state.setPendingCommand)
  const setActiveTerminalPaneId = useTerminalStore((state) => state.setActivePaneId)
  const removeTerminalPane = useTerminalStore((state) => state.removePane)
  const markPaneDetached = useTerminalStore((state) => state.markDetached)
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace)
  const {
    closeNewWorkspace,
    closeWorkspaceSettings,
    activePaneId,
    isCommandMenuOpen,
    openCommandMenu,
    closeCommandMenu,
    isUsageOpen,
    openUsage,
    closeUsage,
    isSettingsOpen,
    isSidebarCollapsed,
    isNewWorkspaceOpen,
    isWorkspaceSettingsOpen,
    slashOverlayPaneId,
    isMcpPanelOpen,
    isLinearPanelOpen,
    isSkillsBrowserOpen,
    isScriptsPanelOpen,
    webPreviewOpenByWorkspace,
    isIntegrationPanelOpen,
    openSlashOverlay,
    closeSlashOverlay,
    openMcpPanel,
    closeMcpPanel,
    openLinearPanel,
    closeLinearPanel,
    openSkillsBrowser,
    closeSkillsBrowser,
    openScriptsPanel,
    closeScriptsPanel,
    isSearchPanelOpen,
    openSearchPanel,
    closeSearchPanel,
    openWebPreview,
    closeWebPreview,
    openIntegrationPanel,
    closeIntegrationPanel,
    maximizedPaneId,
    setActivePane,
    openNewWorkspace,
    setMaximizedPane,
    toggleSettings,
    toggleSidebar
  } = useUIStore(useShallow((state) => ({
    closeNewWorkspace: state.closeNewWorkspace,
    closeWorkspaceSettings: state.closeWorkspaceSettings,
    activePaneId: state.activePaneId,
    isCommandMenuOpen: state.isCommandMenuOpen,
    openCommandMenu: state.openCommandMenu,
    closeCommandMenu: state.closeCommandMenu,
    isUsageOpen: state.isUsageOpen,
    openUsage: state.openUsage,
    closeUsage: state.closeUsage,
    isSettingsOpen: state.isSettingsOpen,
    isSidebarCollapsed: state.isSidebarCollapsed,
    isNewWorkspaceOpen: state.isNewWorkspaceOpen,
    isWorkspaceSettingsOpen: state.isWorkspaceSettingsOpen,
    slashOverlayPaneId: state.slashOverlayPaneId,
    isMcpPanelOpen: state.isMcpPanelOpen,
    isLinearPanelOpen: state.isLinearPanelOpen,
    isSkillsBrowserOpen: state.isSkillsBrowserOpen,
    isScriptsPanelOpen: state.isScriptsPanelOpen,
    webPreviewOpenByWorkspace: state.webPreviewOpenByWorkspace,
    isIntegrationPanelOpen: state.isIntegrationPanelOpen,
    openSlashOverlay: state.openSlashOverlay,
    closeSlashOverlay: state.closeSlashOverlay,
    openMcpPanel: state.openMcpPanel,
    closeMcpPanel: state.closeMcpPanel,
    openLinearPanel: state.openLinearPanel,
    closeLinearPanel: state.closeLinearPanel,
    openSkillsBrowser: state.openSkillsBrowser,
    closeSkillsBrowser: state.closeSkillsBrowser,
    openScriptsPanel: state.openScriptsPanel,
    closeScriptsPanel: state.closeScriptsPanel,
    isSearchPanelOpen: state.isSearchPanelOpen,
    openSearchPanel: state.openSearchPanel,
    closeSearchPanel: state.closeSearchPanel,
    openWebPreview: state.openWebPreview,
    closeWebPreview: state.closeWebPreview,
    openIntegrationPanel: state.openIntegrationPanel,
    closeIntegrationPanel: state.closeIntegrationPanel,
    maximizedPaneId: state.maximizedPaneId,
    setActivePane: state.setActivePane,
    openNewWorkspace: state.openNewWorkspace,
    setMaximizedPane: state.setMaximizedPane,
    toggleSettings: state.toggleSettings,
    toggleSidebar: state.toggleSidebar
  })))
  const {
    allProfiles: agentProfiles,
    readiness: agentReadiness,
    isDiscovering,
    discover,
    loadProfiles,
    loadReadiness,
    updateProfile,
    createProfile,
    deleteProfile
  } = useAgentStore(useShallow((state) => ({
    allProfiles: state.allProfiles,
    readiness: state.readiness,
    isDiscovering: state.isDiscovering,
    discover: state.discover,
    loadProfiles: state.loadProfiles,
    loadReadiness: state.loadReadiness,
    updateProfile: state.updateProfile,
    createProfile: state.createProfile,
    deleteProfile: state.deleteProfile
  })))
  const visitedWorkspacesCap = useSettingsStore((s) => s.visitedWorkspacesCap)
  const integrationGroups = useIntegrationStore((state) => state.groups)
  const [configuredAgent, setConfiguredAgent] = useState<AgentProfile | null>(null)
  const [delegationNotice, setDelegationNotice] = useState<{ workspaceId: string; taskId: string } | null>(null)
  const [isDesignSystemOpen, setDesignSystemOpen] = useState(false)
  const [isSemanticActivityOpen, setSemanticActivityOpen] = useState(false)
  const [appNotice, setAppNotice] = useState<string | null>(null)
  // Track workspaces that have been visited at least once. Visited workspaces
  // stay mounted (hidden via CSS) so the xterm Terminal instances persist
  // across workspace switches — required so full-screen Copilot/Claude TUIs
  // keep their altbuf state and scrollback when the user returns to them.
  // MRU list of visited workspaces (most-recently-visited at the end). Kept
  // mounted in DOM so xterm scrollback and altbuf state survive workspace
  // switches. Capped by visitedWorkspacesCap (Settings) — when exceeded the
  // oldest entry is evicted, its WorkspaceSurface unmounts, and its panes'
  // xterm + IPC + git pollers are torn down.
  const [visitedWorkspaceIds, setVisitedWorkspaceIds] = useState<string[]>([])
  const visitedWorkspaceIdsRef = useRef(visitedWorkspaceIds)
  visitedWorkspaceIdsRef.current = visitedWorkspaceIds
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  useEffect(() => {
    if (!activeWorkspaceId) return
    setVisitedWorkspaceIds((prev) => {
      const without = prev.filter((id) => id !== activeWorkspaceId)
      return [...without, activeWorkspaceId]
    })
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!activeWorkspaceId || applicationView !== 'code') return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('oxe:workspace-activated', {
          detail: { workspaceId: activeWorkspaceId }
        }))
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [activeWorkspaceId, applicationView])

  // Trim the MRU only after the newly activated workspace has painted. Killing
  // PTYs and disposing xterm/WebGL for an evicted workspace in the activation
  // effect competed directly with mounting the new surface.
  useEffect(() => {
    const trim = (): void => {
      const current = visitedWorkspaceIdsRef.current
      const paneCountOf = (workspaceId: string): number =>
        workspacesRef.current.find((item) => item.id === workspaceId)?.panes.length ?? 0
      // Budgeted by rendered panes (WebGL contexts), not by workspace count —
      // five one-pane workspaces are cheaper than three four-pane ones.
      const evictedWorkspaceIds = selectWorkspacesToEvict(
        current,
        paneCountOf,
        activeWorkspaceId,
        Math.max(1, visitedWorkspacesCap || VISITED_WORKSPACES_CAP_DEFAULT)
      )
      if (evictedWorkspaceIds.length === 0) return
      const evicted = new Set(evictedWorkspaceIds)
      for (const workspaceId of evictedWorkspaceIds) {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId)
        for (const pane of workspace?.panes ?? []) {
          // The PTY is deliberately NOT stopped. Killing it here is what made
          // returning to a workspace cost a shell respawn plus a $PROFILE load,
          // and it discarded whatever an agent had produced. Main keeps the
          // process and buffers its output; TerminalView's unmount detaches, so
          // coming back is a replay. The store entry is kept (marked detached)
          // because deleting it is what made a background agent invisible to
          // notifications — see useAgentNotifications.
          markPaneDetached(pane.id)
        }
      }
      setVisitedWorkspaceIds((prev) => prev.filter((id) => !evicted.has(id)))
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(trim, { timeout: 750 })
      return () => idleWindow.cancelIdleCallback?.(id)
    }
    const timer = window.setTimeout(trim, 250)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, markPaneDetached, visitedWorkspaceIds.length, visitedWorkspacesCap])

  // Activity heartbeats for panes with no mounted view. Their TerminalView is
  // gone, so nothing else would hear them and a working background agent would
  // look idle in the sidebar. The preload multiplexes one IPC listener across
  // all panes, so subscribing for every pane is cheap.
  const notePaneActivity = useTerminalStore((state) => state.noteBackgroundActivity)
  useEffect(() => {
    const unsubscribes = workspaces.flatMap((workspace) =>
      workspace.panes.map((pane) =>
        window.oxe.terminal.onActivity?.(pane.id, (event) => notePaneActivity(pane.id, event.at)) ?? (() => undefined)
      )
    )
    return () => { for (const off of unsubscribes) off() }
  }, [notePaneActivity, workspaces])
  const activePane = activeWorkspace?.panes.find((pane) => pane.id === activePaneId) ?? activeWorkspace?.panes[0] ?? null
  const pttHotkey = useVoiceStore((s) => s.pttHotkey)
  const slashPane = slashOverlayPaneId ? activeWorkspace?.panes.find((pane) => pane.id === slashOverlayPaneId) ?? null : null
  const skills = useSkillStore((s) => s.skills)
  const dispatchSlashCommand = useSlashDispatcher({ workspace: activeWorkspace ?? null, pane: slashPane })

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    void loadProfiles()
    void loadReadiness()
    void useSkillStore.getState().refresh()
    void useMcpStore.getState().load(null)
    // Integration store is workspace-agnostic (load(null) returns ALL
    // groups). Load it once at boot — re-running on every workspace switch
    // was the source of the "Loading integration groups…" flash that made
    // sidebar member clicks feel laggy. Add/remove/update actions in the
    // store keep the cache fresh without a network round-trip.
    void useIntegrationStore.getState().load(null)
    // Subscribe once to background job + skill change + mcp health streams.
    const unsubscribe = useBackgroundStore.getState().subscribe()
    const unsubscribeSkills = useSkillStore.getState().subscribe()
    const unsubscribeMcp = useMcpStore.getState().subscribe()
    return () => { unsubscribe(); unsubscribeSkills(); unsubscribeMcp() }
  }, [loadProfiles, loadReadiness])

  // Reload skills (including workspace-scoped ones) when switching workspaces.
  useEffect(() => {
    if (!activeWorkspace) return
    const timer = window.setTimeout(() => {
      void useSkillStore.getState().refresh(activeWorkspace.rootPath)
      void useMcpStore.getState().load(activeWorkspace.id)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [activeWorkspace?.id, activeWorkspace?.rootPath])

  // Hydrate background jobs for the active workspace
  useEffect(() => {
    if (!activeWorkspaceId) return
    const timer = window.setTimeout(() => {
      void useBackgroundStore.getState().loadJobs(activeWorkspaceId)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId])

  useEffect(() => {
    setActiveTerminalPaneId(activePane?.id ?? null)
  }, [activePane?.id, setActiveTerminalPaneId])

  // Top-level listener for `oxespace_open_web_preview` tool calls. Lives
  // here (not inside WebPreviewPanel) so it fires even when the panel is
  // closed — agent says "open localhost:3000" → we auto-open the panel +
  // queue the URL → panel consumes the pending URL on mount.
  useEffect(() => {
    const api = window.oxe?.mcpInternal
    if (!api) return
    const unsubscribe = api.onWebPreview((event) => {
      const ui = useUIStore.getState()
      if (event.threadId) {
        ui.setPendingWebPreview(`thread:${event.threadId}`, event.url)
        useThreadWorkbenchStore.getState().setView(event.threadId, { panel: 'preview' })
      } else {
        ui.setPendingWebPreview(event.workspaceId, event.url)
        ui.openWebPreview(event.workspaceId)
      }
    })
    return unsubscribe
  }, [])

  // Top-level listener for worktree mutations driven by the MCP tools. The
  // store keys worktrees by rootPath, so a refresh re-renders both the
  // Worktree panel and the sidebar `Nwt` badge without a manual reload.
  useEffect(() => {
    const api = window.oxe?.mcpInternal
    if (!api) return
    const unsubscribe = api.onWorktreeChanged((event) => {
      void useWorktreeStore.getState().refresh(event.workspaceId, event.rootPath)
    })
    return unsubscribe
  }, [])

  // Native desktop notifications when a background agent finishes / needs you.
  useEffect(() => {
    const api = window.oxe?.delegation
    if (!api) return
    let revision = 0
    return api.onChanged(event => {
      setDelegationNotice(event)
      const requested = ++revision
      void window.oxe.workspace.list().then(workspaces => {
        if (requested === revision) useWorkspaceStore.setState({ workspaces })
      }).catch(() => {})
    })
  }, [])

  useActivitySources(applicationView)
  useAgentHookStatus()

  // Clicking a notification focuses the originating pane (window focus + restore
  // is handled in main); here we switch to its workspace and select the pane.
  useEffect(() => {
    const api = window.oxe?.notifications
    if (!api) return
    return api.onActivate(({ paneId, workspaceId }) => {
      // Quota alerts are not about a pane; the window was already focused by the click.
      if (paneId.startsWith(QUOTA_NOTIFICATION_PANE_PREFIX)) return
      // Thread notifications carry `thread:<id>` instead of a terminal pane id.
      if (paneId.startsWith(THREAD_NOTIFICATION_PANE_PREFIX)) {
        setHasOpenedThread(true)
        setApplicationView('thread')
        void useThreadStore.getState().select(paneId.slice(THREAD_NOTIFICATION_PANE_PREFIX.length))
        return
      }
      if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) {
        void setActiveWorkspace(workspaceId)
      }
      setActiveTerminalPaneId(paneId)
    })
  }, [setActiveWorkspace, setActiveTerminalPaneId])

  const handleLaunch = async (input: WizardLaunchInput): Promise<void> => {
    const knownIds = new Set(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id))
    const workspace = await createWorkspace({
      rootPath: input.rootPath,
      layoutPreset: input.layoutPreset,
      defaultShellProfileId: input.defaultShellProfileId,
      autoStart: true,
      agentBindings: input.agentBindings
    })
    if (!knownIds.has(workspace.id)) {
      input.agentSlots.forEach((cmd, i) => {
        if (cmd && workspace.panes[i]) setPendingCommand(workspace.panes[i].id, cmd)
      })
    }
    closeNewWorkspace()
  }

  const handleClosePane = (paneId: string): void => {
    const owner = workspaces.find((ws) => ws.panes.some((pane) => pane.id === paneId))
    void closePane(paneId).then(() => {
      removeTerminalPane(paneId)
      if (owner) usePaneLayoutStore.getState().remove(owner.id, paneId)
    })
  }

  const handleCloseWorkspace = (workspaceId: string): void => {
    if (hasDirtyEditor(workspaceId)) {
      setAppNotice(t('app.notice.unsavedEditor'))
      return
    }
    const workspace = workspaces.find((item) => item.id === workspaceId)
    for (const pane of workspace?.panes ?? []) removeTerminalPane(pane.id)
    clearEditor(workspaceId)
    closeWebPreview(workspaceId)
    useUIStore.getState().setPendingWebPreview(workspaceId, null)
    setVisitedWorkspaceIds((prev) => prev.filter((id) => id !== workspaceId))
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

  const toggleGitHubPanel = (): void => {
    if (!activeWorkspace) return
    void updateGitHubState({
      workspaceId: activeWorkspace.id,
      githubPanelVisible: !activeWorkspace.githubPanelVisible,
      githubPanelExpanded: activeWorkspace.githubPanelVisible ? false : activeWorkspace.githubPanelExpanded
    })
  }

  const toggleReviewPanel = (): void => {
    if (!activeWorkspace) return
    void updateReviewState({
      workspaceId: activeWorkspace.id,
      reviewPanelVisible: !activeWorkspace.reviewPanelVisible,
      reviewPanelExpanded: activeWorkspace.reviewPanelVisible ? false : activeWorkspace.reviewPanelExpanded
    })
  }

  const toggleBackgroundPanel = (): void => {
    if (!activeWorkspace) return
    void updateBackgroundState({
      workspaceId: activeWorkspace.id,
      backgroundPanelVisible: !activeWorkspace.backgroundPanelVisible,
      backgroundPanelExpanded: activeWorkspace.backgroundPanelVisible ? false : activeWorkspace.backgroundPanelExpanded
    })
  }

  const toggleWorktreePanel = (): void => {
    if (!activeWorkspace) return
    void updateWorktreeState({
      workspaceId: activeWorkspace.id,
      worktreePanelVisible: !activeWorkspace.worktreePanelVisible,
      worktreePanelExpanded: activeWorkspace.worktreePanelVisible ? false : activeWorkspace.worktreePanelExpanded
    })
  }

  const toggleScriptsPanel = (): void => {
    if (isScriptsPanelOpen) closeScriptsPanel()
    else openScriptsPanel()
  }

  const toggleSearchPanel = (): void => {
    if (isSearchPanelOpen) closeSearchPanel()
    else openSearchPanel()
  }

  const toggleWebPreviewPanel = (): void => {
    if (!activeWorkspaceId) return
    if (webPreviewOpenByWorkspace[activeWorkspaceId]) closeWebPreview(activeWorkspaceId)
    else openWebPreview(activeWorkspaceId)
  }

  const splitWorkspacePane = useCallback((workspaceId: string, paneId: string, direction: 'vertical' | 'horizontal'): void => {
    if (!useUIStore.getState().splitLayoutEnabled) {
      void splitPane(paneId, direction).catch(reportSplitRefused)
      return
    }

    // WorkspaceSurface instances for recently visited workspaces stay mounted
    // to preserve xterm state. Global split routing must therefore live here;
    // a listener in each surface would also mutate hidden workspaces.
    void useWorkspaceStore
      .getState()
      .createPane(workspaceId)
      .then((newPaneId) => {
        usePaneLayoutStore
          .getState()
          .split(workspaceId, paneId, newPaneId, direction === 'vertical' ? 'horizontal' : 'vertical')
      })
      .catch((cause: unknown) => {
        setAppNotice(humanizeError(cause, t('app.notice.splitFailed')))
      })
  }, [splitPane, t])

  const splitActivePane = useCallback((direction: 'vertical' | 'horizontal'): void => {
    if (!activeWorkspace || !activePane) return
    splitWorkspacePane(activeWorkspace.id, activePane.id, direction)
  }, [activePane, activeWorkspace, splitWorkspacePane])

  const toggleActivePaneMaximize = (): void => {
    if (!activePane) return
    setMaximizedPane(maximizedPaneId === activePane.id ? null : activePane.id)
  }

  const toggleActivePaneVoice = (): void => {
    if (applicationView === 'thread') {
      window.dispatchEvent(new CustomEvent('oxe:thread-toggle-voice'))
    } else if (activeWorkspace?.editorVisible) {
      window.dispatchEvent(new CustomEvent('oxe:editor-toggle-voice'))
    } else if (activePane && activePane.type === 'terminal') {
      window.dispatchEvent(new CustomEvent('oxe:terminal-toggle-voice', {
        detail: { paneId: activePane.id }
      }))
    }
  }

  const runCommandInTerminal = async (command: string): Promise<void> => {
    const terminalPanes = activeWorkspace?.panes.filter((pane) => pane.type === 'terminal') ?? []
    const runningPane = terminalPanes.find((pane) => getTerminalStatus(pane.id).status === 'running') ?? null
    const targetPane = activePane?.type === 'terminal' ? activePane : runningPane ?? terminalPanes[0] ?? null
    if (!targetPane) {
      setAppNotice(t('app.notice.noTerminal'))
      return
    }
    setActivePane(targetPane.id)
    const terminalStatus = getTerminalStatus(targetPane.id).status
    if (terminalStatus !== 'running' && terminalStatus !== 'starting') {
      await window.oxe.terminal.start({ paneId: targetPane.id, workspaceId: targetPane.workspaceId })
    }
    await window.oxe.terminal.write({ paneId: targetPane.id, data: `${command}\r` })
  }

  const newWorkspaceOpenerRef = useRef<HTMLElement | null>(null)
  const openNewWorkspaceFromUI = (): void => {
    newWorkspaceOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openNewWorkspace()
  }

  const threadProjects = useThreadStore(state => state.projects)
  const threadProject = threadProjects.find(project => project.projectId === threadSnapshot?.thread.projectId)

  // The Team belongs to a project: the selected workspace in Code, the selected project in Thread.
  const teamTarget = applicationView === 'thread' ? (threadProject ? { kind: 'thread' as const, id: threadProject.projectId } : null)
    : applicationView === 'code' ? (activeWorkspace ? { kind: 'code' as const, id: activeWorkspace.id } : null) : null
  const openTeam = (): void => { if (teamTarget) setTeamScope(teamTarget) }

  // Code's side panels: buttons in the workspace bar for Changes and Browser, the rest in the Panels menu (also on the rail).
  const codePanelItems: WorkbenchPanelItem[] = activeWorkspace ? [
    { id: 'changes', active: activeWorkspace.reviewPanelVisible === true, onToggle: toggleReviewPanel },
    { id: 'browser', active: webPreviewOpenByWorkspace[activeWorkspace.id] === true, onToggle: toggleWebPreviewPanel },
    { id: 'git', active: activeWorkspace.githubPanelVisible === true, onToggle: toggleGitHubPanel },
    { id: 'files', active: activeWorkspace.editorVisible === true, onToggle: toggleEditor },
    { id: 'search', active: isSearchPanelOpen, onToggle: toggleSearchPanel },
    { id: 'scripts', active: isScriptsPanelOpen, onToggle: toggleScriptsPanel },
    { id: 'worktrees', active: activeWorkspace.worktreePanelVisible === true, onToggle: toggleWorktreePanel }
  ] : []

  const toolHandlers: Partial<Record<ToolId, () => void>> = {
    integration: openIntegrationPanel, github: toggleGitHubPanel, worktrees: toggleWorktreePanel, scripts: toggleScriptsPanel, search: toggleSearchPanel,
    'web-preview': toggleWebPreviewPanel, background: toggleBackgroundPanel, mcp: openMcpPanel, skills: openSkillsBrowser, semantic: () => setSemanticActivityOpen(true),
    editor: toggleEditor, review: toggleReviewPanel, team: openTeam, slash: () => { if (activePane) openSlashOverlay(activePane.id) }
  }

  // Palette and menu commands live in src/commands/*.commands.ts.
  useCodeCommands({ applicationView, activeWorkspace, activePane, hasTeamTarget: teamTarget !== null, toolHandlers, openNewWorkspace: openNewWorkspaceFromUI, showCode: () => selectMode('code'),
    openTools: { editor: activeWorkspace?.editorVisible, github: activeWorkspace?.githubPanelVisible, review: activeWorkspace?.reviewPanelVisible, background: activeWorkspace?.backgroundPanelVisible, worktrees: activeWorkspace?.worktreePanelVisible, scripts: isScriptsPanelOpen, search: isSearchPanelOpen, 'web-preview': activeWorkspace ? webPreviewOpenByWorkspace[activeWorkspace.id] : false },
    splitActivePane, toggleActivePaneMaximize, toggleActivePaneVoice, openDesignSystem: () => setDesignSystemOpen(true) })
  const commandActions = useContributedCommands()
  useEffect(() => { setKeyboardView(applicationView) }, [applicationView])
  const terminalPane = activePane?.type === 'terminal' ? activePane : null
  const zoomTerminal = (delta: 1 | -1 | 0): void => {
    const store = useTerminalPrefsStore.getState()
    const next = delta === 0 ? TERMINAL_PREFS_DEFAULTS.fontSize : store.global.fontSize + delta
    store.setGlobal({ fontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next)) })
  }
  useKeybindings({
    'palette.open': openCommandMenu, 'palette.search': openCommandMenu, 'settings.open': () => { if (!isSettingsOpen) toggleSettings() }, 'sidebar.toggle': toggleSidebar,
    'voice.toggle': toggleActivePaneVoice, 'code.changes': toggleReviewPanel, 'code.browser': toggleWebPreviewPanel, 'code.files': toggleEditor,
    'code.splitLayout': () => useUIStore.getState().toggleSplitLayout(),
    // Read fresh state: the search panel flag is not part of this render's closure.
    'code.search': () => { const ui = useUIStore.getState(); if (ui.isSearchPanelOpen) ui.closeSearchPanel(); else ui.openSearchPanel() },
    'pane.splitRight': () => splitActivePane('vertical'), 'pane.splitDown': () => splitActivePane('horizontal'), 'pane.maximize': toggleActivePaneMaximize,
    'terminal.restart': () => terminalPane ? void window.oxe.terminal.restart({ paneId: terminalPane.id }) : false,
    'terminal.slash': () => terminalPane ? openSlashOverlay(terminalPane.id) : false,
    // Terminal zoom belongs to the focused xterm, never to the window.
    'terminal.zoomIn': () => terminalPane ? zoomTerminal(1) : false, 'terminal.zoomOut': () => terminalPane ? zoomTerminal(-1) : false,
    'terminal.zoomReset': () => terminalPane ? zoomTerminal(0) : false
  })

  // Push-to-talk: hold the configured hotkey to dictate into the active
  // terminal, release to transcribe + insert. Works even while the terminal
  // is focused (window-level listener). Auto-repeat is guarded so holding
  // doesn't restart capture each tick.
  useEffect(() => {
    if (applicationView !== 'code' && applicationView !== 'thread') return
    let holding = false
    const dispatch = (type: 'start' | 'end'): void => {
      if (applicationView === 'thread') {
        window.dispatchEvent(new CustomEvent(`oxe:thread-voice-hold-${type}`))
        return
      }
      if (!activePane || activePane.type !== 'terminal') return
      window.dispatchEvent(new CustomEvent(`oxe:terminal-voice-hold-${type}`, {
        detail: { paneId: activePane.id }
      }))
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || holding) return
      if (!matchesHotkey(event, pttHotkey)) return
      event.preventDefault()
      holding = true
      dispatch('start')
    }
    const onKeyUp = (): void => {
      if (!holding) return
      holding = false
      dispatch('end')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onKeyUp)
    }
  }, [activePane, applicationView, pttHotkey])

  useEffect(() => {
    if (!hasOpenedThread) return
    void useThreadStore.getState().load()
    void useThreadStore.getState().loadProjects()
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = new Set<string>()
    let active = true
    const flush = async () => {
      const batch = [...changed]; changed.clear()
      const state = useThreadStore.getState()
      if (batch.some(id => !state.threads.some(t => t.id === id))) await state.load()
      else await Promise.all(batch.map(id => state.refresh(id)))
      timer = undefined
      if (active && changed.size) timer = setTimeout(() => { void flush() }, 100)
    }
    const unsubscribe = window.oxe?.thread?.onChanged(event => {
      changed.add(event.threadId)
      if (!timer) timer = setTimeout(() => { void flush() }, 100)
    })
    const unsubscribeAccounts = window.oxe?.agentAccount?.onChanged(status => useAccountStore.getState().changed(status))
    return () => { active = false; unsubscribe?.(); unsubscribeAccounts?.(); if (timer) clearTimeout(timer) }
  }, [hasOpenedThread])
  const newThread = () => {
    const project = threadProject ?? threadProjects.find(item => !item.hidden)
    if (!project) setThreadProjectOpen(true)
    else setNewThreadWorkspaceId(project.projectId)
  }
  useThreadShortcuts(applicationView === 'thread', newThread)

  // Accounts are checked inside a project; without one there is nothing to show yet.
  const openThreadAccounts = () => { if (threadProject ?? threadProjects[0]) setAccountsOpen(true); else sayAddProjectFirst() }
  useThreadCommands({ snapshot: threadSnapshot, projects: threadProjects, showThread: () => selectMode('thread'), newThread, newThreadIn: setNewThreadWorkspaceId,
    addProject: () => setThreadProjectOpen(true), openAccounts: openThreadAccounts })
  const openDelegation = async (task: DelegationTask): Promise<boolean> => {
    const showDelegationDetails = () => {
      setDelegationTarget({ workspaceId: task.originWorkspaceId ?? task.workspaceId, taskId: task.id })
      setDelegatedWorkOpen(true)
    }
    if (task.destinationThreadId) {
      setHasOpenedThread(true)
      setApplicationView('thread')
      setDelegatedWorkOpen(false)
      const threadApi = window.oxe.thread
      if (!threadApi) { showDelegationDetails(); return false }
      try { useThreadStore.getState().adopt(await threadApi.read(task.destinationThreadId)); return true }
      catch { showDelegationDetails(); return false }
    } else if (task.paneId) {
      try {
        const owner = workspaces.find(workspace => workspace.panes.some(pane => pane.id === task.paneId))
        const session = await window.oxe.terminal.status(task.paneId)
        if (!owner || !session.running) { showDelegationDetails(); return false }
        await setActiveWorkspace(owner.id)
        useUIStore.getState().setActivePane(task.paneId)
        setApplicationView('code')
        setDelegatedWorkOpen(false)
        return true
      } catch { showDelegationDetails(); return false }
    } else {
      showDelegationDetails()
      return false
    }
  }

  return (
    <ThemeProvider themeId={applicationView !== 'code' ? undefined : activeWorkspace?.themeId} density={applicationView !== 'code' ? undefined : activeWorkspace?.uiDensity}>
      <TooltipProvider>
      <TitleTooltips />
      <main className={`app-shell${applicationView === 'thread' ? ' thread-shell' : isDataView(applicationView) ? ' oq-shell' : isSidebarCollapsed ? ' sidebar-collapsed' : ''}`} style={applicationView !== 'code' ? { '--thread-sidebar-width': `${isSidebarCollapsed ? 48 : codeSidebarWidth}px` } as CSSProperties : { '--sidebar-w': `${codeSidebarWidth}px` } as CSSProperties}>
      <header className={cx('workbench-titlebar', titleBar.bar)} aria-label={t('app.workbench')}>
        <div className={titleBar.brand}><OxeLogo size={16} /><strong className={titleBar.word}>oxespace</strong>{!IS_MAC && <Suspense fallback={null}><AppMenuBar context={{ actions: commandActions, applicationView, setApplicationView: selectMode, openSettings: () => { if (!isSettingsOpen) toggleSettings() }, addThreadProject: () => setThreadProjectOpen(true), openCommandMenu }} /></Suspense>}</div>
        <ModeSwitch mode={applicationView} onSelect={selectMode} />
        <div className={titleBar.trailing}><TeamButton view={applicationView} enabled={Boolean(teamTarget)} onOpen={openTeam} /><ActivityCenter onSelectView={selectMode} /><UpdateBanner /><AppUpdateIndicator /></div>
      </header>
      {teamScope && <Suspense fallback={null}><TeamDialog key={`${teamScope.kind}:${teamScope.id}`} scope={teamScope} owner={teamScope.kind === 'thread' && threadSnapshot ? { kind: 'thread', id: threadSnapshot.thread.id } : teamScope.kind === 'code' && activePane ? { kind: 'pane', id: activePane.id } : undefined} onClose={() => setTeamScope(null)} /></Suspense>}
      {delegationNotice && <DelegationNotice onView={() => { setDelegatedWorkOpen(true); setDelegationNotice(null) }} onDismiss={() => setDelegationNotice(null)} />}
      {delegatedWorkOpen && <Suspense fallback={null}><DelegatedWorkDialog workspaces={workspaces} workspaceId={delegationTarget?.workspaceId ?? (applicationView === 'thread' ? threadSnapshot?.thread.workspaceId ?? activeWorkspaceId ?? '' : activeWorkspaceId ?? '')} focusTaskId={delegationTarget?.taskId}
        origin={applicationView === 'thread' ? threadSelection ? { kind: 'thread', id: threadSelection } : undefined : activePane ? { kind: 'pane', id: activePane.id } : undefined}
        onClose={() => { setDelegatedWorkOpen(false); setDelegationTarget(null) }} onOpen={openDelegation} /></Suspense>}
      {isDataView(applicationView) ? <DataSidebar view={applicationView} />
      : applicationView === 'thread' ? <Suspense fallback={<aside className="thread-navigation" aria-label={t('nav.viewSidebar', { name: 'OxeChat' })} />}><ThreadSidebar onCreate={(id, rootPath) => { setNewThreadRootPath(rootPath); setNewThreadWorkspaceId(id) }} onAccounts={openThreadAccounts} onAddProject={() => setThreadProjectOpen(true)} onOpenInCode={async rootPath => {
        const existing = (await window.oxe.workspace.list()).find(workspace => isSameRootPath(workspace.rootPath, rootPath, window.oxe.app.platform))
        if (existing) await setActiveWorkspace(existing.id)
        else await createWorkspace({ rootPath, layoutPreset: 1, autoStart: false })
        setApplicationView('code')
      }} /></Suspense> : <Sidebar
        onDelegations={() => { setDelegationTarget(null); setDelegatedWorkOpen(true) }}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion={appVersion}
        onNewWorkspace={openNewWorkspaceFromUI}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={handleCloseWorkspace}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        panelMenu={panelMenuEntries(codePanelItems)}
        onOpenJobs={toggleBackgroundPanel}
        onOpenScripts={toggleScriptsPanel}
        onOpenSearch={openCommandMenu}
        integrationGroups={integrationGroups}
      />}
      <section className={`workspace-surface${applicationView === 'thread' ? ' thread-workspace-surface' : isDataView(applicationView) ? ' oq-surface' : ''}`}>
        {error ? <div className="error-banner">{error}</div> : null}
        {appNotice ? (
          <div className="error-banner">
            <span>{appNotice}</span>
            <Button variant="ghost" size="sm" onClick={() => setAppNotice(null)}>{t('ui.dismiss')}</Button>
          </div>
        ) : null}
        {isLoading ? (
          <div className="empty-state">
            <h3>{t('app.loadingWorkspaces')}</h3>
          </div>
        ) : activeWorkspace || applicationView !== 'code' ? (
          <>
            <DataHosts view={applicationView} />
            {hasOpenedThread && <div className="thread-host" style={{ display: applicationView === 'thread' ? 'flex' : 'none', flex: 1, minHeight: 0 }} aria-hidden={applicationView !== 'thread'}><ErrorBoundary label={t('app.boundary.conversations')}><Suspense fallback={<LoadingState brand />}><ThreadGrid onNewThread={newThread} onAccounts={openThreadAccounts} onDelegations={() => setDelegatedWorkOpen(true)} /></Suspense></ErrorBoundary></div>}
            {workspaces
              // Include the active id synchronously. On a first visit the MRU
              // effect has not run yet, but the user should never wait an extra
              // render before the new WorkspaceSurface begins mounting.
              .filter((ws) => ws.id === activeWorkspaceId || visitedWorkspaceIds.includes(ws.id))
              .map((ws) => {
                const isActive = ws.id === activeWorkspaceId && applicationView === 'code'
                return (
                  <div
                    key={ws.id}
                    className={`workspace-host${isActive ? '' : ' workspace-host-hidden'}`}
                    aria-hidden={!isActive}
                  >
                    <WorkspaceSurface
                      workspace={ws}
                      isActive={isActive}
                      agentProfiles={agentProfiles}
                      maximizedPaneId={isActive ? maximizedPaneId : null}
                      onClosePane={handleClosePane}
                      onToggleMaximize={(paneId) => setMaximizedPane(maximizedPaneId === paneId ? null : paneId)}
                      onSplitPane={(paneId, dir) => splitWorkspacePane(ws.id, paneId, dir)}
                      onActivatePane={setActivePane}
                      scriptsVisible={isActive && isScriptsPanelOpen}
                      webPreviewVisible={webPreviewOpenByWorkspace[ws.id] === true}
                      integrationVisible={isActive && isIntegrationPanelOpen}
                      searchVisible={isActive && isSearchPanelOpen}
                      onCloseScripts={closeScriptsPanel}
                      onCloseWebPreview={() => closeWebPreview(ws.id)}
                      onCloseIntegration={closeIntegrationPanel}
                      onCloseSearch={closeSearchPanel}
                      onSelectWorkspace={(id) => void setActiveWorkspace(id)}
                      workspaces={workspaces}
                      onUpdateEditorState={(input) => void updateEditorState(input)}
                      onUpdateReviewState={(input) => void updateReviewState(input)}
                      onUpdateGitHubState={(input) => void updateGitHubState(input)}
                      onUpdateBackgroundState={(input) => void updateBackgroundState(input)}
                      onUpdateWorktreeState={(input) => void updateWorktreeState(input)}
                      onRunCommand={(command) => void runCommandInTerminal(command)}
                      activePaneId={isActive ? activePane?.id ?? null : null}
                      panels={isActive ? codePanelItems : undefined}
                    />
                  </div>
                )
              })}
          </>
        ) : (
          <NoWorkspaceStart onNewWorkspace={openNewWorkspaceFromUI} onSelectMode={selectMode} onAddProject={() => { selectMode('thread'); setThreadProjectOpen(true) }} />
        )}
        {applicationView === 'code' && <AppStatusBar workspace={activeWorkspace ?? null} activePaneId={activePane?.id ?? null} />}
        {applicationView === 'thread' && <AppStatusBar docked workspace={null} activePaneId={null} rootPath={threadSnapshot?.thread.rootPath} usageProvider={threadSnapshot?.thread.provider === 'claude' || threadSnapshot?.thread.provider === 'codex' ? threadSnapshot.thread.provider : null} />}
        <Suspense fallback={null}>
          {accountsOpen && (threadProject ?? threadProjects[0]) && <ProviderAccountsPanel workspaceId={threadSnapshot?.thread.workspaceId ?? `thread:${(threadProject ?? threadProjects[0]).projectId}`} onClose={() => setAccountsOpen(false)} />}
          {newThreadWorkspaceId !== undefined && <NewThreadDialog initialProjectId={newThreadWorkspaceId} initialRootPath={newThreadRootPath} onClose={() => { setNewThreadWorkspaceId(undefined); setNewThreadRootPath(undefined) }} />}
          {isThreadProjectOpen && <AddThreadProjectDialog onPickFolder={() => window.oxe.workspace.pickFolder()} onClose={() => setThreadProjectOpen(false)} onAdd={async rootPath => {
            await window.oxe.thread!.addProject(rootPath)
            await useThreadStore.getState().loadProjects()
          }} />}
        </Suspense>
      </section>
      <ErrorBoundary label={t('app.boundary.window')}>
      <Suspense fallback={null}>
      {isNewWorkspaceOpen ? (
        <NewWorkspaceModal
          agentProfiles={agentProfiles}
          shellProfiles={shellProfiles}
          existingWorkspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          platform={window.oxe.app.platform}
          onOpenExisting={async (id) => { await setActiveWorkspace(id); closeNewWorkspace() }}
          onLaunch={handleLaunch}
          onPickFolder={() => window.oxe.workspace.pickFolder()}
          returnFocusTo={newWorkspaceOpenerRef.current}
          onClose={closeNewWorkspace}
        />
      ) : null}
      <CommandMenu
        open={isCommandMenuOpen}
        onOpenChange={(o) => (o ? openCommandMenu() : closeCommandMenu())}
        workspace={activeWorkspace ?? null}
        actions={commandActions}
        workspaces={workspaces}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onSelectPane={setActivePane}
      />
      <UsageModal open={isUsageOpen} onOpenChange={(o) => (o ? openUsage() : closeUsage())} />
      {slashPane ? (
        <SlashOverlay
          paneId={slashPane.id}
          paneLabel={slashPane.displayName ?? slashPane.agentName ?? `Pane ${slashPane.rowIndex + 1}.${slashPane.columnIndex + 1}`}
          skills={skills}
          onClose={closeSlashOverlay}
          onExecute={dispatchSlashCommand}
        />
      ) : null}
      {isLinearPanelOpen ? (
        <Suspense fallback={null}>
          <LinearPanel
            workspaceId={activeWorkspace?.id ?? null}
            rootPath={activeWorkspace?.rootPath ?? null}
            onClose={closeLinearPanel}
          />
        </Suspense>
      ) : null}
      {isMcpPanelOpen ? (
        <McpPanel
          workspaceId={applicationView === 'thread' ? threadSnapshot?.thread.workspaceId ?? null : activeWorkspace?.id ?? null}
          conversationServers={applicationView === 'thread' ? threadSnapshot?.thread.mcpServers?.servers : undefined}
          onClose={closeMcpPanel}
        />
      ) : null}
      {isSkillsBrowserOpen ? (
        <SkillsBrowser
          workspaceId={activeWorkspace?.id ?? null}
          workspaceRootPath={activeWorkspace?.rootPath ?? null}
          activePaneId={activePane?.type === 'terminal' ? activePane.id : null}
          onOpenEditor={(relativePath) => {
            if (!activeWorkspace) return
            void updateEditorState({
              workspaceId: activeWorkspace.id,
              editorVisible: true,
              editorExpanded: false,
              editorWidthPercent: activeWorkspace.editorWidthPercent ?? 40
            })
            void useEditorStore.getState().openFile({
              workspaceId: activeWorkspace.id,
              rootPath: activeWorkspace.rootPath,
              relativePath
            })
          }}
          onClose={closeSkillsBrowser}
        />
      ) : null}
      {isSettingsOpen || isWorkspaceSettingsOpen ? (
        <SettingsCenter
          initialPage={useUIStore.getState().settingsInitialPage}
          initialWorkspaceId={isWorkspaceSettingsOpen && applicationView === 'code' ? activeWorkspace?.id : undefined}
          allowWorkspaceScope={applicationView === 'code'}
          workspaces={workspaces}
          shellProfiles={shellProfiles}
          onSave={updateSettings}
          agentProfiles={agentProfiles}
          agentReadiness={agentReadiness}
          isDiscoveringAgents={isDiscovering}
          onDiscoverAgents={() => void discover(true)}
          onConfigureAgent={(profile) => setConfiguredAgent(profile)}
          onNewCustomAgent={() => setConfiguredAgent({
            // Blank profile for the modal's "isNew" branch. agentProfileId === ''
            // is what AgentConfigModal uses to switch its UI to "create" mode.
            agentProfileId: '',
            name: '',
            provider: 'custom',
            command: '',
            commandTemplate: '',
            isBuiltin: false,
            parentProvider: 'claude',
            systemPrompt: ''
          })}
          onUseProviderInPane={async (profile) => {
            const paneId =
              activePane?.id ??
              activeWorkspace?.panes.find((p) => p.type === 'terminal')?.id ??
              null
            if (!paneId || !activeWorkspace) {
              setAppNotice(t('app.notice.needsTerminal'))
              return
            }
            try {
              await useWorkspaceStore.getState().setPaneAgent(paneId, profile.agentProfileId)
              setActivePane(paneId)
              setActiveTerminalPaneId(paneId)
              useTerminalStore.getState().setStatus(paneId, 'idle')
              try {
                await window.oxe.terminal.stop({ paneId })
              } catch {
                /* may already be stopped */
              }
              const agentCommand =
                profile.parentProvider
                  ? agentProfiles.find((p) => p.provider === profile.parentProvider)?.command
                  : profile.command
              await window.oxe.terminal.start({
                paneId,
                workspaceId: activeWorkspace.id,
                agentCommand: agentCommand || undefined,
                initialPrompt: profile.systemPrompt || undefined
              })
              useTerminalStore.getState().setStatus(paneId, 'running')
              if (isSettingsOpen) toggleSettings()
              closeWorkspaceSettings()
            } catch (err) {
              setAppNotice(humanizeError(err, t('app.notice.agentFailed')))
            }
          }}
          onClose={() => { if (isSettingsOpen) toggleSettings(); closeWorkspaceSettings() }}
        />
      ) : null}
      {isDesignSystemOpen ? <DesignSystemPage onClose={() => { setDesignSystemOpen(false) }} /> : null}
      {isSemanticActivityOpen ? (
        <SemanticActivityPanel
          workspaceId={activeWorkspace?.id ?? null}
          onClose={() => { setSemanticActivityOpen(false) }}
        />
      ) : null}
      {configuredAgent ? (
        <AgentConfigModal
          profile={configuredAgent}
          readiness={agentReadiness.find((r) => r.provider === configuredAgent.provider)}
          isDiscovering={isDiscovering}
          onSave={async (id, input) => {
            // Empty id = "+ New custom agent" path. AgentConfigModal sets the
            // isNew flag from the empty id but routes every save through the
            // same callback, so we branch here on the id.
            if (id === '') {
              await createProfile({
                name: input.name ?? configuredAgent.name,
                provider: 'custom',
                command: input.command ?? '',
                commandTemplate: input.commandTemplate ?? '',
                model: input.model,
                role: input.role,
                systemPrompt: input.systemPrompt,
                parentProvider: input.parentProvider ?? configuredAgent.parentProvider
              })
            } else {
              await updateProfile(id, input)
            }
            await loadShellProfiles()
            await discover(true)
          }}
          onDelete={deleteProfile}
          onHealthCheck={() => void discover(true)}
          onClose={() => setConfiguredAgent(null)}
        />
      ) : null}
      </Suspense>
      </ErrorBoundary>
      </main>
      <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}
