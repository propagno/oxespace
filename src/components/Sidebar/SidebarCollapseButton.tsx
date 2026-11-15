import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useUIStore, type SidebarMode } from '../../store/ui.store'
import { IconButton } from '../../ui'

/** Collapse or expand a mode's sidebar (Ctrl B): the last action of the sidebar header, the first of the rail. A src/ui IconButton (BRD-01). */
export function SidebarCollapseButton({ mode, collapsed }: { mode: SidebarMode; collapsed?: boolean }): ReactElement {
  const { t } = useTranslation()
  const storeCollapsed = useUIStore(s => s.collapsedSidebars[mode])
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const isCollapsed = collapsed ?? storeCollapsed
  const label = isCollapsed ? t('nav.expandSidebarShortcut') : t('nav.collapseSidebarShortcut')
  return (
    <IconButton
      size={collapsed ? 'lg' : 'sm'}
      label={label}
      title={label}
      icon={isCollapsed ? <ChevronsRight size={14} aria-hidden="true" /> : <ChevronsLeft size={14} aria-hidden="true" />}
      onClick={() => toggleSidebar(mode)}
    />
  )
}
