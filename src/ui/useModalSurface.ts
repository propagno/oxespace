import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal behavior for full-height panels that bring their own layout (MCP, Skills, Scripts, Linear,
 * Semantic, Web Preview): Escape closes, Tab stays inside, focus moves in on open and back on close.
 * Spread the result on the element that has `role="dialog"`. Listeners are native so a nested Radix
 * dialog rendered in a portal keeps its own Escape.
 */
export function useModalSurface<T extends HTMLElement>(onClose: () => void, enabled = true): { ref: React.RefObject<T | null>; tabIndex: number } {
  const ref = useRef<T | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const surface = ref.current
    if (!enabled || !surface) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!surface.contains(document.activeElement)) surface.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => !item.closest('[hidden], [inert]'))
      if (!items.length) { event.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === surface)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    surface.addEventListener('keydown', onKeyDown)
    return () => {
      surface.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [enabled])
  return { ref, tabIndex: -1 }
}
