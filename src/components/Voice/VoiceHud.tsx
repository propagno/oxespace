import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { OxeVoiceStatus } from '../../hooks/useOxeVoice'

export function VoiceHud({ status, error, level, modelProgress, onDismiss, containerSelector = '.terminal-pane', focusSelector = '.xterm-helper-textarea' }: {
  status: OxeVoiceStatus; error: string | null; level: number; modelProgress: number | null; onDismiss: () => void; containerSelector?: string; focusSelector?: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const visible = Boolean(error || ['requesting', 'downloading', 'listening', 'transcribing'].includes(status))
  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent) => {
      const pane = element.current?.closest(containerSelector)
      if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof Node) || !pane?.contains(event.target)) return
      // Close only this pane's voice input; do not forward Escape to its CLI.
      event.preventDefault()
      event.stopPropagation()
      onDismiss()
      pane.querySelector<HTMLElement>(focusSelector)?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [visible, onDismiss, containerSelector, focusSelector])
  if (!visible) return null
  return <div ref={element} className={`oxe-voice-hud ${error ? 'error' : status}`} role="status" aria-live="polite">
    {status === 'listening' && !error ? <span className="oxe-voice-meter" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => <span key={i} className="oxe-voice-bar" style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, level * (1.4 - Math.abs(i - 2) * .25)))})` }} />)}
    </span> : <span className={`oxe-voice-pulse${status === 'transcribing' ? ' spin' : ''}`} aria-hidden="true" />}
    <span>{error ?? (status === 'requesting' ? 'Acessando microfone…' : status === 'downloading'
      ? `Baixando modelo de voz… ${Math.round((modelProgress ?? 0) * 100)}%` : status === 'transcribing' ? 'Transcrevendo…' : 'Ouvindo… solte para inserir')}</span>
    <button type="button" className="oxe-voice-dismiss" aria-label="Close voice input" title="Fechar voz (Esc)" onMouseDown={event => event.preventDefault()} onClick={() => {
      const pane = element.current?.closest(containerSelector)
      onDismiss()
      pane?.querySelector<HTMLElement>(focusSelector)?.focus()
    }}><X size={14} aria-hidden="true" /></button>
  </div>
}
