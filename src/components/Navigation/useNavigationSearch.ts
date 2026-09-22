import { useEffect, type RefObject } from 'react'
import { useUIStore } from '../../store/ui.store'

export function useNavigationSearch(ref: RefObject<HTMLInputElement | null>, collapsed: boolean, expand: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key !== '/') return
      if (useUIStore.getState().isSettingsOpen || useUIStore.getState().isWorkspaceSettingsOpen || document.querySelector('[role="dialog"], dialog[open]')) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      event.preventDefault()
      if (collapsed) expand()
      requestAnimationFrame(() => ref.current?.focus())
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [ref, collapsed, expand])
}
