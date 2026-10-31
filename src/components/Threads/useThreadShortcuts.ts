import { useEffect, useLayoutEffect, useRef } from 'react'
import { THREAD_RUN_COMMAND_EVENT } from '../../commands/thread.commands'
import type { useOxeVoice } from '../../hooks/useOxeVoice'
import { useKeybindings } from '../../keyboard/keybindings'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'

/**
 * Shortcuts of the active conversation cell (transcript view, side panels,
 * configuration pickers; chords live in src/keyboard/keybindings.ts) and the global voice events.
 * Inactive cells (side-by-side layouts) listen to nothing.
 */
export function useThreadShortcuts({ active, voice, togglePanel, openControl, onFind, runCommand }: {
  active: boolean
  voice: ReturnType<typeof useOxeVoice>
  togglePanel: (panel: ThreadPanel) => void
  openControl: (control: 'model' | 'effort' | 'permissions') => void
  onFind: () => void
  /** Runs a composer command (the palette's Thread entries send these). */
  runCommand: (text: string) => Promise<void>
}) {
  const latestRun = useRef(runCommand)
  useLayoutEffect(() => { latestRun.current = runCommand })
  useEffect(() => {
    if (!active) return
    const run = (event: Event): void => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text
      if (text) void latestRun.current(text).catch(() => undefined)
    }
    window.addEventListener(THREAD_RUN_COMMAND_EVENT, run)
    return () => window.removeEventListener(THREAD_RUN_COMMAND_EVENT, run)
  }, [active])
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
