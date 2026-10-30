import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import type { ContainerEngine } from '../../../shared/types/oxequery'
import { NavigationRail, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useKeybindings, shortcutLabel } from '../../keyboard/keybindings'
import { Badge, Kbd, SegmentedControl, StatusDot, cx } from '../../ui'
import { Splitter } from '../../ui/Splitter'
import { EngineBar } from './EngineBar'
import { usePodsCatalog } from './catalog'
import { useOxePodStore } from './oxepod.store'
import { KNOWN_STATES, firstHostPort, groupContainers, stateStatus } from './pods-model'
import styles from './OxePod.module.css'

const ENGINE_NAMES: Record<ContainerEngine, string> = { docker: 'Docker', podman: 'Podman' }

/** Left column of OxePod: the engine, the containers by Compose project, and the way to images and agent activity. */
export function OxePodSidebar(): ReactElement {
  usePodsCatalog()
  const { t } = useTranslation('pods')
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const containers = useOxePodStore(state => state.containers)
  const selected = useOxePodStore(state => state.selected)
  const view = useOxePodStore(state => state.view)
  const filter = useOxePodStore(state => state.filter)
  const error = useOxePodStore(state => state.error)
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => { void useOxePodStore.getState().refresh() }, [])
  useKeybindings({ 'oxepod.filter': () => { if (!filterRef.current) return false; filterRef.current.focus(); filterRef.current.select() } })

  const refresh: RailAction = { id: 'refresh', label: t('sidebar.refresh'), icon: RefreshCw, onClick: () => void useOxePodStore.getState().refresh() }
  const resources: RailAction = { id: 'resources', label: t('resources.label'), icon: HardDrive, onClick: () => useOxePodStore.getState().show('resources') }
  const groups = groupContainers(containers, filter)
  return <aside className={cx('thread-navigation', styles.sidebar, collapsed && 'thread-navigation-collapsed')} aria-label={t('sidebar.label')}>
    {collapsed && <NavigationRail mode="pods" primary={[refresh]} context={resources} onToggle={toggleCollapse} />}
    {!collapsed && <div className={styles.sidebarContent}>
      <header className={styles.sidebarHeader}><strong>OxePod</strong><SidebarActions actions={[refresh]} /></header>
      <EngineSwitch />
      <EngineBar shown={containers.length} />
      <label className={cx('desktop-search', styles.filter)}>
        <Search size={13} aria-hidden="true" />
        <input ref={filterRef} data-pod-filter="" type="search" aria-label={t('sidebar.filter')} placeholder={t('sidebar.filter')} value={filter} onChange={event => useOxePodStore.getState().setFilter(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && filter) { event.stopPropagation(); useOxePodStore.getState().setFilter('') } }} />
        {shortcutLabel('oxepod.filter') && <Kbd>{shortcutLabel('oxepod.filter')}</Kbd>}
      </label>
      <div className={styles.groups}>
        {groups.map(group => <section key={group.project ?? ''} aria-label={group.project ? t('sidebar.project', { name: group.project }) : t('sidebar.others')}>
          <h3 className={styles.groupTitle}>{group.project ? t('sidebar.project', { name: group.project }) : t('sidebar.others')}</h3>
          {group.containers.map(container => {
            const port = firstHostPort(container.ports)
            const state = KNOWN_STATES.has(container.state) ? t(`state.${container.state}` as 'state.running') : container.state
            return <button key={container.id} type="button" className={styles.row} aria-current={view === 'container' && selected === container.id ? 'page' : undefined}
              title={[container.name, container.image].join(" · ")} onClick={() => useOxePodStore.getState().select(container.id)}>
              <StatusDot status={stateStatus(container.state)} label={state} />
              <span className={styles.rowName}>{container.name}</span>
              {container.state === 'running' ? port !== undefined && <small className={styles.rowMeta}>{port}</small>
                : <Badge intent={container.state === 'restarting' || container.state === 'paused' ? 'warning' : 'neutral'}>{state}</Badge>}
            </button>
          })}
        </section>)}
        {containers.length > 0 && groups.length === 0 && <p className={styles.sideNote}>{t('sidebar.noMatch')}</p>}
        {containers.length === 0 && !error && <p className={styles.sideNote}>{t('sidebar.empty')}</p>}
      </div>
      <nav className={styles.sidebarLinks} aria-label={t('sidebar.more')}>
        <button type="button" className={styles.row} aria-current={view === 'resources' ? 'page' : undefined} onClick={() => useOxePodStore.getState().show('resources')}><HardDrive size={14} aria-hidden="true" /><span className={styles.rowName}>{t('resources.label')}</span></button>
        <button type="button" className={styles.row} aria-current={view === 'activity' ? 'page' : undefined} onClick={() => useOxePodStore.getState().show('activity')}><ShieldCheck size={14} aria-hidden="true" /><span className={styles.rowName}>{t('sidebar.activity')}</span></button>
      </nav>
      <SidebarFooter context={resources} onToggle={toggleCollapse} />
    </div>}
    {!collapsed && <Splitter orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}

/** Docker and Podman side by side: the one in use, and what the other one is doing. */
function EngineSwitch(): ReactElement | null {
  const { t } = useTranslation('pods')
  const engines = useOxePodStore(state => state.engines)
  const engine = useOxePodStore(state => state.engine)
  if (engines.length === 0) return null
  const current = engine ?? engines.find(info => info.available)?.engine ?? 'docker'
  const info = engines.find(item => item.engine === current)
  const other = engines.find(item => item.engine !== current)
  const describe = (item: typeof info): string => !item ? '' : item.available ? t('engine.ready', { version: item.version ?? '' })
    : t(`engine.state.${item.state === 'stopped' || item.state === 'denied' ? item.state : 'missing'}`)
  return <div className={styles.engine}>
    <SegmentedControl label={t('engine.label')} value={current} onChange={value => { if (value !== current) void useOxePodStore.getState().refresh(value) }}
      options={(['docker', 'podman'] as const).map(value => ({ value, label: ENGINE_NAMES[value] }))} />
    <small className={styles.engineNote}>
      <span>{ENGINE_NAMES[current]}: {describe(info)}</span>
      {other && <span>{ENGINE_NAMES[other.engine]}: {describe(other)}</span>}
    </small>
  </div>
}
