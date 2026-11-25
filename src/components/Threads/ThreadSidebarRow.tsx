import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, CircleCheck, CircleX, Pin, Square, Sun } from 'lucide-react'
import { SidebarRow, cx } from '../../ui'
import type { ConversationThread, ThreadPendingRequestSummary } from '../../../shared/types/thread'
import type { SessionChanges } from '../../../shared/types/thread-session'
import type { useSectionDrag } from './sections/useSectionDrag'
import { threadNavigationStatus, threadRowStateWord } from './threadNavigationStatus'
import { displayThreadTitle } from './threadTitle'
import { ThreadRowAttention } from './ThreadRowAttention'
import styles from './ThreadSidebar.module.css'

type DragRowProps = ReturnType<ReturnType<typeof useSectionDrag>['rowProps']>

/**
 * One conversation in the OxeChat sidebar (BRD-02, OXE-166): a src/ui SidebarRow of two lines. Line 1 is the title
 * ([data-ui=row-title]) and the age; line 2 ([data-ui=row-meta]) the worktree branch, +N −N only when the session has
 * changes, and the state word. No provider product name. The mini card of a waiting request comes right after the row
 * (a card with buttons may not nest in the row's role=button), and the hover actions after it.
 * A parallel chat (`child`, OXC-5) is one line under its parent: the title and the age, on the parent's guide.
 */
export function ThreadSidebarRow({ thread, selected, unread, child = false, changes, request, time, snippet, dragProps, actions, onSelect, onMenu, onOpenRequest, onAnswered }: {
  thread: ConversationThread
  /** A parallel chat of a session, drawn under its parent's row (OXE-170). */
  child?: boolean
  selected: boolean
  unread: boolean
  changes?: SessionChanges
  request?: ThreadPendingRequestSummary
  time: string
  snippet?: ReactNode
  dragProps?: DragRowProps
  actions?: ReactNode
  onSelect: () => void
  onMenu: () => void
  onOpenRequest: () => void
  onAnswered?: () => void
}): ReactElement {
  const { t } = useTranslation('thread')
  const status = threadNavigationStatus(thread)
  const title = displayThreadTitle(thread.title)
  const branch = thread.ownedWorktree?.branch
  const parts: ReactNode[] = []
  if (branch) parts.push(<span key="branch" className={styles.branch}>{branch}</span>)
  if (changes && (changes.additions > 0 || changes.deletions > 0)) parts.push(<span key="changes" className={styles.changes}><span className={styles.added}>+{changes.additions}</span> <span className={styles.deleted}>−{changes.deletions}</span></span>)
  parts.push(<span key="state" className={cx('thread-session-state', styles.state)} data-status={status.kind}>{threadRowStateWord(thread)}</span>)
  const line2 = parts.flatMap((part, index) => index ? [<span key={`separator-${index}`} aria-hidden="true"> · </span>, part] : [part])
  const icon = status.kind === 'ready' ? <Circle size={10} fill="currentColor" /> : status.kind === 'completed' ? <CircleCheck size={14} /> : status.kind === 'attention' ? <Sun size={14} />
    : status.kind === 'failed' ? <CircleX size={14} /> : status.kind === 'interrupted' ? <Square size={11} /> : null
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); onMenu() }
  }
  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    event.preventDefault(); onMenu()
  }
  return <div className={cx('thread-navigation-row', styles.row, child && styles.child, unread && cx('is-unread', styles.unread))} data-thread-row={thread.id} data-parent-thread={child ? thread.parentThreadId : undefined} {...dragProps} onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
    <SidebarRow className={cx('thread-navigation-item', styles.item)} data-list-item data-status={status.kind} selected={selected} onSelect={onSelect}
      lead={<span className={cx('thread-session-indicator', styles.indicator)} data-status={status.kind} aria-hidden="true">{icon}</span>}
      title={<>{unread && <span className={cx('thread-unread-marker', styles.unreadMark)} aria-label={t('sidebar.unread')} />}{unread && ' '}<span data-ui="row-title" className={cx('thread-session-title', styles.title)}>{title}</span></>}
      meta={<small className={styles.time}>{time}</small>}
      detail={child ? undefined : <span data-ui="row-meta" className={cx('thread-session-meta', styles.meta)}>{line2}{thread.pinned && <> <Pin size={11} aria-label={t('sidebar.pinned')} /></>}</span>} />
    {request ? <ThreadRowAttention request={request} onOpen={onOpenRequest} onAnswered={onAnswered} /> : null}
    {snippet}
    {actions ? <span className={styles.actions}>{actions}</span> : null}
  </div>
}
