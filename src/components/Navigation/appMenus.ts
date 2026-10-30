import { i18n } from '../../i18n'
import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { shortcutLabel, type AppView } from '../../keyboard/keybindings'

export type AppMenuNode =
  | { kind: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; onSelect(): void }
  | { kind: 'radio'; id: string; label: string; shortcut?: string; checked: boolean; onSelect(): void }
  | { kind: 'separator'; id: string }
  | { kind: 'submenu'; id: string; label: string; disabled?: boolean; children: AppMenuNode[] }

export interface AppMenu { id: string; label: string; items: AppMenuNode[] }

export interface AppMenuContext {
  /** The same actions the command palette runs; menus never own behaviour. */
  actions: CommandPaletteAction[]
  applicationView: AppView
  setApplicationView(view: AppView): void
  openSettings(): void
  addThreadProject(): void
  openCommandMenu(): void
  version: string
}

const sep = (id: string): AppMenuNode => ({ kind: 'separator', id })
/** The views in the order of the switch; product names, never translated. */
const VIEWS: Array<[AppView, string]> = [['code', 'Code'], ['thread', 'Thread'], ['data', 'OxeQuery'], ['pods', 'OxePod'], ['post', 'OxePost']]

/** Every palette action a menu points to; tests/app-menus.test.ts checks each one exists, so none disappears silently. */
export const MENU_ACTION_IDS = ['new-workspace', 'workspace-settings', 'toggle-sidebar', 'tool-editor', 'tool-github', 'tool-background',
  'toggle-split-layout', 'balance-pane-layout', 'split-vertical', 'split-horizontal', 'maximize-pane',
  'tool-mcp', 'tool-skills', 'open-usage', 'open-linear', 'help.shortcuts', 'help.report-problem', 'settings.diagnostics', 'settings.updates'] as const
/** Families of actions shown as submenus, by id prefix. */
export const MENU_ACTION_PREFIXES = ['appearance-', 'density-', 'layout-'] as const
type MenuActionId = typeof MENU_ACTION_IDS[number]

/** Native text-editing commands run against whichever field has focus. */
const edit = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => (): void => { document.execCommand(command) }

export function buildAppMenus(ctx: AppMenuContext): AppMenu[] {
  const t = i18n.t.bind(i18n)
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
      id: 'file', label: t('menu.file'), items: compact([
        ctx.applicationView === 'thread'
          ? { kind: 'item', id: 'add-project', label: t('menu.addProject'), onSelect: ctx.addThreadProject }
          : fromAction('new-workspace', t('menu.newWorkspace')),
        sep('file-1'),
        { kind: 'item', id: 'settings', label: t('menu.settings'), shortcut: shortcutLabel('settings.open'), onSelect: ctx.openSettings },
        fromAction('workspace-settings', t('menu.workspaceSettings')),
        sep('file-2'),
        { kind: 'item', id: 'quit', label: t('menu.exit'), onSelect: () => window.close() }
      ])
    },
    {
      id: 'edit', label: t('menu.edit'), items: [
        { kind: 'item', id: 'undo', label: t('menu.undo'), shortcut: 'Ctrl+Z', onSelect: edit('undo') },
        { kind: 'item', id: 'redo', label: t('menu.redo'), shortcut: 'Ctrl+Shift+Z', onSelect: edit('redo') },
        sep('edit-1'),
        { kind: 'item', id: 'cut', label: t('menu.cut'), shortcut: 'Ctrl+X', onSelect: edit('cut') },
        { kind: 'item', id: 'copy', label: t('menu.copy'), shortcut: 'Ctrl+C', onSelect: edit('copy') },
        { kind: 'item', id: 'paste', label: t('menu.paste'), shortcut: 'Ctrl+V', onSelect: edit('paste') },
        { kind: 'item', id: 'select-all', label: t('menu.selectAll'), shortcut: 'Ctrl+A', onSelect: edit('selectAll') }
      ]
    },
    {
      id: 'view', label: t('menu.view'), items: compact([
        { kind: 'item', id: 'command-palette', label: t('menu.commandPalette'), shortcut: shortcutLabel('palette.open'), onSelect: ctx.openCommandMenu },
        sep('view-0'),
        ...VIEWS.map(([view, label]): AppMenuNode => ({ kind: 'radio', id: `view-${view}`, label, shortcut: shortcutLabel(`view.${view}`), checked: ctx.applicationView === view, onSelect: () => ctx.setApplicationView(view) })),
        sep('view-1'),
        fromAction('toggle-sidebar', t('menu.toggleSidebar'), shortcutLabel('sidebar.toggle')),
        fromAction('tool-editor', t('menu.files'), shortcutLabel('code.files')),
        fromAction('tool-github', t('menu.sourceControl')),
        fromAction('tool-background', t('menu.backgroundActivity')),
        fromAction('toggle-split-layout', t('menu.splitLayout'), shortcutLabel('code.splitLayout')),
        fromAction('balance-pane-layout', t('menu.balancePanes')),
        sep('view-2'),
        // Appearance applies to the whole app, so it works without a workspace.
        appearances.length ? { kind: 'submenu', id: 'appearance', label: t('menu.appearance'), children: appearances } : null,
        densities.length ? { kind: 'submenu', id: 'densities', label: t('menu.density'), disabled: noWorkspace, children: densities } : null,
        layouts.length ? { kind: 'submenu', id: 'layouts', label: t('menu.layout'), disabled: noWorkspace, children: layouts } : null,
        sep('view-3'),
        fromAction('split-vertical', t('menu.splitRight'), shortcutLabel('pane.splitRight')),
        fromAction('split-horizontal', t('menu.splitDown'), shortcutLabel('pane.splitDown')),
        fromAction('maximize-pane', t('menu.maximizePane'), shortcutLabel('pane.maximize'))
      ])
    },
    {
      id: 'tools', label: t('menu.tools'), items: compact([
        fromAction('tool-mcp', t('menu.mcpServers')),
        fromAction('tool-skills', t('menu.skills')),
        fromAction('open-usage', t('menu.usage')),
        fromAction('open-linear', t('menu.linear'))
      ])
    },
    {
      id: 'help', label: t('menu.help'), items: compact([
        fromAction('help.shortcuts', t('menu.keyboardShortcuts'), shortcutLabel('help.shortcuts')),
        fromAction('settings.diagnostics', t('menu.diagnostics')),
        fromAction('help.report-problem', t('menu.reportProblem')),
        sep('help-1'),
        // Settings › Updates shows the version and checks for a newer one.
        fromAction('settings.updates', t('menu.about', { version: ctx.version }))
      ])
    }
  ]
}
