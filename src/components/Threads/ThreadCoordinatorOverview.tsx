import { Columns2, LayoutList } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread, ThreadPendingRequestSummary } from '../../../shared/types/thread'
import { Button, IconButton, Popover, StatusDot } from '../../ui'
import { useThreadStore } from '../../store/thread.store'
import { threadNavigationStatus } from './threadNavigationStatus'
import styles from './ThreadCoordinatorOverview.module.css'

type Group = 'waiting' | 'working' | 'rest'
const GROUPS: Group[] = ['waiting', 'working', 'rest']
const DOT = { waiting: 'attention', working: 'running', rest: 'idle' } as const

/**
 * The coordinator's view of its project (B1.4): every other conversation in it, and first the ones waiting for a
 * person's decision, with how many requests each holds. It only shows and opens; answering stays in each conversation.
 */
export function ThreadCoordinatorOverview({ thread }: { thread: ConversationThread }): ReactElement | null {
  const { t } = useTranslation('thread')
  const threads = useThreadStore(state => state.threads)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ThreadPendingRequestSummary[]>([])

  useEffect(() => {
    if (!open) return
    let live = true
    const read = window.oxe?.thread?.pendingRequestsAll
    if (read) void read().then(list => { if (live && Array.isArray(list)) setPending(list) }, () => undefined)
    return () => { live = false }
  }, [open])

  const others = useMemo(() => threads.filter(item => item.projectId === thread.projectId && item.id !== thread.id && !item.archived), [threads, thread.projectId, thread.id])
  const requests = useMemo(() => {
    const counts = new Map<string, number>()
    for (const request of pending) counts.set(request.threadId, (counts.get(request.threadId) ?? 0) + 1)
    return counts
  }, [pending])
  const groupOf = (item: ConversationThread): Group => item.status === 'approval' || requests.has(item.id) ? 'waiting' : item.status === 'running' ? 'working' : 'rest'
  const waiting = others.filter(item => groupOf(item) === 'waiting').length

  if (!thread.coordinator) return null
  const go = (id: string, beside: boolean): void => {
    setOpen(false)
    const store = useThreadStore.getState()
    void (beside ? store.openSecondary(id) : store.select(id))
  }
  const name = (item: ConversationThread): string => item.title.trim() || t('dialogs.newTitle')
  return <Popover open={open} onOpenChange={setOpen} align="end" label={t('coordinator.overview')} className={styles.panel}
    trigger={<Button variant="ghost" size="sm" className={styles.trigger} data-testid="thread-coordinator-overview"
      aria-label={t('coordinator.overviewSummary', { count: others.length, waiting })} icon={<LayoutList size={14} aria-hidden="true" />}>
      {waiting > 0 && <span className={styles.waiting} data-testid="thread-coordinator-waiting-count">{waiting}</span>}
    </Button>}>
    <header className={styles.header}><strong>{t('coordinator.overview')}</strong><small>{t('coordinator.overviewCount', { count: others.length })}</small></header>
    {!others.length ? <p className={styles.empty}>{t('coordinator.overviewEmpty')}</p>
      : GROUPS.map(group => {
        const items = others.filter(item => groupOf(item) === group)
        if (!items.length) return null
        return <section key={group} className={styles.group} aria-label={t(`coordinator.group.${group}`)} data-testid={`thread-coordinator-${group}`}>
          <h3>{t(`coordinator.group.${group}`)}</h3>
          <ul className={styles.list}>
            {items.map(item => <li key={item.id} className={styles.item}>
              <Button variant="ghost" size="sm" className={styles.open} onClick={() => go(item.id, false)}>
                <StatusDot status={DOT[group]} label={threadNavigationStatus(item).label} />
                <span className={styles.name}>{name(item)}</span>
                <small>{requests.get(item.id) ? t('coordinator.requests', { count: requests.get(item.id) }) : threadNavigationStatus(item).label}</small>
              </Button>
              <IconButton size="sm" label={t('coordinator.openBeside', { name: name(item) })} icon={<Columns2 size={14} />} onClick={() => go(item.id, true)} />
            </li>)}
          </ul>
        </section>
      })}
    <p className={styles.note}>{t('coordinator.overviewNote')}</p>
  </Popover>
}
