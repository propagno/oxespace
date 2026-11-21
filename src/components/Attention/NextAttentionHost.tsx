import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { goToNextAttention, NEXT_ATTENTION_EVENT } from '../../app/nextAttention'
import { useKeybindings, type AppView } from '../../keyboard/keybindings'
import { connectAttentionFeed, isAttentionSummaryReady, whenAttentionSummaryReady } from '../../store/activity.feed'
import { toast } from '../../ui'

/**
 * Binds Ctrl+Shift+U (`attention.next`) and the palette command to the next one that needs the person (OXE-128).
 * With nothing waiting it changes nothing and says so in a toast, which the app's Toaster places, times and announces.
 * If pressed while the startup attention summary is still loading (OXE-287), waits for it instead of dropping the press.
 */
export function NextAttentionHost({ selectView }: { selectView: (view: AppView) => void }): ReactElement | null {
  const { t } = useTranslation()
  const mounted = useRef(true)
  const waitingReady = useRef(false)
  const answer = useCallback(() => {
    if (!goToNextAttention(selectView)) toast({ title: t('activityCenter.nothingWaiting') })
  }, [selectView, t])
  const answerRef = useRef(answer)
  useEffect(() => { answerRef.current = answer }, [answer])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const next = useCallback(() => {
    connectAttentionFeed()
    if (isAttentionSummaryReady()) {
      answerRef.current()
      return
    }
    if (waitingReady.current) return
    waitingReady.current = true
    void whenAttentionSummaryReady().then(() => {
      waitingReady.current = false
      if (mounted.current) answerRef.current()
    })
  }, [])

  useKeybindings({ 'attention.next': () => { next() } })

  useEffect(() => {
    connectAttentionFeed()
    const onCommand = (): void => { next() }
    window.addEventListener(NEXT_ATTENTION_EVENT, onCommand)
    return () => window.removeEventListener(NEXT_ATTENTION_EVENT, onCommand)
  }, [next])

  return null
}
