import { i18n } from '../../i18n'
import type { CommandPaletteAction } from '../../utils/commandRegistry'

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

/** Every palette action a menu points to; tests/app-menus.test.ts checks each one exists, so none disappears silently. */
export const MENU_ACTION_IDS = ['new-workspace', 'workspace-settings', 'toggle-sidebar', 'tool-editor', 'tool-github', 'tool-background',
  'toggle-split-layout', 'balance-pane-layout', 'split-vertical', 'split-horizontal', 'maximize-pane', 'design-system',
  'find-in-files', 'tool-mcp', 'tool-skills', 'open-usage', 'open-linear'] as const
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
        { kind: 'item', id: 'settings', label: t('menu.settings'), shortcut: 'Ctrl+,', onSelect: ctx.openSettings },
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
        { kind: 'radio', id: 'view-code', label: 'Code', checked: ctx.applicationView === 'code', onSelect: () => ctx.setApplicationView('code') },
        { kind: 'radio', id: 'view-thread', label: 'Thread', checked: ctx.applicationView === 'thread', onSelect: () => ctx.setApplicationView('thread') },
        { kind: 'radio', id: 'view-data', label: 'OxeQuery', checked: ctx.applicationView === 'data', onSelect: () => ctx.setApplicationView('data') },
        sep('view-1'),
        fromAction('toggle-sidebar', t('menu.toggleSidebar'), 'Ctrl+B'),
        fromAction('tool-editor', t('menu.files'), 'Ctrl+E'),
        fromAction('tool-github', t('menu.sourceControl')),
        fromAction('tool-background', t('menu.backgroundActivity')),
        fromAction('toggle-split-layout', t('menu.splitLayout'), 'F2'),
        fromAction('balance-pane-layout', t('menu.balancePanes')),
        sep('view-2'),
        // Appearance applies to the whole app, so it works without a workspace.
        appearances.length ? { kind: 'submenu', id: 'appearance', label: t('menu.appearance'), children: appearances } : null,
        densities.length ? { kind: 'submenu', id: 'densities', label: t('menu.density'), disabled: noWorkspace, children: densities } : null,
        layouts.length ? { kind: 'submenu', id: 'layouts', label: t('menu.layout'), disabled: noWorkspace, children: layouts } : null,
        sep('view-3'),
        fromAction('split-vertical', t('menu.splitRight'), 'Ctrl+Shift+\\'),
        fromAction('split-horizontal', t('menu.splitDown'), 'Ctrl+Shift+-'),
        fromAction('maximize-pane', t('menu.maximizePane'), 'Ctrl+Shift+Enter'),
        sep('view-4'),
        fromAction('design-system', t('menu.designSystem'))
      ])
    },
    {
      id: 'help', label: t('menu.help'), items: compact([
        fromAction('find-in-files', t('menu.searchFiles'), 'Ctrl+J'),
        sep('help-1'),
        fromAction('tool-mcp', t('menu.mcpServers')),
        fromAction('tool-skills', t('menu.skills')),
        fromAction('open-usage', t('menu.usage')),
        fromAction('open-linear', t('menu.linear')),
        sep('help-2'),
        { kind: 'item', id: 'about', label: t('menu.about', { version: ctx.version }), disabled: true, onSelect: () => undefined }
      ])
    }
  ]
}
