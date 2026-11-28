import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import styles from './TitleTooltips.module.css'

const DELAY_MS = 400
const CHROME = 44
const EDGE = 8
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
        setTip({ text, x: rect.left + rect.width / 2, y: below ? rect.bottom + 6 : Math.max(rect.top - 6, CHROME), below })
      }, DELAY_MS)
    }
    const titled = (node: EventTarget | null): HTMLElement | null =>
      (node instanceof Element ? (node.closest('[title]') as HTMLElement | null) : null)
    const leave = (next: EventTarget | null): void => {
      if (!current || (next instanceof Node && current.contains(next))) return
      restore()
    }
    const listeners: Array<[keyof DocumentEventMap, EventListener]> = [
      ['pointerover', (e) => { const pe = e as PointerEvent; if (pe.pointerType !== 'touch') { const t = titled(pe.target); if (t) begin(t) } }],
      ['pointerout', (e) => leave((e as PointerEvent).relatedTarget)],
      ['pointerdown', () => { lastWasKey = false; restore() }],
      ['keydown', (e) => { lastWasKey = true; if ((e as KeyboardEvent).key !== 'Tab') restore() }],
      ['focusin', (e) => { if (lastWasKey) { const t = titled(e.target); if (t) begin(t) } }],
      ['focusout', (e) => leave((e as FocusEvent).relatedTarget)],
      ['scroll', restore]
    ]
    for (const [ev, fn] of listeners) document.addEventListener(ev, fn, true)
    window.addEventListener('blur', restore)
    return () => {
      restore()
      for (const [ev, fn] of listeners) document.removeEventListener(ev, fn, true)
      window.removeEventListener('blur', restore)
    }
  }, [])

  if (!tip) return null
  const clamp = (el: HTMLDivElement | null): void => {
    if (!el) return
    const half = (el.getBoundingClientRect().width || el.offsetWidth) / 2
    const min = EDGE + half
    el.style.left = `${Math.min(Math.max(tip.x, min), Math.max(min, window.innerWidth - EDGE - half))}px`
  }
  return createPortal(
    <div ref={clamp} role="tooltip" className={styles.tip} style={{ left: Math.min(Math.max(tip.x, EDGE), Math.max(EDGE, window.innerWidth - EDGE)), top: tip.y, transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }}>{tip.text}</div>,
    document.body
  )
}
