import { FileCode, MousePointerClick, Send, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { formatSourceLocation, type DesignGrabSource } from '../../../shared/design-source'
import type { DesignGrabContext, DesignGrabPayload } from '../../../shared/types/design-mode'
import { Button } from '../../ui'
import { useTranslation } from 'react-i18next'

/** One element the person picked, with what was found about it. */
export interface DesignGrabItem {
  id: string
  payload: DesignGrabPayload
  /** data: URI of the captured element, when the capture succeeded. */
  screenshot: string | null
  context: DesignGrabContext
  /** The project is still being searched for where the element is written. */
  locating: boolean
}

interface DesignGrabSheetProps {
  items: DesignGrabItem[]
  /** The picker is on: the next click in the page adds an element. */
  picking: boolean
  onSend: (note: string) => void
  onDismiss: () => void
  onRemove: (id: string) => void
  onAddAnother: () => void
  onChooseSource: (id: string, source: DesignGrabSource) => void
  onOpenSource?: (source: DesignGrabSource) => void
}

/**
 * #3 · Confirmation sheet for a Design Mode grab. Nothing is sent to an agent
 * until the user reviews exactly what was captured and presses Send — the grab
 * carries page markup, so it must never leave silently.
 */
export function DesignGrabSheet({ items, picking, onAddAnother, onChooseSource, onDismiss, onOpenSource, onRemove, onSend }: DesignGrabSheetProps): ReactElement {
  const { t } = useTranslation('code')
  const [note, setNote] = useState('')
  const single = items.length === 1 ? items[0] : null

  return (
    <div className="design-grab-sheet" role="dialog" aria-label={t('preview.grab.label')} data-testid="design-grab-sheet">
      <header className="design-grab-header">
        <div className="design-grab-title">
          {single
            ? <><strong>{single.payload.tagName}</strong><code>{single.payload.selector}</code></>
            : <strong>{t('preview.grab.selected', { count: items.length })}</strong>}
        </div>
        <Button variant="ghost" size="sm" square aria-label={t('preview.grab.discard')} title={t('preview.grab.discard')} onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </Button>
      </header>

      <div className="design-grab-body scrollbar-sleek">
        {items.map(item => (
          <section className="design-grab-item" key={item.id} data-testid="design-grab-item" aria-label={item.payload.selector}>
            {!single ? (
              <div className="design-grab-item-head">
                <strong>{item.payload.tagName}</strong><code>{item.payload.selector}</code>
                <button type="button" className="design-grab-remove" aria-label={t('preview.grab.remove', { selector: item.payload.selector })} title={t('preview.grab.remove', { selector: item.payload.selector })} onClick={() => onRemove(item.id)}><X size={12} aria-hidden="true" /></button>
              </div>
            ) : null}
            {item.screenshot ? <img className="design-grab-shot" src={item.screenshot} alt={t('preview.grab.capture', { selector: item.payload.selector })} /> : null}
            <GrabSource item={item} onChoose={source => onChooseSource(item.id, source)} onOpen={onOpenSource} />
            <dl className="design-grab-facts">
              <div>
                <dt>{t('preview.grab.box')}</dt>
                <dd>
                  {Math.round(item.payload.rect.width)}×{Math.round(item.payload.rect.height)}
                </dd>
              </div>
              {item.payload.text ? (
                <div>
                  <dt>{t('preview.grab.text')}</dt>
                  <dd className="design-grab-text">{item.payload.text}</dd>
                </div>
              ) : null}
              {item.payload.styles.slice(0, single ? 6 : 3).map((style) => (
                <div key={style.property}>
                  <dt>{style.property}</dt>
                  <dd>{style.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <footer className="design-grab-footer">
        <button type="button" className="design-grab-add" aria-pressed={picking} data-testid="design-grab-add" title={t('preview.grab.addAnotherTitle')} onClick={onAddAnother}>
          <MousePointerClick size={12} aria-hidden="true" />
          {picking ? t('preview.grab.picking') : t('preview.grab.addAnother')}
        </button>
        <textarea
          className="design-grab-note"
          aria-label={t('preview.grab.note')}
          placeholder={t('preview.grab.notePlaceholder')}
          value={note}
          data-testid="design-grab-note"
          onChange={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              onSend(note)
            }
          }}
        />
        <button
          type="button"
          className="design-grab-send"
          data-testid="design-grab-send"
          onClick={() => onSend(note)}
        >
          <Send size={12} aria-hidden="true" />
          {t('preview.grab.send')}
        </button>
      </footer>
    </div>
  )
}

/** Where the element is written: the file and line, how sure that is, and the other places when a search found several. */
function GrabSource({ item, onChoose, onOpen }: { item: DesignGrabItem; onChoose: (source: DesignGrabSource) => void; onOpen?: (source: DesignGrabSource) => void }): ReactElement {
  const { t } = useTranslation('code')
  const { source, candidates, components }: DesignGrabContext = item.context
  if (item.locating) return <p className="design-grab-source" data-testid="design-grab-source" data-state="locating" role="status">{t('preview.grab.locating')}</p>
  if (!source) return <p className="design-grab-source" data-testid="design-grab-source" data-state="none">{t('preview.grab.noSource')}</p>
  const location = formatSourceLocation(source)
  const hint = source.origin === 'search' ? t('preview.grab.bySearch') : source.approximate ? t('preview.grab.approximate') : null
  return (
    <div className="design-grab-source" data-testid="design-grab-source" data-state="found" data-origin={source.origin}>
      <FileCode size={12} aria-hidden="true" />
      {onOpen
        ? <button type="button" className="design-grab-source-file" title={t('preview.grab.openSource', { location })} onClick={() => onOpen(source)}>{location}</button>
        : <code className="design-grab-source-file">{location}</code>}
      {source.component ? <span className="design-grab-source-component">{components.length > 1 ? components.slice(0, 3).join(' ‹ ') : source.component}</span> : null}
      {hint ? <small>{hint}</small> : null}
      {candidates.length > 0 ? (
        <label className="design-grab-source-others">
          <span>{t('preview.grab.otherPlaces')}</span>
          <select aria-label={t('preview.grab.otherPlaces')} value="" onChange={event => { const next = candidates[Number(event.currentTarget.value)]; if (next) onChoose(next) }}>
            <option value="" disabled>{t('preview.grab.choosePlace')}</option>
            {candidates.map((candidate, index) => <option key={`${candidate.file}:${candidate.line ?? 0}`} value={index}>{formatSourceLocation(candidate)}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  )
}
