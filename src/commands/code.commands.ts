import { Activity, Columns2, FilePlus2, Grid2x2, LayoutDashboard, ListTodo, Maximize, Mic, Palette, RotateCw, Sliders, Split, StopCircle } from 'lucide-react'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { TOOL_CATALOG, type ToolId } from '../components/Workspace/toolCatalog'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES } from '../components/Workspace/workspaceOptions'
import { usePaneLayoutStore } from '../store/pane-layout.store'
import { useSettingsStore } from '../store/settings.store'
import { useTerminalStore } from '../store/terminal.store'
import { useUIStore } from '../store/ui.store'
import { useWorkspaceStore } from '../store/workspace.store'
import type { ContributedCommand } from '../utils/commandRegistry'
import { i18n } from '../i18n'
import { tCommand } from './commandText'
import { useCommandSource } from './useCommandSource'

export interface CodeCommandContext {
  applicationView: import('../keyboard/keybindings').AppView
  activeWorkspace: Workspace | null | undefined
  activePane: WorkspacePane | null | undefined
  /** Team needs a project: the workspace in Code, the project in Thread. */
  hasTeamTarget: boolean
  /** Why Team can't open here; the palette shows it as the command's description. */
  teamUnavailable?: string
  toolHandlers: Partial<Record<ToolId, () => void>>
  /** Which Code panels are open, so a command run from Thread or OxeQuery opens a panel instead of closing it. */
  openTools?: Partial<Record<ToolId, boolean>>
  /** Brings Code to the front before a command acts on the workspace. */
  showCode?: () => void
  openNewWorkspace: () => void
  splitActivePane: (direction: 'vertical' | 'horizontal') => void
  toggleActivePaneMaximize: () => void
  toggleActivePaneVoice: () => void
  openDesignSystem: () => void
}

const updateSettings = (input: Parameters<ReturnType<typeof useWorkspaceStore.getState>['updateSettings']>[0]): void => {
  void useWorkspaceStore.getState().updateSettings(input)
}

/** Workspace, panels, view, appearance and terminal commands of the palette and the application menus. */
export function buildCodeCommands(ctx: CodeCommandContext): ContributedCommand[] {
  const { activeWorkspace, activePane } = ctx
  const ui = useUIStore.getState()
  const terminalPane = activePane?.type === 'terminal' ? activePane : null
  const terminalRunning = terminalPane !== null && useTerminalStore.getState().getStatus(terminalPane.id).status === 'running'
  const voiceAvailable = ctx.applicationView === 'thread' || Boolean(activeWorkspace?.editorVisible)
    || terminalRunning
  // Workspace commands act on Code: from Thread or OxeQuery they show Code first, so their effect is visible.
  const away = ctx.applicationView !== 'code'
  const inCode = (run: () => void) => (): void => { if (away) ctx.showCode?.(); run() }
  const CODE_TOOLS: ToolId[] = ['integration', 'github', 'worktrees', 'scripts', 'search', 'web-preview', 'background', 'slash', 'editor', 'review']
  const toolRun = (id: ToolId): (() => void) => {
    const run = ctx.toolHandlers[id] ?? (() => undefined)
    if (!CODE_TOOLS.includes(id) || !away) return run
    // Coming from another view, the panel opens; a toggle would close one left open in Code.
    return () => { ctx.showCode?.(); if (!ctx.openTools?.[id]) run() }
  }
  return [
    // Workspace
    { id: 'new-workspace', label: i18n.t('menu.newWorkspace'), detail: tCommand('code.newWorkspaceDetail'), icon: FilePlus2, category: 'Workspace', keywords: ['new', 'create', 'open', 'project'], run: ctx.openNewWorkspace },
    { id: 'workspace-settings', label: i18n.t('menu.workspaceSettings'), detail: tCommand('code.workspaceSettingsDetail'), icon: Sliders, category: 'Workspace', disabled: !activeWorkspace, run: inCode(ui.openWorkspaceSettings) },
    { id: 'toggle-sidebar', label: i18n.t('menu.toggleSidebar'), icon: LayoutDashboard, category: 'Workspace', shortcut: 'sidebar.toggle', run: ui.toggleSidebar },

    // Tools: named like the Panels menu and Thread, from the shared panel catalog.
    ...TOOL_CATALOG.map(tool => ({
      id: `tool-${tool.id}`,
      label: tool.label,
      detail: tool.id === 'team' && !ctx.hasTeamTarget && ctx.teamUnavailable ? ctx.teamUnavailable : tool.detail,
      icon: tool.icon,
      category: tool.group,
      keywords: tool.keywords,
      shortcut: tool.keybinding,
      disabled: tool.id === 'team' ? !ctx.hasTeamTarget : tool.id === 'slash' ? !activePane : !['mcp', 'skills', 'semantic'].includes(tool.id) && !activeWorkspace,
      run: toolRun(tool.id)
    })),

    { id: 'open-linear', label: i18n.t('menu.linear'), detail: tCommand('code.linearDetail'), icon: ListTodo, category: 'Development', keywords: ['linear', 'issue', 'ticket', 'board', 'worktree'], run: ui.openLinearPanel },

    // View
    { id: 'balance-pane-layout', label: i18n.t('menu.balancePanes'), detail: tCommand('code.balanceDetail'), icon: Columns2, category: 'View', disabled: !activeWorkspace, run: inCode(() => { if (activeWorkspace) usePaneLayoutStore.getState().balance(activeWorkspace.id) }) },
    { id: 'toggle-split-layout', label: i18n.t('menu.splitLayout'), detail: tCommand('code.splitLayoutDetail'), icon: Columns2, category: 'View', keywords: ['split', 'pane', 'layout', 'f2', 'tree'], disabled: !activeWorkspace, shortcut: 'code.splitLayout', run: inCode(() => useUIStore.getState().toggleSplitLayout()) },
    { id: 'open-usage', label: i18n.t('menu.usage'), detail: tCommand('code.usageDetail'), icon: Activity, category: 'AI & Agents', keywords: ['usage', 'quota', 'credits', 'rate', 'limit', 'tokens'], run: () => useUIStore.getState().openUsage() },
    { id: 'design-system', label: tCommand('code.designSystem'), detail: tCommand('code.designSystemDetail'), icon: Palette, category: 'View', run: ctx.openDesignSystem },

    // Appearance: one app-wide choice (light, dark or follow the system).
    ...(['system', 'light', 'dark'] as const).map(appearance => ({
      id: `appearance-${appearance}`,
      label: tCommand('code.appearance', { mode: tCommand(`code.appearanceMode.${appearance}`) }),
      detail: tCommand('code.appearanceDetail'),
      icon: Palette,
      category: 'Appearance',
      keywords: ['theme', 'mode', 'color', 'light', 'dark'],
      run: () => useSettingsStore.getState().setAppearance(appearance)
    })),
    ...WORKSPACE_DENSITIES.map(density => ({
      id: `density-${density.id}`, label: tCommand('code.density', { density: density.label }), detail: tCommand('code.densityDetail'), icon: Sliders, category: 'Appearance', disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, uiDensity: density.id }) })
    })),
    ...LAYOUT_PRESETS.map(preset => ({
      id: `layout-${preset}`, label: tCommand('code.layout', { count: preset }), detail: tCommand('code.layoutDetail'), icon: Grid2x2, category: 'Layout', disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, layoutPreset: preset }) })
    })),

    // Terminal: named like the keyboard shortcuts and the pane menu.
    { id: 'split-vertical', label: i18n.t('menu.splitRight'), icon: Split, category: 'Terminal', disabled: !activePane, shortcut: 'pane.splitRight', run: inCode(() => ctx.splitActivePane('vertical')) },
    { id: 'split-horizontal', label: i18n.t('menu.splitDown'), icon: Split, category: 'Terminal', disabled: !activePane, shortcut: 'pane.splitDown', run: inCode(() => ctx.splitActivePane('horizontal')) },
    { id: 'maximize-pane', label: i18n.t('menu.maximizePane'), icon: Maximize, category: 'Terminal', disabled: !activePane, shortcut: 'pane.maximize', run: inCode(ctx.toggleActivePaneMaximize) },
    { id: 'toggle-oxevoice', label: i18n.t('keys.bindings.voice.toggle'), detail: tCommand('code.voiceDetail'), icon: Mic, category: 'Terminal', keywords: ['oxevoice', 'voice', 'speech', 'microphone', 'dictation'], disabled: !voiceAvailable, shortcut: 'voice.toggle', run: ctx.toggleActivePaneVoice },
    { id: 'restart-terminal', label: i18n.t('keys.bindings.terminal.restart'), icon: RotateCw, category: 'Terminal', disabled: !terminalPane, shortcut: 'terminal.restart', run: inCode(() => { if (terminalPane) void window.oxe.terminal.restart({ paneId: terminalPane.id }) }) },
    { id: 'stop-terminal', label: tCommand('code.stopTerminal'), icon: StopCircle, category: 'Terminal', disabled: !terminalRunning, run: inCode(() => { if (terminalPane) void window.oxe.terminal.stop({ paneId: terminalPane.id }) }) }
  ]
}

export function useCodeCommands(ctx: CodeCommandContext): void {
  useCommandSource('code', buildCodeCommands(ctx))
}
