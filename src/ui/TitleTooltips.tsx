import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import styles from './TitleTooltips.module.css'

const DELAY_MS = 400
const CHROME = 44
const SKIP = '.xterm, iframe, webview, [data-native-title]'

interface Tip { text: string; x: number; y: number; below: boolean }

/**
 * Shows every native `title` hint as a styled tooltip that follows the theme.
 * Pointer hover and keyboard focus (the last input was a key, not :focus-visible) both wait 400 ms.
 * Tab only moves focus: it must not dismiss the hint that focus starts. Escape and leaving restore the title.
 * The attribute is lifted off the element while the hint is pending or visible and restored afterwards,
 * so accessible names and tests that read `title` at rest are unchanged.
 */
export function TitleTooltips(): ReactElement | null {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let text = ''
    let timer = 0
    let lastWasKey = false

    const restore = (): void => {
      window.clearTimeout(timer)
      if (current && text && !current.hasAttribute('title')) current.setAttribute('title', text)
      current = null; text = ''
      setTip(null)
    }
    const begin = (target: HTMLElement): void => {
      if (target === current || target.closest(SKIP)) return
      const title = target.getAttribute('title')?.trim()
      if (!title) return
      restore()
      current = target; text = title
      target.removeAttribute('title')
      timer = window.setTimeout(() => {
        const rect = target.getBoundingClientRect()
        const below = rect.bottom + 40 < window.innerHeight
        setTip({ text, x: Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12), y: below ? rect.bottom + 6 : Math.max(rect.top - 6, CHROME), below })
      }, DELAY_MS)
    }
    const titled = (node: EventTarget | null): HTMLElement | null => {
      const element = node instanceof Element ? node : null
      return (element?.closest('[title]') as HTMLElement | null) ?? null
    }
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return
      const target = titled(event.target)
      if (!target) return
      begin(target)
    }
    const onOut = (event: PointerEvent): void => {
      if (!current) return
      const next = event.relatedTarget as Node | null
      if (next && current.contains(next)) return
      restore()
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (!lastWasKey) return
      const target = titled(event.target)
      if (!target) return
      begin(target)
    }
    const onFocusOut = (event: FocusEvent): void => {
      if (!current) return
      const next = event.relatedTarget as Node | null
      if (next && current.contains(next)) return
      restore()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      lastWasKey = true
      if (event.key === 'Tab') return
      restore()
    }
    const onPointerDown = (): void => {
      lastWasKey = false
      restore()
    }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('blur', restore)
    document.addEventListener('scroll', restore, true)
    return () => {
      restore()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('blur', restore)
      document.removeEventListener('scroll', restore, true)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div role="tooltip" className={styles.tip} style={{ left: tip.x, top: tip.y, transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }}>{tip.text}</div>,
    document.body
  )
}
