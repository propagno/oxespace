import { useEffect } from 'react'
import type { useOxeVoice } from '../../hooks/useOxeVoice'
import { useKeybindings } from '../../keyboard/keybindings'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'

/**
 * Shortcuts of the active conversation cell (transcript view, side panels,
 * configuration pickers; chords live in src/keyboard/keybindings.ts) and the global voice events.
 * Inactive cells (side-by-side layouts) listen to nothing.
 */
export function useThreadShortcuts({ active, voice, togglePanel, openControl, onFind }: {
  active: boolean
  voice: ReturnType<typeof useOxeVoice>
  togglePanel: (panel: ThreadPanel) => void
  openControl: (control: 'model' | 'effort' | 'permissions') => void
  onFind: () => void
}) {
  useEffect(() => {
    if (!active) return
    const toggle = () => voice.toggle(), start = () => voice.startHold(), end = () => voice.endHold()
    window.addEventListener('oxe:thread-toggle-voice', toggle)
    window.addEventListener('oxe:thread-voice-hold-start', start)
    window.addEventListener('oxe:thread-voice-hold-end', end)
    return () => { window.removeEventListener('oxe:thread-toggle-voice', toggle); window.removeEventListener('oxe:thread-voice-hold-start', start); window.removeEventListener('oxe:thread-voice-hold-end', end) }
  }, [active, voice])
  useKeybindings({
    'thread.find': onFind,
    'thread.viewMode': () => useThreadViewModeStore.getState().cycle(),
    'thread.terminal': () => togglePanel('terminal'),
    'thread.changes': () => togglePanel('changes'),
    'thread.browser': () => togglePanel('preview'),
    'thread.permissions': () => openControl('permissions'),
    'thread.model': () => openControl('model'),
    'thread.effort': () => openControl('effort')
  }, active)
}
