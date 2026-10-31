import { ArrowUpCircle, Bell, CircleAlert, CircleCheck, Gauge, Hand, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { OPEN_ACTIVITY_CENTER_EVENT } from '../../commands/activity.commands'
import { useKeybindings, withShortcut } from '../../keyboard/keybindings'
import { activityGroup, unreadActivityCount, useActivityStore, type ActivityGroup, type ActivityItem, type ActivityKind } from '../../store/activity.store'
import { Button, EmptyState, Popover, cx } from '../../ui'
import { formatActivityTime } from '../../utils/formatTime'
import { openActivityTarget, type ActivityView } from './openActivityTarget'
import styles from './ActivityCenter.module.css'

const GROUPS: Array<{ group: ActivityGroup; title: string }> = [
  { group: 'needs-you', title: 'Needs you' },
  { group: 'finished', title: 'Finished' },
  { group: 'updates', title: 'Updates' }
]

const KIND: Record<ActivityKind, { icon: LucideIcon; className?: string; label: string }> = {
  'needs-you': { icon: Hand, className: styles.needsYou, label: 'Needs you' },
  failed: { icon: CircleAlert, className: styles.failed, label: 'Failed' },
  finished: { icon: CircleCheck, className: styles.finished, label: 'Finished' },
  quota: { icon: Gauge, className: styles.needsYou, label: 'Quota' },
  update: { icon: ArrowUpCircle, label: 'Update' }
}

/**
 * The bell in the title bar and its popover: what needs you, what finished and what is new,
 * from the activity store. A click goes to the conversation, pane or page; it never approves anything.
 */
export function ActivityCenter({ onSelectView }: { onSelectView: (view: ActivityView) => void }): ReactElement {
  const items = useActivityStore(state => state.items)
  const markRead = useActivityStore(state => state.markRead)
  const markAllRead = useActivityStore(state => state.markAllRead)
  const [open, setOpen] = useState(false)
  const unread = unreadActivityCount(items)
  const waiting = items.some(item => item.kind === 'needs-you' && !item.read)
  const groups = useMemo(() => GROUPS.map(entry => ({ ...entry, items: items.filter(item => activityGroup(item.kind) === entry.group) })).filter(entry => entry.items.length > 0), [items])

  useKeybindings({ 'activity.open': () => setOpen(value => !value) })
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(OPEN_ACTIVITY_CENTER_EVENT, show)
    return () => window.removeEventListener(OPEN_ACTIVITY_CENTER_EVENT, show)
  }, [])

  const go = (item: ActivityItem): void => {
    markRead(item.source, item.id)
    setOpen(false)
    openActivityTarget(item.target, onSelectView)
  }

  const label = unread ? `Activity, ${unread} unread` : 'Activity'
  return <Popover open={open} onOpenChange={setOpen} align="end" label="Activity" className={styles.panel}
    trigger={<Button variant="ghost" size="sm" square className={styles.trigger} aria-label={label} title={withShortcut('Activity', 'activity.open')} data-testid="activity-bell" icon={<Bell size={14} aria-hidden="true" />}>
      {unread > 0 && <span className={cx(styles.count, waiting && styles.urgent)} aria-hidden="true" data-testid="activity-count">{unread > 9 ? '9+' : unread}</span>}
    </Button>}>
    <div className={styles.header}>
      <h2 className={styles.heading}>Activity</h2>
      <Button variant="ghost" size="sm" disabled={unread === 0} onClick={markAllRead}>Mark all as read</Button>
    </div>
    <div className={styles.body} data-testid="activity-center">
      {groups.length === 0
        ? <EmptyState compact icon={<Bell size={16} />} title="Nothing yet">Finished turns, requests that need you and updates show up here.</EmptyState>
        : groups.map(group => <section key={group.group} className={styles.group} aria-label={group.title}>
          <h3 className={styles.groupTitle}>{group.title}</h3>
          <ul className={styles.list}>
            {group.items.map(item => <li key={`${item.source}:${item.id}`}><ActivityRow item={item} onOpen={go} /></li>)}
          </ul>
        </section>)}
    </div>
  </Popover>
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }): ReactElement {
  const kind = KIND[item.kind]
  const Icon = kind.icon
  return <button type="button" className={cx(styles.item, !item.read && styles.unread)} onClick={() => onOpen(item)} data-testid="activity-item"
    aria-label={`${kind.label}: ${item.title}${item.detail ? `. ${item.detail}` : ''}${item.read ? '' : ' (unread)'}`}>
    <span className={cx(styles.icon, kind.className)} aria-hidden="true"><Icon size={14} /></span>
    <span className={styles.text}>
      <span className={styles.title}>{item.title}</span>
      {item.detail && <span className={styles.detail}>{item.detail}</span>}
    </span>
    <time className={styles.time} dateTime={new Date(item.at).toISOString()}>{formatActivityTime(item.at)}</time>
  </button>
}
