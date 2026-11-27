import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { toast } from '../../ui/Toast'

// The dialog loads when it is first opened; this host is the only part the app carries from the start.
const SchedulesDialog = lazy(() => import('./SchedulesDialog').then(module => ({ default: module.SchedulesDialog })))

/**
 * Schedules & Automations run in the background: when one starts, needs review, waits for approval, times out, or
 * fails, the window surfaces an actionable toast wherever the person is.
 */
export function SchedulesHost({ onOpenThread }: { onOpenThread: (threadId: string) => void }): ReactElement | null {
  const open = useUIStore(state => state.isSchedulesOpen)
  const initialTab = useUIStore(state => state.schedulesInitialTab)
  const close = useUIStore(state => state.closeSchedules)
  useEffect(() => window.oxe?.schedules?.onChanged(event => {
    if (!event) return
    const t = i18n.getFixedT(null, 'thread')
    if (event.outcome === 'started' || event.outcome === 'running') {
      // The list of conversations learns of the new one before the person follows the notice to it.
      void useThreadStore.getState().load()
      toast({ title: t('schedules.notice.started', { name: event.name }), ...(event.threadId ? { action: { label: t('schedules.openConversation'), run: () => onOpenThread(event.threadId!) } } : {}) })
    } else if (event.outcome === 'needs_review') {
      toast({
        intent: 'info',
        title: t('schedules.notice.needsReview', { name: event.name }),
        action: { label: t('schedules.notice.openReview'), run: () => useUIStore.getState().openSchedules('review') }
      })
    } else if (event.outcome === 'waiting_approval') {
      toast({
        intent: 'warning',
        title: t('schedules.notice.waitingApproval', { name: event.name }),
        ...(event.threadId ? { action: { label: t('schedules.openConversation'), run: () => onOpenThread(event.threadId!) } } : {})
      })
    } else if (event.outcome === 'timed_out') {
      toast({
        intent: 'danger',
        title: t('schedules.notice.timedOut', { name: event.name }),
        action: { label: t('schedules.notice.see'), run: () => useUIStore.getState().openSchedules('schedules') }
      })
    } else if (event.outcome === 'failed') {
      toast({ intent: 'danger', title: t('schedules.notice.failed', { name: event.name }), action: { label: t('schedules.notice.see'), run: () => useUIStore.getState().openSchedules('schedules') } })
    }
  }), [onOpenThread])
  return open ? <Suspense fallback={null}><SchedulesDialog initialTab={initialTab} onClose={close} onOpenThread={onOpenThread} /></Suspense> : null
}
