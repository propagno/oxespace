import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { toast } from '../../ui'
import type { ApprovalsApi } from '../../../shared/types/approvals'
import { approvalsApi } from './approvalsApi'
import { OPEN_APPROVAL_HISTORY_EVENT, reportShown, takeHistoryRequest, trackQueue } from './approvalsBoot'
import { useApprovalsStore } from './approvals.store'
import { ApprovalDialog } from './ApprovalDialog'
import { ApprovalHistory } from './ApprovalHistory'
import { approvalT } from './approvalText'
import { registerCommands } from '../../utils/commandRegistry'
import { i18n } from '../../i18n'

// What was approved or denied in this session, and who asked. Registered with this chunk, which loads at idle right
// after boot, so the boot bundle does not carry it; registered again when the language changes. Worded like the
// palette's catalog (F17): "<Category>: <Action>" from `commands.category.help` and `commands.action.help.approvals`.
// TODO(F17): use commandText('Help', 'help.approvals', …) once src/commands/commandText.ts is on main.
const registerHistoryCommand = (): void => {
  const category = approvalT('commands.category.help')
  const action = approvalT('commands.action.help.approvals')
  registerCommands('approvals', [{
    id: 'help.approvals', label: `${category}: ${action}`, icon: ShieldCheck, category: 'Help',
    // The former label, in the language on screen, still finds it.
    keywords: ['approvals', 'aprovações', 'histórico', 'history', 'permissions', 'allowed', 'denied', 'decisions', 'security', approvalT('approvals.history.command')],
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_HISTORY_EVENT))) }
  }])
}
registerHistoryCommand()
i18n.on('languageChanged', registerHistoryCommand)

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
  const settled = useApprovalsStore(state => state.settled)

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

  // The window holds these requests (a crash hands them back to main); on screen, their fail-safe stops.
  useEffect(() => { trackQueue(queue); if (queue.length && !historyOpen) reportShown(queue) }, [queue, historyOpen])

  // The request on screen was settled without the person: say so apart from the dialog, so nothing about it is
  // carried onto the next request (R5).
  useEffect(() => {
    if (!settled) return
    const taken = useApprovalsStore.getState().takeSettled()
    if (taken) toast({ title: approvalT(`approvals.settled.${taken.by}`), intent: 'info' })
  }, [settled])

  if (historyOpen) return <ApprovalHistory onClose={() => useApprovalsStore.getState().setHistoryOpen(false)} hasPending={queue.length > 0} />
  const request = queue[0]
  if (!request) return null
  // Keyed by id and generation: a re-issued or next request is a fresh dialog, with nothing kept from the one before.
  return <ApprovalDialog key={`${request.id}#${request.generation}`} request={request} position={1} total={queue.length} api={api} armMs={armMs} />
}
