import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubPrStatus } from '../../../shared/types/github'
import type { ConversationThread } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { dismissToast, toast } from '../../ui'
import { PR_ARCHIVE_OFFER_MS, prArchiveOffer } from './prArchiveOffer'

/**
 * T40: when the PR read the conversation's status bar already makes (PrStatusBar, every 30 s while it is shown) says
 * the conversation's own PR closed or merged, a toast offers to archive it, with Keep. It archives only when the toast's
 * time runs out (paused on hover and focus) while this conversation is still on screen and the window has focus;
 * anything else (the conversation leaves the screen, the window loses focus, the app closes, the toast is dismissed)
 * archives nothing, and the next read offers again. Keep is stored with the conversation for that PR number.
 * Archiving cannot be undone in 1.4 (no unarchive yet), which the toast says.
 */
export function usePrArchiveOffer(thread: ConversationThread | undefined): (status: GitHubPrStatus | null) => void {
  const { t } = useTranslation('thread')
  const latest = useRef(thread)
  useEffect(() => { latest.current = thread })
  // The offer on screen: its conversation and PR, and its toast. `settled` once kept or archived, so it is not offered again.
  const offer = useRef<{ key: string; toastId: number; settled: boolean } | null>(null)

  const cancel = useCallback((): void => {
    const current = offer.current
    if (!current || current.settled) return
    dismissToast(current.toastId)
    offer.current = null
  }, [])

  // Another conversation on screen, or none: an open offer is withdrawn, nothing archived.
  useEffect(() => cancel, [thread?.id, cancel])
  useEffect(() => {
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [cancel])

  return useCallback((status: GitHubPrStatus | null): void => {
    const current = latest.current
    if (!current) return
    const found = prArchiveOffer(current, status)
    if (!found) return
    const key = `${current.id}#${found.prNumber}`
    if (offer.current?.key === key) return
    cancel()
    const threadId = current.id
    const entry = { key, toastId: 0, settled: false }
    entry.toastId = toast({
      title: t(found.merged ? 'prArchive.merged' : 'prArchive.closed', { number: found.prNumber }),
      description: t('prArchive.description'),
      duration: PR_ARCHIVE_OFFER_MS,
      action: { label: t('prArchive.keep'), run: () => { entry.settled = true; void window.oxe.thread?.keepAfterPr?.(threadId, found.prNumber).catch(() => undefined) } },
      onTimeout: () => {
        if (offer.current !== entry) return
        const stillHere = latest.current?.id === threadId && document.hasFocus()
        if (!stillHere) { offer.current = null; return }
        entry.settled = true
        void useThreadStore.getState().archiveThread(threadId)
      }
    })
    offer.current = entry
  }, [cancel, t])
}
