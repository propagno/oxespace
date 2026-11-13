import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { toast } from '../../ui/Toast'

/**
 * Says what a Compact did (CHAT-18). The turn ran and ended "Finished" with no word on what changed. When a turn
 * whose message is /compact finishes, the context is read again and the person is told how much of the window it
 * took before and takes now; without both numbers, that the conversation was compacted.
 */
export function useCompactFeedback(snapshot: ThreadSnapshot | null): void {
  const { t } = useTranslation('thread')
  const watching = useRef<{ turn: string; before: number | null } | null>(null)
  const id = snapshot?.thread.id
  const last = snapshot?.turns?.at(-1)
  const turn = last?.id
  const status = last?.status
  const compact = Boolean(turn && snapshot?.events.some(event => event.type === 'message' && event.role === 'user' && event.id === turn && event.text.trim() === '/compact'))
  const percentage = useRef<number | null>(null)
  percentage.current = snapshot?.thread.contextReport?.percentage ?? null

  useEffect(() => {
    if (!id || !turn || !compact) return
    if (status === 'running') {
      if (watching.current?.turn !== turn) watching.current = { turn, before: percentage.current }
      return
    }
    const watched = watching.current
    if (!watched || watched.turn !== turn) return
    watching.current = null
    if (status !== 'completed') return
    void Promise.resolve(window.oxe?.thread?.contextUsage?.(id)).catch(() => null).then(report => {
      const after = report?.percentage ?? null
      toast({ title: watched.before !== null && after !== null ? t('compactFeedback.done', { before: watched.before, after }) : t('compactFeedback.doneNoNumbers') })
    })
  }, [id, turn, compact, status, t])
}
