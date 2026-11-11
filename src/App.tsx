import { Settings } from 'lucide-react'
import { useContributedCommands } from './utils/commandRegistry'
import { sayAddProjectFirst } from './commands/thread.events'
import type { CodeCommandContext } from './commands/code.commands'
import type { ThreadCommandContext } from './commands/thread.commands'
import { useDeferredModule } from './app/useDeferredModule'
import { DataHosts, DataSidebar, isDataView, ThreadGrid, ThreadSidebar, ThreadSidebarBoundary, useModeActions, ViewSkeleton } from './components/Navigation/ModeViews'
import { useViewSwitch } from './app/viewSwitch'
import { setShownView } from './app/shownView'
import { hasRememberedAppView, rememberAppView, startAppView } from './app/startView'
import { SettingsCenter } from './components/Settings/SettingsHost'
const NoWorkspaceStart = lazy(() => import('./components/Onboarding/NoWorkspaceStart').then(m => ({ default: m.NoWorkspaceStart })))
const FirstRunHost = lazy(() => import('./components/Onboarding/FirstRunHost').then(m => ({ default: m.FirstRunHost })))
const DelegationNotice = lazy(() => import('./components/Delegation/DelegationNotice').then(m => ({ default: m.DelegationNotice })))
import { useTranslation } from 'react-i18next'
import type { ToolId } from './components/Workspace/toolCatalog'
import { panelMenuEntries, type WorkbenchPanelItem } from './components/Workbench/WorkbenchPanelMenu'
import { Button, cx, Toaster, TitleTooltips, TooltipProvider } from './ui'
import { reportSplitRefused, reportSplitTooSmall } from './components/Grid/splitRefusal'
import { layoutPaneSize, paneSize, splitGridSize, splitHasRoom } from './components/Grid/splitRoom'
import titleBar from './components/Navigation/TitleBar.module.css'
import { ModeSwitch } from './components/Navigation/ModeSwitch'
import { NeedsYouPill } from './components/Navigation/NeedsYouPill'
import { RemovedFeaturesBand } from './components/Updates/RemovedFeaturesBand'
import { ActivityCenter } from './components/Activity/ActivityCenter'
import { CommandBarTrigger } from './components/CommandBar/CommandBarTrigger'

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
/** The palette's and menu bar's command lists, loaded after the first frame (T52). */
const loadCommandContributors = () => import('./commands/CommandContributors')
/** The activity center's producers, loaded after the first frame. */
const loadActivitySources = () => import('./app/ActivitySources')
const AgentConfigModal = lazy(() => import('./components/Agents/AgentConfigModal').then((m) => ({ default: m.AgentConfigModal })))
const DesignSystemPage = lazy(() => import('./components/DesignSystem/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })))
const DelegatedWorkDialog = lazy(() => import('./components/Delegation/DelegatedWorkDialog').then(m => ({ default: m.DelegatedWorkDialog })))
const ProviderAccountsPanel = lazy(() => import('./components/Threads/ProviderAccountsPanel').then(m => ({ default: m.ProviderAccountsPanel })))
const NewThreadDialog = lazy(() => import('./components/Threads/ThreadDialogs').then(m => ({ default: m.NewThreadDialog })))
const AddThreadProjectDialog = lazy(() => import('./components/Threads/ThreadDialogs').then(m => ({ default: m.AddThreadProjectDialog })))
const SlashOverlay = lazy(() => import('./components/SlashOverlay/SlashOverlay').then(m => ({ default: m.SlashOverlay })))
// The palette waits for the command lists (T52), so its first opening never shows an empty or partial list.
const CommandMenu = lazy(() => Promise.all([import('./components/CommandMenu/CommandMenu'), loadCommandContributors()]).then(([m]) => ({ default: m.CommandMenu })))
const UsageModal = lazy(() => import('./components/Usage/UsageModal').then(m => ({ default: m.UsageModal })))
const CommandBarHost = lazy(() => import('./components/CommandBar/CommandBarHost').then(m => ({ default: m.CommandBarHost })))
const McpPanel = lazy(() => import('./components/MCP/McpPanel').then((m) => ({ default: m.McpPanel })))
const ContainersPanel = lazy(() => import('./components/Containers/ContainersPanel').then((m) => ({ default: m.ContainersPanel })))
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



import { chunk, lazyFrom } from './lib/chunk'
const WORKSPACE_SURFACE_CHUNK = chunk(() => import('./components/Workspace/WorkspaceSurface'))
const WorkspaceSurface = lazyFrom(WORKSPACE_SURFACE_CHUNK, (m) => m.WorkspaceSurface)



import { AgentHooksPromptHost } from './components/AgentSessions/AgentHooksPromptHost'
import './components/Threads/ThreadView.css'
import { AppStatusBar } from './components/Workspace/AppStatusBar'
import { UpdateChips } from './app/UpdateChips'
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
import { useAgentHookStatus } from './hooks/useAgentHookStatus'
import { startToolOutputCuts } from './store/tool-output-cut.store'
import { QUOTA_NOTIFICATION_PANE_PREFIX, THREAD_NOTIFICATION_PANE_PREFIX } from './hooks/notificationPrefixes'
import { useThreadShortcuts } from './hooks/useThreadShortcuts'
import { setKeyboardView, useKeybindings, withShortcut, type AppView } from './keyboard/keybindings'
import { useTerminalPrefsStore, TERMINAL_PREFS_DEFAULTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from './store/terminal-prefs.store'
import { RemotePairingHost } from './components/Remote/RemotePairingHost'
/** macOS keeps its native application menu; Windows/Linux draw it in the title bar. */
// Like the palette, the menu bar waits for the command lists (T52) so it never opens short.
const AppMenuBar = lazy(() => Promise.all([import('./components/Navigation/AppMenuBar'), loadCommandContributors()]).then(([module]) => ({ default: module.AppMenuBar })))
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
export function App(): ReactElement {
  const { t } = useTranslation()
  const appVersion = window.oxe?.app?.version ?? 'dev'
  const [applicationView, setApplicationView] = useState<AppView>(startAppView)
  const [delegatedWorkOpen, setDelegatedWorkOpen] = useState(false)
  const [delegationTarget, setDelegationTarget] = useState<{ workspaceId: string; taskId: string } | null>(null)
  const [hasOpenedThread, setHasOpenedThread] = useState(() => applicationView === 'thread')
  const [firstRunExited, setFirstRunExited] = useState(false)
  const firstRunDismissed = useNavigationPrefs(state => state.firstRun.dismissed)
  // The view switches when the next view is ready; until then the current one stays and the button is busy (F7.2).
  const viewSwitch = useViewSwitch(applicationView, mode => { setFirstRunExited(true); if (mode === 'thread') setHasOpenedThread(true); rememberAppView(mode); setApplicationView(mode) })
  const rawSelectMode = viewSwitch.select
  const selectMode = useCallback((mode: AppView) => {
    setFirstRunExited(true)
    rememberAppView(mode)
    rawSelectMode(mode)
  }, [rawSelectMode])
  useModeActions(selectMode)
  const [newThreadWorkspaceId, setNewThreadWorkspaceId] = useState<string | null | undefined>(undefined)
  const [newThreadRootPath, setNewThreadRootPath] = useState<string | undefined>()
  const [isThreadProjectOpen, setThreadProjectOpen] = useState(false)
  const threadSnapshot = useThreadStore(state => state.snapshot)
  const threadSelection = useThreadStore(state => state.selectedId)
  const codeSidebarWidth = useNavigationPrefs(state => state.width)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [containersOpen, setContainersOpen] = useState(false)
  const { activeWorkspaceId, bootstrap, closePane, closeWorkspace, createWorkspace, error, isLoading, loadShellProfiles, setActiveWorkspace, shellProfiles, splitPane, updateGitHubState, updateReviewState, updateEditorState, updateBackgroundState, updateWorktreeState, updateSettings, workspaces } = useWorkspaceStore(useShallow((state) => ({
    activeWorkspaceId: state.activeWorkspaceId, bootstrap: state.bootstrap, closePane: state.closePane, closeWorkspace: state.closeWorkspace, createWorkspace: state.createWorkspace, error: state.error, isLoading: state.isLoading, loadShellProfiles: state.loadShellProfiles, setActiveWorkspace: state.setActiveWorkspace, shellProfiles: state.shellProfiles, splitPane: state.splitPane, updateGitHubState: state.updateGitHubState, updateReviewState: state.updateReviewState, updateEditorState: state.updateEditorState, updateBackgroundState: state.updateBackgroundState, updateWorktreeState: state.updateWorktreeState, updateSettings: state.updateSettings, workspaces: state.workspaces
  })))
  const clearEditor = useEditorStore((state) => state.clearEditor)
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
    isSidebarCollapsed, collapsedSidebars,
    isNewWorkspaceOpen,
    isWorkspaceSettingsOpen,
    slashOverlayPaneId,
    isMcpPanelOpen,
    isScriptsPanelOpen,
    webPreviewOpenByWorkspace,
    isIntegrationPanelOpen,
    openSlashOverlay,
    closeSlashOverlay,
    openMcpPanel,
    closeMcpPanel,
    openScriptsPanel,
    closeScriptsPanel,
    isSearchPanelOpen, openSearchPanel, closeSearchPanel, isHttpCallsPanelOpen, toggleHttpCallsPanel, isAndroidPanelOpen, toggleAndroidPanel,
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
    isSidebarCollapsed: state.isSidebarCollapsed, collapsedSidebars: state.collapsedSidebars,
    isNewWorkspaceOpen: state.isNewWorkspaceOpen,
    isWorkspaceSettingsOpen: state.isWorkspaceSettingsOpen,
    slashOverlayPaneId: state.slashOverlayPaneId,
    isMcpPanelOpen: state.isMcpPanelOpen,
    isScriptsPanelOpen: state.isScriptsPanelOpen,
    webPreviewOpenByWorkspace: state.webPreviewOpenByWorkspace,
    isIntegrationPanelOpen: state.isIntegrationPanelOpen,
    openSlashOverlay: state.openSlashOverlay, closeSlashOverlay: state.closeSlashOverlay, openMcpPanel: state.openMcpPanel, closeMcpPanel: state.closeMcpPanel,
    openScriptsPanel: state.openScriptsPanel, closeScriptsPanel: state.closeScriptsPanel,
    isSearchPanelOpen: state.isSearchPanelOpen, openSearchPanel: state.openSearchPanel, closeSearchPanel: state.closeSearchPanel,
    isHttpCallsPanelOpen: state.isHttpCallsPanelOpen, toggleHttpCallsPanel: state.toggleHttpCallsPanel, isAndroidPanelOpen: state.isAndroidPanelOpen, toggleAndroidPanel: state.toggleAndroidPanel,
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
  useEffect(() => { if (isNewWorkspaceOpen || activeWorkspace) void WORKSPACE_SURFACE_CHUNK.load() }, [isNewWorkspaceOpen, activeWorkspace])
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
  const [appNotice, setAppNotice] = useState<string | null>(null)
  const [commandBarOpen, setCommandBarOpen] = useState(false)
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
  useEffect(() => {
    const trim = (): void => {
      const current = visitedWorkspaceIdsRef.current
      const paneCountOf = (workspaceId: string): number =>
        workspacesRef.current.find((item) => item.id === workspaceId)?.panes.length ?? 0
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
    void useIntegrationStore.getState().load(null)
    if (window.oxe?.thread?.projects) void useThreadStore.getState().loadProjects()
    const unsubscribe = useBackgroundStore.getState().subscribe()
    const unsubscribeSkills = useSkillStore.getState().subscribe()
    const unsubscribeMcp = useMcpStore.getState().subscribe()
    return () => { unsubscribe(); unsubscribeSkills(); unsubscribeMcp() }
  }, [loadProfiles, loadReadiness])

  useEffect(() => {
    if (!activeWorkspace) return
    const timer = window.setTimeout(() => {
      void useSkillStore.getState().refresh(activeWorkspace.rootPath)
      void useMcpStore.getState().load(activeWorkspace.id)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [activeWorkspace?.id, activeWorkspace?.rootPath])

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

  useEffect(() => {
    const api = window.oxe?.mcpInternal
    if (!api) return
    const unsubscribe = api.onWorktreeChanged((event) => {
      void useWorktreeStore.getState().refresh(event.workspaceId, event.rootPath)
    })
    return unsubscribe
  }, [])

  useEffect(() => { void import('./app/voiceRemovedNotice').then(m => m.showVoiceRemovedNotice(), () => {}) }, [])

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

  const activitySources = useDeferredModule(loadActivitySources, () => t('deferred.activityMissing', { ns: 'common' }))
  useAgentHookStatus()
  useEffect(() => startToolOutputCuts(), [])

  useEffect(() => {
    const api = window.oxe?.notifications
    if (!api) return
    return api.onActivate(({ paneId, workspaceId }) => {
      if (paneId.startsWith(QUOTA_NOTIFICATION_PANE_PREFIX)) return
      if (paneId.startsWith(THREAD_NOTIFICATION_PANE_PREFIX)) {
        setFirstRunExited(true)
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
    setFirstRunExited(true)
    rememberAppView('code')
    setApplicationView('code')
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

  const toggleScriptsPanel = (): void => { if (isScriptsPanelOpen) closeScriptsPanel(); else openScriptsPanel() }
  const toggleSearchPanel = (): void => { if (isSearchPanelOpen) closeSearchPanel(); else openSearchPanel() }

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
    const size = layoutPaneSize(usePaneLayoutStore.getState().trees[workspaceId] ?? null, paneId, splitGridSize()) ?? paneSize(paneId)
    if (size && !splitHasRoom(size, direction)) {
      reportSplitTooSmall({ width: direction === 'vertical' ? (size.width - 10) / 2 : size.width, height: direction === 'horizontal' ? (size.height - 10) / 2 : size.height })
      return
    }

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
  const showFirstRun = !isLoading && workspaces.length === 0 && threadProjects.length === 0 && !firstRunDismissed && !firstRunExited && !hasRememberedAppView()
  const openContainerConversation = useCallback((id: string): void => {
    setContainersOpen(false)
    setFirstRunExited(true)
    setHasOpenedThread(true)
    rememberAppView('thread')
    setApplicationView('thread')
    void useThreadStore.getState().select(id)
  }, [])

  // Code's side panels: buttons in the workspace bar for Changes and Browser, the rest in the Panels menu (also on the rail).
  const codePanelItems: WorkbenchPanelItem[] = activeWorkspace ? [
    { id: 'changes', active: activeWorkspace.reviewPanelVisible === true, onToggle: toggleReviewPanel },
    { id: 'browser', active: webPreviewOpenByWorkspace[activeWorkspace.id] === true, onToggle: toggleWebPreviewPanel },
    { id: 'git', active: activeWorkspace.githubPanelVisible === true, onToggle: toggleGitHubPanel },
    { id: 'files', active: activeWorkspace.editorVisible === true, onToggle: toggleEditor },
    { id: 'search', active: isSearchPanelOpen, onToggle: toggleSearchPanel },
    { id: 'scripts', active: isScriptsPanelOpen, onToggle: toggleScriptsPanel },
    { id: 'worktrees', active: activeWorkspace.worktreePanelVisible === true, onToggle: toggleWorktreePanel }, { id: 'httpCalls', active: isHttpCallsPanelOpen, onToggle: toggleHttpCallsPanel }, { id: 'android', active: isAndroidPanelOpen, onToggle: toggleAndroidPanel }, { id: 'containers', active: containersOpen, onToggle: () => setContainersOpen(open => !open) }
  ] : []

  const toolHandlers: Partial<Record<ToolId, () => void>> = {
    integration: openIntegrationPanel, github: toggleGitHubPanel, worktrees: toggleWorktreePanel, scripts: toggleScriptsPanel, search: toggleSearchPanel,
    'web-preview': toggleWebPreviewPanel, background: toggleBackgroundPanel, mcp: openMcpPanel,
    editor: toggleEditor, review: toggleReviewPanel, 'http-calls': toggleHttpCallsPanel, android: toggleAndroidPanel, slash: () => { if (activePane) openSlashOverlay(activePane.id) }
  }

  // Palette and menu commands live in src/commands/*.commands.ts. They load after the first frame (T52): only the lazy
  // palette and menu bar read them, and shortcuts never go through them.
  const commandContributors = useDeferredModule(loadCommandContributors)
  const codeCommandContext: CodeCommandContext = { applicationView, activeWorkspace, activePane, toolHandlers, openNewWorkspace: openNewWorkspaceFromUI, showCode: () => selectMode('code'),
    openTools: { editor: activeWorkspace?.editorVisible, github: activeWorkspace?.githubPanelVisible, review: activeWorkspace?.reviewPanelVisible, background: activeWorkspace?.backgroundPanelVisible, worktrees: activeWorkspace?.worktreePanelVisible, scripts: isScriptsPanelOpen, search: isSearchPanelOpen, 'http-calls': isHttpCallsPanelOpen, android: isAndroidPanelOpen, 'web-preview': activeWorkspace ? webPreviewOpenByWorkspace[activeWorkspace.id] : false },
    splitActivePane, toggleActivePaneMaximize, openDesignSystem: () => setDesignSystemOpen(true) }
  const commandActions = useContributedCommands()
  useEffect(() => { setKeyboardView(applicationView); setShownView(applicationView) }, [applicationView])
  const terminalPane = activePane?.type === 'terminal' ? activePane : null
  const zoomTerminal = (delta: 1 | -1 | 0): void => {
    const store = useTerminalPrefsStore.getState()
    const next = delta === 0 ? TERMINAL_PREFS_DEFAULTS.fontSize : store.global.fontSize + delta
    store.setGlobal({ fontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next)) })
  }
  useKeybindings({
    'commandBar.open': () => setCommandBarOpen(true), 'palette.open': openCommandMenu, 'palette.search': openCommandMenu, 'settings.open': () => { if (!isSettingsOpen) toggleSettings() }, 'sidebar.toggle': () => toggleSidebar(applicationView === 'thread' ? 'thread' : 'code'),
    'code.changes': toggleReviewPanel, 'code.browser': toggleWebPreviewPanel, 'code.files': toggleEditor,
    'code.splitLayout': () => useUIStore.getState().toggleSplitLayout(),
    'code.search': () => { const ui = useUIStore.getState(); if (ui.isSearchPanelOpen) ui.closeSearchPanel(); else ui.openSearchPanel() },
    'pane.splitRight': () => splitActivePane('vertical'), 'pane.splitDown': () => splitActivePane('horizontal'), 'pane.maximize': toggleActivePaneMaximize,
    'terminal.restart': () => terminalPane ? void window.oxe.terminal.restart({ paneId: terminalPane.id }) : false,
    'terminal.slash': () => terminalPane ? openSlashOverlay(terminalPane.id) : false,
    'terminal.zoomIn': () => terminalPane ? zoomTerminal(1) : false, 'terminal.zoomOut': () => terminalPane ? zoomTerminal(-1) : false,
    'terminal.zoomReset': () => terminalPane ? zoomTerminal(0) : false
  })

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
      if (batch.some(id => !state.threads.some(t => t.id === id))) await Promise.all([state.load(), state.loadProjects()])
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
  const threadCommandContext: ThreadCommandContext = { snapshot: threadSnapshot, projects: threadProjects, showThread: () => selectMode('thread'), newThread, newThreadIn: setNewThreadWorkspaceId,
    addProject: () => setThreadProjectOpen(true), openAccounts: openThreadAccounts }
  const openDelegation = async (task: DelegationTask): Promise<boolean> => {
    const showDelegationDetails = () => {
      setDelegationTarget({ workspaceId: task.originWorkspaceId ?? task.workspaceId, taskId: task.id })
      setDelegatedWorkOpen(true)
    }
    if (task.destinationThreadId) {
      setFirstRunExited(true)
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
        setFirstRunExited(true)
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
      {activitySources && <activitySources.ActivitySources applicationView={applicationView} />}
      {commandContributors && <><commandContributors.CodeCommandContributor {...codeCommandContext} /><commandContributors.ThreadCommandContributor {...threadCommandContext} /></>}
      <main className={`app-shell${showFirstRun ? ' first-run-shell' : applicationView === 'thread' ? ' thread-shell' : isDataView(applicationView) ? ' oq-shell' : collapsedSidebars.code ? ' sidebar-collapsed' : ''}`} style={applicationView !== 'code' ? { '--thread-sidebar-width': `${(applicationView === 'thread' ? collapsedSidebars.thread : isSidebarCollapsed) ? 48 : codeSidebarWidth}px` } as CSSProperties : { '--sidebar-w': `${codeSidebarWidth}px` } as CSSProperties}>
      <header className={cx('workbench-titlebar', titleBar.bar)} aria-label={t('app.workbench')}>
        <div className={titleBar.brand}><OxeLogo size={16} /><strong className={titleBar.word}>oxespace</strong>{!IS_MAC && <Suspense fallback={null}><AppMenuBar context={{ actions: commandActions, applicationView, setApplicationView: selectMode, openSettings: () => { if (!isSettingsOpen) toggleSettings() }, addThreadProject: () => setThreadProjectOpen(true), openCommandMenu, openContainers: () => setContainersOpen(v => !v), version: appVersion }} /></Suspense>}</div>
        <ModeSwitch mode={showFirstRun ? 'thread' : applicationView} onSelect={selectMode} />
        <div className={titleBar.trailing}><CommandBarTrigger onOpen={() => setCommandBarOpen(true)} /><NeedsYouPill /><ActivityCenter onSelectView={selectMode} /><Button variant="ghost" size="sm" square aria-label={showFirstRun ? t('nav.openSettings') : withShortcut(t('nav.settings'), 'settings.open')} title={withShortcut(t('nav.settings'), 'settings.open')} data-testid="titlebar-settings" icon={<Settings size={14} aria-hidden="true" />} onClick={toggleSettings} /><UpdateChips /></div>
      </header>
      <RemovedFeaturesBand />
      {delegationNotice && <Suspense fallback={null}><DelegationNotice onView={() => { setDelegatedWorkOpen(true); setDelegationNotice(null) }} onDismiss={() => setDelegationNotice(null)} /></Suspense>}
      {delegatedWorkOpen && <Suspense fallback={null}><DelegatedWorkDialog workspaces={workspaces} workspaceId={delegationTarget?.workspaceId ?? (applicationView === 'thread' ? threadSnapshot?.thread.workspaceId ?? activeWorkspaceId ?? '' : activeWorkspaceId ?? '')} focusTaskId={delegationTarget?.taskId}
        origin={applicationView === 'thread' ? threadSelection ? { kind: 'thread', id: threadSelection } : undefined : activePane ? { kind: 'pane', id: activePane.id } : undefined}
        onClose={() => { setDelegatedWorkOpen(false); setDelegationTarget(null) }} onOpen={openDelegation} /></Suspense>}
      {showFirstRun ? null : isDataView(applicationView) ? <DataSidebar view={applicationView} />
      : applicationView === 'thread' ? <ThreadSidebarBoundary><ThreadSidebar onCreate={(id, rootPath) => { setNewThreadRootPath(rootPath); setNewThreadWorkspaceId(id) }} onAccounts={openThreadAccounts} onAddProject={() => setThreadProjectOpen(true)} onOpenInCode={async rootPath => {
        const existing = (await window.oxe.workspace.list()).find(workspace => isSameRootPath(workspace.rootPath, rootPath, window.oxe.app.platform))
        if (existing) await setActiveWorkspace(existing.id)
        else await createWorkspace({ rootPath, layoutPreset: 1, autoStart: false })
        setFirstRunExited(true)
        setApplicationView('code')
      }} /></ThreadSidebarBoundary> : <Sidebar
        onDelegations={() => { setDelegationTarget(null); setDelegatedWorkOpen(true) }}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion={appVersion}
        onNewWorkspace={openNewWorkspaceFromUI}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={handleCloseWorkspace}
        isCollapsed={collapsedSidebars.code}
        onToggleCollapse={() => toggleSidebar('code')}
        panelMenu={panelMenuEntries(codePanelItems)}
        onOpenJobs={toggleBackgroundPanel}
        onOpenScripts={toggleScriptsPanel}
        onOpenSearch={openCommandMenu}
        integrationGroups={integrationGroups}
      />}
      <section className={`workspace-surface${showFirstRun ? ' thread-workspace-surface' : applicationView === 'thread' ? ' thread-workspace-surface' : isDataView(applicationView) ? ' oq-surface' : ''}`}>
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
        ) : showFirstRun ? (
          <Suspense fallback={null}><FirstRunHost onOpenMode={selectMode} onNewWorkspace={openNewWorkspaceFromUI} onStartConversation={folder => {
            setFirstRunExited(true)
            setHasOpenedThread(true)
            selectMode('thread')
            const project = folder ? threadProjects.find(item => item.contexts.some(ctx => isSameRootPath(ctx.rootPath, folder, window.oxe.app.platform))) : threadProjects.find(item => !item.hidden)
            if (project) setNewThreadWorkspaceId(project.projectId)
            else if (folder) { setNewThreadRootPath(folder); setNewThreadWorkspaceId(null) }
            else setThreadProjectOpen(true)
          }} /></Suspense>
        ) : activeWorkspace || applicationView !== 'code' ? (
          <>
            <DataHosts view={applicationView} />
            <AgentHooksPromptHost />
            {hasOpenedThread && <div className="thread-host" data-view="thread" style={{ display: applicationView === 'thread' ? 'flex' : 'none', flex: 1, minHeight: 0 }} aria-hidden={applicationView !== 'thread'}><ErrorBoundary id="conversations" label={t('app.boundary.conversations')} onReset={ThreadGrid.retry}><Suspense fallback={<ViewSkeleton name="OxeChat" />}><ThreadGrid onNewThread={newThread} onAccounts={openThreadAccounts} onDelegations={() => setDelegatedWorkOpen(true)} /></Suspense></ErrorBoundary></div>}
            {workspaces
              .filter((ws) => ws.id === activeWorkspaceId || visitedWorkspaceIds.includes(ws.id))
              .map((ws) => {
                const isActive = ws.id === activeWorkspaceId && applicationView === 'code'
                return (
                  <div
                    key={ws.id}
                    className={`workspace-host${isActive ? '' : ' workspace-host-hidden'}`} data-view={isActive ? 'code' : undefined}
                    aria-hidden={!isActive}
                  >
                    <Suspense fallback={<ViewSkeleton name="OxeCode" />}><WorkspaceSurface
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
                      containersVisible={isActive && containersOpen}
                      onCloseScripts={closeScriptsPanel}
                      onCloseWebPreview={() => closeWebPreview(ws.id)}
                      onCloseIntegration={closeIntegrationPanel}
                      onCloseSearch={closeSearchPanel}
                      onCloseContainers={() => setContainersOpen(false)}
                      onOpenContainerConversation={openContainerConversation}
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
                    /></Suspense>
                  </div>
                )
              })}
          </>
        ) : (
          <Suspense fallback={null}><NoWorkspaceStart onNewWorkspace={openNewWorkspaceFromUI} onSelectMode={selectMode} onAddProject={() => { selectMode('thread'); setThreadProjectOpen(true) }} /></Suspense>
        )}
        {showFirstRun ? (
          <AppStatusBar docked firstRun appVersion={appVersion} workspace={null} activePaneId={null} />
        ) : applicationView === 'code' ? (
          <AppStatusBar appVersion={appVersion} workspace={activeWorkspace ?? null} activePaneId={activePane?.id ?? null} />
        ) : applicationView === 'thread' ? (
          <AppStatusBar docked appVersion={appVersion} workspace={null} activePaneId={null} rootPath={threadSnapshot?.thread.rootPath} usageProvider={threadSnapshot?.thread.provider === 'claude' || threadSnapshot?.thread.provider === 'codex' ? threadSnapshot.thread.provider : null} />
        ) : (
          <AppStatusBar docked appVersion={appVersion} workspace={activeWorkspace ?? null} activePaneId={null} />
        )}
        <Suspense fallback={null}>
          {accountsOpen && (threadProject ?? threadProjects[0]) && <ProviderAccountsPanel workspaceId={threadSnapshot?.thread.workspaceId ?? `thread:${(threadProject ?? threadProjects[0]).projectId}`} onClose={() => setAccountsOpen(false)} />}
          {newThreadWorkspaceId !== undefined && <NewThreadDialog initialProjectId={newThreadWorkspaceId} initialRootPath={newThreadRootPath} onClose={() => { setNewThreadWorkspaceId(undefined); setNewThreadRootPath(undefined) }} />}
          {isThreadProjectOpen && <AddThreadProjectDialog onPickFolder={() => window.oxe.workspace.pickFolder()} onClose={() => setThreadProjectOpen(false)} onAdd={async rootPath => {
            await window.oxe.thread!.addProject(rootPath)
            await useThreadStore.getState().loadProjects()
          }} />}
        </Suspense>
      </section>
      <ErrorBoundary id="window" label={t('app.boundary.window')}>
      <Suspense fallback={null}>
      {isNewWorkspaceOpen ? (
        <NewWorkspaceModal
          agentProfiles={agentProfiles}
          shellProfiles={shellProfiles}
          existingWorkspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          platform={window.oxe.app.platform}
          onOpenExisting={async (id) => { setFirstRunExited(true); await setActiveWorkspace(id); closeNewWorkspace() }}
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
      {commandBarOpen ? <CommandBarHost open={commandBarOpen} onOpenChange={setCommandBarOpen} applicationView={applicationView} selectMode={selectMode} activeWorkspace={activeWorkspace ?? null} activePane={activePane} /> : null}
      {slashPane ? (
        <SlashOverlay
          paneId={slashPane.id}
          paneLabel={slashPane.displayName ?? slashPane.agentName ?? `Pane ${slashPane.rowIndex + 1}.${slashPane.columnIndex + 1}`}
          skills={skills}
          onClose={closeSlashOverlay}
          onExecute={dispatchSlashCommand}
        />
      ) : null}
      {isMcpPanelOpen ? (
        <McpPanel
          workspaceId={applicationView === 'thread' ? threadSnapshot?.thread.workspaceId ?? null : activeWorkspace?.id ?? null}
          conversationServers={applicationView === 'thread' ? threadSnapshot?.thread.mcpServers?.servers : undefined}
          onClose={closeMcpPanel}
        />
      ) : null}
      {containersOpen && !(applicationView === 'code' && activeWorkspace && !showFirstRun) ? <ContainersPanel onClose={() => setContainersOpen(false)} onOpenConversation={openContainerConversation} /> : null}
      {isSettingsOpen || (isWorkspaceSettingsOpen && applicationView === 'code') ? (
        <Suspense fallback={null}><SettingsCenter
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
        /></Suspense>
      ) : null}
      {isDesignSystemOpen ? <DesignSystemPage onClose={() => { setDesignSystemOpen(false) }} /> : null}
      {configuredAgent ? (
        <AgentConfigModal
          profile={configuredAgent}
          readiness={agentReadiness.find((r) => r.provider === configuredAgent.provider)}
          isDiscovering={isDiscovering}
          onSave={async (id, input) => {
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
      <RemotePairingHost />
      <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}
