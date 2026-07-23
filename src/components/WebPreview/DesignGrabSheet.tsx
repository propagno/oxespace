import { Send, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { formatDesignGrab, type DesignGrabPayload } from '../../../shared/types/design-mode'

interface DesignGrabSheetProps {
  payload: DesignGrabPayload
  /** data: URI of the captured element, when the capture succeeded. */
  screenshot: string | null
  onSend: (prompt: string) => void
  onDismiss: () => void
}

/**
 * #3 · Confirmation sheet for a Design Mode grab. Nothing is sent to an agent
 * until the user reviews exactly what was captured and presses Send — the grab
 * carries page markup, so it must never leave silently.
 */
export function DesignGrabSheet({ onDismiss, onSend, payload, screenshot }: DesignGrabSheetProps): ReactElement {
  const [note, setNote] = useState('')

  return (
    <div className="design-grab-sheet" role="dialog" aria-label="Design Mode selection" data-testid="design-grab-sheet">
      <header className="design-grab-header">
        <div className="design-grab-title">
          <strong>{payload.tagName}</strong>
          <code>{payload.selector}</code>
        </div>
        <button type="button" className="icon-button" aria-label="Discard selection" onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="design-grab-body scrollbar-sleek">
        {screenshot ? <img className="design-grab-shot" src={screenshot} alt={`Capture of ${payload.selector}`} /> : null}
        <dl className="design-grab-facts">
          <div>
            <dt>Box</dt>
            <dd>
              {Math.round(payload.rect.width)}×{Math.round(payload.rect.height)}
            </dd>
          </div>
          {payload.text ? (
            <div>
              <dt>Text</dt>
              <dd className="design-grab-text">{payload.text}</dd>
            </div>
          ) : null}
          {payload.styles.slice(0, 6).map((style) => (
            <div key={style.property}>
              <dt>{style.property}</dt>
              <dd>{style.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <footer className="design-grab-footer">
        <textarea
          className="design-grab-note"
          placeholder="What should the agent change here? (Ctrl+Enter to send)"
          value={note}
          data-testid="design-grab-note"
          onChange={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              onSend(formatDesignGrab(payload, note))
            }
          }}
        />
        <button
          type="button"
          className="design-grab-send"
          data-testid="design-grab-send"
          onClick={() => onSend(formatDesignGrab(payload, note))}
        >
          <Send size={12} aria-hidden="true" />
          Send to agent
        </button>
      </footer>
    </div>
  )
}
