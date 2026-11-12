import { i18n } from '../../i18n'
import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { shortcutLabel, type AppView } from '../../keyboard/keybindings'
import { tCommand } from '../../commands/commandText'
import { toast } from '../../ui/Toast'
import type { EditCommand } from '../../../shared/types/ipc'
import { editUnavailable, requestEdit } from './editTarget'

export type AppMenuNode =
  /**
   * `unavailable`: the item can't run here and says why. Unlike `disabled` it stays reachable by keyboard and screen
   * readers (aria-disabled), shows the reason as a second line, and selecting it says the reason again as a toast.
   */
  | { kind: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; unavailable?: string; onSelect(): void }
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
  openContainers?: () => void
  version?: string
}

const sep = (id: string): AppMenuNode => ({ kind: 'separator', id })
/** The views in the order of the switch; product names, never translated. */
const VIEWS: Array<[AppView, string]> = [['code', 'OxeCode'], ['thread', 'OxeChat'], ['data', 'OxeQuery']]

/** Every palette action a menu points to; tests/app-menus.test.ts checks each one exists, so none disappears silently. */
export const MENU_ACTION_IDS = ['new-workspace', 'workspace-settings', 'toggle-sidebar', 'tool-editor', 'tool-github', 'tool-background',
  'toggle-split-layout', 'balance-pane-layout', 'split-vertical', 'split-horizontal', 'maximize-pane',
  'tool-http-calls', 'tool-android', 'tool-mcp', 'open-usage', 'help.whats-new', 'help.shortcuts', 'help.report-problem', 'help.about', 'settings.diagnostics', 'settings.about'] as const
/** Families of actions shown as submenus, by id prefix. */
export const MENU_ACTION_PREFIXES = ['appearance-', 'density-', 'layout-'] as const
type MenuActionId = typeof MENU_ACTION_IDS[number]

/**
 * An editing command for the place the person was in before the menu opened (editTarget.ts). Where it cannot act (Undo
 * in a terminal, Paste with no field) the item says why instead of doing nothing.
 */
function editItem(id: string, command: EditCommand, label: string, shortcut: string): AppMenuNode {
  const unavailable = editUnavailable(command)
  return { kind: 'item', id, label, shortcut, unavailable, onSelect: unavailable ? () => { toast({ title: unavailable }) } : () => requestEdit(command) }
}

export function buildAppMenus(ctx: AppMenuContext): AppMenu[] {
  const t = i18n.t.bind(i18n)
  const byId = new Map(ctx.actions.map(action => [action.id, action]))
  // An item says what its palette command says, from the same catalog key, without the category its menu already gives.
  const menuLabel = (action: CommandPaletteAction): string => action.action ?? action.title
  const noWorkspace = !byId.get('workspace-settings') || byId.get('workspace-settings')!.disabled === true
  // With no workspace open, the items of OxeCode cannot run. They say so, as Edit's do, instead of being grey without
  // a word (MENU-R1): reachable by keyboard, with the reason as a second line and again when chosen.
  const item = (action: CommandPaletteAction, shortcut?: string): AppMenuNode => {
    const unavailable = action.disabled && noWorkspace ? t('menu.needsWorkspace') : undefined
    return unavailable
      ? { kind: 'item', id: action.id, label: menuLabel(action), shortcut, unavailable, onSelect: () => { toast({ title: unavailable }) } }
      : { kind: 'item', id: action.id, label: menuLabel(action), shortcut, disabled: action.disabled, onSelect: action.run }
  }
  const fromAction = (id: MenuActionId, shortcut?: string): AppMenuNode | null => {
    const action = byId.get(id)
    return action ? item(action, shortcut) : null
  }
  const group = (prefix: string): AppMenuNode[] => ctx.actions.filter(action => action.id.startsWith(prefix)).map(action => item(action))
  const compact = (nodes: Array<AppMenuNode | null>): AppMenuNode[] => nodes.filter((node): node is AppMenuNode => node !== null)
  const appearances = group('appearance-')
  const densities = group('density-')
  const layouts = group('layout-')

  return [
    {
      id: 'file', label: t('menu.file'), items: compact([
        ctx.applicationView === 'thread'
          ? { kind: 'item', id: 'add-project', label: tCommand('action.thread.add-project'), onSelect: ctx.addThreadProject }
          : fromAction('new-workspace'),
        sep('file-1'),
        { kind: 'item', id: 'settings', label: t('menu.settings'), shortcut: shortcutLabel('settings.open'), onSelect: ctx.openSettings },
        fromAction('workspace-settings'),
        sep('file-2'),
        { kind: 'item', id: 'quit', label: t('menu.exit'), onSelect: () => window.close() }
      ])
    },
    {
      id: 'edit', label: t('menu.edit'), items: [
        editItem('undo', 'undo', t('menu.undo'), 'Ctrl+Z'),
        editItem('redo', 'redo', t('menu.redo'), 'Ctrl+Shift+Z'),
        sep('edit-1'),
        editItem('cut', 'cut', t('menu.cut'), 'Ctrl+X'),
        editItem('copy', 'copy', t('menu.copy'), 'Ctrl+C'),
        editItem('paste', 'paste', t('menu.paste'), 'Ctrl+V'),
        editItem('select-all', 'selectAll', t('menu.selectAll'), 'Ctrl+A')
      ]
    },
    {
      id: 'view', label: t('menu.view'), items: compact([
        { kind: 'item', id: 'command-palette', label: t('menu.commandPalette'), shortcut: shortcutLabel('palette.open'), onSelect: ctx.openCommandMenu },
        sep('view-0'),
        ...VIEWS.map(([view, label]): AppMenuNode => ({ kind: 'radio', id: `view-${view}`, label, shortcut: shortcutLabel(`view.${view}`), checked: ctx.applicationView === view, onSelect: () => ctx.setApplicationView(view) })),
        sep('view-1'),
        fromAction('toggle-sidebar', shortcutLabel('sidebar.toggle')),
        fromAction('tool-editor', shortcutLabel('code.files')),
        fromAction('tool-github'),
        fromAction('tool-background'),
        fromAction('toggle-split-layout', shortcutLabel('code.splitLayout')),
        fromAction('balance-pane-layout'),
        sep('view-2'),
        // Appearance applies to the whole app, so it works without a workspace.
        appearances.length ? { kind: 'submenu', id: 'appearance', label: t('menu.appearance'), children: appearances } : null,
        densities.length ? { kind: 'submenu', id: 'densities', label: t('menu.density'), disabled: noWorkspace, children: densities } : null,
        layouts.length ? { kind: 'submenu', id: 'layouts', label: t('menu.layout'), disabled: noWorkspace, children: layouts } : null,
        sep('view-3'),
        fromAction('split-vertical', shortcutLabel('pane.splitRight')),
        fromAction('split-horizontal', shortcutLabel('pane.splitDown')),
        fromAction('maximize-pane', shortcutLabel('pane.maximize'))
      ])
    },
    {
      id: 'tools', label: t('menu.tools'), items: compact([
        fromAction('tool-android'),
        fromAction('tool-http-calls'),
        ctx.openContainers ? { kind: 'item', id: 'containers', label: i18n.t('panels.containers', { ns: 'code' }), onSelect: ctx.openContainers } : null,
        sep('tools-1'),
        fromAction('tool-mcp'),
        fromAction('open-usage')
      ])
    },
    {
      id: 'help', label: t('menu.help'), items: compact([
        fromAction('help.whats-new'),
        fromAction('help.shortcuts', shortcutLabel('help.shortcuts')),
        fromAction('settings.diagnostics'),
        fromAction('help.report-problem'),
        sep('help-1'),
        fromAction('settings.about'),
        fromAction('help.about')
      ])
    }
  ]
}
