// Parked for F9 (P1, Containers panel). Component tests keep passing.
import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import type { ContainerEngine } from '../../../shared/types/oxepod'
import { NavigationRail, RailItems, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useKeybindings, shortcutLabel } from '../../keyboard/keybindings'
import { Badge, SegmentedControl, SidebarFilter, SidebarHeader, SidebarRow, StatusDot, cx } from '../../ui'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(useKeybindings as any)({ 'oxepod.filter': () => { if (!filterRef.current) return false; filterRef.current.focus(); filterRef.current.select() } })

  const refresh: RailAction = { id: 'refresh', label: t('sidebar.refresh'), icon: RefreshCw, onClick: () => void useOxePodStore.getState().refresh() }
  const resources: RailAction = { id: 'resources', label: t('resources.label'), icon: HardDrive, onClick: () => useOxePodStore.getState().show('resources') }
  const groups = groupContainers(containers, filter)
  return <aside className={cx('thread-navigation', styles.sidebar, collapsed && 'thread-navigation-collapsed')} aria-label={t('sidebar.label')}>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    {collapsed && <NavigationRail mode={'pods' as any} primary={[refresh]} context={resources} onToggle={toggleCollapse}>
      <RailItems label={t('sidebar.label')} items={groups.flatMap(group => group.containers).map(container => {
        const state = KNOWN_STATES.has(container.state) ? t(`state.${container.state}` as 'state.running') : container.state
        return { id: container.id, label: `${container.name} · ${state}`, current: view === 'container' && selected === container.id,
          mark: <StatusDot status={stateStatus(container.state)} label={state} />, onSelect: () => useOxePodStore.getState().select(container.id) }
      })} />
    </NavigationRail>}
    {!collapsed && <div className={styles.sidebarContent}>
      <SidebarHeader title="OxePod" actions={<SidebarActions actions={[refresh]} />} />
      <EngineSwitch />
      <EngineBar shown={containers.length} />
      <SidebarFilter ref={filterRef} data-pod-filter="" icon={<Search size={12} aria-hidden="true" />} aria-label={t('sidebar.filter')} placeholder={t('sidebar.filterPlaceholder')}
        value={filter} onChange={event => useOxePodStore.getState().setFilter(event.target.value)} hint={shortcutLabel('oxepod.filter') || undefined}
        onClear={() => useOxePodStore.getState().setFilter('')} clearLabel={t('common.clear')} />
      <div className={styles.groups}>
        {groups.map(group => <section key={group.project ?? ''} aria-label={group.project ? t('sidebar.project', { name: group.project }) : t('sidebar.others')}>
          <h3 className={styles.groupTitle}>{group.project ? t('sidebar.project', { name: group.project }) : t('sidebar.others')}</h3>
          {group.containers.map(container => {
            const port = firstHostPort(container.ports)
            const state = KNOWN_STATES.has(container.state) ? t(`state.${container.state}` as 'state.running') : container.state
            return <SidebarRow key={container.id} selected={view === 'container' && selected === container.id} onSelect={() => useOxePodStore.getState().select(container.id)}
              lead={<StatusDot status={stateStatus(container.state)} label={state} />}
              title={<span title={[container.name, container.image].join(' · ')}>{container.name}</span>}
              meta={container.state === 'running' ? port !== undefined && <span className={styles.rowMeta}>{port}</span>
                : <Badge intent={container.state === 'restarting' || container.state === 'paused' ? 'warning' : 'neutral'}>{state}</Badge>} />
          })}
        </section>)}
        {containers.length > 0 && groups.length === 0 && <p className={styles.sideNote}>{t('sidebar.noMatch')}</p>}
        {containers.length === 0 && !error && <p className={styles.sideNote}>{t('sidebar.empty')}</p>}
      </div>
      <nav className={styles.sidebarLinks} aria-label={t('sidebar.more')}>
        <SidebarRow selected={view === 'resources'} onSelect={() => useOxePodStore.getState().show('resources')} lead={<HardDrive size={14} aria-hidden="true" />} title={t('resources.label')} />
        <SidebarRow selected={view === 'activity'} onSelect={() => useOxePodStore.getState().show('activity')} lead={<ShieldCheck size={14} aria-hidden="true" />} title={t('sidebar.activity')} />
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
