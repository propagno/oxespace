import { lazy, Suspense, useEffect, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadToolTabEntry } from '../../../shared/types/ipc'
import { PlacesChanges } from './PlacesChanges'
import { placesBridge } from './placesModel'

const ChangesPanel = lazy(() => import('../Changes/ChangesPanel').then(module => ({ default: module.ChangesPanel })))
const ActivityPanel = lazy(() => import('../OxeQuery/ActivityPanel').then(module => ({ default: module.ActivityPanel })))
const ContainersPanel = lazy(() => import('../Containers/ContainersPanel').then(module => ({ default: module.ContainersPanel })))

export type ThreadTabId = ThreadToolTabEntry['tab']

interface ToolTabsBridge {
  thread?: {
    toolTabs?: (threadId: string) => Promise<ThreadToolTabEntry[] | null | undefined>
    onToolTabsChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
  }
}

const DEFAULT_TABS: ThreadToolTabEntry[] = [{ tab: 'conversation', count: null }]

const TAB_KEY = {
  conversation: 'threadTabs.conversation',
  queries: 'threadTabs.queries',
  containers: 'threadTabs.containers',
  changes: 'threadTabs.changes'
} as const satisfies Record<ThreadTabId, string>

function bridge(): ToolTabsBridge | undefined {
  return (window as unknown as { oxe?: ToolTabsBridge }).oxe
}

export function ThreadToolTabs(props: {
  threadId: string
  workspaceId?: string
  rootPath?: string
  branch?: string
  activeTab?: ThreadTabId
  onOpen?: (tab: ThreadTabId) => void
  onSendToConversation?: (prompt: string) => void
  trailing?: ReactNode
}): ReactElement {
  const { threadId, workspaceId, rootPath, branch, activeTab, onOpen, onSendToConversation, trailing } = props
  const { t } = useTranslation('thread')
  const base = useId()
  const [entries, setEntries] = useState<ThreadToolTabEntry[]>(DEFAULT_TABS)
  const [internalSelected, setInternalSelected] = useState<ThreadTabId>('conversation')
  const selected = activeTab ?? internalSelected

  useEffect(() => {
    const api = bridge()
    let alive = true
    const load = (): void => {
      if (!api?.thread?.toolTabs) return
      void api.thread.toolTabs(threadId).then(
        // A tab this window doesn't know (one that left, from a main that still lists it) is not drawn.
        next => { if (alive && Array.isArray(next) && next.length > 0) setEntries(next.filter(entry => entry.tab in TAB_KEY)) },
        () => undefined
      )
    }
    load()
    const off = api?.thread?.onToolTabsChanged?.(event => {
      if (!event?.threadId || event.threadId === threadId) load()
    })
    return () => {
      alive = false
      off?.()
    }
  }, [threadId])

  const tabs = entries.map(entry => entry.tab)
  const current = tabs.includes(selected) ? selected : 'conversation'
  const tabId = (tab: ThreadTabId): string => `${base}-tab-${tab}`
  const choose = (tab: ThreadTabId): void => {
    setInternalSelected(tab)
    onOpen?.(tab)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, tab: ThreadTabId): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(tab)
      return
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.indexOf(tab)
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    choose(next)
    document.getElementById(tabId(next))?.focus()
  }

  const pBridge = placesBridge()
  const hasPlaces = Boolean(pBridge?.places && pBridge.placeDiff)

  const content = current === 'changes' && workspaceId && rootPath
        ? (hasPlaces
            ? <PlacesChanges threadId={threadId} workspaceId={workspaceId} onSend={onSendToConversation} />
            : <Suspense fallback={null}><ChangesPanel workspaceId={workspaceId} rootPath={rootPath} onSendComments={onSendToConversation ? text => { onSendToConversation(text); return true } : undefined} /></Suspense>)
        : current === 'queries' && workspaceId
          ? <Suspense fallback={null}><ActivityPanel active scope="database" /></Suspense>
          : current === 'containers' && workspaceId
              ? <Suspense fallback={null}><ContainersPanel /></Suspense>
              : null

  return (
    <>
      <div className="thread-tabs-bar">
        <div role="tablist" className="thread-tabs" aria-label={t('threadTabs.label')}>
          {entries.map(entry => {
            const isSelected = entry.tab === current
            const showCount = typeof entry.count === 'number'
            return (
              <button
                key={entry.tab}
                id={tabId(entry.tab)}
                type="button"
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-controls={isSelected && content ? `${base}-panel` : undefined}
                data-tab={entry.tab}
                onClick={() => choose(entry.tab)}
                onKeyDown={event => onKeyDown(event, entry.tab)}
              >
                <span>{t(TAB_KEY[entry.tab])}</span>
                {showCount && <span className="thread-tab-count">{` ${entry.count}`}</span>}
              </button>
            )
          })}
        </div>
        {trailing}
      </div>
      {content && (
        <div id={`${base}-panel`} role="tabpanel" className="thread-tab-panel" aria-labelledby={tabId(current)} tabIndex={0}>
          {content}
        </div>
      )}
    </>
  )
}
