import { useEffect } from 'react'
import type { useOxeVoice } from '../../hooks/useOxeVoice'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'

/**
 * Window-level shortcuts of the active conversation cell: transcript view,
 * side panels, configuration pickers, and the global voice events.
 * Inactive cells (side-by-side layouts) listen to nothing.
 */
export function useThreadShortcuts({ active, voice, togglePanel, openControl }: {
  active: boolean
  voice: ReturnType<typeof useOxeVoice>
  togglePanel: (panel: ThreadPanel) => void
  openControl: (control: 'model' | 'effort' | 'permissions') => void
}) {
  useEffect(() => {
    if (!active) return
    const toggle = () => voice.toggle(), start = () => voice.startHold(), end = () => voice.endHold()
    window.addEventListener('oxe:thread-toggle-voice', toggle)
    window.addEventListener('oxe:thread-voice-hold-start', start)
    window.addEventListener('oxe:thread-voice-hold-end', end)
    return () => { window.removeEventListener('oxe:thread-toggle-voice', toggle); window.removeEventListener('oxe:thread-voice-hold-start', start); window.removeEventListener('oxe:thread-voice-hold-end', end) }
  }, [active, voice])
  // Re-subscribed every render so the handlers always see the current conversation.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      const inTerminal = event.target instanceof Element && Boolean(event.target.closest('.xterm'))
      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 'o' && !inTerminal) { event.preventDefault(); useThreadViewModeStore.getState().cycle() }
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '`') { event.preventDefault(); togglePanel('terminal') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'd') { event.preventDefault(); togglePanel('changes') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'b') { event.preventDefault(); togglePanel('preview') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'm') { event.preventDefault(); openControl('permissions') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'i') { event.preventDefault(); openControl('model') }
      else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'e') { event.preventDefault(); openControl('effort') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
