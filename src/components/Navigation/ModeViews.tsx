import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { LoadingState } from '../../ui'
import type { AppView } from '../../keyboard/keybindings'

// OxeQuery (databases), OxePod (containers) and OxePost (API requests) are entirely lazy: nothing of them is in the entry chunk until first use.
const OxeQuerySidebar = lazy(() => import('../OxeQuery/OxeQuerySidebar').then(m => ({ default: m.OxeQuerySidebar })))
const OxeQueryView = lazy(() => import('../OxeQuery/OxeQueryView').then(m => ({ default: m.OxeQueryView })))
const OxePodSidebar = lazy(() => import('../OxePod/OxePodSidebar').then(m => ({ default: m.OxePodSidebar })))
const OxePodView = lazy(() => import('../OxePod/OxePodView').then(m => ({ default: m.OxePodView })))
const OxePostSidebar = lazy(() => import('../OxePost/OxePostSidebar').then(m => ({ default: m.OxePostSidebar })))
const OxePostView = lazy(() => import('../OxePost/OxePostView').then(m => ({ default: m.OxePostView })))

export type DataView = 'data' | 'pods' | 'post'
/** The views with their own lazy sidebar and work area, laid out alike. */
export const isDataView = (view: AppView): view is DataView => view === 'data' || view === 'pods' || view === 'post'

const NAMES: Record<DataView, string> = { data: 'OxeQuery', pods: 'OxePod', post: 'OxePost' }
const HOSTS: Record<DataView, string> = { data: 'oq-host', pods: 'pod-host', post: 'post-host' }
const ORDER: readonly DataView[] = ['data', 'pods', 'post']

export function DataSidebar({ view }: { view: DataView }): ReactElement {
  const { t } = useTranslation()
  return <Suspense fallback={<aside className="thread-navigation" aria-label={t('nav.viewSidebar', { name: NAMES[view] })} />}>{view === 'data' ? <OxeQuerySidebar /> : view === 'pods' ? <OxePodSidebar /> : <OxePostSidebar />}</Suspense>
}

/**
 * The work areas of OxeQuery, OxePod and OxePost. Each mounts the first time its view opens and then stays mounted
 * while hidden, so open connections, tabs, the selected container and the request being edited survive a trip to
 * another view.
 */
export function DataHosts({ view }: { view: AppView }): ReactElement {
  const { t } = useTranslation()
  const [opened, setOpened] = useState<DataView[]>([])
  if (isDataView(view) && !opened.includes(view)) setOpened([...opened, view])
  return <>{ORDER.filter(item => opened.includes(item) || item === view).map(item =>
    <div key={item} className={HOSTS[item]} style={{ display: view === item ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }} aria-hidden={view !== item}>
      <ErrorBoundary id="mode-view" component={NAMES[item]} label={NAMES[item]}><Suspense fallback={<LoadingState brand label={t('nav.loadingView', { name: NAMES[item] })} />}>
        {item === 'data' ? <OxeQueryView active={view === 'data'} /> : item === 'pods' ? <OxePodView active={view === 'pods'} /> : <OxePostView active={view === 'post'} />}
      </Suspense></ErrorBoundary>
    </div>)}</>
}

/**
 * The palette entries of OxeQuery, OxePod and OxePost register once their modules load, after the first paint; so
 * do the small bridges they talk through, which keeps all three out of the boot bundle. Choosing an entry opens its
 * view first, then lets the action find its control.
 */
export function useModeActions(select: (view: AppView) => void): void {
  const latest = useRef(select)
  useEffect(() => { latest.current = select })
  useEffect(() => {
    let cancelled = false
    let off: Array<() => void> = []
    void Promise.all([import('../OxeQuery/oxequery-bridge'), import('../OxePod/oxepod-bridge'), import('../OxePost/oxepost-bridge'), import('../OxeQuery/oxequery.commands'), import('../OxePod/oxepod.commands'), import('../OxePost/oxepost.commands')]).then(([query, pod, post]) => {
      if (cancelled) return
      off = [
        query.onOxeQueryAction(action => { latest.current('data'); query.performOxeQueryAction(action) }),
        pod.onOxePodAction(action => { latest.current('pods'); pod.performOxePodAction(action) }),
        post.onOxePostAction(action => { latest.current('post'); post.performOxePostAction(action) })
      ]
    })
    return () => { cancelled = true; off.forEach(stop => stop()) }
  }, [])
}
