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
    { id: 'new-workspace', label: 'New workspace…', detail: 'Open the New Workspace wizard', icon: FilePlus2, category: 'Workspace', keywords: ['new', 'create', 'open', 'project'], run: ctx.openNewWorkspace },
    { id: 'workspace-settings', label: 'Workspace settings', detail: 'Layout, density and shell', icon: Sliders, category: 'Workspace', disabled: !activeWorkspace, run: inCode(ui.openWorkspaceSettings) },
    { id: 'toggle-sidebar', label: 'Toggle sidebar', icon: LayoutDashboard, category: 'Workspace', shortcut: 'sidebar.toggle', run: ui.toggleSidebar },

    // Tools: named like the Panels menu and Thread, from the shared panel catalog.
    ...TOOL_CATALOG.map(tool => ({
      id: `tool-${tool.id}`,
      label: tool.label,
      detail: tool.detail,
      icon: tool.icon,
      category: tool.group,
      keywords: tool.keywords,
      shortcut: tool.keybinding,
      disabled: tool.id === 'team' ? !ctx.hasTeamTarget : tool.id === 'slash' ? !activePane : !['mcp', 'skills', 'semantic'].includes(tool.id) && !activeWorkspace,
      run: toolRun(tool.id)
    })),

    { id: 'open-linear', label: 'Linear issues', detail: 'Issues, boards and worktree from issue', icon: ListTodo, category: 'Development', keywords: ['linear', 'issue', 'ticket', 'board', 'worktree'], run: ui.openLinearPanel },

    // View
    { id: 'balance-pane-layout', label: 'Balance panes', detail: 'Restore equal sizes within each split', icon: Columns2, category: 'View', disabled: !activeWorkspace, run: inCode(() => { if (activeWorkspace) usePaneLayoutStore.getState().balance(activeWorkspace.id) }) },
    { id: 'toggle-split-layout', label: 'Toggle split layout', detail: 'Recursive resizable panes (default on)', icon: Columns2, category: 'View', keywords: ['split', 'pane', 'layout', 'f2', 'tree'], disabled: !activeWorkspace, shortcut: 'code.splitLayout', run: inCode(() => useUIStore.getState().toggleSplitLayout()) },
    { id: 'open-usage', label: 'Usage & limits', detail: 'Claude, Codex & Copilot quota + resets', icon: Activity, category: 'AI & Agents', keywords: ['usage', 'quota', 'credits', 'rate', 'limit', 'tokens'], run: () => useUIStore.getState().openUsage() },
    { id: 'design-system', label: 'Design System: Open Viewer', detail: 'Tokens and components in light and dark', icon: Palette, category: 'View', run: ctx.openDesignSystem },

    // Appearance: one app-wide choice (light, dark or follow the system).
    ...(['system', 'light', 'dark'] as const).map(appearance => ({
      id: `appearance-${appearance}`,
      label: `Appearance: ${appearance === 'system' ? 'Follow system' : appearance === 'light' ? 'Light' : 'Dark'}`,
      detail: 'Applies to the whole application',
      icon: Palette,
      category: 'Appearance',
      keywords: ['theme', 'mode', 'color', 'light', 'dark'],
      run: () => useSettingsStore.getState().setAppearance(appearance)
    })),
    ...WORKSPACE_DENSITIES.map(density => ({
      id: `density-${density.id}`, label: `Density: ${density.label}`, detail: 'Workspace density', icon: Sliders, category: 'Appearance', disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, uiDensity: density.id }) })
    })),
    ...LAYOUT_PRESETS.map(preset => ({
      id: `layout-${preset}`, label: `Layout: ${preset} ${preset === 1 ? 'pane' : 'panes'}`, detail: 'Workspace layout preset', icon: Grid2x2, category: 'Layout', disabled: !activeWorkspace,
      run: inCode(() => { if (activeWorkspace) updateSettings({ workspaceId: activeWorkspace.id, layoutPreset: preset }) })
    })),

    // Terminal: named like the keyboard shortcuts and the pane menu.
    { id: 'split-vertical', label: 'Split pane right', icon: Split, category: 'Terminal', disabled: !activePane, shortcut: 'pane.splitRight', run: inCode(() => ctx.splitActivePane('vertical')) },
    { id: 'split-horizontal', label: 'Split pane down', icon: Split, category: 'Terminal', disabled: !activePane, shortcut: 'pane.splitDown', run: inCode(() => ctx.splitActivePane('horizontal')) },
    { id: 'maximize-pane', label: 'Maximize / restore pane', icon: Maximize, category: 'Terminal', disabled: !activePane, shortcut: 'pane.maximize', run: inCode(ctx.toggleActivePaneMaximize) },
    { id: 'toggle-oxevoice', label: 'Toggle voice input', detail: 'Speak into the active terminal, editor, or Thread draft', icon: Mic, category: 'Terminal', keywords: ['oxevoice', 'voice', 'speech', 'microphone', 'dictation'], disabled: !voiceAvailable, shortcut: 'voice.toggle', run: ctx.toggleActivePaneVoice },
    { id: 'restart-terminal', label: 'Restart terminal', icon: RotateCw, category: 'Terminal', disabled: !terminalPane, shortcut: 'terminal.restart', run: inCode(() => { if (terminalPane) void window.oxe.terminal.restart({ paneId: terminalPane.id }) }) },
    { id: 'stop-terminal', label: 'Stop terminal', icon: StopCircle, category: 'Terminal', disabled: !terminalRunning, run: inCode(() => { if (terminalPane) void window.oxe.terminal.stop({ paneId: terminalPane.id }) }) }
  ]
}

export function useCodeCommands(ctx: CodeCommandContext): void {
  useCommandSource('code', buildCodeCommands(ctx))
}
