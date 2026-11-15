import { useCallback, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { goToNextAttention, NEXT_ATTENTION_EVENT } from '../../app/nextAttention'
import { useKeybindings, type AppView } from '../../keyboard/keybindings'
import { connectAttentionFeed } from '../../store/activity.feed'
import { toast } from '../../ui'

/**
 * Binds Ctrl+Shift+U (`attention.next`) and the palette command to the next one that needs the person (OXE-128).
 * With nothing waiting it changes nothing and says so in a toast, which the app's Toaster places, times and announces.
 */
export function NextAttentionHost({ selectView }: { selectView: (view: AppView) => void }): ReactElement | null {
  const { t } = useTranslation()

  const next = useCallback(() => {
    if (!goToNextAttention(selectView)) toast({ title: t('activityCenter.nothingWaiting') })
  }, [selectView, t])

  useKeybindings({ 'attention.next': () => { next() } })

  useEffect(() => {
    connectAttentionFeed()
    const onCommand = (): void => { next() }
    window.addEventListener(NEXT_ATTENTION_EVENT, onCommand)
    return () => window.removeEventListener(NEXT_ATTENTION_EVENT, onCommand)
  }, [next])

  return null
}
