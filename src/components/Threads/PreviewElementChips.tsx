import { MousePointerClick, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PreviewElementRef } from '../../../shared/types/design-mode'
import { IconButton } from '../../ui'
import styles from './PreviewElementChips.module.css'

export interface PreviewElementChipsProps {
  elements: readonly PreviewElementRef[]
  disabled?: boolean
  onRemove: (id: string) => void
}

/**
 * Structured removable chips for elements picked in the Web Preview (OXE-10).
 * Keeps the composer free of raw markup blocks while showing each element's
 * concise label and CSS selector.
 */
export function PreviewElementChips({ elements, disabled = false, onRemove }: PreviewElementChipsProps): ReactElement | null {
  const { t } = useTranslation('thread')
  if (elements.length === 0) return null
  return (
    <div className={styles.list} role="list" aria-label={t('composer.previewElements')} data-testid="preview-element-chips">
      {elements.map(item => (
        <span
          key={item.id}
          role="listitem"
          className={styles.chip}
          data-ui="preview-element-chip"
          data-testid="preview-element-chip"
          title={`${item.label} (${item.selector})`}
        >
          <MousePointerClick size={12} aria-hidden="true" className={styles.icon} />
          <span className={styles.label} data-testid="preview-element-label">{item.label}</span>
          <code className={styles.selector} data-testid="preview-element-selector">{item.selector}</code>
          <IconButton
            size="sm"
            variant="ghost"
            icon={<X size={12} aria-hidden="true" />}
            label={t('composer.removePreviewElement', { label: item.label, selector: item.selector })}
            disabled={disabled}
            onClick={() => onRemove(item.id)}
          />
        </span>
      ))}
    </div>
  )
}
