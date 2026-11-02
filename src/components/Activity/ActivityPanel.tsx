import { ArrowUpCircle, Bell, CircleAlert, CircleCheck, Gauge, Hand, type LucideIcon } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { activityGroup, unreadActivityCount, useActivityStore, type ActivityGroup, type ActivityItem, type ActivityKind } from '../../store/activity.store'
import { Button, EmptyState, cx } from '../../ui'
import { formatActivityTime } from '../../utils/formatTime'
import { openActivityTarget, type ActivityView } from './openActivityTarget'
import styles from './ActivityCenter.module.css'

const GROUPS: ActivityGroup[] = ['needs-you', 'finished', 'updates']

/** Each kind's icon; its name is `activity.kind.<kind>` in the catalog. */
const KIND: Record<ActivityKind, { icon: LucideIcon; className?: string }> = {
  'needs-you': { icon: Hand, className: styles.needsYou },
  failed: { icon: CircleAlert, className: styles.failed },
  finished: { icon: CircleCheck, className: styles.finished },
  quota: { icon: Gauge, className: styles.needsYou },
  update: { icon: ArrowUpCircle }
}

/**
 * The activity center's content: what needs you, what finished and what is new, from the activity store. Loaded when
 * the bell is first pointed at, focused or opened (ActivityCenter.tsx), so the boot bundle carries only the bell.
 * A click goes to the conversation, pane or page; it never approves anything.
 */
export function ActivityPanel({ onClose, onSelectView }: { onClose: () => void; onSelectView: (view: ActivityView) => void }): ReactElement {
  const { t } = useTranslation()
  const items = useActivityStore(state => state.items)
  const markRead = useActivityStore(state => state.markRead)
  const markAllRead = useActivityStore(state => state.markAllRead)
  const unread = unreadActivityCount(items)
  const groups = useMemo(() => GROUPS.map(group => ({ group, items: items.filter(item => activityGroup(item.kind) === group) })).filter(entry => entry.items.length > 0), [items])

  const go = (item: ActivityItem): void => {
    markRead(item.source, item.id)
    onClose()
    openActivityTarget(item.target, onSelectView)
  }

  return <>
    <div className={styles.header}>
      <h2 className={styles.heading}>{t('activity.title')}</h2>
      <Button variant="ghost" size="sm" disabled={unread === 0} onClick={markAllRead}>{t('activity.markAll')}</Button>
    </div>
    <div className={styles.body} data-testid="activity-center">
      {groups.length === 0
        ? <EmptyState compact icon={<Bell size={16} />} title={t('activity.empty')}>{t('activity.emptyHint')}</EmptyState>
        : groups.map(group => <section key={group.group} className={styles.group} aria-label={t(`activity.group.${group.group}`)}>
          <h3 className={styles.groupTitle}>{t(`activity.group.${group.group}`)}</h3>
          <ul className={styles.list}>
            {group.items.map(item => <li key={`${item.source}:${item.id}`}><ActivityRow item={item} onOpen={go} /></li>)}
          </ul>
        </section>)}
    </div>
  </>
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }): ReactElement {
  const { t } = useTranslation()
  const kind = KIND[item.kind]
  const Icon = kind.icon
  return <button type="button" className={cx(styles.item, !item.read && styles.unread)} onClick={() => onOpen(item)} data-testid="activity-item"
    aria-label={t(item.read ? 'activity.itemLabel' : 'activity.itemLabelUnread', { kind: t(`activity.kind.${item.kind}`), title: item.detail ? `${item.title}. ${item.detail}` : item.title })}>
    <span className={cx(styles.icon, kind.className)} aria-hidden="true"><Icon size={14} /></span>
    <span className={styles.text}>
      <span className={styles.title}>{item.title}</span>
      {item.detail && <span className={styles.detail}>{item.detail}</span>}
    </span>
    <time className={styles.time} dateTime={new Date(item.at).toISOString()}>{formatActivityTime(item.at)}</time>
  </button>
}
