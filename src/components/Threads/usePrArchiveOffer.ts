import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubPrStatus } from '../../../shared/types/github'
import type { ConversationThread } from '../../../shared/types/thread'
import { useShownView } from '../../app/shownView'
import { useThreadStore } from '../../store/thread.store'
import { dismissToast, toast } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { PR_ARCHIVE_OFFER_MS, prArchiveOffer } from './prArchiveOffer'

/** Conversation and PR pairs answered in this app session (kept or archived): each comes up once (DESIGN on #442). */
const answeredThisSession = new Set<string>()

/** Tests: forget the session's answers. */
export function resetPrArchiveOffers(): void {
  answeredThisSession.clear()
}

/** The sidebar's Restore (Archived › a conversation): main resumes it, and the window adopts what main now says. */
async function restoreConversation(threadId: string, words: { restart: string; notRestored: string; failed: string }): Promise<void> {
  try {
    if (!window.oxe.thread?.command) throw Error(words.restart)
    await window.oxe.thread.command(threadId, `/resume ${threadId}`)
    const snapshot = await window.oxe.thread.read(threadId)
    if (snapshot.thread.archived) throw Error(words.notRestored)
    useThreadStore.getState().adopt(snapshot)
  } catch (error) {
    toast({ title: humanizeError(error, words.failed), intent: 'danger' })
  }
}

/**
 * T40 (B20, the person's decision X17; DESIGN option A on #442): when the PR read the conversation's status bar
 * already makes (PrStatusBar, every 30 s while it is shown) says the conversation's own PR closed or merged, a toast
 * says the conversation will be archived.
 * - Its time running out (PR_ARCHIVE_OFFER_MS, counted only while the toast is not hovered, focused or hidden)
 *   archives it, through the existing archiveThread, and says so politely, with Restore.
 * - Keep, ✕ and Escape all keep it: the PR is stored as kept (keptAfterPr) and nothing is archived. Closing a toast
 *   never commits an action.
 * - Leaving the conversation or OxeChat before the time runs out withdraws the toast and archives nothing; coming back
 *   to the same conversation shows it again with a fresh timer. A PR comes up at most once per session once answered.
 */
export function usePrArchiveOffer(thread: ConversationThread | undefined): (status: GitHubPrStatus | null) => void {
  const { t } = useTranslation('thread')
  const shown = useShownView() === 'thread'
  const latest = useRef({ thread, shown })
  useEffect(() => { latest.current = { thread, shown } })
  const lastStatus = useRef<{ threadId: string; status: GitHubPrStatus } | null>(null)
  const offer = useRef<{ key: string; toastId: number } | null>(null)

  const raise = useCallback((status: GitHubPrStatus | null): void => {
    const { thread: current, shown: onScreen } = latest.current
    if (!current) return
    if (status) lastStatus.current = { threadId: current.id, status }
    if (!onScreen || offer.current) return
    const found = prArchiveOffer(current, status)
    if (!found) return
    const key = `${current.id}#${found.prNumber}`
    if (answeredThisSession.has(key)) return
    const threadId = current.id
    const keep = (): void => {
      answeredThisSession.add(key)
      if (offer.current?.key === key) offer.current = null
      void window.oxe.thread?.keepAfterPr?.(threadId, found.prNumber).catch(() => undefined)
    }
    const toastId = toast({
      title: t(found.merged ? 'prArchive.merged' : 'prArchive.closed', { number: found.prNumber }),
      description: t('prArchive.description'),
      duration: PR_ARCHIVE_OFFER_MS,
      action: { label: t('prArchive.keep'), run: keep },
      onDismiss: keep,
      onTimeout: () => {
        if (offer.current?.key === key) offer.current = null
        // Only the conversation still on screen in OxeChat: one taken off it was withdrawn, never archived unseen.
        const now = latest.current
        if (!now.shown || now.thread?.id !== threadId || now.thread.archived) return
        answeredThisSession.add(key)
        void useThreadStore.getState().archiveThread(threadId).then(archived => {
          if (archived) toast({ title: t('prArchive.archived'), intent: 'success', action: { label: t('prArchive.restore'), run: () => { void restoreConversation(threadId, { restart: t('sidebar.restartToRestore'), notRestored: t('sidebar.notRestored'), failed: t('sidebar.restoreFailed') }) } } })
        })
      }
    })
    offer.current = { key, toastId }
  }, [t])

  // Leaving the conversation or OxeChat withdraws a toast not answered yet: nothing archived, nothing stored.
  useEffect(() => {
    if (shown) {
      // Back on the same conversation: the last read status raises it again, with a fresh timer.
      const last = lastStatus.current
      if (last && last.threadId === thread?.id) raise(last.status)
      return
    }
    const current = offer.current
    offer.current = null
    if (current) dismissToast(current.toastId)
  }, [shown, thread?.id, raise])
  useEffect(() => () => {
    const current = offer.current
    offer.current = null
    if (current) dismissToast(current.toastId)
  }, [thread?.id])

  return raise
}
