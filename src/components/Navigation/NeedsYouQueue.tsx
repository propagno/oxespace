import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { AgentKey, AgentRequestSummary, AgentRow, AgentsChange, AgentsOverview } from '../../../shared/types/agents'
import type { ThreadRequestResponse } from '../../../shared/types/thread'
import { shortcutLabel } from '../../keyboard/keybindings'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, FieldError, Kbd, StatusSignal } from '../../ui'
import { openActivityTarget } from '../Activity/openActivityTarget'
import { useOpenRequest } from '../Approvals/openRequest'
import styles from './NeedsYouQueue.module.css'

/**
 * BRD-10 (OXE-73, with OXE-176): the needs-you queue the title-bar pill opens in place. Its only source is main's agents
 * overview (window.oxe.agents.overview() and onChanged): the window never guesses what waits. Three groups, in order,
 * each only when it has rows: Needs you (every answerable request, oldest first, then every waiting terminal; never
 * capped), Failed and Working (3 rows, then "+N more").
 *
 * A request shows its exact command. Deny and Allow once answer it in its conversation (RT-1); a critical one (main's
 * risk) offers only See impact: nothing critical is decided from here, by click or by key. A waiting terminal offers
 * only Go to terminal. J and K move between items, D denies and A allows the focused request, Enter opens the impact of
 * one that cannot be decided here, Esc closes and gives the focus back to the pill.
 */

type AgentsBridge = {
  overview?: () => Promise<AgentsOverview>
  onChanged?: (listener: (change: AgentsChange) => void) => (() => void) | void
}
type ThreadBridge = { respond?: (threadId: string, requestId: string, response: ThreadRequestResponse) => Promise<void> | void }

const oxe = (): { agents?: AgentsBridge; thread?: ThreadBridge } | undefined =>
  (window as unknown as { oxe?: { agents?: AgentsBridge; thread?: ThreadBridge } }).oxe

const keyOf = (key: AgentKey): string => `${key.kind}:${key.id}`

/** Main's change applied to the rows the window holds: removed ones go, upserted ones replace theirs in place or join. */
export function applyAgentsChange(rows: AgentRow[], change: AgentsChange): AgentRow[] {
  const removed = new Set((change.removed ?? []).map(keyOf))
  const upsert = new Map((change.upsert ?? []).map(row => [keyOf(row), row]))
  const next: AgentRow[] = []
  for (const row of rows) {
    const key = keyOf(row)
    if (removed.has(key)) continue
    const replaced = upsert.get(key)
    if (replaced) { next.push(replaced); upsert.delete(key) } else next.push(row)
  }
  return [...next, ...upsert.values()]
}

/** Every agent main reports, kept current by its pushes. Empty when the bridge is not there. */
export function useAgentsOverview(): AgentRow[] {
  const [agents, setAgents] = useState<AgentRow[]>([])
  useEffect(() => {
    const api = oxe()?.agents
    if (!api || typeof api.overview !== 'function') return
    let alive = true
    // Changes pushed while the first read is in flight are applied on top of it.
    let early: AgentsChange[] | null = []
    const off = typeof api.onChanged === 'function' ? api.onChanged(change => {
      if (!alive || !change) return
      if (early) { early.push(change); return }
      setAgents(rows => applyAgentsChange(rows, change))
    }) : undefined
    api.overview().then(overview => {
      if (!alive) return
      let rows = Array.isArray(overview?.agents) ? overview.agents : []
      for (const change of early ?? []) rows = applyAgentsChange(rows, change)
      early = null
      setAgents(rows)
    }).catch(() => { early = null })
    return () => { alive = false; if (typeof off === 'function') off() }
  }, [])
  return agents
}

/**
 * Main's overview plus the terminals main's agent-state broadcast reports as waiting (the terminal store's live
 * attention) that the overview does not list yet: one row per pane, never two. The overview's row always wins.
 */
export function withWaitingPanes(agents: readonly AgentRow[], liveCode: Record<string, string>, waiting: Record<string, { since: number }>,
  workspaces: ReadonlyArray<{ id: string; panes: ReadonlyArray<{ id: string; type: string; agentName?: string | null; displayName?: string | null }> }>): AgentRow[] {
  const known = new Set(agents.filter(row => row.kind === 'pane').map(row => row.id))
  const extra: AgentRow[] = []
  for (const [paneId, state] of Object.entries(liveCode)) {
    if (state !== 'needs-you' || known.has(paneId)) continue
    const workspace = workspaces.find(item => item.panes.some(pane => pane.id === paneId))
    const pane = workspace?.panes.find(item => item.id === paneId)
    if (!workspace || !pane || pane.type !== 'terminal') continue
    const since = waiting[paneId]?.since ?? 0
    extra.push({ kind: 'pane', id: paneId, state: 'needs-you', provider: 'other', mode: 'code', title: pane.agentName ?? '', workspaceId: workspace.id, since,
      seenAt: null, session: null, worktree: null, cost: null, requests: [] } as AgentRow)
  }
  return extra.length ? [...agents, ...extra] : [...agents]
}

/** The pill's number: every answerable request of a needs-you agent plus every waiting terminal (OXE-176). */
export function pendingCount(agents: readonly AgentRow[]): number {
  let count = 0
  for (const row of agents) {
    if (row.state !== 'needs-you') continue
    if (row.kind === 'pane') count += 1
    else count += (row.requests ?? []).filter(request => request.answerable).length
  }
  return count
}

type QueueItem =
  | { kind: 'request'; key: string; row: AgentRow; request: AgentRequestSummary }
  | { kind: 'pane'; key: string; row: AgentRow }

function queueItems(agents: readonly AgentRow[]): QueueItem[] {
  const waiting = agents.filter(row => row.state === 'needs-you')
  const requests = waiting.filter(row => row.kind !== 'pane')
    .flatMap(row => (row.requests ?? []).filter(request => request.answerable).map(request => ({ kind: 'request' as const, key: `request:${request.requestId}`, row, request })))
    .sort((a, b) => a.request.since - b.request.since)
  const panes = waiting.filter(row => row.kind === 'pane').sort((a, b) => a.since - b.since)
    .map(row => ({ kind: 'pane' as const, key: `pane:${row.id}`, row }))
  return [...requests, ...panes]
}

/** OXE-337: only a conversation's approval main judged low risk and did not mark irreversible is answered here. */
const decidable = (item: QueueItem | undefined): boolean =>
  item?.kind === 'request' && item.row.kind === 'thread' && item.request.kind === 'approval' && item.request.risk === 'low'
  && item.request.reversible !== false

const ROW_CAP = 3
const GROUP_KEY = { 'needs-you': 'f7.queue.group.needsYou', failed: 'f7.queue.group.failed', working: 'f7.queue.group.working' } as const

export interface NeedsYouQueueProps {
  agents: readonly AgentRow[]
  anchor: RefObject<HTMLElement | null>
  /** `restore`: give the focus back to the pill (Esc); false when the person went somewhere else. */
  onClose: (restore: boolean) => void
}

export function NeedsYouQueue({ agents, anchor, onClose }: NeedsYouQueueProps): ReactElement {
  const { t } = useTranslation('thread')
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const openRequest = useOpenRequest(state => state.open)
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const lastIndex = useRef(0)
  const sent = useRef(new Set<string>())
  const [active, setActive] = useState(0)
  // OXE-337: a failed answer is shown, never swallowed; the row stays so it can be answered again.
  const [failedAnswer, setFailedAnswer] = useState(false)
  const [place, setPlace] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const items = queueItems(agents)
  const failed = agents.filter(row => row.state === 'failed')
  const working = agents.filter(row => row.state === 'working')
  itemRefs.current.length = items.length

  useLayoutEffect(() => {
    const measure = (): void => {
      const box = anchor.current?.getBoundingClientRect()
      if (box) setPlace({ top: Math.round(box.bottom + 4), right: Math.max(8, Math.round(window.innerWidth - box.right)) })
    }
    measure()
    itemRefs.current[0]?.focus()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchor])

  // An item answered elsewhere leaves: the focus stays in the queue, on the item that took its place.
  useEffect(() => {
    const root = rootRef.current
    if (!root || !items.length || root.contains(document.activeElement)) return
    if (document.activeElement && document.activeElement !== document.body) return
    itemRefs.current[Math.min(lastIndex.current, items.length - 1)]?.focus()
  }, [items.length])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target || rootRef.current?.contains(target) || anchor.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchor, onClose])

  const where = (row: AgentRow): string => {
    const workspace = workspaces.find(item => item.id === row.workspaceId)
      ?? (row.kind === 'pane' ? workspaces.find(item => item.panes.some(pane => pane.id === row.id)) : undefined)
    const pane = row.kind === 'pane' ? workspace?.panes.find(item => item.id === row.id) as { displayName?: string | null } | undefined : undefined
    const name = pane?.displayName || row.title || ''
    return workspace ? `${workspace.name} › ${name}` : name
  }

  const decide = (item: QueueItem | undefined, decision: 'accept' | 'decline'): void => {
    if (!item || item.kind !== 'request' || !decidable(item)) return
    const id = item.request.requestId
    const respond = oxe()?.thread?.respond
    if (sent.current.has(id) || typeof respond !== 'function') return
    sent.current.add(id)
    setFailedAnswer(false)
    let pending: Promise<void> | void
    try { pending = respond(item.row.id, id, { decision }) } catch (error) { pending = Promise.reject(error) }
    void Promise.resolve(pending).catch(() => {
      sent.current.delete(id)
      setFailedAnswer(true)
    })
  }

  const goToPane = (row: AgentRow): void => {
    const workspaceId = row.workspaceId ?? workspaces.find(item => item.panes.some(pane => pane.id === row.id))?.id
    if (!workspaceId) return
    onClose(false)
    // OXE-128's path; the app's own pane opener switches to OxeCode and focuses the terminal.
    openActivityTarget({ type: 'pane', workspaceId, paneId: row.id }, view => {
      if (view === 'code') window.dispatchEvent(new CustomEvent('oxe:open-pane', { detail: { paneId: row.id, workspaceId } }))
    })
  }

  // OXE-332: the request opens with its conversation (so the host can load it uncached) and the queue closes.
  const seeImpact = (item: QueueItem): void => {
    if (item.kind !== 'request') return
    openRequest(item.request.requestId, item.row.id)
    onClose(false)
  }

  // OXE-333: a question is answered in its conversation (OXE-332's event), never from the impact dialog.
  const answerInConversation = (item: QueueItem): void => {
    if (item.kind !== 'request') return
    onClose(false)
    window.dispatchEvent(new CustomEvent('oxe:open-thread', { detail: { threadId: item.row.id } }))
  }

  const focusedIndex = (): number => itemRefs.current.findIndex(item => item?.contains(document.activeElement) ?? false)
  const move = (index: number): void => {
    if (!items.length) return
    itemRefs.current[Math.max(0, Math.min(items.length - 1, index))]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
      return
    }
    const index = focusedIndex()
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (key === 'j' || key === 'ArrowDown') { event.preventDefault(); move(index < 0 ? 0 : index + 1); return }
    if (key === 'k' || key === 'ArrowUp') { event.preventDefault(); move(index < 0 ? 0 : index - 1); return }
    const item = index >= 0 ? items[index] : undefined
    if (!item) return
    if (key === 'd' || key === 'a') {
      event.preventDefault()
      if (!event.repeat) decide(item, key === 'a' ? 'accept' : 'decline')
      return
    }
    // Enter on the item itself (a button keeps its own Enter): the impact of a request the queue cannot decide.
    if (key === 'Enter' && event.target === itemRefs.current[index] && item.kind === 'request' && !decidable(item)) {
      event.preventDefault()
      if (item.request.kind === 'question') answerInConversation(item)
      else seeImpact(item)
    }
  }

  const itemProps = (index: number, label: string) => ({
    ref: (element: HTMLDivElement | null) => { itemRefs.current[index] = element },
    className: styles.item,
    'data-ui': 'needs-you-item',
    role: 'group',
    'aria-label': label,
    tabIndex: index === active ? 0 : -1,
    onFocus: () => { lastIndex.current = index; setActive(index) }
  })

  const needsWord = t(GROUP_KEY['needs-you'])
  const nextShortcut = shortcutLabel('attention.next')
  const capped = (state: 'failed' | 'working', rows: AgentRow[]): ReactElement | null => rows.length === 0 ? null : (
    <section className={styles.group} data-ui="needs-you-group" data-state={state}>
      <h3 className={styles.heading}>{t('f7.queue.groupHeading', { label: t(GROUP_KEY[state]), count: rows.length })}</h3>
      {rows.slice(0, ROW_CAP).map(row => (
        <div key={keyOf(row)} className={styles.row} data-ui="needs-you-row">
          <StatusSignal state={state} label={t(GROUP_KEY[state])} size={14} />
          <span className={styles.where}>{where(row)}</span>
        </div>
      ))}
      {rows.length > ROW_CAP && <p className={styles.more}>{t('f7.queue.more', { rest: rows.length - ROW_CAP })}</p>}
    </section>
  )

  return createPortal(
    <div ref={rootRef} className={styles.queue} data-ui="needs-you-queue" role="dialog" aria-label={t('f7.queue.panelLabel')}
      style={{ top: place.top, right: place.right }} onKeyDown={onKeyDown}>
      {items.length > 0 && (
        <section className={styles.group} data-ui="needs-you-group" data-state="needs-you">
          {items.map((item, index) => {
            const label = where(item.row)
            if (item.kind === 'pane') {
              return (
                <div key={item.key} {...itemProps(index, label)} data-kind="pane">
                  <div className={styles.head}>
                    <StatusSignal state="needs-you" label={needsWord} size={14} />
                    <span className={styles.where}>{label}</span>
                  </div>
                  <div className={styles.actions}>
                    <span className={styles.detail}>{t('f7.queue.paneWaiting')}</span>
                    <Button size="sm" variant="secondary" onClick={() => goToPane(item.row)}>{t('f7.queue.goToPane')}</Button>
                  </div>
                </div>
              )
            }
            const critical = item.request.risk === 'critical'
            return (
              <div key={item.key} {...itemProps(index, label)} data-kind="request">
                <div className={styles.head}>
                  <StatusSignal state="needs-you" label={needsWord} size={14} />
                  <span className={styles.where}>{label}</span>
                  {critical && <span className={styles.risk} data-ui="risk-label">{t('approvals.risk.critical', { ns: 'common' })}</span>}
                </div>
                {item.request.command && <code className={styles.command}>{item.request.command.text}</code>}
                <div className={styles.actions}>
                  {decidable(item) ? (
                    <>
                      <Button size="md" variant="secondary" onClick={() => decide(item, 'decline')}>{t('f7.queue.deny')}</Button>
                      <Button size="md" variant="primary" onClick={() => decide(item, 'accept')}>{t('f7.card.allowOnce')}</Button>
                    </>
                  ) : (
                    item.request.kind === 'question'
                      ? <Button size="md" variant="primary" onClick={() => answerInConversation(item)}>{t('f7.queue.answerInConversation')}</Button>
                      : <Button size="md" variant="secondary" onClick={() => seeImpact(item)}>{t('f7.card.seeImpact')}</Button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}
      {failedAnswer && <FieldError className={styles.more}>{t('f7.queue.respondFailed')}</FieldError>}
      {capped('failed', failed)}
      {capped('working', working)}
      {items.length > 0 && nextShortcut && (
        <footer className={styles.footer} data-ui="needs-you-footer">
          <span>{t('f7.queue.nextShortcut')}</span>{' '}
          <Kbd>{nextShortcut}</Kbd>
        </footer>
      )}
      {items.length === 0 && failed.length === 0 && working.length === 0 && <p className={styles.more}>{t('f7.queue.allClearTitle')}</p>}
    </div>,
    document.body
  )
}
