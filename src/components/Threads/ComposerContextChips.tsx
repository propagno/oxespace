import { useState, type ReactElement } from 'react'
import { ClipboardList, FileText, Folder, GitCompareArrows, MessageSquareText, TerminalSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComposerContextItem } from '../../../shared/types/composer-context'
import { Button, IconButton, Popover } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import styles from './ComposerContextChips.module.css'

const PREVIEW_MAX_CHARS = 8_000

export interface ComposerContextChipsProps {
  items: readonly ComposerContextItem[]
  disabled?: boolean
  onRemove: (id: string) => void
  onInlinePaste?: (item: Extract<ComposerContextItem, { kind: 'pasted-text' }>) => void
}

function chipIcon(kind: ComposerContextItem['kind']): ReactElement {
  switch (kind) {
    case 'file':
      return <FileText size={12} aria-hidden="true" className={styles.icon} />
    case 'folder':
      return <Folder size={12} aria-hidden="true" className={styles.icon} />
    case 'pasted-text':
      return <ClipboardList size={12} aria-hidden="true" className={styles.icon} />
    case 'changes':
      return <GitCompareArrows size={12} aria-hidden="true" className={styles.icon} />
    case 'terminal':
      return <TerminalSquare size={12} aria-hidden="true" className={styles.icon} />
    case 'thread':
      return <MessageSquareText size={12} aria-hidden="true" className={styles.icon} />
  }
}

function parentFolderHint(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : ''
}

function PastedTextChip({
  item,
  disabled,
  onRemove,
  onInlinePaste
}: {
  item: Extract<ComposerContextItem, { kind: 'pasted-text' }>
  disabled: boolean
  onRemove: (id: string) => void
  onInlinePaste?: (item: Extract<ComposerContextItem, { kind: 'pasted-text' }>) => void
}): ReactElement {
  const { t } = useTranslation('thread')
  const [open, setOpen] = useState(false)
  const label = t('composer.pastedTextChip', { count: item.lineCount })
  const preview = item.content.length > PREVIEW_MAX_CHARS
    ? `${item.content.slice(0, PREVIEW_MAX_CHARS)}\n…`
    : item.content

  return (
    <span
      role="listitem"
      className={styles.chip}
      data-ui="composer-context-chip"
      data-context-kind="pasted-text"
      data-testid="composer-context-chip"
      title={t('composer.pastedMeta', { lines: formatNumber(item.lineCount), chars: formatNumber(item.charCount) })}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        label={t('composer.pastedPreviewTitle')}
        className={styles.previewPopover}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={styles.previewTrigger}
            disabled={disabled}
            aria-expanded={open}
          >
            {chipIcon('pasted-text')}
            <span className={styles.label}>{label}</span>
          </Button>
        }
      >
        <div className={styles.previewHeader}>
          <strong>{t('composer.pastedPreviewTitle')}</strong>
          <small>{t('composer.pastedMeta', { lines: formatNumber(item.lineCount), chars: formatNumber(item.charCount) })}</small>
        </div>
        <pre className={styles.previewBody} data-testid="pasted-text-preview">{preview}</pre>
        <div className={styles.previewFooter}>
          {onInlinePaste && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => { setOpen(false); onInlinePaste(item) }}
            >
              {t('composer.insertIntoMessage')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => { setOpen(false); onRemove(item.id) }}
          >
            {t('composer.remove', { name: t('composer.pastedText') })}
          </Button>
        </div>
      </Popover>
      <IconButton
        size="sm"
        variant="ghost"
        className={styles.remove}
        icon={<X size={12} aria-hidden="true" />}
        label={t('composer.removeContext', { label })}
        title={t('composer.removeContext', { label })}
        disabled={disabled}
        onClick={() => onRemove(item.id)}
      />
    </span>
  )
}

/**
 * Quiet Obsidian Minimal chip strip rendered above the composer textarea for attached files,
 * folders, auto-collapsed long pastes, and @changes / @terminal / @folder / @thread context items (OXE-478).
 */
export function ComposerContextChips({
  items,
  disabled = false,
  onRemove,
  onInlinePaste
}: ComposerContextChipsProps): ReactElement | null {
  const { t } = useTranslation('thread')
  if (items.length === 0) return null

  return (
    <div
      className={styles.list}
      role="list"
      aria-label={t('composer.contextChips')}
      data-ui="composer-context-chips"
      data-testid="composer-context-chips"
    >
      {items.map(item => {
        if (item.kind === 'pasted-text') {
          return (
            <PastedTextChip
              key={item.id}
              item={item}
              disabled={disabled}
              onRemove={onRemove}
              onInlinePaste={onInlinePaste}
            />
          )
        }

        const label = item.kind === 'folder' && item.path === '.'
          ? t('composer.contextSources.folderRoot')
          : item.label
        const meta = item.kind === 'file' || item.kind === 'folder'
          ? (!item.isRelative ? t('composer.outsideWorkspace') : parentFolderHint(item.path))
          : item.kind === 'thread'
            ? '@thread'
            : ''
        const tooltip = item.kind === 'file' || item.kind === 'folder'
          ? item.path
          : item.kind === 'thread'
            ? `${t('composer.contextSources.thread')}: ${item.label}`
            : item.label

        return (
          <span
            key={item.id}
            role="listitem"
            className={styles.chip}
            data-ui="composer-context-chip"
            data-context-kind={item.kind}
            data-testid="composer-context-chip"
            title={tooltip}
          >
            {chipIcon(item.kind)}
            <span className={styles.label}>{label}</span>
            {meta ? <span className={styles.meta}>{meta}</span> : null}
            <IconButton
              size="sm"
              variant="ghost"
              className={styles.remove}
              icon={<X size={12} aria-hidden="true" />}
              label={t('composer.removeContext', { label })}
              title={t('composer.removeContext', { label })}
              disabled={disabled}
              onClick={() => onRemove(item.id)}
            />
          </span>
        )
      })}
    </div>
  )
}
