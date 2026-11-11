import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useUIStore, type SidebarMode } from '../../store/ui.store'

export function SidebarCollapseButton({ mode, collapsed }: { mode: SidebarMode; collapsed?: boolean }): ReactElement {
  const { t } = useTranslation()
  const storeCollapsed = useUIStore(s => s.collapsedSidebars[mode])
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const isCollapsed = collapsed ?? storeCollapsed
  const label = isCollapsed ? t('nav.expandSidebarShortcut') : t('nav.collapseSidebarShortcut')
  return (
    <button
      type="button"
      className="nav-rail-btn"
      aria-label={label}
      title={label}
      onClick={() => toggleSidebar(mode)}
    >
      {isCollapsed ? <ChevronsRight size={15} aria-hidden="true" /> : <ChevronsLeft size={15} aria-hidden="true" />}
    </button>
  )
}
