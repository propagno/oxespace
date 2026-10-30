import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Boxes, RefreshCw } from 'lucide-react'
import type { ContainerEngineInfo } from '../../../shared/types/oxequery'
import { Button, EmptyState, ErrorState, LoadingState } from '../../ui'
import { loadOxeQueryCatalog } from '../OxeQuery/catalog'
import { ContainerDetail } from './ContainerDetail'
import { ResourcesPanel } from './ResourcesPanel'
import { usePodsCatalog } from './catalog'
import { useOxePodStore } from './oxepod.store'
import styles from './OxePod.module.css'

const REFRESH_MS = 3000
/** Docker contexts that still mean this computer. */
const LOCAL_CONTEXTS = new Set(['default', 'desktop-linux', 'desktop-windows', 'orbstack', 'colima', 'rancher-desktop'])

// Agent requests are one audit for databases and containers; OxePod shows the container ones with OxeQuery's panel.
const ActivityPanel = lazy(async () => {
  await loadOxeQueryCatalog()
  const module = await import('../OxeQuery/ActivityPanel')
  return { default: module.ActivityPanel }
})

/** Main area of the OxePod mode: one container in detail, or the engine's images, volumes and networks, or agent activity. */
export function OxePodView({ active }: { active: boolean }): ReactElement {
  usePodsCatalog()
  const { t } = useTranslation('pods')
  const containers = useOxePodStore(state => state.containers)
  const error = useOxePodStore(state => state.error)
  const loading = useOxePodStore(state => state.loading)
  const engine = useOxePodStore(state => state.engine)
  const engines = useOxePodStore(state => state.engines)
  const selected = useOxePodStore(state => state.selected)
  const view = useOxePodStore(state => state.view)
  const refresh = useOxePodStore(state => state.refresh)

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, refresh])
  useEffect(() => window.oxe?.oxeQuery?.onEvent(event => { if (event.type === 'containers-changed') void refresh() }), [refresh])

  const context = engines.find(item => item.engine === engine && item.available)?.context
  const remote = context && !LOCAL_CONTEXTS.has(context) ? context : ''
  const container = containers.find(item => item.id === selected) ?? null
  let body: ReactElement
  if (view === 'resources') body = <ResourcesPanel engine={engine} active={active} />
  else if (view === 'activity') body = <Suspense fallback={<LoadingState label={t('activity.loading')} />}><div className={styles.activity}><ActivityPanel active={active} scope="containers" /></div></Suspense>
  else if (error && containers.length === 0) body = <EngineProblem message={error} engines={engines} loading={loading} onRetry={() => void refresh()} />
  else if (container) body = <ContainerDetail key={container.id} container={container} engine={engine} active={active} />
  else body = <div className={styles.center}>{loading && containers.length === 0 ? <LoadingState label={t('view.loading')} />
    : <EmptyState icon={<Boxes size={22} aria-hidden="true" />} title={t('view.emptyTitle')}>{t('view.emptyText')}</EmptyState>}</div>

  return <div className={styles.view} aria-label="OxePod">
    {remote && <p className={styles.banner} role="note"><Trans t={t} i18nKey="view.remoteContext" values={{ where: remote }} components={{ strong: <strong /> }} /></p>}
    {body}
  </div>
}

/** Why there is no list: no engine, a stopped daemon, or a socket this user may not use; it checks again by itself. */
function EngineProblem({ message, engines, loading, onRetry }: { message: string; engines: ContainerEngineInfo[]; loading: boolean; onRetry: () => void }): ReactElement {
  const { t } = useTranslation('pods')
  const stopped = engines.find(info => info.state === 'stopped' || info.state === 'denied')
  const missing = !stopped && engines.length > 0 && engines.every(info => info.state === 'missing')
  const linux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
  const heading = missing ? t('engine.missingTitle') : stopped?.state === 'denied' ? t('engine.deniedTitle') : stopped ? t('engine.stoppedTitle', { engine: stopped.engine === 'docker' ? 'Docker' : 'Podman' }) : t('engine.unavailableTitle')
  return <div className={styles.center}><ErrorState icon={<Boxes size={22} />} heading={2} title={heading} message={message}
    actions={<Button icon={<RefreshCw size={13} aria-hidden="true" />} loading={loading} onClick={onRetry}>{loading ? t('engine.checking') : t('engine.checkAgain')}</Button>}>
    {stopped?.state === 'denied' && <p><Trans t={t} i18nKey="engine.deniedFix" components={{ code: <code /> }} /></p>}
    {stopped?.state === 'stopped' && <p>{linux ? <Trans t={t} i18nKey="engine.startLinux" components={{ code: <code /> }} /> : stopped.engine === 'docker' ? t('engine.startDesktop') : <Trans t={t} i18nKey="engine.startPodman" components={{ code: <code /> }} />} {t('engine.checksAgain')}</p>}
    {missing && <p>{t('engine.install')}</p>}
  </ErrorState></div>
}
