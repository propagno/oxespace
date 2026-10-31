import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2, KeyRound, RefreshCw, Search, Upload } from 'lucide-react'
import { NavigationRail, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useKeybindings, shortcutLabel } from '../../keyboard/keybindings'
import { Badge, Kbd, Skeleton, cx } from '../../ui'
import { Splitter } from '../../ui/Splitter'
import { usePostCatalog } from './catalog'
import { useOxePostStore } from './oxepost.store'
import { groupRequests } from './post-model'
import styles from './OxePost.module.css'

/** Left column of OxePost: the requests of the workspace by folder, and the way to import them and to the environments. */
export function OxePostSidebar(): ReactElement {
  usePostCatalog()
  const { t } = useTranslation('post')
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const entries = useOxePostStore(state => state.entries)
  const selected = useOxePostStore(state => state.selected)
  const filter = useOxePostStore(state => state.filter)
  const loading = useOxePostStore(state => state.loading)
  const error = useOxePostStore(state => state.error)
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => { void useOxePostStore.getState().load(workspaceId) }, [workspaceId])
  useKeybindings({ 'oxepost.filter': () => { if (!filterRef.current) return false; filterRef.current.focus(); filterRef.current.select() } })

  const store = useOxePostStore.getState
  const create: RailAction = { id: 'new', label: t('sidebar.new'), icon: FilePlus2, onClick: () => void store().open(null) }
  const refresh: RailAction = { id: 'refresh', label: t('sidebar.refresh'), icon: RefreshCw, onClick: () => void store().load(workspaceId) }
  const environments: RailAction = { id: 'environments', label: t('sidebar.environments'), icon: KeyRound, onClick: () => store().show('environments') }
  const groups = groupRequests(entries, filter)
  return <aside className={cx('thread-navigation', styles.sidebar, collapsed && 'thread-navigation-collapsed')} aria-label={t('sidebar.label')}>
    {collapsed && <NavigationRail mode="post" primary={[create, refresh]} context={environments} onToggle={toggleCollapse} />}
    {!collapsed && <div className={styles.sidebarContent}>
      <header className={styles.sidebarHeader}><strong>OxePost</strong><SidebarActions actions={[create, refresh]} /></header>
      <label className={cx('desktop-search', styles.filter)}>
        <Search size={13} aria-hidden="true" />
        <input ref={filterRef} data-post-filter="" type="search" aria-label={t('sidebar.filter')} placeholder={t('sidebar.filter')} value={filter} onChange={event => store().setFilter(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && filter) { event.stopPropagation(); store().setFilter('') } }} />
        {shortcutLabel('oxepost.filter') && <Kbd>{shortcutLabel('oxepost.filter')}</Kbd>}
      </label>
      <div className={styles.groups}>
        {loading && entries.length === 0 && <Skeleton lines={4} label={t('sidebar.loading')} />}
        {groups.map(group => <section key={group.folder} aria-label={group.folder ? t('sidebar.folder', { name: group.folder }) : t('sidebar.root')}>
          {group.folder && <h3 className={styles.groupTitle}>{group.folder}</h3>}
          {group.entries.map(entry => <button key={entry.path} type="button" className={styles.row} aria-current={selected === entry.path ? 'page' : undefined} title={entry.problem ?? entry.path}
            onClick={() => void store().open(entry.path)}>
            {entry.method ? <span className={cx(styles.method, styles[`m${entry.method}`])}>{entry.method}</span> : <Badge intent="danger">{t('sidebar.unreadable')}</Badge>}
            <span className={styles.rowName}>{entry.name}</span>
          </button>)}
        </section>)}
        {entries.length > 0 && groups.length === 0 && <p className={styles.sideNote}>{t('sidebar.noMatch')}</p>}
        {!loading && !error && entries.length === 0 && <p className={styles.sideNote}>{workspaceId ? t('sidebar.empty') : t('sidebar.noWorkspace')}</p>}
        {error && <p className={styles.sideNote} role="alert">{t('sidebar.failed')}</p>}
      </div>
      <nav className={styles.sidebarLinks} aria-label={t('sidebar.more')}>
        <button type="button" className={styles.row} onClick={() => store().show('import')}><Upload size={14} aria-hidden="true" /><span className={styles.rowName}>{t('sidebar.import')}</span></button>
        <button type="button" className={styles.row} onClick={() => store().show('environments')}><KeyRound size={14} aria-hidden="true" /><span className={styles.rowName}>{t('sidebar.environments')}</span></button>
      </nav>
      <SidebarFooter context={environments} onToggle={toggleCollapse} />
    </div>}
    {!collapsed && <Splitter orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}
