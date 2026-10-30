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
import { commandText, tCommand, type CommandCategory } from './commandText'
import { useCommandSource } from './useCommandSource'

export interface CodeCommandContext {
  applicationView: import('../keyboard/keybindings').AppView
  activeWorkspace: Workspace | null | undefined
  activePane: WorkspacePane | null | undefined
  /** Team needs a project: the workspace in Code, the project in Thread. */
  hasTeamTarget: boolean
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

/** The palette group of each workspace tool (docs/design/commands.md). */
const TOOL_CATEGORY: Record<ToolId, CommandCategory> = {
  team: 'Agents', integration: 'Workspace', github: 'Git', worktrees: 'Git', scripts: 'View', search: 'View', 'web-preview': 'View', background: 'View',
  slash: 'Terminal', mcp: 'Agents', skills: 'Agents', semantic: 'Agents', editor: 'View', review: 'View'
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
  const text = commandText
  return [
    // Workspace
    { id: 'new-workspace', ...text('Workspace', 'new-workspace', { keywords: ['new', 'create', 'open', 'project'] }), detail: tCommand('code.newWorkspaceDetail'), icon: FilePlus2, run: ctx.openNewWorkspace },
    { id: 'workspace-settings', ...text('Workspace', 'workspace-settings'), detail: tCommand('code.workspaceSettingsDetail'), icon: Sliders, disabled: !activeWorkspace, run: inCode(ui.openWorkspaceSettings) },
    { id: 'toggle-sidebar', ...text('View', 'toggle-sidebar'), icon: LayoutDashboard, shortcut: 'sidebar.toggle', run: ui.toggleSidebar },

    // Tools: their panel or dialog names (Panels menu, Thread) stay as search words.
    ...TOOL_CATALOG.map(tool => ({
      id: `tool-${tool.id}`,
      ...text(TOOL_CATEGORY[tool.id], `tool-${tool.id}`, { keywords: [tool.label, ...(tool.keywords ?? [])] }),
      detail: tool.detail,
      icon: tool.icon,
      shortcut: tool.keybinding,
      disabled: tool.id === 'team' ? !ctx.hasTeamTarget : tool.id === 'slash' ? !activePane : !['mcp', 'skills', 'semantic'].includes(tool.id) && !activeWorkspace,
      run: toolRun(tool.id)
    })),

    { id: 'open-linear', ...text('Workspace', 'open-linear', { keywords: ['linear', 'issue', 'ticket', 'board', 'worktree'] }), detail: tCommand('code.linearDetail'), icon: ListTodo, run: ui.openLinearPanel },
    { id: 'open-usage', ...text('Agents', 'open-usage', { keywords: ['usage', 'quota', 'credits', 'rate', 'limit', 'tokens'] }), detail: tCommand('code.usageDetail'), icon: Activity, run: () => useUIStore.getState().openUsage() },
    { id: 'design-system', ...text('View', 'design-system'), detail: tCommand('code.designSystemDetail'), icon: Palette, run: ctx.openDesignSystem },

    // Layout
    { id: 'balance-pane-layout', ...text('Layout', 'balance-pane-layout'), detail: tCommand('code.balanceDetail'), icon: Columns2, disabled: !activeWorkspace, run: inCode(() => { if (activeWorkspace) usePaneLayoutStore.getState().balance(activeWorkspace.id) }) },
    { id: 'toggle-split-layout', ...text('Layout', 'toggle-split-layout', { keywords: ['split', 'pane', 'layout', 'f2', 'tree'] }), detail: tCommand('code.splitLayoutDetail'), icon: Columns2, disabled: !activeWorkspace, shortcut: 'code.splitLayout', run: inCode(() => useUIStore.getState().toggleSplitLayout()) },
    ...LAYOUT_PRESETS.map(preset => ({
      id: `layout-${preset}`, ...text('Layout', 'layout', { values: { count: preset } }), detail: tCommand('code.layoutDetail'), icon: Grid2x2, disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, layoutPreset: preset }) })
    })),

    // Appearance: one app-wide choice (light, dark or follow the system), and the workspace density.
    ...(['system', 'light', 'dark'] as const).map(appearance => ({
      id: `appearance-${appearance}`,
      ...text('Appearance', `appearance-${appearance}`, { keywords: ['theme', 'mode', 'color', 'light', 'dark'] }),
      detail: tCommand('code.appearanceDetail'),
      icon: Palette,
      run: () => useSettingsStore.getState().setAppearance(appearance)
    })),
    ...WORKSPACE_DENSITIES.map(density => ({
      id: `density-${density.id}`, ...text('Appearance', `density-${density.id}`, { keywords: ['density', density.label] }), detail: tCommand('code.densityDetail'), icon: Sliders, disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, uiDensity: density.id }) })
    })),

    // Terminal: the active pane.
    { id: 'split-vertical', ...text('Terminal', 'split-vertical'), icon: Split, disabled: !activePane, shortcut: 'pane.splitRight', run: inCode(() => ctx.splitActivePane('vertical')) },
    { id: 'split-horizontal', ...text('Terminal', 'split-horizontal'), icon: Split, disabled: !activePane, shortcut: 'pane.splitDown', run: inCode(() => ctx.splitActivePane('horizontal')) },
    { id: 'maximize-pane', ...text('Terminal', 'maximize-pane'), icon: Maximize, disabled: !activePane, shortcut: 'pane.maximize', run: inCode(ctx.toggleActivePaneMaximize) },
    { id: 'toggle-oxevoice', ...text('Terminal', 'toggle-oxevoice', { keywords: ['oxevoice', 'voice', 'speech', 'microphone', 'dictation'] }), detail: tCommand('code.voiceDetail'), icon: Mic, disabled: !voiceAvailable, shortcut: 'voice.toggle', run: ctx.toggleActivePaneVoice },
    { id: 'restart-terminal', ...text('Terminal', 'restart-terminal'), icon: RotateCw, disabled: !terminalPane, shortcut: 'terminal.restart', run: inCode(() => { if (terminalPane) void window.oxe.terminal.restart({ paneId: terminalPane.id }) }) },
    { id: 'stop-terminal', ...text('Terminal', 'stop-terminal'), icon: StopCircle, disabled: !terminalRunning, run: inCode(() => { if (terminalPane) void window.oxe.terminal.stop({ paneId: terminalPane.id }) }) }
  ]
}

export function useCodeCommands(ctx: CodeCommandContext): void {
  useCommandSource('code', buildCodeCommands(ctx))
}
