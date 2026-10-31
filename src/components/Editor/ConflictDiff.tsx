import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'

interface ConflictDiffProps {
  localContent: string
  externalContent: string
  /** Take the version on disk, or keep the local edits (saving writes them over the disk). */
  onResolve: (keep: 'disk' | 'mine') => void
}

/** The file changed on disk while it had unsaved edits: both versions side by side, and a choice. */
export function ConflictDiff({ externalContent, localContent, onResolve }: ConflictDiffProps): ReactElement {
  const { t } = useTranslation('code')
  return (
    <section className="editor-conflict" aria-label={t('editor.conflict.label')}>
      <div className="editor-conflict-header">
        <strong>{t('editor.conflict.title')}</strong>
        <span>{t('editor.conflict.kept')}</span>
        <Button size="sm" variant="secondary" onClick={() => onResolve('disk')}>{t('editor.conflict.useDisk')}</Button>
        <Button size="sm" variant="ghost" onClick={() => onResolve('mine')}>{t('editor.conflict.keepMine')}</Button>
      </div>
      <div className="editor-conflict-grid">
        <figure><figcaption>{t('editor.conflict.local')}</figcaption><pre>{localContent}</pre></figure>
        <figure><figcaption>{t('editor.conflict.external')}</figcaption><pre>{externalContent}</pre></figure>
      </div>
    </section>
  )
}
