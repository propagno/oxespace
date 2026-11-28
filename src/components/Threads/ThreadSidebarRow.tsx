import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, CircleX, Pin, Square, Sun } from 'lucide-react'
import { i18n } from '../../i18n'
import { SidebarRow, cx } from '../../ui'
import type { ConversationThread, ThreadPendingRequestSummary } from '../../../shared/types/thread'
import type { SessionChanges } from '../../../shared/types/thread-session'
import type { useSectionDrag } from './sections/useSectionDrag'
import { threadNavigationStatus, threadRowStateWord } from './threadNavigationStatus'
import { displayThreadTitle } from './threadTitle'
import { ThreadRowAttention } from './ThreadRowAttention'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import styles from './ThreadSidebar.module.css'

type DragRowProps = ReturnType<ReturnType<typeof useSectionDrag>['rowProps']>

/**
 * One conversation in the OxeChat sidebar (BRD-02, OXE-166): a src/ui SidebarRow of two lines. Line 1 is the title
 * ([data-ui=row-title]) and the age; line 2 ([data-ui=row-meta]) the worktree branch, +N −N only when the session has
 * changes, the state word, and any failure, unconfirmed, or read-only suffix. No provider product name. The mini card
 * of a waiting request comes right after the row (a card with buttons may not nest in the row's role=button), and the
 * hover actions after it (so NavigationChrome's [role='button'] + span stacking keeps actions above the row).
 * A parallel or delegated child (`child`, OXC-5 / OXE-346) is one line under its parent: the title and the age, on the
 * parent's guide inside a sibling role="group" outside [data-thread-row].
 */
export function ThreadSidebarRow({ thread, selected, unread, child = false, changes, request, time, snippet, dragProps, actions, onSelect, onMenu, onOpenRequest, onAnswered }: {
  thread: ConversationThread
  /** A parallel or delegated child conversation, drawn under its parent's row (OXE-170, OXE-346). */
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
  if (thread.status === 'failed' && thread.lastFailureCode) {
    const code = i18n.exists(`thread:failure.title.${thread.lastFailureCode}`) ? thread.lastFailureCode : 'unknown'
    parts.push(<span key="failure" className={styles.state} data-status="failed">{t(`failure.title.${code}`)}</span>)
  }
  if (thread.providerObservation?.state === 'unknown') {
    parts.push(<span key="unconfirmed" data-meta-suffix="unconfirmed">{t('sidebar.meta.unconfirmed')}</span>)
  }
  if (thread.access === 'read-only') {
    parts.push(<span key="read-only" data-meta-suffix="read-only">{t('sidebar.meta.readOnly')}</span>)
  }
  const line2 = parts.flatMap((part, index) => index ? [<span key={`separator-${index}`} aria-hidden="true"> · </span>, part] : [part])
  const icon = status.kind === 'ready' ? <Circle size={10} fill="currentColor" /> : status.kind === 'completed' ? <Check size={12} strokeWidth={2} /> : status.kind === 'attention' ? <Sun size={14} />
    : status.kind === 'failed' ? <CircleX size={14} /> : status.kind === 'interrupted' ? <Square size={11} /> : null
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); onMenu() }
  }
  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    event.preventDefault(); onMenu()
  }
  return <div className={cx('thread-navigation-row', styles.row, child && styles.child, unread && cx('is-unread', styles.unread))} data-thread-row={thread.id} data-parent-thread={child ? thread.parentThreadId : undefined} {...dragProps} onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
    <SidebarRow className={cx('thread-navigation-item', styles.item)} data-list-item data-status={status.kind} selected={selected} onSelect={onSelect}
      lead={<span className={cx('thread-session-indicator', styles.indicator)} data-status={status.kind} aria-hidden="true">{icon}</span>}
      title={<>{unread && <span className={cx('thread-unread-marker', styles.unreadMark)} aria-label={t('sidebar.unread')} />}{unread && ' '}{thread.provider && <AgentProviderIcon provider={thread.provider} size={14} />}<span data-ui="row-title" className={cx('thread-session-title', styles.title)}>{title}</span></>}
      meta={<small className={styles.time}>{time}</small>}
      detail={child ? undefined : <span data-ui="row-meta" className={cx('thread-session-meta', styles.meta)}>{line2}{thread.pinned && <> <Pin size={11} aria-label={t('sidebar.pinned')} /></>}</span>} />
    {request ? <ThreadRowAttention request={request} onOpen={onOpenRequest} onAnswered={onAnswered} /> : null}
    {snippet}
    {actions ? <span className={styles.actions}>{actions}</span> : null}
  </div>
}
