import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubPrStatus } from '../../../shared/types/github'
import type { ConversationThread } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { dismissToast, toast } from '../../ui'
import { PR_ARCHIVE_OFFER_MS, prArchiveOffer } from './prArchiveOffer'

/** Conversation and PR pairs offered in this app session: each is offered once (DESIGN on #442). */
const offeredThisSession = new Set<string>()

/** Tests: forget the session's offers. */
export function resetPrArchiveOffers(): void {
  offeredThisSession.clear()
}

/**
 * T40, opt-in in 1.4.0 (DESIGN on #442; the coordinator's decision, recorded against the person's X17): when the PR read
 * the conversation's status bar already makes (PrStatusBar, every 30 s while it is shown) says the conversation's own PR
 * closed or merged, a toast asks whether to archive it.
 * - Archive (the person's click) archives through the existing archiveThread.
 * - Its time running out archives nothing and stores nothing.
 * - ✕ or Escape stores the PR as kept (keptAfterPr), so it is never offered again.
 * - Each PR is offered once per app session. Leaving the conversation before an answer withdraws the offer without
 *   counting it, so the next read offers again.
 * There is no unarchive in 1.4.0, which the toast says; the automatic version, with Keep and unarchive, is 1.4.1.
 */
export function usePrArchiveOffer(thread: ConversationThread | undefined): (status: GitHubPrStatus | null) => void {
  const { t } = useTranslation('thread')
  const latest = useRef(thread)
  useEffect(() => { latest.current = thread })
  const offer = useRef<{ key: string; toastId: number; answered: boolean } | null>(null)

  // Another conversation on screen, or none: an offer not answered yet is withdrawn and may come back.
  useEffect(() => () => {
    const current = offer.current
    offer.current = null
    if (!current || current.answered) return
    offeredThisSession.delete(current.key)
    dismissToast(current.toastId)
  }, [thread?.id])

  return useCallback((status: GitHubPrStatus | null): void => {
    const current = latest.current
    if (!current) return
    const found = prArchiveOffer(current, status)
    if (!found) return
    const key = `${current.id}#${found.prNumber}`
    if (offeredThisSession.has(key)) return
    offeredThisSession.add(key)
    const threadId = current.id
    const entry = { key, toastId: 0, answered: false }
    entry.toastId = toast({
      title: t(found.merged ? 'prArchive.merged' : 'prArchive.closed', { number: found.prNumber }),
      description: t('prArchive.description'),
      duration: PR_ARCHIVE_OFFER_MS,
      action: { label: t('prArchive.archive'), run: () => { entry.answered = true; void useThreadStore.getState().archiveThread(threadId) } },
      onDismiss: () => { entry.answered = true; void window.oxe.thread?.keepAfterPr?.(threadId, found.prNumber).catch(() => undefined) }
    })
    offer.current = entry
  }, [t])
}
