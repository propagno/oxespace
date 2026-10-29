import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { EmptyState } from '../../ui'
import type { AppView } from '../../keyboard/keybindings'
import { onOxeQueryAction, performOxeQueryAction } from '../OxeQuery/oxequery-bridge'
import { onOxePodAction, performOxePodAction } from '../OxePod/oxepod-bridge'

// OxeQuery (databases) and OxePod (containers) are entirely lazy: nothing of either is in the entry chunk until first use.
const OxeQuerySidebar = lazy(() => import('../OxeQuery/OxeQuerySidebar').then(m => ({ default: m.OxeQuerySidebar })))
const OxeQueryView = lazy(() => import('../OxeQuery/OxeQueryView').then(m => ({ default: m.OxeQueryView })))
const OxePodSidebar = lazy(() => import('../OxePod/OxePodSidebar').then(m => ({ default: m.OxePodSidebar })))
const OxePodView = lazy(() => import('../OxePod/OxePodView').then(m => ({ default: m.OxePodView })))

export type DataView = 'data' | 'pods'
/** The views with their own lazy sidebar and work area, laid out alike. */
export const isDataView = (view: AppView): view is DataView => view === 'data' || view === 'pods'

const NAMES: Record<DataView, string> = { data: 'OxeQuery', pods: 'OxePod' }

export function DataSidebar({ view }: { view: DataView }): ReactElement {
  const { t } = useTranslation()
  return <Suspense fallback={<aside className="thread-navigation" aria-label={t('nav.viewSidebar', { name: NAMES[view] })} />}>{view === 'data' ? <OxeQuerySidebar /> : <OxePodSidebar />}</Suspense>
}

/**
 * The work areas of OxeQuery and OxePod. Each mounts the first time its view opens and then stays mounted while
 * hidden, so open connections, tabs and the selected container survive a trip to another view.
 */
export function DataHosts({ view }: { view: AppView }): ReactElement {
  const { t } = useTranslation()
  const [opened, setOpened] = useState<DataView[]>([])
  if (isDataView(view) && !opened.includes(view)) setOpened([...opened, view])
  return <>{(['data', 'pods'] as const).filter(item => opened.includes(item) || item === view).map(item =>
    <div key={item} className={item === 'data' ? 'oq-host' : 'pod-host'} style={{ display: view === item ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }} aria-hidden={view !== item}>
      <ErrorBoundary label={NAMES[item]}><Suspense fallback={<EmptyState compact title={t('nav.loadingView', { name: NAMES[item] })} />}>
        {item === 'data' ? <OxeQueryView active={view === 'data'} /> : <OxePodView active={view === 'pods'} />}
      </Suspense></ErrorBoundary>
    </div>)}</>
}

/**
 * The palette entries of OxeQuery and OxePod register once their modules load, after the first paint. Choosing one
 * opens its view first, then lets the action find its control.
 */
export function useModeActions(select: (view: AppView) => void): void {
  const latest = useRef(select)
  useEffect(() => { latest.current = select })
  useEffect(() => {
    void import('../OxeQuery/oxequery.commands')
    void import('../OxePod/oxepod.commands')
    const offQuery = onOxeQueryAction(action => { latest.current('data'); performOxeQueryAction(action) })
    const offPod = onOxePodAction(action => { latest.current('pods'); performOxePodAction(action) })
    return () => { offQuery(); offPod() }
  }, [])
}
