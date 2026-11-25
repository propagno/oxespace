import { useEffect, useState, type RefObject } from 'react'

/**
 * Returns true when the document is active and the element (plus every ancestor up to <html>)
 * is connected and not hidden via `hidden`, `display: none`, `visibility: hidden`, or `checkVisibility()`.
 */
export function isElementVisible(element: HTMLElement | null): boolean {
  if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
    return false
  }
  if (!element) return true
  if (!element.isConnected) return false
  let target: HTMLElement | null = null
  const hasComputedStyle = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden) return false
    if (node.style.display === 'none' || node.style.visibility === 'hidden') return false
    let display = node.style.display
    if (hasComputedStyle) {
      const computed = window.getComputedStyle(node)
      if (computed.display === 'none' || computed.visibility === 'hidden') return false
      display = computed.display || display
    }
    // Chromium's checkVisibility() always returns false for `display: contents` elements
    // because they generate no CSS layout box; resolve to the nearest layout-box ancestor.
    if (!target && display !== 'contents') {
      target = node
    }
  }
  if (target && typeof target.checkVisibility === 'function' && !target.checkVisibility({ visibilityProperty: true })) {
    return false
  }
  return true
}

/**
 * Tracks whether an element is currently visible on screen (document visible and no ancestor hidden).
 * Observes `visibilitychange` plus attribute mutations along the element's ancestor chain only.
 */
export function useElementVisibility(ref: RefObject<HTMLElement | null>, refreshKey?: unknown): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden && document.visibilityState !== 'hidden'
  )

  useEffect(() => {
    let active = true
    const sync = (): void => {
      if (!active) return
      setVisible(isElementVisible(ref.current))
    }
    queueMicrotask(sync)
    document.addEventListener('visibilitychange', sync)

    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null
    if (observer && ref.current) {
      for (let node: HTMLElement | null = ref.current; node && node !== document.documentElement; node = node.parentElement) {
        observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] })
      }
    }

    return () => {
      active = false
      document.removeEventListener('visibilitychange', sync)
      observer?.disconnect()
    }
  }, [ref, refreshKey])

  return visible
}
