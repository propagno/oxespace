import type { ReactElement } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Menubar } from 'radix-ui'
import { buildAppMenus, type AppMenuContext, type AppMenuNode } from './appMenus'
import './AppMenuBar.css'

function Nodes({ nodes }: { nodes: AppMenuNode[] }): ReactElement {
  return <>{nodes.map(node => {
    if (node.kind === 'separator') return <Menubar.Separator key={node.id} className="app-menu-separator" />
    if (node.kind === 'radio') {
      return <Menubar.CheckboxItem key={node.id} className="app-menu-item" checked={node.checked} onSelect={node.onSelect}>
        <span className="app-menu-indicator"><Menubar.ItemIndicator><Check size={12} aria-hidden="true" /></Menubar.ItemIndicator></span>{node.label}
      </Menubar.CheckboxItem>
    }
    if (node.kind === 'submenu') {
      return <Menubar.Sub key={node.id}>
        <Menubar.SubTrigger className="app-menu-item" disabled={node.disabled}><span className="app-menu-indicator" />{node.label}<ChevronRight size={12} className="app-menu-chevron" aria-hidden="true" /></Menubar.SubTrigger>
        <Menubar.Portal><Menubar.SubContent className="app-menu-content" alignOffset={-5} sideOffset={4}><Nodes nodes={node.children} /></Menubar.SubContent></Menubar.Portal>
      </Menubar.Sub>
    }
    return <Menubar.Item key={node.id} className="app-menu-item" disabled={node.disabled} onSelect={node.onSelect}>
      <span className="app-menu-indicator" />{node.label}{node.shortcut && <kbd>{node.shortcut}</kbd>}
    </Menubar.Item>
  })}</>
}

/** Application menu bar drawn inside the title bar (the OS frame is hidden). */
export function AppMenuBar({ context }: { context: AppMenuContext }): ReactElement {
  const menus = buildAppMenus(context)
  return <Menubar.Root className="app-menubar" aria-label="Application menu">
    {menus.map(menu => <Menubar.Menu key={menu.id}>
      <Menubar.Trigger className="app-menubar-trigger">{menu.label}</Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content className="app-menu-content" align="start" sideOffset={4} alignOffset={-4}><Nodes nodes={menu.items} /></Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>)}
  </Menubar.Root>
}
