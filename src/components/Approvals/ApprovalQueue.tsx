import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalDatabasePreview } from '../../../shared/types/approvals'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, Dialog } from '../../ui'
import { ImpactFacts, titleIncludesWhere } from './ImpactFacts'

const QUEUE_HOLD_MS = 1_200

export interface ApprovalQueueItem {
  request: ThreadRequest
  agent: string
  conversation: string
}

export interface ApprovalDecidedItem {
  id: string
  title: string
  agent: string
  outcome: string
}

interface ActiveAgentEntry {
  id: string
  title: string
  kind: 'thread' | 'pane' | 'delegated'
  workspaceId?: string | null
  paneId?: string
  threadId?: string
}

type AgentsBridge = {
  list?: () => Promise<unknown[]>
  overview?: () => Promise<{ items?: unknown[] }>
  onChanged?: (listener: () => void) => () => void
}

function normalizeActiveEntry(raw: unknown): ActiveAgentEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const status = typeof row.status === 'string' ? row.status : typeof row.state === 'string' ? row.state : 'working'
  if (status === 'idle' || status === 'done') return null
  const id = typeof row.id === 'string' ? row.id : ''
  const title = typeof row.title === 'string' ? row.title : ''
  if (!id || !title) return null
  const rawKind = typeof row.kind === 'string' ? row.kind : typeof row.source === 'string' ? row.source : 'thread'
  const kind: ActiveAgentEntry['kind'] = rawKind === 'pane' ? 'pane' : rawKind === 'delegated' || rawKind === 'delegation' ? 'delegated' : 'thread'
  return {
    id,
    title,
    kind,
    workspaceId: typeof row.workspaceId === 'string' ? row.workspaceId : null,
    paneId: typeof row.paneId === 'string' ? row.paneId : undefined,
    threadId: typeof row.threadId === 'string' ? row.threadId : kind === 'thread' ? id : undefined
  }
}

export function ApprovalQueue({
  items,
  decided,
  onRespond
}: {
  items: ApprovalQueueItem[]
  decided: ApprovalDecidedItem[]
  onRespond: (id: string, response: ThreadRequestResponse) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('thread')
  const sorted = useMemo(() => [...items].sort((a, b) => a.request.createdAt - b.request.createdAt), [items])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeAgents, setActiveAgents] = useState<ActiveAgentEntry[]>([])
  const [dbPreview, setDbPreview] = useState<{ id: string; data: ApprovalDatabasePreview } | null>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRespondRef = useRef(onRespond)

  useEffect(() => {
    onRespondRef.current = onRespond
  }, [onRespond])

  const selectedIndex = sorted.length === 0 ? -1 : Math.max(0, sorted.findIndex(item => item.request.id === selectedId))
  const selected = selectedIndex >= 0 ? sorted[selectedIndex] : null

  const clearHold = (): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }
  }, [selected?.request.id])

  useEffect(() => {
    let alive = true
    const bridge = (window as unknown as { oxe?: { agents?: AgentsBridge } }).oxe?.agents
    const loadAgents = async (): Promise<void> => {
      if (!bridge) {
        if (alive) setActiveAgents([])
        return
      }
      try {
        if (typeof bridge.list === 'function') {
          const rows = await bridge.list()
          if (alive) setActiveAgents((Array.isArray(rows) ? rows : []).map(normalizeActiveEntry).filter((item): item is ActiveAgentEntry => item !== null))
          return
        }
        if (typeof bridge.overview === 'function') {
          const overview = await bridge.overview()
          const rows = Array.isArray(overview?.items) ? overview.items : []
          if (alive) setActiveAgents(rows.map(normalizeActiveEntry).filter((item): item is ActiveAgentEntry => item !== null))
        }
      } catch {
        if (alive) setActiveAgents([])
      }
    }
    void loadAgents()
    const unsubscribe = bridge?.onChanged?.(() => {
      void loadAgents()
    })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  const selectedDbId = selected?.request.impact?.kind === 'db' ? selected.request.id : null
  useEffect(() => {
    if (!selectedDbId) return
    let alive = true
    const previewFn = window.oxe?.approvals?.preview
    if (typeof previewFn !== 'function') return
    void previewFn(selectedDbId)
      .then(data => {
        if (alive) setDbPreview({ id: selectedDbId, data })
      })
      .catch(() => {
        if (alive) setDbPreview({ id: selectedDbId, data: { status: 'failed', count: null, reason: 'unavailable' } })
      })
    return () => {
      alive = false
    }
  }, [selectedDbId])

  const startHold = (requestId: string): void => {
    clearHold()
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      void onRespondRef.current(requestId, { decision: 'accept' })
    }, QUEUE_HOLD_MS)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select')) return
    const lower = event.key.toLowerCase()
    if (lower === 'j' || event.key === 'ArrowDown') {
      if (sorted.length === 0) return
      event.preventDefault()
      clearHold()
      const nextIndex = Math.min(sorted.length - 1, selectedIndex + 1)
      setSelectedId(sorted[nextIndex].request.id)
      return
    }
    if (lower === 'k' || event.key === 'ArrowUp') {
      if (sorted.length === 0) return
      event.preventDefault()
      clearHold()
      const prevIndex = Math.max(0, selectedIndex - 1)
      setSelectedId(sorted[prevIndex].request.id)
      return
    }
    if (lower === 'd' && selected) {
      event.preventDefault()
      clearHold()
      void onRespond(selected.request.id, { decision: 'decline' })
      return
    }
    if (lower === 'a' && selected) {
      event.preventDefault()
      if (event.repeat) return
      const impact = selected.request.impact
      if (impact?.reversible) {
        void onRespond(selected.request.id, { decision: 'accept' })
        return
      }
      if (impact?.risk === 'critical') {
        startHold(selected.request.id)
        return
      }
      approveRef.current?.focus()
    }
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key.toLowerCase() === 'a') {
      clearHold()
    }
  }

  const openActiveAgent = (entry: ActiveAgentEntry): void => {
    if (entry.kind === 'pane' && entry.workspaceId) {
      void useWorkspaceStore.getState().setActiveWorkspace(entry.workspaceId)
      if (entry.paneId) useUIStore.getState().setActivePane(entry.paneId)
      return
    }
    if (entry.threadId) {
      void useThreadStore.getState().select(entry.threadId)
    }
  }

  const currentDbPreview = selectedDbId && dbPreview?.id === selectedDbId ? dbPreview.data : null

  return (
    <div
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)', gap: 'var(--space-4)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {sorted.length > 0 ? (
          <div
            role="listbox"
            tabIndex={0}
            aria-label={t('f7.queue.listLabel')}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
          >
            {sorted.map((item, index) => {
              const isSelected = index === selectedIndex
              const impact = item.request.impact
              const showWhere = Boolean(impact?.where && !titleIncludesWhere(item.request.title, impact.where))
              const showSub = Boolean(impact?.whereSub && !titleIncludesWhere(item.request.title, impact.whereSub))
              const meta = [
                item.agent,
                item.conversation,
                ...(showWhere && impact?.where ? [impact.where] : []),
                ...(showSub && impact?.whereSub ? [impact.whereSub] : [])
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  key={item.request.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    clearHold()
                    setSelectedId(item.request.id)
                  }}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                    background: isSelected ? 'var(--surface-selected)' : 'var(--surface-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.request.title}</div>
                  {meta ? <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{meta}</div> : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('f7.queue.allClear')}</p>
        )}

        <section aria-label={t('f7.queue.decidedToday')}>
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)' }}>{t('f7.queue.decidedToday')}</h3>
          {decided.length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{t('f7.queue.noDecided')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {decided.map(entry => (
                <li key={entry.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  <span>{entry.title}</span>
                  <span>{` · ${entry.agent} · ${entry.outcome}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t('f7.queue.activeHeading', { count: activeAgents.length })}>
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)' }}>
            {t('f7.queue.activeHeading', { count: activeAgents.length })}
          </h3>
          {activeAgents.length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{t('f7.queue.noActive')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {activeAgents.map(entry => (
                <li key={`${entry.kind}:${entry.id}`}>
                  <div
                    onClick={() => openActiveAgent(entry)}
                    style={{ fontSize: 'var(--text-xs)', cursor: 'pointer' }}
                  >
                    {entry.title}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selected ? (
        <section
          aria-label={t('f7.queue.previewLabel')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)'
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              {t('f7.preview.context', { agent: selected.agent, conversation: selected.conversation })}
            </div>
            <h3 style={{ margin: 'var(--space-1) 0 0' }}>{selected.request.title}</h3>
          </div>
          {selected.request.impact?.why ? <p style={{ margin: 0 }}>{selected.request.impact.why}</p> : null}
          {selected.request.impact ? (
            <ImpactFacts
              impact={selected.request.impact}
              layout="grid"
              countOverride={selected.request.impact.kind === 'db' && currentDbPreview ? currentDbPreview.count : undefined}
            />
          ) : null}
          {selected.request.impact ? (
            <pre style={{ margin: 0, padding: 'var(--space-2)', overflowX: 'auto', background: 'var(--surface-secondary)', borderRadius: 'var(--radius-sm)' }}>
              <code>{selected.request.impact.text}</code>
            </pre>
          ) : null}
          <footer style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'auto' }}>
            <Button variant="secondary" onClick={() => void onRespond(selected.request.id, { decision: 'decline' })}>
              {t('request.deny')}
            </Button>
            {selected.request.impact?.risk === 'critical' && !selected.request.impact.reversible ? (
              <Button
                variant="danger"
                onPointerDown={() => startHold(selected.request.id)}
                onPointerUp={clearHold}
                onPointerCancel={clearHold}
                onPointerLeave={clearHold}
              >
                {t('f7.preview.holdToApprove')}
              </Button>
            ) : (
              <Button
                ref={approveRef}
                variant="primary"
                onClick={() => void onRespond(selected.request.id, { decision: 'accept' })}
              >
                {t('request.approve')}
              </Button>
            )}
          </footer>
        </section>
      ) : null}
    </div>
  )
}

export function ApprovalQueueModal({ onClose }: { onClose: () => void }): ReactElement {
  const { t: tCommon } = useTranslation('common')
  const { t: tThread } = useTranslation('thread')
  const snapshot = useThreadStore(state => state.snapshot)
  const snapshotCache = useThreadStore(state => state.snapshotCache)

  const { items, decided, threadById } = useMemo(() => {
    const snapshots = new Map<string, NonNullable<typeof snapshot>>()
    for (const entry of Object.values(snapshotCache)) snapshots.set(entry.thread.id, entry)
    if (snapshot) snapshots.set(snapshot.thread.id, snapshot)
    const pendingItems: ApprovalQueueItem[] = []
    const decidedItems: ApprovalDecidedItem[] = []
    const ownerMap = new Map<string, string>()
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const since = midnight.getTime()
    for (const snap of snapshots.values()) {
      const agent = snap.thread.provider === 'codex' ? 'Codex' : snap.thread.provider === 'claude' ? 'Claude' : tThread('f7.card.defaultAgent')
      const conversation = snap.thread.title || tThread('notify.untitled')
      for (const event of snap.events) {
        if (event.type !== 'request' || event.request.kind !== 'approval') continue
        if (event.request.state === 'pending') {
          ownerMap.set(event.request.id, snap.thread.id)
          pendingItems.push({ request: event.request, agent, conversation })
        } else if ((event.request.resolvedAt ?? 0) >= since) {
          decidedItems.push({
            id: event.request.id,
            title: event.request.title,
            agent,
            outcome: event.request.resolution ?? event.request.state
          })
        }
      }
    }
    return { items: pendingItems, decided: decidedItems, threadById: ownerMap }
  }, [snapshot, snapshotCache, tThread])

  return (
    <Dialog size="xl" title={tCommon('approvals.queueDialogTitle')} onClose={onClose}>
      <ApprovalQueue
        items={items}
        decided={decided}
        onRespond={async (requestId, response) => {
          const threadId = threadById.get(requestId)
          if (!threadId || !window.oxe?.thread?.respond) return
          await window.oxe.thread.respond(threadId, requestId, response)
          await useThreadStore.getState().refresh(threadId)
        }}
      />
    </Dialog>
  )
}
