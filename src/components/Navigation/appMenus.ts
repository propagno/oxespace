import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { shortcutLabel } from '../../keyboard/keybindings'

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
  openCommandMenu(): void
  version: string
}

const sep = (id: string): AppMenuNode => ({ kind: 'separator', id })

/** Every palette action a menu points to; tests/app-menus.test.ts checks each one exists, so none disappears silently. */
export const MENU_ACTION_IDS = ['new-workspace', 'workspace-settings', 'toggle-sidebar', 'tool-editor', 'tool-github', 'tool-background',
  'toggle-split-layout', 'balance-pane-layout', 'split-vertical', 'split-horizontal', 'maximize-pane',
  'tool-mcp', 'tool-skills', 'open-usage', 'open-linear', 'help.shortcuts', 'settings.diagnostics', 'settings.updates'] as const
/** Families of actions shown as submenus, by id prefix. */
export const MENU_ACTION_PREFIXES = ['appearance-', 'density-', 'layout-'] as const
type MenuActionId = typeof MENU_ACTION_IDS[number]

/** Native text-editing commands run against whichever field has focus. */
const edit = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => (): void => { document.execCommand(command) }

export function buildAppMenus(ctx: AppMenuContext): AppMenu[] {
  const byId = new Map(ctx.actions.map(action => [action.id, action]))
  const fromAction = (id: MenuActionId, label?: string, shortcut?: string): AppMenuNode | null => {
    const action = byId.get(id)
    if (!action) return null
    return { kind: 'item', id, label: label ?? action.title, shortcut, disabled: action.disabled, onSelect: action.run }
  }
  const group = (prefix: string, strip: RegExp): AppMenuNode[] => ctx.actions
    .filter(action => action.id.startsWith(prefix))
    .map(action => ({ kind: 'item', id: action.id, label: action.title.replace(strip, ''), disabled: action.disabled, onSelect: action.run }) as AppMenuNode)
  const compact = (nodes: Array<AppMenuNode | null>): AppMenuNode[] => nodes.filter((node): node is AppMenuNode => node !== null)
  const appearances = group('appearance-', /^Appearance:\s*/)
  const densities = group('density-', /^Density:\s*/)
  const layouts = group('layout-', /^Layout:\s*/)
  const noWorkspace = !byId.get('workspace-settings') || byId.get('workspace-settings')!.disabled === true

  return [
    {
      id: 'file', label: 'File', items: compact([
        ctx.applicationView === 'thread'
          ? { kind: 'item', id: 'add-project', label: 'Add project…', onSelect: ctx.addThreadProject }
          : fromAction('new-workspace'),
        sep('file-1'),
        { kind: 'item', id: 'settings', label: 'Settings', shortcut: shortcutLabel('settings.open'), onSelect: ctx.openSettings },
        fromAction('workspace-settings'),
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
        { kind: 'item', id: 'command-palette', label: 'Command palette…', shortcut: shortcutLabel('palette.open'), onSelect: ctx.openCommandMenu },
        sep('view-0'),
        { kind: 'radio', id: 'view-code', label: 'Code', checked: ctx.applicationView === 'code', onSelect: () => ctx.setApplicationView('code') },
        { kind: 'radio', id: 'view-thread', label: 'Thread', checked: ctx.applicationView === 'thread', onSelect: () => ctx.setApplicationView('thread') },
        { kind: 'radio', id: 'view-data', label: 'OxeQuery', checked: ctx.applicationView === 'data', onSelect: () => ctx.setApplicationView('data') },
        sep('view-1'),
        fromAction('toggle-sidebar', undefined, shortcutLabel('sidebar.toggle')),
        fromAction('tool-editor', undefined, shortcutLabel('code.files')),
        fromAction('tool-github'),
        fromAction('tool-background'),
        fromAction('toggle-split-layout', undefined, shortcutLabel('code.splitLayout')),
        fromAction('balance-pane-layout'),
        sep('view-2'),
        // Appearance applies to the whole app, so it works without a workspace.
        appearances.length ? { kind: 'submenu', id: 'appearance', label: 'Appearance', children: appearances } : null,
        densities.length ? { kind: 'submenu', id: 'densities', label: 'Density', disabled: noWorkspace, children: densities } : null,
        layouts.length ? { kind: 'submenu', id: 'layouts', label: 'Layout', disabled: noWorkspace, children: layouts } : null,
        sep('view-3'),
        fromAction('split-vertical', undefined, shortcutLabel('pane.splitRight')),
        fromAction('split-horizontal', undefined, shortcutLabel('pane.splitDown')),
        fromAction('maximize-pane', undefined, shortcutLabel('pane.maximize'))
      ])
    },
    {
      id: 'tools', label: 'Tools', items: compact([
        fromAction('tool-mcp'),
        fromAction('tool-skills'),
        fromAction('open-usage'),
        fromAction('open-linear')
      ])
    },
    {
      id: 'help', label: 'Help', items: compact([
        fromAction('help.shortcuts', 'Keyboard shortcuts', shortcutLabel('help.shortcuts')),
        fromAction('settings.diagnostics', 'Diagnostics'),
        sep('help-1'),
        // Settings › Updates shows the version and checks for a newer one.
        fromAction('settings.updates', `About OXESpace (v${ctx.version})`)
      ])
    }
  ]
}
