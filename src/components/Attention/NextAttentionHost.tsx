import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { goToNextAttention, NEXT_ATTENTION_EVENT } from '../../app/nextAttention'
import { useKeybindings, type AppView } from '../../keyboard/keybindings'
import { connectAttentionFeed } from '../../store/activity.feed'
import { Notice } from '../../ui'

/** How long "Nothing waiting for you" stays. */
const NOTICE_MS = 5_000

/**
 * Binds Ctrl+Shift+U (`attention.next`) and the palette command to the next one that needs the person (OXE-128).
 * With nothing waiting it changes nothing and says so in a status that goes away by itself.
 */
export function NextAttentionHost({ selectView }: { selectView: (view: AppView) => void }): ReactElement | null {
  const { t } = useTranslation()
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const next = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (goToNextAttention(selectView)) { setIdle(false); return }
    setIdle(true)
    timer.current = setTimeout(() => { timer.current = null; setIdle(false) }, NOTICE_MS)
  }, [selectView])

  useKeybindings({ 'attention.next': () => { next() } })

  useEffect(() => {
    connectAttentionFeed()
    const onCommand = (): void => { next() }
    window.addEventListener(NEXT_ATTENTION_EVENT, onCommand)
    return () => window.removeEventListener(NEXT_ATTENTION_EVENT, onCommand)
  }, [next])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!idle) return null
  return <div style={{ position: 'fixed', insetBlockEnd: 'var(--space-12)', insetInlineStart: '50%', transform: 'translateX(-50%)', zIndex: 'var(--layer-toast)' }}>
    <Notice intent="info">{t('activityCenter.nothingWaiting')}</Notice>
  </div>
}
