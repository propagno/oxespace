import { useEffect, useState } from 'react'
import type { ThreadToolTabEntry } from '../../../shared/types/ipc'

export type ThreadTabId = ThreadToolTabEntry['tab']

interface ToolTabsBridge {
  thread?: {
    toolTabs?: (threadId: string) => Promise<ThreadToolTabEntry[] | null | undefined>
    onToolTabsChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
  }
}

/** The tabs this window knows how to draw; one main lists and this window doesn't is left out. */
export const KNOWN_TOOL_TABS: readonly ThreadTabId[] = ['conversation', 'queries', 'containers', 'changes']

const DEFAULT_TABS: ThreadToolTabEntry[] = [{ tab: 'conversation', count: null }]

/**
 * The conversation's tool tabs as main reports them (thread:toolTabs), read again on every thread:toolTabsChanged push
 * for this conversation. Since OXC-4 the conversation draws no tab row: its Queries and Containers open from the header's
 * Mais painéis when main lists them.
 */
export function useThreadToolTabs(threadId: string | undefined): ThreadToolTabEntry[] {
  const [entries, setEntries] = useState<{ threadId: string; tabs: ThreadToolTabEntry[] } | null>(null)
  useEffect(() => {
    if (!threadId) return
    const api = (window as unknown as { oxe?: ToolTabsBridge }).oxe
    let alive = true
    const load = (): void => {
      if (!api?.thread?.toolTabs) return
      void api.thread.toolTabs(threadId).then(
        next => { if (alive && Array.isArray(next) && next.length > 0) setEntries({ threadId, tabs: next.filter(entry => KNOWN_TOOL_TABS.includes(entry.tab)) }) },
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
  return entries && entries.threadId === threadId ? entries.tabs : DEFAULT_TABS
}
