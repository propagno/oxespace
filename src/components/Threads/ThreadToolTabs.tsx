import { useEffect, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadToolTabEntry } from '../../../shared/types/ipc'
import { ThreadTerminalTab } from './ThreadTerminalTab'
import { PullRequestTab } from './PullRequestTab'

type TabId = ThreadToolTabEntry['tab']

interface ToolTabsBridge {
  thread?: {
    toolTabs?: (threadId: string) => Promise<ThreadToolTabEntry[] | null | undefined>
    onToolTabsChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
  }
}

const DEFAULT_TABS: ThreadToolTabEntry[] = [{ tab: 'conversation', count: null }]

const TAB_KEY = {
  conversation: 'threadTabs.conversation',
  terminal: 'threadTabs.terminal',
  queries: 'threadTabs.queries',
  network: 'threadTabs.network',
  containers: 'threadTabs.containers',
  changes: 'threadTabs.changes',
  pullRequest: 'threadTabs.pullRequest'
} as const satisfies Record<TabId, string>

function bridge(): ToolTabsBridge | undefined {
  return (window as unknown as { oxe?: ToolTabsBridge }).oxe
}

export function ThreadToolTabs(props: {
  threadId: string
  rootPath?: string
  branch?: string
  onOpen?: (tab: TabId) => void
  trailing?: ReactNode
}): ReactElement {
  const { threadId, rootPath, branch, onOpen, trailing } = props
  const { t } = useTranslation('thread')
  const base = useId()
  const [entries, setEntries] = useState<ThreadToolTabEntry[]>(DEFAULT_TABS)
  const [selected, setSelected] = useState<TabId>('conversation')

  useEffect(() => {
    const api = bridge()
    let alive = true
    const load = (): void => {
      if (!api?.thread?.toolTabs) return
      void api.thread.toolTabs(threadId).then(
        next => { if (alive && Array.isArray(next) && next.length > 0) setEntries(next) },
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
  const tabId = (tab: TabId): string => `${base}-tab-${tab}`
  const choose = (tab: TabId): void => {
    setSelected(tab)
    onOpen?.(tab)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, tab: TabId): void => {
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

  const content = current === 'terminal'
    ? <ThreadTerminalTab threadId={threadId} />
    : current === 'pullRequest' && rootPath && branch
      ? <PullRequestTab threadId={threadId} rootPath={rootPath} branch={branch} />
      : null

  return (
    <>
      <div className="thread-tabs-bar">
        <div role="tablist" className="thread-tabs" aria-label={t('threadTabs.label')}>
          {entries.map(entry => {
            const isSelected = entry.tab === current
            const showCount = typeof entry.count === 'number' && entry.tab !== 'pullRequest'
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
