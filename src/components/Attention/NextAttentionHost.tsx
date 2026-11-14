import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { goToNextAttention, NEXT_ATTENTION_EVENT } from '../../app/nextAttention'
import { useKeybindings, type AppView } from '../../keyboard/keybindings'
import { connectAttentionFeed } from '../../store/activity.feed'
import { cx } from '../../ui'
import styles from '../Navigation/TitleBar.module.css'

/** How long "Nothing waiting for you" stays before it goes by itself. */
const NOTICE_MS = 6000

/**
 * Ctrl+Shift+U (OXE-128): goes to the next pane or conversation that needs the person, oldest first, in a cycle.
 * With nothing waiting it changes nothing and says so in a status that goes away by itself.
 */
export function NextAttentionHost({ selectView }: { selectView: (view: AppView) => void }): ReactElement {
  const { t } = useTranslation()
  const [notice, setNotice] = useState(0)

  useEffect(() => { connectAttentionFeed() }, [])

  const go = useCallback(() => {
    if (goToNextAttention(selectView)) setNotice(0)
    else setNotice(count => count + 1)
  }, [selectView])

  useKeybindings({ 'attention.next': () => { go() } })

  useEffect(() => {
    const onRequest = (): void => go()
    window.addEventListener(NEXT_ATTENTION_EVENT, onRequest)
    return () => window.removeEventListener(NEXT_ATTENTION_EVENT, onRequest)
  }, [go])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(0), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <span role="status" aria-live="polite" data-testid="next-attention-status">
      {notice > 0 && <span className={cx(styles.needs, styles.needsZero)}>{t('attention.next.nothing')}</span>}
    </span>
  )
}
