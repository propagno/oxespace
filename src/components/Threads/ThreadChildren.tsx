import { Columns2, GitBranch } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread, ThreadChildrenSummary } from '../../../shared/types/thread'
import { Button, ErrorState, IconButton, Popover, StatusDot } from '../../ui'
import { useThreadStore } from '../../store/thread.store'
import { threadNavigationStatus } from './threadNavigationStatus'
import { childCounts } from './threadNesting'
import styles from './ThreadChildren.module.css'

const DOT = { running: 'running', approval: 'attention', failed: 'danger', interrupted: 'idle', idle: 'success' } as const

/**
 * The conversations this one started (B1.3): how many, which still work or wait, and a way to each, here or beside
 * this one in the grid. Shown only when there is at least one; the list is read from main when it opens, archived
 * children included.
 */
export function ThreadChildren({ thread }: { thread: ConversationThread }): ReactElement | null {
  const { t } = useTranslation('thread')
  const threads = useThreadStore(state => state.threads)
  const counts = childCounts(thread.id, threads)
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<ThreadChildrenSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    setFailed(false)
    const read = window.oxe?.thread?.children
    if (!read) { setFailed(true); return }
    void read(thread.id).then(result => { if (live) setSummary(result) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [open, thread.id])

  if (!counts.total) return null
  // TODO(#277): displayThreadTitle once it is on main; an unnamed child reads "New conversation".
  const name = (title: string): string => title.trim() || t('dialogs.newTitle')
  const label = t('children.button', { count: counts.total })
  const go = (id: string, beside: boolean): void => {
    setOpen(false)
    const store = useThreadStore.getState()
    void (beside ? store.openSecondary(id) : store.select(id))
  }
  return <Popover open={open} onOpenChange={setOpen} align="end" label={t('children.title')} className={styles.panel}
    trigger={<Button variant="ghost" size="sm" className={styles.trigger} aria-label={t('children.summary', { count: counts.total, working: counts.working, waiting: counts.waiting })}
      data-testid="thread-children-button" icon={<GitBranch size={14} aria-hidden="true" />}>
      {counts.total}{counts.waiting > 0 && <span className={styles.waiting} aria-hidden="true" />}
    </Button>}>
    <header className={styles.header}><strong>{t('children.title')}</strong><small>{label}</small></header>
    {failed ? <ErrorState compact title={t('children.failed')} />
      : !summary ? <p className={styles.loading}>{t('children.loading')}</p>
      : <ul className={styles.list} data-testid="thread-children-list">
        {summary.children.map(child => {
          const status = threadNavigationStatus({ ...thread, id: child.id, status: child.status, lastTurnStatus: undefined, background: undefined } as ConversationThread)
          return <li key={child.id} className={styles.item}>
            <Button variant="ghost" size="sm" className={styles.open} onClick={() => go(child.id, false)} data-testid="thread-child-open">
              <StatusDot status={DOT[child.status] ?? 'idle'} label={status.label} />
              <span className={styles.name}>{name(child.title)}</span>
              <small>{child.archived ? t('children.archived') : status.label}</small>
            </Button>
            <IconButton size="sm" label={t('children.openBeside', { name: name(child.title) })} icon={<Columns2 size={14} />} onClick={() => go(child.id, true)} />
          </li>
        })}
      </ul>}
  </Popover>
}
