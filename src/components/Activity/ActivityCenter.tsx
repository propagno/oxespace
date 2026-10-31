import { Bell } from 'lucide-react'
import { Suspense, useEffect, useState, type ReactElement } from 'react'
import { OPEN_ACTIVITY_CENTER_EVENT } from '../../commands/activity.commands'
import { useKeybindings, withShortcut } from '../../keyboard/keybindings'
import { unreadActivityCount, useActivityStore } from '../../store/activity.store'
import { chunk, lazyFrom } from '../../lib/chunk'
import { Button, LoadingState, Popover, cx } from '../../ui'
import { ErrorBoundary } from '../common/ErrorBoundary'
import type { ActivityView } from './openActivityTarget'
import styles from './ActivityCenter.module.css'

const PANEL = chunk(() => import('./ActivityPanel'))
const ActivityPanel = lazyFrom(PANEL, module => module.ActivityPanel)
const preloadPanel = (): void => { void PANEL.load().catch(() => undefined) }

/**
 * The bell in the title bar: its unread count, its shortcut, and the popover around ActivityPanel, which loads on its
 * own the first time the bell is pointed at, focused or opened.
 */
export function ActivityCenter({ onSelectView }: { onSelectView: (view: ActivityView) => void }): ReactElement {
  const items = useActivityStore(state => state.items)
  const [open, setOpen] = useState(false)
  const unread = unreadActivityCount(items)
  const waiting = items.some(item => item.kind === 'needs-you' && !item.read)

  useKeybindings({ 'activity.open': () => setOpen(value => !value) })
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(OPEN_ACTIVITY_CENTER_EVENT, show)
    return () => window.removeEventListener(OPEN_ACTIVITY_CENTER_EVENT, show)
  }, [])

  const label = unread ? `Activity, ${unread} unread` : 'Activity'
  return <Popover open={open} onOpenChange={setOpen} align="end" label="Activity" className={styles.panel}
    trigger={<Button variant="ghost" size="sm" square className={styles.trigger} aria-label={label} title={withShortcut('Activity', 'activity.open')} data-testid="activity-bell" icon={<Bell size={14} aria-hidden="true" />}
      onPointerEnter={preloadPanel} onFocus={preloadPanel}>
      {unread > 0 && <span className={cx(styles.count, waiting && styles.urgent)} aria-hidden="true" data-testid="activity-count">{unread > 9 ? '9+' : unread}</span>}
    </Button>}>
    {/* A panel that could not load says so here, with Try again; the window stays. */}
    <ErrorBoundary id="title-bar" component="ActivityPanel" compact label="Activity" onReset={ActivityPanel.retry}>
      <Suspense fallback={<LoadingState />}><ActivityPanel onClose={() => setOpen(false)} onSelectView={onSelectView} /></Suspense>
    </ErrorBoundary>
  </Popover>
}
