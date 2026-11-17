import { ArrowUpCircle, Bell, Gauge } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { activityGroup, unreadActivityCount, useActivityStore, type ActivityGroup, type ActivityItem } from '../../store/activity.store'
import { Button, EmptyState, StatusSignal, cx } from '../../ui'
import { formatActivityTime } from '../../utils/formatTime'
import { openActivityTarget, type ActivityView } from './openActivityTarget'
import styles from './ActivityCenter.module.css'

const GROUPS: ActivityGroup[] = ['needs-you', 'failed', 'finished', 'updates']

function itemGroup(item: ActivityItem): ActivityGroup {
  if (item.kind === 'needs-you' && item.outcome) return 'finished'
  return activityGroup(item.kind)
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
  const groups = useMemo(() => GROUPS.map(group => ({ group, items: items.filter(item => itemGroup(item) === group) })).filter(entry => entry.items.length > 0), [items])

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
        ? <EmptyState compact icon={<Bell size={16} />} title={t('activityCenter.nothingWaiting')}>{t('activity.emptyHint')}</EmptyState>
        : groups.map(group => <section key={group.group} className={styles.group} aria-label={t(`activity.group.${group.group}`)}>
          <h3 className={styles.groupTitle}>{t(`activity.group.${group.group}`)}</h3>
          <ul className={styles.list}>
            {group.items.map(item => <li key={`${item.source}:${item.id}`}><ActivityRow item={item} onOpen={go} /></li>)}
          </ul>
        </section>)}
    </div>
  </>
}

function ActivitySignal({ item }: { item: ActivityItem }): ReactElement {
  const { t } = useTranslation()
  if (item.kind === 'needs-you') {
    if (item.outcome) return <span className={styles.icon} aria-hidden="true"><StatusSignal state="waiting" label={t(`activity.outcome.${item.outcome}`)} size={14} /></span>
    return <span className={styles.icon} aria-hidden="true"><StatusSignal state="needs-you" label={t('activity.kind.needs-you')} size={14} /></span>
  }
  if (item.kind === 'failed') return <span className={styles.icon} aria-hidden="true"><StatusSignal state="failed" label={t('activity.kind.failed')} size={14} /></span>
  if (item.kind === 'finished') return <span className={styles.icon} aria-hidden="true"><StatusSignal state="done" label={t('activity.kind.finished')} size={14} /></span>
  if (item.kind === 'quota') return <span className={cx(styles.icon, styles.quota)} aria-hidden="true"><Gauge size={14} /></span>
  return <span className={styles.icon} aria-hidden="true"><ArrowUpCircle size={14} /></span>
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }): ReactElement {
  const { t } = useTranslation()
  const place = item.place?.project ? `${item.place.project} · ${item.place.mode === 'chat' ? 'OxeChat' : 'OxeCode'}` : null
  return <button type="button" className={cx(styles.item, !item.read && styles.unread)} onClick={() => onOpen(item)} data-testid="activity-item"
    aria-label={t(item.read ? 'activity.itemLabel' : 'activity.itemLabelUnread', { kind: t(`activity.kind.${item.kind}`), title: item.detail ? `${item.title}. ${item.detail}` : item.title })}>
    <ActivitySignal item={item} />
    <span className={styles.text}>
      <span className={styles.title}>{item.title}</span>
      {item.detail && <span className={styles.detail}>{item.detail}</span>}
      {place && <span className={styles.place} data-ui="activity-place">{place}</span>}
      {item.outcome && <span className={styles.outcome}>{t(`activity.outcome.${item.outcome}`)}</span>}
    </span>
    <time className={styles.time} dateTime={new Date(item.at).toISOString()}>{formatActivityTime(item.at)}</time>
  </button>
}
