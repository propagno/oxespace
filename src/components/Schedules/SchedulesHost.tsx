import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { toast } from '../../ui/Toast'

// The dialog loads when it is first opened; this host is the only part the app carries from the start.
const SchedulesDialog = lazy(() => import('./SchedulesDialog').then(module => ({ default: module.SchedulesDialog })))

/**
 * Schedules run with no one asking: when one starts, or cannot, the window says so wherever the person is, with the
 * way to the conversation it opened. Also holds the Schedules dialog, opened from OxeChat's list.
 */
export function SchedulesHost({ onOpenThread }: { onOpenThread: (threadId: string) => void }): ReactElement | null {
  const open = useUIStore(state => state.isSchedulesOpen)
  const close = useUIStore(state => state.closeSchedules)
  useEffect(() => window.oxe?.schedules?.onChanged(event => {
    if (!event) return
    const t = i18n.getFixedT(null, 'thread')
    if (event.outcome === 'started') {
      // The list of conversations learns of the new one before the person follows the notice to it.
      void useThreadStore.getState().load()
      toast({ title: t('schedules.notice.started', { name: event.name }), ...(event.threadId ? { action: { label: t('schedules.openConversation'), run: () => onOpenThread(event.threadId!) } } : {}) })
    } else if (event.outcome === 'failed') {
      toast({ intent: 'danger', title: t('schedules.notice.failed', { name: event.name }), action: { label: t('schedules.notice.see'), run: () => useUIStore.getState().openSchedules() } })
    }
  }), [onOpenThread])
  return open ? <Suspense fallback={null}><SchedulesDialog onClose={close} onOpenThread={onOpenThread} /></Suspense> : null
}
