import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { toast } from '../../ui'
import type { ApprovalsApi } from '../../../shared/types/approvals'
import { approvalsApi } from './approvalsApi'
import { OPEN_APPROVAL_HISTORY_EVENT, reportShown, takeHistoryRequest } from './approvalsBoot'
import { useApprovalsStore } from './approvals.store'
import { ApprovalDialog } from './ApprovalDialog'
import { ApprovalHistory } from './ApprovalHistory'
import { approvalT } from './approvalText'
import { registerCommands } from '../../utils/commandRegistry'

// What was approved or denied in this session, and who asked. Registered with this chunk, which loads at idle right
// after boot, so the boot bundle does not carry it.
registerCommands('approvals', [{
  id: 'help.approvals', label: 'Approval history', icon: ShieldCheck, category: 'Help', keywords: ['approvals', 'permissions', 'allowed', 'denied', 'decisions', 'security'],
  run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_HISTORY_EVENT))) }
}])

/**
 * The approval window, loaded on demand by ApprovalsHost. One request at a time, oldest first; the next opens after
 * a decision. Nothing here answers without the person: there is no approve-all, and closing means deny.
 */
export function ApprovalCenter({ armMs }: { armMs?: number } = {}): ReactElement | null {
  useTranslation()
  // Mounted only once ApprovalsHost found a channel (or a test installed the mock).
  const api = approvalsApi() as ApprovalsApi
  const queue = useApprovalsStore(state => state.queue)
  const historyOpen = useApprovalsStore(state => state.historyOpen)
  const notice = useApprovalsStore(state => state.notice)
  const hadQueue = useRef(false)

  useEffect(() => {
    const store = useApprovalsStore.getState()
    // A new request takes the screen from the history, so its fail-safe sees it shown.
    const offRequested = api.onRequested(request => { const current = useApprovalsStore.getState(); current.received(request); current.setHistoryOpen(false) })
    const offResolved = api.onResolved(resolution => useApprovalsStore.getState().resolved(resolution))
    void store.sync(api).catch(() => {})
    if (takeHistoryRequest()) store.setHistoryOpen(true)
    const openHistory = (): void => { takeHistoryRequest(); useApprovalsStore.getState().setHistoryOpen(true) }
    window.addEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
    return () => { offRequested(); offResolved(); window.removeEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory) }
  }, [api])

  // The history reads main's record again when it opens (it also lists requests main settled without showing them).
  useEffect(() => { if (historyOpen) void useApprovalsStore.getState().sync(api).catch(() => {}) }, [historyOpen, api])

  // The dialog is on screen with these requests in its queue: their fail-safe stops.
  useEffect(() => { if (queue.length && !historyOpen) reportShown(queue, api) }, [queue, historyOpen, api])

  // The last request settled without the person while it was on screen: say so, since the dialog closes.
  useEffect(() => {
    if (queue.length) { hadQueue.current = true; return }
    if (hadQueue.current && notice?.kind === 'settled') {
      toast({ title: approvalT(`approvals.settled.${notice.by}`), intent: 'info' })
      useApprovalsStore.getState().dismissNotice()
    }
    hadQueue.current = false
  }, [queue.length, notice])

  if (historyOpen) return <ApprovalHistory onClose={() => useApprovalsStore.getState().setHistoryOpen(false)} hasPending={queue.length > 0} />
  const request = queue[0]
  if (!request) return null
  return <ApprovalDialog request={request} position={1} total={queue.length} api={api} armMs={armMs} />
}
