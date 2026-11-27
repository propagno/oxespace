import { Suspense, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PlacesChanges, type PlacesSend } from './PlacesChanges'
import { placesBridge } from './placesModel'
import { lazyFrom } from '../../lib/chunk'
import { SHARED_PANEL_CHUNKS } from '../../lib/panelChunks'
import { useThreadToolTabs, type ThreadTabId } from './useThreadToolTabs'
import { Button } from '../../ui'

const ChangesPanel = lazyFrom(SHARED_PANEL_CHUNKS.changes, module => module.ChangesPanel)
const ActivityPanel = lazyFrom(SHARED_PANEL_CHUNKS.activity, module => module.ActivityPanel)
const ContainersPanel = lazyFrom(SHARED_PANEL_CHUNKS.containers, module => module.ContainersPanel)

export type { ThreadTabId }

const TAB_KEY = {
  conversation: 'threadTabs.conversation',
  queries: 'threadTabs.queries',
  containers: 'threadTabs.containers',
  changes: 'threadTabs.changes'
} as const satisfies Record<ThreadTabId, string>

export function ThreadToolTabs(props: {
  threadId: string
  workspaceId?: string
  rootPath?: string
  branch?: string
  activeTab?: ThreadTabId
  onOpen?: (tab: ThreadTabId) => void
  onSendToConversation?: PlacesSend
  trailing?: ReactNode
}): ReactElement {
  const { threadId, workspaceId, rootPath, branch, activeTab, onOpen, onSendToConversation, trailing } = props
  const { t } = useTranslation('thread')
  const base = useId()
  const entries = useThreadToolTabs(threadId)
  const [internalSelected, setInternalSelected] = useState<ThreadTabId>('conversation')
  const selected = activeTab ?? internalSelected

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
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const index = tabs.indexOf(tab)
    const next = event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[tabs.length - 1]
      : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    choose(next)
    document.getElementById(tabId(next))?.focus()
  }

  const pBridge = placesBridge()
  const hasPlaces = Boolean(pBridge?.places && pBridge.placeDiff)

  const content = current === 'changes' && workspaceId && rootPath
        ? (hasPlaces
            ? <PlacesChanges threadId={threadId} workspaceId={workspaceId} onSend={onSendToConversation} />
            : <Suspense fallback={null}><ChangesPanel workspaceId={workspaceId} rootPath={rootPath} onSendComments={onSendToConversation ? async text => (await onSendToConversation(text)) !== false : undefined} /></Suspense>)
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
              <Button
                key={entry.tab}
                id={tabId(entry.tab)}
                variant="ghost"
                size="sm"
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
              </Button>
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
