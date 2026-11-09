import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { isUnderPlace, visibleThreadTabs, type ThreadTabId, type ThreadTabsState } from './threadTabs'

// On a case-insensitive file system (Windows, macOS) an import of './threadTabs' by extension order can land here.
export { visibleThreadTabs } from './threadTabs'

interface PlaceLike { path?: string; files?: unknown[] }
interface ContainerLike { labels?: Record<string, string> }
interface ThreadTabsBridge {
  thread?: {
    places?: (threadId: string) => Promise<{ places?: PlaceLike[] } | null | undefined>
    panes?: (threadId: string) => Promise<unknown[] | null | undefined>
    onPlacesChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
  }
  httpAudit?: { list?: (input: { threadId: string }) => Promise<{ rows?: unknown[] } | null | undefined> }
  pullRequest?: { state?: (threadId: string) => Promise<{ pr?: unknown } | null | undefined> }
  oxePod?: {
    call?: (op: string, input?: unknown) => Promise<{ ok?: boolean; value?: { containers?: ContainerLike[] } | null } | null | undefined>
    onEvent?: (listener: (event: { type?: string } | undefined) => void) => () => void
  }
}

function bridge(): ThreadTabsBridge | undefined {
  return (window as unknown as { oxe?: ThreadTabsBridge }).oxe
}

const WORKING_DIR = 'com.docker.compose.project.working_dir'
const EMPTY: ThreadTabsState = { changedFiles: 0, panes: 0, composePlace: false, httpCalls: 0, pullRequest: false, done: false }
const TAB_KEY = {
  conversation: 'threadTabs.conversation', changes: 'threadTabs.changes', terminal: 'threadTabs.terminal',
  containers: 'threadTabs.containers', network: 'threadTabs.network', 'pull-request': 'threadTabs.pullRequest'
} as const satisfies Record<ThreadTabId, string>

async function safe<T>(read: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (!read) return undefined
  try { return await read() } catch { return undefined }
}

async function readState(threadId: string): Promise<ThreadTabsState> {
  const api = bridge()
  const windows = typeof navigator !== 'undefined' && /^win/i.test(navigator.platform)
  const [places, panes, http, pr, pod] = await Promise.all([
    safe(api?.thread?.places ? () => api.thread!.places!(threadId) : undefined),
    safe(api?.thread?.panes ? () => api.thread!.panes!(threadId) : undefined),
    safe(api?.httpAudit?.list ? () => api.httpAudit!.list!({ threadId }) : undefined),
    safe(api?.pullRequest?.state ? () => api.pullRequest!.state!(threadId) : undefined),
    safe(api?.oxePod?.call ? () => api.oxePod!.call!('containers.list') : undefined)
  ])
  const placeList = places?.places ?? []
  const containers = pod?.ok ? pod.value?.containers ?? [] : []
  const composePlace = containers.some(container => {
    const folder = container.labels?.[WORKING_DIR]
    return !!folder && placeList.some(place => !!place.path && isUnderPlace(folder, place.path, windows))
  })
  return {
    changedFiles: placeList.reduce((sum, place) => sum + (Array.isArray(place.files) ? place.files.length : 0), 0),
    panes: Array.isArray(panes) ? panes.length : 0,
    composePlace,
    httpCalls: Array.isArray(http?.rows) ? http.rows.length : 0,
    pullRequest: !!pr?.pr,
    done: false
  }
}

/** The conversation's tabs (DESIGN U4.8): each one fills in once main reports something for it, without a reload. */
export function ThreadTabs(props: { threadId: string }): ReactElement {
  const { threadId } = props
  const { t } = useTranslation('thread')
  const [state, setState] = useState<ThreadTabsState>(EMPTY)
  const [selected, setSelected] = useState<ThreadTabId>('conversation')

  useEffect(() => {
    const api = bridge()
    let alive = true
    const read = (): void => { void readState(threadId).then(next => { if (alive) setState(next) }) }
    setState(EMPTY)
    read()
    const offPlaces = api?.thread?.onPlacesChanged?.(event => { if (!event?.threadId || event.threadId === threadId) read() })
    const offPod = api?.oxePod?.onEvent?.(event => { if (event?.type === 'containers-changed') read() })
    return () => { alive = false; offPlaces?.(); offPod?.() }
  }, [threadId])

  const tabs = visibleThreadTabs(state)
  const current = tabs.includes(selected) ? selected : 'conversation'
  return (
    <div role="tablist" className="thread-tabs" aria-label={t('threadTabs.label')}>
      {tabs.map(tab => (
        <div key={tab} role="tab" tabIndex={tab === current ? 0 : -1} aria-selected={tab === current} data-tab={tab}
          onClick={() => setSelected(tab)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(tab) } }}>
          {t(TAB_KEY[tab])}
        </div>
      ))}
    </div>
  )
}
