import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shown and reachable: not in a hidden or inert subtree, and not hidden by CSS (a collapsed section, display: none). */
function reachable(item: HTMLElement): boolean {
  if (item.closest('[hidden], [inert]')) return false
  if (typeof item.checkVisibility === 'function') return item.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions)
  // Without checkVisibility (older engines, jsdom): the computed styles up the tree.
  for (let node: Element | null = item; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/**
 * Everything outside the surface becomes inert while it is open, so neither Tab nor a screen reader's virtual cursor
 * leaves it: each sibling on the way from the surface up to <body>. Returns the undo. Elements that were inert
 * already stay so.
 */
function inertOutside(surface: HTMLElement): () => void {
  const marked: HTMLElement[] = []
  for (let node: HTMLElement | null = surface; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute('inert') || sibling.tagName === 'SCRIPT') continue
      sibling.setAttribute('inert', '')
      marked.push(sibling)
    }
  }
  return () => { for (const element of marked) element.removeAttribute('inert') }
}

/**
 * Modal behavior for full-height panels that bring their own layout (MCP, Skills, Scripts, Linear,
 * Semantic, Web Preview): Escape closes, Tab stays inside and only on controls that are shown, the rest of the window
 * is inert, focus moves in on open and back on close. Spread the result on the element that has `role="dialog"`.
 * Listeners are native so a nested Radix dialog rendered in a portal keeps its own Escape; it opens after the panel,
 * so it is not made inert.
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
    const restore = inertOutside(surface)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(reachable)
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
      restore()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [enabled])
  return { ref, tabIndex: -1 }
}
