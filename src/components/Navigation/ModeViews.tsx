import { Suspense, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { LoadingState, SidebarSkeleton } from '../../ui'
import type { AppView } from '../../keyboard/keybindings'
import { useUIStore } from '../../store/ui.store'
import { scheduleIdle } from '../../lib/preloadSchedule'
import { chunk, lazyFrom } from '../../lib/chunk'

/**
 * Thread, OxeQuery (databases), OxePod (containers) and OxePost (API requests) are entirely lazy: nothing of them is in
 * the entry chunk until first use. Each view's sidebar and work area are one chunk pair requested together, so they
 * reveal in one commit; the idle preload (src/lib/idlePreload.ts) loads the same pairs.
 */
export const VIEW_CHUNKS = {
  thread: chunk(() => Promise.all([import('../Threads/ThreadSidebar'), import('../Threads/ThreadGrid')])),
  data: chunk(() => Promise.all([import('../OxeQuery/OxeQuerySidebar'), import('../OxeQuery/OxeQueryView')])),
  pods: chunk(() => Promise.all([import('../OxePod/OxePodSidebar'), import('../OxePod/OxePodView')])),
  post: chunk(() => Promise.all([import('../OxePost/OxePostSidebar'), import('../OxePost/OxePostView')]))
}
export const ThreadSidebar = lazyFrom(VIEW_CHUNKS.thread, ([sidebar]) => sidebar.ThreadSidebar)
export const ThreadGrid = lazyFrom(VIEW_CHUNKS.thread, ([, grid]) => grid.ThreadGrid)
const OxeQuerySidebar = lazyFrom(VIEW_CHUNKS.data, ([sidebar]) => sidebar.OxeQuerySidebar)
const OxeQueryView = lazyFrom(VIEW_CHUNKS.data, ([, view]) => view.OxeQueryView)
const OxePodSidebar = lazyFrom(VIEW_CHUNKS.pods, ([sidebar]) => sidebar.OxePodSidebar)
const OxePodView = lazyFrom(VIEW_CHUNKS.pods, ([, view]) => view.OxePodView)
const OxePostSidebar = lazyFrom(VIEW_CHUNKS.post, ([sidebar]) => sidebar.OxePostSidebar)
const OxePostView = lazyFrom(VIEW_CHUNKS.post, ([, view]) => view.OxePostView)

export type DataView = 'data' | 'pods' | 'post'
/** The views with their own lazy sidebar and work area, laid out alike. */
export const isDataView = (view: AppView): view is DataView => view === 'data' || view === 'pods' || view === 'post'

const NAMES: Record<DataView, string> = { data: 'OxeQuery', pods: 'OxePod', post: 'OxePost' }
const HOSTS: Record<DataView, string> = { data: 'oq-host', pods: 'pod-host', post: 'post-host' }
const ORDER: readonly DataView[] = ['data', 'pods', 'post']

/** What a lazy view's sidebar shows while its chunk loads: the same frame and header, with placeholder rows. */
export function ViewSidebarSkeleton({ view }: { view: DataView | 'thread' }): ReactElement {
  const { t } = useTranslation()
  const { t: tt } = useTranslation('thread')
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  return view === 'thread'
    ? <SidebarSkeleton label={tt('sidebar.region')} title={tt('sidebar.conversations')} collapsed={collapsed} />
    : <SidebarSkeleton label={t('nav.viewSidebar', { name: NAMES[view] })} title={NAMES[view]} collapsed={collapsed} />
}

const SIDEBARS = { data: OxeQuerySidebar, pods: OxePodSidebar, post: OxePostSidebar }
const VIEWS = { data: OxeQueryView, pods: OxePodView, post: OxePostView }

/** A view's sidebar: a chunk that fails to load shows its error here, with Try again, and leaves the window alone. */
/** The Thread sidebar's frame while its chunk loads or fails: the skeleton, and an error that stays in the sidebar. */
export function ThreadSidebarBoundary({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation('thread')
  return <ErrorBoundary id="sidebar" component="ThreadSidebar" compact label={t('sidebar.conversations')} onReset={ThreadSidebar.retry}>
    <Suspense fallback={<ViewSidebarSkeleton view="thread" />}>{children}</Suspense>
  </ErrorBoundary>
}

export function DataSidebar({ view }: { view: DataView }): ReactElement {
  const Sidebar = SIDEBARS[view]
  return <ErrorBoundary id="sidebar" component={NAMES[view]} compact label={NAMES[view]} onReset={Sidebar.retry}>
    <Suspense fallback={<ViewSidebarSkeleton view={view} />}><Sidebar /></Suspense>
  </ErrorBoundary>
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
  // Every start shows Code first; only the views the person switches to count as the most recent one.
  const initial = useRef<AppView | null>(view)
  useEffect(() => { if (view === initial.current) return; initial.current = null; void import('../../lib/idlePreload').then(m => m.rememberView(view)).catch(() => undefined) }, [view])
  return <>{ORDER.filter(item => opened.includes(item) || item === view).map(item =>
    <div key={item} className={HOSTS[item]} style={{ display: view === item ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }} aria-hidden={view !== item}>
      <ErrorBoundary id="mode-view" component={NAMES[item]} label={NAMES[item]} onReset={VIEWS[item].retry}><Suspense fallback={<LoadingState brand label={t('nav.loadingView', { name: NAMES[item] })} />}>
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
  useIdlePreload()
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

/**
 * Once the window is idle after its first paint, warms up the chunks of the view used most recently and Settings
 * (src/lib/idlePreload.ts decides, and skips on battery or low memory). Cancelled when the app unmounts.
 */
function useIdlePreload(): void {
  useEffect(() => {
    let cancelled = false
    const cancel = scheduleIdle(() => { void import('../../lib/idlePreload').then(m => m.runIdlePreload(() => cancelled)).catch(() => undefined) })
    return () => { cancelled = true; cancel() }
  }, [])
}
