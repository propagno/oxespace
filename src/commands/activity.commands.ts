import { Bell, CheckCheck } from 'lucide-react'
import { i18n } from '../i18n'
import { useActivityStore } from '../store/activity.store'
import { toast } from '../ui'
import { registerCommands } from '../utils/commandRegistry'
import { commandText, registerTranslated, tCommand } from './commandText'

/** Event the palette sends to open the activity center in the title bar. */
export const OPEN_ACTIVITY_CENTER_EVENT = 'oxe:open-activity-center'

registerTranslated(() => registerCommands('activity', [
  { id: 'activity.open', ...commandText('Activity', 'activity.open', { keywords: ['notifications', 'inbox', 'needs you', 'finished', 'updates'] }), icon: Bell, shortcut: 'activity.open',
    // After the palette closes, so the popover keeps focus.
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_ACTIVITY_CENTER_EVENT))) } },
  { id: 'activity.markAllRead', ...commandText('Activity', 'activity.markAllRead', { keywords: ['notifications', 'clear'] }), icon: CheckCheck,
    // Says so either way, so the command never looks like it did nothing.
    run: () => {
      const activity = useActivityStore.getState()
      if (!activity.items.some(item => !item.read)) { toast({ title: i18n.t('activityCenter.nothingToRead'), description: i18n.t('activityCenter.nothingToReadText') }); return }
      activity.markAllRead()
      toast({ title: i18n.t('activityCenter.allRead'), intent: 'success' })
    } }
]))
