import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemotePaneConversationPage, RemoteThreadItem } from '../../../shared/remote/protocol'
import type { PaneConversationPageResult } from '../../../shared/types/ipc'
import { Button, Notice, cx } from '../../ui'
import { ThreadMarkdown } from '../Threads/ThreadMarkdown'
import styles from './PaneConversationView.module.css'

type Entry = { seq: number; item: RemoteThreadItem }

function isErrorResult(
  result: PaneConversationPageResult | null | undefined
): result is { error: 'no-conversation' } | { error: 'conversation-changed'; reason?: 'new-session' | 'rewritten' } {
  return Boolean(result && typeof result === 'object' && 'error' in result)
}

function dedupeEntries(entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const entry of entries) {
    const id = entry?.item?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(entry)
  }
  return out
}

function mergeLiveEntries(held: readonly Entry[], incoming: readonly Entry[]): { entries: Entry[]; gap: boolean } {
  if (held.length === 0) return { entries: dedupeEntries(incoming), gap: false }
  const incomingIds = new Set(incoming.map((entry) => entry.item.id))
  const shared = held.some((entry) => incomingIds.has(entry.item.id))
  if (!shared) {
    return { entries: dedupeEntries(incoming), gap: incoming.length > 0 }
  }
  return { entries: dedupeEntries([...held, ...incoming]), gap: false }
}

export function PaneConversationView(props: {
  paneId: string
  onShowScreen: () => void
  onTypeInTerminal: () => void
}): ReactElement {
  const { paneId, onShowScreen, onTypeInTerminal } = props
  const { t: tc } = useTranslation('code')
  const { t: tm } = useTranslation('mobile')
  useEffect(() => { void window.oxe?.featureUsage?.record?.('paneConversation') }, [])

  const [entries, setEntries] = useState<Entry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [newConversationMarked, setNewConversationMarked] = useState(false)
  const [hasGap, setHasGap] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const epochRef = useRef<number | null>(null)
  const entriesRef = useRef<Entry[]>([])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)

  const applyPage = useCallback((page: RemotePaneConversationPage, mode: 'initial' | 'live' | 'older') => {
    setUnavailable(false)
    if (mode === 'initial') {
      epochRef.current = page.epoch
      const next = dedupeEntries(page.items)
      entriesRef.current = next
      setEntries(next)
      setCursor(page.cursor)
      setNewConversationMarked(false)
      setHasGap(false)
      return
    }
    if (mode === 'older') {
      const next = dedupeEntries([...page.items, ...entriesRef.current])
      entriesRef.current = next
      setEntries(next)
      setCursor(page.cursor)
      return
    }
    // Live update: check epoch change vs same-epoch merge/gap.
    if (epochRef.current !== null && page.epoch !== epochRef.current) {
      epochRef.current = page.epoch
      const next = dedupeEntries(page.items)
      entriesRef.current = next
      setEntries(next)
      setCursor(page.cursor)
      setNewConversationMarked(true)
      setHasGap(false)
      return
    }
    epochRef.current = page.epoch
    const merged = mergeLiveEntries(entriesRef.current, page.items)
    entriesRef.current = merged.entries
    setEntries(merged.entries)
    if (merged.gap) {
      setCursor(page.cursor)
      setHasGap(true)
    }
  }, [])

  const loadNewest = useCallback(
    async (mode: 'initial' | 'live', allowRewriteRetry: boolean): Promise<void> => {
      const api = window.oxe?.paneConversation
      if (!api?.page) {
        if (mountedRef.current) setUnavailable(true)
        return
      }
      try {
        const result = await api.page({ paneId })
        if (!mountedRef.current) return
        if (isErrorResult(result)) {
          if (result.error === 'conversation-changed' && allowRewriteRetry) {
            await loadNewest('initial', false)
            return
          }
          setUnavailable(true)
          return
        }
        applyPage(result, mode)
      } catch {
        if (mountedRef.current) setUnavailable(true)
      }
    },
    [applyPage, paneId]
  )

  useEffect(() => {
    mountedRef.current = true
    epochRef.current = null
    entriesRef.current = []
    setEntries([])
    setCursor(null)
    setUnavailable(false)
    setNewConversationMarked(false)
    setHasGap(false)

    const api = window.oxe?.paneConversation
    void loadNewest('initial', true)
    void api?.watch?.(paneId)?.catch(() => {})
    const unsubscribe = api?.onChanged?.((event) => {
      if (event?.paneId === paneId) {
        void loadNewest('live', true)
      }
    })

    return () => {
      mountedRef.current = false
      unsubscribe?.()
      void api?.unwatch?.(paneId)?.catch(() => {})
    }
  }, [loadNewest, paneId])

  const handleLoadEarlier = async (): Promise<void> => {
    if (!cursor || loadingOlder) return
    const api = window.oxe?.paneConversation
    if (!api?.page) return
    setLoadingOlder(true)
    try {
      const result = await api.page({ paneId, cursor })
      if (!mountedRef.current) return
      if (isErrorResult(result)) {
        if (result.error === 'conversation-changed') {
          await loadNewest('initial', false)
        } else {
          setUnavailable(true)
        }
        return
      }
      applyPage(result, 'older')
    } finally {
      if (mountedRef.current) setLoadingOlder(false)
    }
  }

  const messages = entries.filter(
    (entry): entry is { seq: number; item: Extract<RemoteThreadItem, { type: 'message' }> } =>
      entry.item.type === 'message'
  )

  return (
    <div className={styles.root} data-testid="pane-conversation-view">
      <div className={styles.bar}>
        <div className={styles.badges}>
          <span className={styles.badge}>{tc('pane.conversation.readOnly')}</span>
          {!unavailable && <span className={styles.badge}>{tc('pane.conversation.live')}</span>}
        </div>
        {hasGap && !unavailable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setHasGap(false)
              scrollerRef.current?.scrollTo?.({ top: scrollerRef.current.scrollHeight })
            }}
          >
            {tc('pane.conversation.latest')}
          </Button>
        )}
      </div>

      <div className={styles.scroller} ref={scrollerRef}>
        {unavailable ? (
          <Notice
            intent="info"
            actions={
              <Button size="sm" variant="ghost" onClick={onShowScreen}>
                {tm('terminal.conversation.showScreen')}
              </Button>
            }
          >
            {tm('terminal.conversation.unavailable')}
          </Notice>
        ) : (
          <>
            {cursor !== null && (
              <div>
                <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void handleLoadEarlier()}>
                  {tm('thread.loadOlder')}
                </Button>
              </div>
            )}
            {newConversationMarked && (
              <div className={styles.marker} role="status">
                {tm('terminal.conversation.newConversation')}
              </div>
            )}
            {messages.length === 0 ? (
              <p className={styles.placeholder}>{tm('terminal.conversation.empty')}</p>
            ) : (
              messages.map((entry) => (
                <article
                  key={entry.item.id}
                  className={cx(styles.bubble, entry.item.role === 'user' ? styles.user : styles.assistant)}
                  data-role={entry.item.role}
                >
                  {/* The same Markdown as OxeChat: the reader showed the raw text, backticks and all (user report, 13/11). */}
                  <ThreadMarkdown text={entry.item.text} />
                </article>
              ))
            )}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <Button size="sm" variant="ghost" onClick={onTypeInTerminal}>
          {tc('pane.conversation.typeInTerminal')}
        </Button>
      </div>
    </div>
  )
}
