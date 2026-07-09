import { Activity, Bot, FilePlus2, FolderOpen, Github, Grid2x2, History, LayoutDashboard, Maximize, Mic, Palette, Plus, RotateCw, Settings2, Sliders, Split, Square, StopCircle, Wrench } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../shared/types/agent'
import { OxeLogo } from './components/Brand/OxeLogo'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ThemeProvider } from './components/Theme/ThemeProvider'
import { SlashOverlay } from './components/SlashOverlay/SlashOverlay'
import type { CommandPaletteAction } from './components/CommandPalette/CommandPalette'
// Modals/overlays are user-triggered and infrequent — lazy-load them so they're
// not in the first-paint bundle.
const AgentConfigModal = lazy(() => import('./components/Agents/AgentConfigModal').then((m) => ({ default: m.AgentConfigModal })))
const DesignSystemPage = lazy(() => import('./components/DesignSystem/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })))
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const ToolsModal = lazy(() => import('./components/Workspace/ToolsModal').then((m) => ({ default: m.ToolsModal })))
const CommandPalette = lazy(() => import('./components/CommandPalette/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const HistoryPanel = lazy(() => import('./components/History/HistoryPanel').then((m) => ({ default: m.HistoryPanel })))
const McpPanel = lazy(() => import('./components/MCP/McpPanel').then((m) => ({ default: m.McpPanel })))
const SemanticActivityPanel = lazy(() => import('./components/Semantic/SemanticActivityPanel').then((m) => ({ default: m.SemanticActivityPanel })))
const SkillsBrowser = lazy(() => import('./components/Skills/SkillsBrowser').then((m) => ({ default: m.SkillsBrowser })))
import { useBackgroundStore } from './store/background.store'
import { useMcpStore } from './store/mcp.store'
import { useSkillStore } from './store/skill.store'
import { useSlashDispatcher } from './lib/useSlashDispatcher'
import { Sidebar } from './components/Sidebar/Sidebar'
import type { WizardLaunchInput } from './components/Workspace/NewWorkspaceModal'
const NewWorkspaceModal = lazy(() => import('./components/Workspace/NewWorkspaceModal').then((m) => ({ default: m.NewWorkspaceModal })))
const WorkspaceSettingsModal = lazy(() => import('./components/Workspace/WorkspaceSettingsModal').then((m) => ({ default: m.WorkspaceSettingsModal })))
import { WorkspaceSurface } from './components/Workspace/WorkspaceSurface'
import { UpdateBanner } from './components/Updates/UpdateBanner'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES, WORKSPACE_THEMES } from './components/Workspace/workspaceOptions'
import { useAgentStore } from './store/agent.store'
import { useEditorStore } from './store/editor.store'
import { useTerminalStore } from './store/terminal.store'
import { useUIStore } from './store/ui.store'
import { selectActiveWorkspace, useWorkspaceStore } from './store/workspace.store'
import { useIntegrationStore } from './store/integration.store'
import { useWorktreeStore } from './store/worktree.store'
import { useVoiceStore } from './store/voice.store'
import { useAgentNotifications } from './hooks/useAgentNotifications'
import { useTerminalPrefsStore, TERMINAL_PREFS_DEFAULTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from './store/terminal-prefs.store'
import { useSettingsStore } from './store/settings.store'

/** Match a KeyboardEvent against a hotkey string like "Ctrl+Shift+Space". */
function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
  const mods = new Set(['ctrl', 'shift', 'alt', 'meta', 'cmd'])
  const mainKey = parts.find((p) => !mods.has(p)) ?? ''
  const eventKey = event.key === ' ' ? 'space' : event.key.toLowerCase()
  return (
    event.ctrlKey === parts.includes('ctrl') &&
    event.shiftKey === parts.includes('shift') &&
    event.altKey === parts.includes('alt') &&
    event.metaKey === (parts.includes('meta') || parts.includes('cmd')) &&
    eventKey === mainKey
  )
}

export function App(): ReactElement {
  const appVersion = window.oxe?.app?.version ?? 'dev'
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
    updateGitHubState,
    updateReviewState,
    updateEditorState,
    updateBackgroundState,
    updateWorktreeState,
    updateSettings,
    workspaces
  } = useWorkspaceStore()
  const { clearEditor, hasDirtyEditor } = useEditorStore()
  const getTerminalStatus = useTerminalStore((state) => state.getStatus)
  const setPendingCommand = useTerminalStore((state) => state.setPendingCommand)
  const setActiveTerminalPaneId = useTerminalStore((state) => state.setActivePaneId)
  const removeTerminalPane = useTerminalStore((state) => state.removePane)
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace)
  const {
    closeNewWorkspace,
    closeCommandPalette,
    closeWorkspaceSettings,
    activePaneId,
    isCommandPaletteOpen,
    isSettingsOpen,
    isToolsOpen,
    isSidebarCollapsed,
    isNewWorkspaceOpen,
    isWorkspaceSettingsOpen,
    slashOverlayPaneId,
    isHistoryPanelOpen,
    isMcpPanelOpen,
    isSkillsBrowserOpen,
    isScriptsPanelOpen,
    isWebPreviewOpen,
    isOxePanelOpen,
    isIntegrationPanelOpen,
    openCommandPalette,
    openWorkspaceSettings,
    openSlashOverlay,
    closeSlashOverlay,
    openHistoryPanel,
    closeHistoryPanel,
    openMcpPanel,
    closeMcpPanel,
    openSkillsBrowser,
    closeSkillsBrowser,
    openScriptsPanel,
    closeScriptsPanel,
    openOxePanel,
    closeOxePanel,
    openWebPreview,
    closeWebPreview,
    openIntegrationPanel,
    closeIntegrationPanel,
    openTools,
    closeTools,
    maximizedPaneId,
    setActivePane,
    openNewWorkspace,
    setMaximizedPane,
    toggleSettings,
    toggleSidebar
  } = useUIStore()
  const { allProfiles: agentProfiles, readiness: agentReadiness, isDiscovering, discover, loadProfiles, loadReadiness, updateProfile, createProfile, deleteProfile } = useAgentStore()
  const visitedWorkspacesCap = useSettingsStore((s) => s.visitedWorkspacesCap)
  const integrationGroups = useIntegrationStore((state) => state.groups)
  const [configuredAgent, setConfiguredAgent] = useState<AgentProfile | null>(null)
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
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  useEffect(() => {
    if (!activeWorkspaceId) return
    setVisitedWorkspaceIds((prev) => {
      const without = prev.filter((id) => id !== activeWorkspaceId)
      const next = [...without, activeWorkspaceId]
      const cap = Math.max(1, Math.min(5, visitedWorkspacesCap || 3))
      const evictedWorkspaceId = next.length > cap ? next[0] : null
      if (evictedWorkspaceId) {
        const workspace = workspacesRef.current.find((item) => item.id === evictedWorkspaceId)
        for (const pane of workspace?.panes ?? []) {
          // An evicted workspace has no xterm instance or output consumer. Stop
          // its PTYs rather than letting agents run invisibly and lose output.
          void window.oxe.terminal.stop({ paneId: pane.id }).catch(() => undefined)
          removeTerminalPane(pane.id)
        }
      }
      return evictedWorkspaceId ? next.slice(1) : next
    })
  }, [activeWorkspaceId, removeTerminalPane, visitedWorkspacesCap])
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
    void useSkillStore.getState().refresh(activeWorkspace.rootPath)
    void useMcpStore.getState().load(activeWorkspace.id)
  }, [activeWorkspace?.id, activeWorkspace?.rootPath])

  // Hydrate background jobs for the active workspace
  useEffect(() => {
    if (!activeWorkspaceId) return
    void useBackgroundStore.getState().loadJobs(activeWorkspaceId)
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
      useUIStore.setState({
        pendingWebPreview: { workspaceId: event.workspaceId, url: event.url },
        isWebPreviewOpen: true
      })
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
  useAgentNotifications()

  // Clicking a notification focuses the originating pane (window focus + restore
  // is handled in main); here we switch to its workspace and select the pane.
  useEffect(() => {
    const api = window.oxe?.notifications
    if (!api) return
    return api.onActivate(({ paneId, workspaceId }) => {
      const current = useWorkspaceStore.getState().workspaces.find((w) => w.isActive)
      if (current?.id !== workspaceId) void setActiveWorkspace(workspaceId)
      setActiveTerminalPaneId(paneId)
    })
  }, [setActiveWorkspace, setActiveTerminalPaneId])

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
    void closePane(paneId).then(() => removeTerminalPane(paneId))
  }

  const handleCloseWorkspace = (workspaceId: string): void => {
    if (hasDirtyEditor(workspaceId)) {
      setAppNotice('Workspace has unsaved editor changes. Save or close the file before closing the workspace.')
      return
    }
    const workspace = workspaces.find((item) => item.id === workspaceId)
    for (const pane of workspace?.panes ?? []) removeTerminalPane(pane.id)
    clearEditor(workspaceId)
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

  const toggleOxePanel = (): void => {
    if (isOxePanelOpen) closeOxePanel()
    else openOxePanel()
  }

  const toggleScriptsPanel = (): void => {
    if (isScriptsPanelOpen) closeScriptsPanel()
    else openScriptsPanel()
  }

  const toggleWebPreviewPanel = (): void => {
    if (isWebPreviewOpen) closeWebPreview()
    else openWebPreview()
  }

  const splitActivePane = (direction: 'vertical' | 'horizontal'): void => {
    if (!activePane) return
    void splitPane(activePane.id, direction)
  }

  const toggleActivePaneMaximize = (): void => {
    if (!activePane) return
    setMaximizedPane(maximizedPaneId === activePane.id ? null : activePane.id)
  }

  const toggleActivePaneVoice = (): void => {
    if (activeWorkspace?.editorVisible) {
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
      setAppNotice('No visible terminal to run the command.')
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
    // Workspace
    { id: 'new-workspace', title: 'Create workspace', subtitle: 'Open the New Workspace wizard', icon: FilePlus2, category: 'Workspace', keywords: ['new', 'open', 'project'], run: openNewWorkspace },
    { id: 'workspace-settings', title: 'Open workspace settings', subtitle: 'Theme, layout, density, shell', icon: Sliders, category: 'Workspace', disabled: !activeWorkspace, run: openWorkspaceSettings },
    { id: 'toggle-sidebar', title: 'Toggle sidebar', subtitle: 'Ctrl+B', icon: LayoutDashboard, category: 'Workspace', run: toggleSidebar },
    { id: 'open-tools', title: 'Open Tools', subtitle: 'Panels, MCP, history, workspace tools', icon: Settings2, category: 'Workspace', keywords: ['tools', 'panels', 'mcp', 'gear'], run: openTools },

    // AI & Agents
    { id: 'open-settings', title: 'Open Agent Settings', subtitle: 'Configure CLIs and discovery', icon: Bot, category: 'AI & Agents', keywords: ['ai', 'provider', 'discovery'], run: toggleSettings },
    { id: 'open-history', title: 'Open session history', subtitle: 'Ctrl+Shift+H', icon: History, category: 'AI & Agents', keywords: ['session', 'resume'], run: openHistoryPanel },
    { id: 'open-mcp', title: 'Open MCP servers', subtitle: 'Model Context Protocol tools', icon: Wrench, category: 'AI & Agents', keywords: ['mcp', 'tools'], run: openMcpPanel },
    { id: 'open-skills', title: 'Open Skills', subtitle: 'Browse markdown skill prompts', icon: Activity, category: 'AI & Agents', keywords: ['skill', 'slash'], run: openSkillsBrowser },
    { id: 'open-integration', title: 'Open integration command center', subtitle: 'Multi-repo context and handoff', icon: Grid2x2, category: 'Workspace', keywords: ['integration', 'srv', 'bff', 'fed', 'handoff'], disabled: !activeWorkspace, run: openIntegrationPanel },

    // View
    { id: 'toggle-editor', title: 'Toggle editor', subtitle: 'Ctrl+E', icon: LayoutDashboard, category: 'View', disabled: !activeWorkspace, run: toggleEditor },
    { id: 'github-open-panel', title: 'GitHub: Open tools panel', icon: Github, category: 'View', keywords: ['git', 'pr', 'workflow', 'actions'], disabled: !activeWorkspace, run: toggleGitHubPanel },
    {
      id: 'toggle-background-dock',
      title: 'Background jobs: Toggle dock',
      subtitle: 'Right-side panel',
      icon: Activity,
      category: 'View',
      keywords: ['bg', 'job', 'task'],
      disabled: !activeWorkspace,
      run: () => {
        if (!activeWorkspace) return
        void updateBackgroundState({
          workspaceId: activeWorkspace.id,
          backgroundPanelVisible: !activeWorkspace.backgroundPanelVisible,
          backgroundPanelExpanded: activeWorkspace.backgroundPanelVisible ? false : activeWorkspace.backgroundPanelExpanded
        })
      }
    },
    { id: 'design-system', title: 'Design System: Open Viewer', subtitle: 'Ctrl+Shift+D', icon: Palette, category: 'View', run: () => { setDesignSystemOpen(true) } },

    // Theme
    ...WORKSPACE_THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Theme: ${theme.label}`,
      subtitle: 'Workspace theme',
      icon: Palette,
      category: 'Theme',
      keywords: [theme.id, 'color', 'palette'],
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, themeId: theme.id })
      }
    })),

    // Density
    ...WORKSPACE_DENSITIES.map((density) => ({
      id: `density-${density.id}`,
      title: `Density: ${density.label}`,
      subtitle: 'Workspace density',
      icon: Sliders,
      category: 'Theme',
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, uiDensity: density.id })
      }
    })),

    // Layout
    ...LAYOUT_PRESETS.map((preset) => ({
      id: `layout-${preset}`,
      title: `Layout: ${preset} panes`,
      subtitle: 'Workspace layout preset',
      icon: Grid2x2,
      category: 'Layout',
      disabled: !activeWorkspace,
      run: () => {
        if (activeWorkspace) void updateSettings({ workspaceId: activeWorkspace.id, layoutPreset: preset })
      }
    })),

    // Terminal
    { id: 'split-vertical', title: 'Split active pane (vertical)', subtitle: 'Ctrl+Shift+\\', icon: Split, category: 'Terminal', disabled: !activePane, run: () => splitActivePane('vertical') },
    { id: 'split-horizontal', title: 'Split active pane (horizontal)', subtitle: 'Ctrl+Shift+-', icon: Split, category: 'Terminal', disabled: !activePane, run: () => splitActivePane('horizontal') },
    { id: 'maximize-pane', title: 'Maximize / restore active pane', subtitle: 'Ctrl+Shift+Enter', icon: Maximize, category: 'Terminal', disabled: !activePane, run: toggleActivePaneMaximize },
    { id: 'toggle-oxevoice', title: 'Toggle OXEVoice for active context', subtitle: 'Speak directly into terminal or editor', icon: Mic, category: 'Terminal', keywords: ['voice', 'speech', 'microphone', 'dictation'], disabled: !activeWorkspace?.editorVisible && (!activePane || activePane.type !== 'terminal' || getTerminalStatus(activePane.id).status !== 'running'), run: toggleActivePaneVoice },
    { id: 'restart-terminal', title: 'Restart active terminal', subtitle: 'Ctrl+R', icon: RotateCw, category: 'Terminal', disabled: !activePane || activePane.type !== 'terminal', run: () => activePane && void window.oxe.terminal.restart({ paneId: activePane.id }) },
    { id: 'stop-terminal', title: 'Stop active terminal', icon: StopCircle, category: 'Terminal', disabled: !activePane || activePane.type !== 'terminal', run: () => activePane && void window.oxe.terminal.stop({ paneId: activePane.id }) }
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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'v') {
        event.preventDefault()
        toggleActivePaneVoice()
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
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '/' && activePane?.type === 'terminal') {
        event.preventDefault()
        openSlashOverlay(activePane.id)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'h') {
        event.preventDefault()
        openHistoryPanel()
        return
      }
      // Live terminal font zoom: Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0 (reset).
      // Adjusts the GLOBAL font-size pref, which propagates to every open pane.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const isPlus = key === '=' || key === '+'
        const isMinus = key === '-' || key === '_'
        const isZero = key === '0'
        if (isPlus || isMinus || isZero) {
          event.preventDefault()
          const store = useTerminalPrefsStore.getState()
          if (isZero) {
            store.setGlobal({ fontSize: TERMINAL_PREFS_DEFAULTS.fontSize })
          } else {
            const next = store.global.fontSize + (isPlus ? 1 : -1)
            store.setGlobal({ fontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next)) })
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePane, activeWorkspace, maximizedPaneId, openCommandPalette, openSlashOverlay, openHistoryPanel, openWorkspaceSettings, splitPane, toggleSidebar, updateEditorState])

  // Push-to-talk: hold the configured hotkey to dictate into the active
  // terminal, release to transcribe + insert. Works even while the terminal
  // is focused (window-level listener). Auto-repeat is guarded so holding
  // doesn't restart capture each tick.
  useEffect(() => {
    let holding = false
    const dispatch = (type: 'start' | 'end'): void => {
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
  }, [activePane, pttHotkey])

  return (
    <ThemeProvider themeId={activeWorkspace?.themeId} density={activeWorkspace?.uiDensity}>
      <main className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion={appVersion}
        onNewWorkspace={openNewWorkspace}
        onSelectWorkspace={(id) => void setActiveWorkspace(id)}
        onCloseWorkspace={handleCloseWorkspace}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onOpenTools={openTools}
        integrationGroups={integrationGroups}
      />
      <section className="workspace-surface">
        <UpdateBanner />
        {error ? <div className="error-banner">{error}</div> : null}
        {appNotice ? (
          <div className="error-banner">
            <span>{appNotice}</span>
            <button type="button" className="ghost-btn small" onClick={() => setAppNotice(null)}>Dismiss</button>
          </div>
        ) : null}
        {isLoading ? (
          <div className="empty-state">
            <h3>Loading workspaces</h3>
          </div>
        ) : activeWorkspace ? (
          <>
            {workspaces
              .filter((ws) => visitedWorkspaceIds.includes(ws.id))
              .map((ws) => {
                const isActive = ws.id === activeWorkspaceId
                return (
                  <div
                    key={ws.id}
                    className={`workspace-host${isActive ? '' : ' workspace-host-hidden'}`}
                    aria-hidden={!isActive}
                  >
                    <WorkspaceSurface
                      workspace={ws}
                      agentProfiles={agentProfiles}
                      maximizedPaneId={isActive ? maximizedPaneId : null}
                      onClosePane={handleClosePane}
                      onToggleMaximize={(paneId) => setMaximizedPane(maximizedPaneId === paneId ? null : paneId)}
                      onSplitPane={(paneId, dir) => void splitPane(paneId, dir)}
                      onActivatePane={setActivePane}
                      scriptsVisible={isActive && isScriptsPanelOpen}
                      webPreviewVisible={isActive && isWebPreviewOpen}
                      integrationVisible={isActive && isIntegrationPanelOpen}
                      oxeVisible={isActive && isOxePanelOpen}
                      onCloseScripts={closeScriptsPanel}
                      onCloseWebPreview={closeWebPreview}
                      onCloseIntegration={closeIntegrationPanel}
                      onCloseOxe={closeOxePanel}
                      onSelectWorkspace={(id) => void setActiveWorkspace(id)}
                      workspaces={workspaces}
                      onUpdateEditorState={(input) => void updateEditorState(input)}
                      onUpdateReviewState={(input) => void updateReviewState(input)}
                      onUpdateGitHubState={(input) => void updateGitHubState(input)}
                      onUpdateBackgroundState={(input) => void updateBackgroundState(input)}
                      onUpdateWorktreeState={(input) => void updateWorktreeState(input)}
                      onRunCommand={(command) => void runCommandInTerminal(command)}
                      activePaneId={isActive ? activePane?.id ?? null : null}
                    />
                  </div>
                )
              })}
          </>
        ) : (
          <div className="empty-state">
            <OxeLogo size={72} variant="hero" />
            <p>Select a folder to start your first agentic terminal workspace.</p>
            <button type="button" className="empty-state-cta" onClick={openNewWorkspace}>
              <Plus size={14} aria-hidden="true" />
              New workspace
            </button>
          </div>
        )}
      </section>
      <ErrorBoundary label="esta janela">
      <Suspense fallback={null}>
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
      {slashPane ? (
        <SlashOverlay
          paneId={slashPane.id}
          paneLabel={slashPane.displayName ?? slashPane.agentName ?? `Pane ${slashPane.rowIndex + 1}.${slashPane.columnIndex + 1}`}
          skills={skills}
          onClose={closeSlashOverlay}
          onExecute={dispatchSlashCommand}
        />
      ) : null}
      {isHistoryPanelOpen && activeWorkspace ? (
        <HistoryPanel
          workspaceId={activeWorkspace.id}
          workspaceRootPath={activeWorkspace.rootPath}
          activePaneId={activePaneId}
          onClose={closeHistoryPanel}
        />
      ) : null}
      {isMcpPanelOpen ? (
        <McpPanel
          workspaceId={activeWorkspace?.id ?? null}
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
              setAppNotice('Open a workspace with a terminal pane first.')
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
              toggleSettings()
            } catch (err) {
              setAppNotice(err instanceof Error ? err.message : 'Failed to start agent in pane')
            }
          }}
          onClose={toggleSettings}
        />
      ) : null}
      {isToolsOpen ? (
        <ToolsModal
          active={{
            github: activeWorkspace?.githubPanelVisible === true,
            editor: activeWorkspace?.editorVisible === true,
            review: activeWorkspace?.reviewPanelVisible === true,
            background: activeWorkspace?.backgroundPanelVisible === true,
            worktree: activeWorkspace?.worktreePanelVisible === true,
            scripts: isScriptsPanelOpen,
            webPreview: isWebPreviewOpen,
            integration: isIntegrationPanelOpen,
            oxe: isOxePanelOpen
          }}
          onClose={closeTools}
          onOpenCommandPalette={openCommandPalette}
          onOpenWorkspaceSettings={openWorkspaceSettings}
          onOpenAgentSettings={toggleSettings}
          onToggleEditor={toggleEditor}
          onToggleGitHub={toggleGitHubPanel}
          onToggleReview={toggleReviewPanel}
          onToggleBackground={toggleBackgroundPanel}
          onToggleWorktree={toggleWorktreePanel}
          onToggleScripts={toggleScriptsPanel}
          onToggleWebPreview={toggleWebPreviewPanel}
          onOpenIntegration={openIntegrationPanel}
          onOpenHistory={openHistoryPanel}
          onOpenMcp={openMcpPanel}
          onOpenSkills={openSkillsBrowser}
          onOpenSemanticLogs={() => setSemanticActivityOpen(true)}
          onToggleOxe={toggleOxePanel}
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
    </ThemeProvider>
  )
}
