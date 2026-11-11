import type { ReactElement } from 'react'
import { Check, ChevronRight, Menu } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'
import { buildAppMenus, type AppMenuContext, type AppMenuNode } from './appMenus'
import './AppMenuBar.css'

function Nodes({ nodes }: { nodes: AppMenuNode[] }): ReactElement {
  return <>{nodes.map(node => {
    if (node.kind === 'separator') return <DropdownMenu.Separator key={node.id} className="app-menu-separator" />
    if (node.kind === 'radio') {
      return <DropdownMenu.CheckboxItem key={node.id} className="app-menu-item" checked={node.checked} onSelect={node.onSelect}>
        <span className="app-menu-indicator"><DropdownMenu.ItemIndicator><Check size={12} aria-hidden="true" /></DropdownMenu.ItemIndicator></span>{node.label}{node.shortcut && <kbd>{node.shortcut}</kbd>}
      </DropdownMenu.CheckboxItem>
    }
    if (node.kind === 'submenu') return <Submenu key={node.id} label={node.label} nodes={node.children} disabled={node.disabled} />
    if (node.unavailable) return <DropdownMenu.Item key={node.id} className="app-menu-item app-menu-item-unavailable" aria-disabled="true" aria-description={node.unavailable} onSelect={node.onSelect}>
      <span className="app-menu-indicator" /><span className="app-menu-item-text">{node.label}<small aria-hidden="true">{node.unavailable}</small></span>{node.shortcut && <kbd>{node.shortcut}</kbd>}
    </DropdownMenu.Item>
    return <DropdownMenu.Item key={node.id} className="app-menu-item" disabled={node.disabled} onSelect={node.onSelect}>
      <span className="app-menu-indicator" />{node.label}{node.shortcut && <kbd>{node.shortcut}</kbd>}
    </DropdownMenu.Item>
  })}</>
}

function Submenu({ label, nodes, disabled }: { label: string; nodes: AppMenuNode[]; disabled?: boolean }): ReactElement {
  return <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger className="app-menu-item" disabled={disabled}><span className="app-menu-indicator" />{label}<ChevronRight size={12} className="app-menu-chevron" aria-hidden="true" /></DropdownMenu.SubTrigger>
    <DropdownMenu.Portal><DropdownMenu.SubContent className="app-menu-content" alignOffset={-5} sideOffset={4}><Nodes nodes={nodes} /></DropdownMenu.SubContent></DropdownMenu.Portal>
  </DropdownMenu.Sub>
}

/** The application menus (File, Edit, View, Tools, Help) inline beside the logo, with the compact menu button kept for narrow widths and keyboard shortcuts. */
export function AppMenuBar({ context }: { context: AppMenuContext }): ReactElement {
  // Subscribing re-renders the menus, built with i18n.t, when the language changes.
  const { t } = useTranslation()
  const menus = buildAppMenus(context)
  // Non-modal (CR-33, HML-F2-1): a modal menu sets aria-hidden on every sibling of its portal, <main> included, while <main> keeps focusable controls (axe aria-hidden-focus). Escape, a click outside and focus return still close it.
  return <div className="app-menubar-wrap">
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="app-menu-button" aria-label={t('nav.applicationMenu')} title={t('nav.menu')}><Menu size={15} aria-hidden="true" /></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="app-menu-content" align="start" sideOffset={6}>
          {menus.map(menu => <Submenu key={menu.id} label={menu.label} nodes={menu.items} />)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <nav className="app-menubar-inline" aria-label={t('nav.menu')}>
      {menus.map(menu => (
        <DropdownMenu.Root key={menu.id} modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="sm" className="app-menubar-trigger">{menu.label}</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="app-menu-content" align="start" sideOffset={6}>
              <Nodes nodes={menu.items} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </nav>
  </div>
}
