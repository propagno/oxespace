import type { CommandPaletteAction } from '../CommandPalette/CommandPalette'

export type AppMenuNode =
  | { kind: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; onSelect(): void }
  | { kind: 'radio'; id: string; label: string; checked: boolean; onSelect(): void }
  | { kind: 'separator'; id: string }
  | { kind: 'submenu'; id: string; label: string; disabled?: boolean; children: AppMenuNode[] }

export interface AppMenu { id: string; label: string; items: AppMenuNode[] }

export interface AppMenuContext {
  /** The same actions the command palette runs; menus never own behaviour. */
  actions: CommandPaletteAction[]
  applicationView: 'code' | 'thread' | 'data'
  setApplicationView(view: 'code' | 'thread' | 'data'): void
  openSettings(): void
  addThreadProject(): void
  version: string
}

const sep = (id: string): AppMenuNode => ({ kind: 'separator', id })

/** Native text-editing commands run against whichever field has focus. */
const edit = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => (): void => { document.execCommand(command) }

export function buildAppMenus(ctx: AppMenuContext): AppMenu[] {
  const byId = new Map(ctx.actions.map(action => [action.id, action]))
  const fromAction = (id: string, label?: string, shortcut?: string): AppMenuNode | null => {
    const action = byId.get(id)
    if (!action) return null
    return { kind: 'item', id, label: label ?? action.title, shortcut, disabled: action.disabled, onSelect: action.run }
  }
  const group = (prefix: string, strip: RegExp): AppMenuNode[] => ctx.actions
    .filter(action => action.id.startsWith(prefix))
    .map(action => ({ kind: 'item', id: action.id, label: action.title.replace(strip, ''), disabled: action.disabled, onSelect: action.run }) as AppMenuNode)
  const compact = (nodes: Array<AppMenuNode | null>): AppMenuNode[] => nodes.filter((node): node is AppMenuNode => node !== null)
  const themes = group('theme-', /^Theme:\s*/)
  const densities = group('density-', /^Density:\s*/)
  const layouts = group('layout-', /^Layout:\s*/)
  const noWorkspace = !byId.get('workspace-settings') || byId.get('workspace-settings')!.disabled === true

  return [
    {
      id: 'file', label: 'File', items: compact([
        ctx.applicationView === 'thread'
          ? { kind: 'item', id: 'add-project', label: 'Add project…', onSelect: ctx.addThreadProject }
          : fromAction('new-workspace', 'New workspace…'),
        sep('file-1'),
        { kind: 'item', id: 'settings', label: 'Settings', shortcut: 'Ctrl+,', onSelect: ctx.openSettings },
        fromAction('workspace-settings', 'Workspace settings'),
        sep('file-2'),
        { kind: 'item', id: 'quit', label: 'Exit', onSelect: () => window.close() }
      ])
    },
    {
      id: 'edit', label: 'Edit', items: [
        { kind: 'item', id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', onSelect: edit('undo') },
        { kind: 'item', id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', onSelect: edit('redo') },
        sep('edit-1'),
        { kind: 'item', id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', onSelect: edit('cut') },
        { kind: 'item', id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', onSelect: edit('copy') },
        { kind: 'item', id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', onSelect: edit('paste') },
        { kind: 'item', id: 'select-all', label: 'Select all', shortcut: 'Ctrl+A', onSelect: edit('selectAll') }
      ]
    },
    {
      id: 'view', label: 'View', items: compact([
        { kind: 'radio', id: 'view-code', label: 'Code', checked: ctx.applicationView === 'code', onSelect: () => ctx.setApplicationView('code') },
        { kind: 'radio', id: 'view-thread', label: 'Thread', checked: ctx.applicationView === 'thread', onSelect: () => ctx.setApplicationView('thread') },
        { kind: 'radio', id: 'view-data', label: 'OxeQuery', checked: ctx.applicationView === 'data', onSelect: () => ctx.setApplicationView('data') },
        sep('view-1'),
        fromAction('toggle-sidebar', 'Toggle sidebar', 'Ctrl+B'),
        fromAction('toggle-editor', 'Toggle editor', 'Ctrl+E'),
        fromAction('github-open-panel', 'Source control'),
        fromAction('toggle-background-dock', 'Background jobs'),
        fromAction('toggle-split-layout', 'Split layout', 'F2'),
        fromAction('balance-pane-layout', 'Balance panes'),
        sep('view-2'),
        themes.length ? { kind: 'submenu', id: 'themes', label: 'Theme', disabled: noWorkspace, children: themes } : null,
        densities.length ? { kind: 'submenu', id: 'densities', label: 'Density', disabled: noWorkspace, children: densities } : null,
        layouts.length ? { kind: 'submenu', id: 'layouts', label: 'Layout', disabled: noWorkspace, children: layouts } : null,
        sep('view-3'),
        fromAction('split-vertical', 'Split pane right', 'Ctrl+Shift+\\'),
        fromAction('split-horizontal', 'Split pane down', 'Ctrl+Shift+-'),
        fromAction('maximize-pane', 'Maximize pane', 'Ctrl+Shift+Enter'),
        sep('view-4'),
        fromAction('design-system', 'Design system', 'Ctrl+Shift+D')
      ])
    },
    {
      id: 'help', label: 'Help', items: compact([
        fromAction('find-in-files', 'Search files & commands', 'Ctrl+J'),
        fromAction('open-tools', 'Tools'),
        sep('help-1'),
        fromAction('open-mcp', 'MCP servers'),
        fromAction('open-skills', 'Skills'),
        fromAction('open-usage', 'Usage & limits'),
        fromAction('open-linear', 'Linear issues'),
        sep('help-2'),
        { kind: 'item', id: 'about', label: `OXESpace v${ctx.version}`, disabled: true, onSelect: () => undefined }
      ])
    }
  ]
}
