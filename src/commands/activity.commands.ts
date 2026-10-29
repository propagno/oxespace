import { Bell, CheckCheck } from 'lucide-react'
import { useActivityStore } from '../store/activity.store'
import { registerCommands } from '../utils/commandRegistry'

/** Event the palette sends to open the activity center in the title bar. */
export const OPEN_ACTIVITY_CENTER_EVENT = 'oxe:open-activity-center'

registerCommands('activity', [
  { id: 'activity.open', label: 'Open activity center', icon: Bell, category: 'View', keywords: ['notifications', 'inbox', 'needs you', 'finished', 'updates'], shortcut: 'activity.open',
    // After the palette closes, so the popover keeps focus.
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_ACTIVITY_CENTER_EVENT))) } },
  { id: 'activity.markAllRead', label: 'Activity: Mark all as read', icon: CheckCheck, category: 'View', keywords: ['notifications', 'clear'],
    run: () => useActivityStore.getState().markAllRead() }
])
