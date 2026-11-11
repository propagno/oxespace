import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Sun, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ApprovalDatabasePreview, ApprovalRequest } from '../../../shared/types/approvals'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, Checkbox, Dialog, EmptyState, IconButton, Notice } from '../../ui'
import { useModalSurface } from '../../ui/useModalSurface'
import { formatNumber } from '../../utils/formatTime'
import { AlwaysAllowConfirm, clearAlwaysAllowToast, showAlwaysAllowToast } from './AlwaysAllowConfirm'
import { approvalsApi } from './approvalsApi'
import { useApprovalsStore } from './approvals.store'
import { formatMainMessage, requesterText } from './approvalText'
import sharedStyles from './Approvals.module.css'
import styles from './ApprovalQueue.module.css'
import { ImpactFacts, titleIncludesWhere } from './ImpactFacts'
import { formatPreviewCell, isChangedPreviewCell } from './ImpactPreview'

const QUEUE_HOLD_MS = 1_200

export interface ApprovalQueueItem {
  request: ThreadRequest
  agent: string
  conversation: string
  threadId?: string
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

function paneRequestToQueueItem(req: ApprovalRequest, fallbackAgent: string): ApprovalQueueItem {
  const reversible = req.risk === 'low'
  const kind = req.kind === 'oxequery' ? 'db' : req.kind === 'policyChange' ? 'file' : 'command'
  const title = formatMainMessage(req.title)
  const summary = formatMainMessage(req.summary)
  const agent = requesterText(req.requester) || fallbackAgent
  const text = req.agentText.text || summary
  return {
    agent,
    conversation: req.target || req.environment?.name || 'OxeCode',
    request: {
      id: req.id,
      nativeId: req.id,
      nativeMethod: req.kind,
      kind: 'approval',
      title,
      command: text,
      detail: summary,
      generation: req.generation,
      createdAt: req.createdAt,
      state: 'pending',
      availableDecisions: ['accept', 'decline'],
      impact: {
        why: summary,
        where: req.environment?.name || req.target || 'workspace',
        whereSub: req.environment?.production ? 'production' : req.environment?.kind,
        affects: { count: null, unit: kind === 'db' ? 'rows' : kind === 'file' ? 'files' : 'resources' },
        reversible,
        risk: req.risk,
        kind,
        text,
        lang: kind === 'db' ? 'sql' : 'shell'
      }
    }
  }
}

export function ApprovalQueue({
  items,
  decided,
  onRespond,
  onOpenTask,
  onOpenRules,
  headingId,
  initialSelectedId
}: {
  items: ApprovalQueueItem[]
  decided: ApprovalDecidedItem[]
  onRespond: (id: string, response: ThreadRequestResponse) => Promise<void>
  onOpenTask?: (item: ApprovalQueueItem) => void
  onOpenRules?: () => void
  headingId?: string
  initialSelectedId?: string | null
}): ReactElement {
  const { t } = useTranslation('thread')
  const sorted = useMemo(() => [...items].sort((a, b) => a.request.createdAt - b.request.createdAt), [items])
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null)
  const [activeAgents, setActiveAgents] = useState<ActiveAgentEntry[]>([])
  const [dbPreview, setDbPreview] = useState<{ id: string; data: ApprovalDatabasePreview } | null>(null)
  const [alwaysAllowOpen, setAlwaysAllowOpen] = useState(false)
  const [savingRule, setSavingRule] = useState(false)
  const [withoutHoldOpen, setWithoutHoldOpen] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const listboxRef = useRef<HTMLDivElement>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const withoutHoldCancelRef = useRef<HTMLButtonElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRespondRef = useRef(onRespond)

  useEffect(() => {
    onRespondRef.current = onRespond
  }, [onRespond])

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId)
  }, [initialSelectedId])

  useEffect(() => {
    if (!withoutHoldOpen) return
    withoutHoldCancelRef.current?.focus({ preventScroll: true })
  }, [withoutHoldOpen])

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
    void window.oxe?.featureUsage?.record?.('approvalsQueue')
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
    if (event.ctrlKey || event.metaKey || event.altKey || withoutHoldOpen) return
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
  const selectedImpact = selected?.request.impact
  const selectedOffer = selected?.request.alwaysAllow
  const isCriticalIrreversible = Boolean(selectedImpact && !selectedImpact.reversible && selectedImpact.risk === 'critical')

  const confirmAlwaysAllow = async (): Promise<void> => {
    if (!selected || !selectedImpact || savingRule) return
    setSavingRule(true)
    try {
      const res = await window.oxe?.approvals?.alwaysAllow?.(selected.request.id)
      setAlwaysAllowOpen(false)
      if (!res?.ok) {
        clearAlwaysAllowToast()
        return
      }
      await onRespond(selected.request.id, { decision: 'accept' })
      showAlwaysAllowToast(
        t('f7.alwaysAllow.toastAdded', { command: selectedImpact.text }),
        t('f7.alwaysAllow.toastOpen'),
        () => useUIStore.getState().openSettingsPage('agent-permissions')
      )
    } finally {
      setSavingRule(false)
    }
  }

  const closeWithoutHold = (): void => {
    setWithoutHoldOpen(false)
    setUnderstood(false)
  }

  return (
    <div
      className={styles.queue}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div className={styles.left}>
        <header className={styles.leftHeader}>
          <h2 id={headingId} className={styles.heading}>{t('f7.queue.heading')}</h2>
          <p className={styles.subtitle}>
            {sorted.length > 0
              ? t('f7.queue.subtitle', { count: sorted.length })
              : t('f7.queue.subtitleClear')}
          </p>
        </header>

        {sorted.length > 0 ? (
          <div
            ref={listboxRef}
            role="listbox"
            tabIndex={0}
            aria-label={t('f7.queue.listLabel')}
            className={styles.listbox}
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
                  className={styles.option}
                  onClick={() => {
                    clearHold()
                    setSelectedId(item.request.id)
                  }}
                >
                  <div className={styles.optionHead}>
                    <Sun size={13} aria-hidden="true" className={styles.optionGlyph} />
                    <span className={styles.optionTitle}>{item.request.title}</span>
                  </div>
                  {meta ? <div className={styles.optionMeta}>{meta}</div> : null}
                </div>
              )
            })}
          </div>
        ) : null}

        <section aria-label={t('f7.queue.decidedToday')} className={styles.section}>
          <h3 className={styles.sectionHeading}>{t('f7.queue.decidedToday')}</h3>
          {decided.length === 0 ? (
            <p className={styles.emptyLine}>{t('f7.queue.noDecided')}</p>
          ) : (
            <ul className={styles.list}>
              {decided.map(entry => (
                <li key={entry.id} className={styles.decidedRow}>
                  <span className={styles.decidedTitle}>{entry.title}</span>
                  <span>{` · ${entry.agent} · ${entry.outcome}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t('f7.queue.activeHeading', { count: activeAgents.length })} className={styles.section}>
          <h3 className={styles.sectionHeading}>
            {t('f7.queue.activeHeading', { count: activeAgents.length })}
          </h3>
          {activeAgents.length === 0 ? (
            <p className={styles.emptyLine}>{t('f7.queue.noActive')}</p>
          ) : (
            <ul className={styles.list}>
              {activeAgents.map(entry => (
                <li key={`${entry.kind}:${entry.id}`}>
                  <div
                    className={styles.activeRow}
                    onClick={() => openActiveAgent(entry)}
                  >
                    <span className={styles.activeDot} aria-hidden="true" />
                    <span>{entry.title}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className={styles.leftFooter}>
          <Button
            variant="ghost"
            size="sm"
            icon={<Settings2 size={14} />}
            onClick={() => {
              onOpenRules?.()
              useUIStore.getState().openSettingsPage('agent-permissions')
            }}
          >
            {t('f7.queue.approvalRules')}
          </Button>
        </footer>
      </div>

      {selected ? (
        <section aria-label={t('f7.queue.previewLabel')} className={styles.right}>
          <div className={styles.rightBody}>
            <header className={styles.previewHeader}>
              <div className={styles.previewContextRow}>
                <span>{t('f7.preview.context', { agent: selected.agent, conversation: selected.conversation })}</span>
              </div>
              <h3 className={styles.previewTitle}>{selected.request.title}</h3>
            </header>

            {selectedImpact?.why ? <p className={styles.previewWhy}>{selectedImpact.why}</p> : null}

            {selectedImpact ? (
              <ImpactFacts
                impact={selectedImpact}
                layout="grid"
                countOverride={selectedImpact.kind === 'db' && currentDbPreview ? currentDbPreview.count : undefined}
              />
            ) : null}

            {selectedImpact?.kind === 'db' && currentDbPreview?.status === 'ok' && currentDbPreview.sample ? (
              <section className={sharedStyles.sectionBlock}>
                <h4 className={sharedStyles.sectionHeading}>{t('f7.preview.beforeAfter')}</h4>
                <p className={sharedStyles.sampleMeta}>
                  {t('f7.preview.sampleCount', {
                    sampleCount: currentDbPreview.sample.rows.length,
                    count: currentDbPreview.count ?? currentDbPreview.sample.rows.length,
                    formattedSample: formatNumber(currentDbPreview.sample.rows.length),
                    formattedCount: formatNumber(currentDbPreview.count ?? currentDbPreview.sample.rows.length)
                  })}
                </p>
                <div className={sharedStyles.sampleWrap}>
                  <table className={sharedStyles.sampleTable}>
                    <thead>
                      <tr>
                        {currentDbPreview.sample.cols.map(col => (
                          <th key={col} scope="col">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentDbPreview.sample.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className={isChangedPreviewCell(cell) ? sharedStyles.changedCell : undefined}>
                              {formatPreviewCell(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {selectedImpact ? (
              <section className={sharedStyles.sectionBlock}>
                <h4 className={sharedStyles.sectionHeading}>{t('f7.preview.exactHeading')}</h4>
                <pre className={sharedStyles.codeBlock}>
                  <code>{selectedImpact.text}</code>
                </pre>
              </section>
            ) : selected.request.command || selected.request.detail ? (
              <pre className={sharedStyles.codeBlock}>
                <code>{selected.request.command ?? selected.request.detail}</code>
              </pre>
            ) : null}

            {selectedImpact && !selectedImpact.reversible ? (
              isCriticalIrreversible ? (
                <>
                  <Notice intent="danger">{t('f7.preview.criticalCallout')}</Notice>
                  <p className={sharedStyles.noteLine}>{t('f7.preview.criticalPhone')}</p>
                </>
              ) : (
                <>
                  <Notice intent="warning">{t('f7.preview.highCallout')}</Notice>
                  {selectedImpact.kind === 'db' ? (
                    <p className={sharedStyles.noteLine}>{t('f7.preview.dbDesktopOnly')}</p>
                  ) : null}
                </>
              )
            ) : null}
          </div>

          <footer className={styles.previewFooter}>
            <Button variant="secondary" onClick={() => void onRespond(selected.request.id, { decision: 'decline' })}>
              {t('request.deny')}
              <kbd aria-hidden="true" className={sharedStyles.kbdHint}>D</kbd>
            </Button>
            {isCriticalIrreversible ? (
              <>
                <Button
                  variant="danger"
                  onPointerDown={() => startHold(selected.request.id)}
                  onPointerUp={clearHold}
                  onPointerCancel={clearHold}
                  onPointerLeave={clearHold}
                >
                  {t('f7.preview.holdToApprove')}
                  <kbd aria-hidden="true" className={sharedStyles.kbdHint}>A</kbd>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setUnderstood(false)
                    setWithoutHoldOpen(true)
                  }}
                >
                  {t('f7.preview.approveWithoutHolding')}
                </Button>
              </>
            ) : (
              <Button
                ref={approveRef}
                variant={selectedImpact && !selectedImpact.reversible ? 'danger' : 'primary'}
                onClick={() => void onRespond(selected.request.id, { decision: 'accept' })}
              >
                {t('request.approve')}
                <kbd aria-hidden="true" className={sharedStyles.kbdHint}>A</kbd>
              </Button>
            )}
            {selectedOffer?.offered ? (
              <Button variant="ghost" onClick={() => setAlwaysAllowOpen(true)}>
                {t('f7.card.alwaysAllowEllipsis')}
              </Button>
            ) : null}
            {onOpenTask && selected.threadId ? (
              <span className={styles.openTaskSlot}>
                <Button variant="ghost" size="sm" onClick={() => onOpenTask(selected)}>
                  {t('f7.queue.openTask')}
                </Button>
              </span>
            ) : null}
          </footer>
        </section>
      ) : (
        <section aria-label={t('f7.queue.previewLabel')} className={styles.rightEmpty}>
          <EmptyState title={t('f7.queue.allClearTitle')}>{t('f7.queue.allClear')}</EmptyState>
        </section>
      )}

      {alwaysAllowOpen && selectedOffer?.offered ? (
        <AlwaysAllowConfirm
          rule={selectedOffer.rule}
          runsProjectCode={selectedOffer.runsProjectCode}
          definedIn={selectedOffer.definedIn}
          busy={savingRule}
          onCancel={() => setAlwaysAllowOpen(false)}
          onConfirm={() => void confirmAlwaysAllow()}
        />
      ) : null}

      {withoutHoldOpen && selected ? (
        <Dialog
          size="sm"
          title={t('f7.preview.withoutHoldTitle')}
          onClose={closeWithoutHold}
          footer={
            <>
              <Button
                ref={withoutHoldCancelRef}
                variant="secondary"
                data-dialog-cancel=""
                autoFocus
                onClick={closeWithoutHold}
              >
                {i18n.t('ui.cancel')}
              </Button>
              <Button
                variant="danger"
                data-dialog-primary=""
                disabled={!understood}
                onClick={() => {
                  const id = selected.request.id
                  closeWithoutHold()
                  void onRespond(id, { decision: 'accept' })
                }}
              >
                {t('request.approve')}
              </Button>
            </>
          }
        >
          <Checkbox
            checked={understood}
            onChange={event => setUnderstood(event.currentTarget.checked)}
            label={t('f7.preview.withoutHoldCheckbox')}
          />
        </Dialog>
      ) : null}
    </div>
  )
}

export function ApprovalQueueModal({
  onClose,
  initialSelectedId
}: {
  onClose: () => void
  initialSelectedId?: string | null
}): ReactElement {
  const { t: tThread } = useTranslation('thread')
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const modalProps = useModalSurface<HTMLDivElement>(onClose, true)

  const snapshot = useThreadStore(state => state.snapshot)
  const snapshotCache = useThreadStore(state => state.snapshotCache)
  const paneQueue = useApprovalsStore(state => state.queue)
  const paneHistory = useApprovalsStore(state => state.history)

  // Hydrate any unloaded threads that currently have pending requests in main so all conversations show up immediately.
  useEffect(() => {
    let alive = true
    const threadApi = window.oxe?.thread
    if (!threadApi?.pendingRequestsAll || !threadApi?.read) return
    void threadApi.pendingRequestsAll()
      .then(async rows => {
        if (!alive || !Array.isArray(rows)) return
        const state = useThreadStore.getState()
        const missingThreadIds = new Set<string>()
        for (const row of rows) {
          if (!row?.threadId) continue
          const cached = state.snapshot?.thread.id === row.threadId ? state.snapshot : state.snapshotCache[row.threadId]
          const hasRequest = cached?.events.some(ev => ev.type === 'request' && ev.request.id === row.requestId && ev.request.state === 'pending')
          if (!hasRequest) missingThreadIds.add(row.threadId)
        }
        for (const threadId of missingThreadIds) {
          try {
            const loaded = await threadApi.read(threadId)
            if (alive && loaded) useThreadStore.getState().updateSnapshot(loaded)
          } catch {
            // Ignore a thread that closed while hydrating.
          }
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const { items, decided, threadById, paneById } = useMemo(() => {
    const snapshots = new Map<string, NonNullable<typeof snapshot>>()
    for (const entry of Object.values(snapshotCache)) snapshots.set(entry.thread.id, entry)
    if (snapshot) snapshots.set(snapshot.thread.id, snapshot)
    const pendingItems: ApprovalQueueItem[] = []
    const decidedItems: ApprovalDecidedItem[] = []
    const seenPending = new Set<string>()
    const seenDecided = new Set<string>()
    const ownerMap = new Map<string, string>()
    const paneMap = new Map<string, ApprovalRequest>()
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const since = midnight.getTime()

    for (const snap of snapshots.values()) {
      const agent = snap.thread.provider === 'codex' ? 'Codex' : snap.thread.provider === 'claude' ? 'Claude' : tThread('f7.card.defaultAgent')
      const conversation = snap.thread.title || tThread('notify.untitled')
      for (const event of snap.events) {
        if (event.type !== 'request' || (event.request.kind !== 'approval' && event.request.kind !== 'question')) continue
        if (event.request.state === 'pending') {
          if (seenPending.has(event.request.id)) continue
          seenPending.add(event.request.id)
          ownerMap.set(event.request.id, snap.thread.id)
          pendingItems.push({ request: event.request, agent, conversation, threadId: snap.thread.id })
        } else if ((event.request.resolvedAt ?? 0) >= since && !seenDecided.has(event.request.id)) {
          seenDecided.add(event.request.id)
          decidedItems.push({
            id: event.request.id,
            title: event.request.title,
            agent,
            outcome: event.request.resolution ?? event.request.state
          })
        }
      }
    }

    const defaultAgent = tThread('f7.card.defaultAgent')
    for (const req of paneQueue) {
      if (seenPending.has(req.id)) continue
      seenPending.add(req.id)
      paneMap.set(req.id, req)
      pendingItems.push(paneRequestToQueueItem(req, defaultAgent))
    }

    for (const row of paneHistory) {
      if (row.resolvedAt < since || seenDecided.has(row.id)) continue
      seenDecided.add(row.id)
      decidedItems.push({
        id: row.id,
        title: formatMainMessage(row.title),
        agent: requesterText(row.requester) || defaultAgent,
        outcome: row.outcome
      })
    }

    return { items: pendingItems, decided: decidedItems, threadById: ownerMap, paneById: paneMap }
  }, [snapshot, snapshotCache, paneQueue, paneHistory, tThread])

  useLayoutEffect(() => {
    const listbox = modalProps.ref.current?.querySelector<HTMLElement>('[role="listbox"]')
    if (listbox) listbox.focus({ preventScroll: true })
    else closeRef.current?.focus({ preventScroll: true })
  }, [items.length > 0, modalProps.ref])

  return createPortal(
    <div className={styles.viewport}>
      <div
        {...modalProps}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={styles.surface}
      >
        <div className={styles.closeSlot}>
          <IconButton ref={closeRef} icon={<X size={16} />} label={tThread('f7.queue.closeQueue')} onClick={onClose} />
        </div>
        <ApprovalQueue
          headingId={headingId}
          initialSelectedId={initialSelectedId}
          items={items}
          decided={decided}
          onOpenRules={onClose}
          onOpenTask={item => {
            onClose()
            if (item.threadId) {
              void useThreadStore.getState().select(item.threadId)
            }
          }}
          onRespond={async (requestId, response) => {
            const paneReq = paneById.get(requestId)
            if (paneReq) {
              const api = approvalsApi()
              if (!api) return
              const targetIntent = response.decision === 'accept' || response.decision === 'acceptForSession' ? 'allow' : 'deny'
              const option = paneReq.options.find(opt => opt.intent === targetIntent) ?? paneReq.options[0]
              if (option) await useApprovalsStore.getState().respond(api, paneReq, option.id)
              return
            }
            const threadId = threadById.get(requestId)
            if (!threadId || !window.oxe?.thread?.respond) return
            await window.oxe.thread.respond(threadId, requestId, response)
            await useThreadStore.getState().refresh(threadId)
          }}
        />
      </div>
    </div>,
    document.body
  )
}
