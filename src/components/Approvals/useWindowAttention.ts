import { useEffect, useState } from 'react'

/** Whether the person can see the window and it has the keyboard. */
export interface WindowAttention { visible: boolean; focused: boolean }

export function readAttention(): WindowAttention {
  return { visible: document.visibilityState === 'visible', focused: document.hasFocus() }
}

export const attentive = (attention: WindowAttention): boolean => attention.visible && attention.focused

/**
 * The window's visibility (`visibilitychange`) and focus (window `focus`/`blur`), as they change. A blur is taken
 * from the event, not from document.hasFocus(), which some engines still report true while the blur is dispatched.
 */
export function useWindowAttention(): WindowAttention {
  const [attention, setAttention] = useState(readAttention)
  useEffect(() => {
    const update = (next: Partial<WindowAttention>): void => setAttention(current => {
      const merged = { ...current, ...next }
      return merged.visible === current.visible && merged.focused === current.focused ? current : merged
    })
    const onVisibility = (): void => update({ visible: document.visibilityState === 'visible', ...(document.visibilityState === 'visible' ? {} : { focused: false }) })
    const onFocus = (): void => update({ focused: true, visible: document.visibilityState === 'visible' })
    const onBlur = (): void => update({ focused: false })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    // Something may have changed between the first render and these listeners.
    update(readAttention())
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return attention
}
