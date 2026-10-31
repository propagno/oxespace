import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiagnosticsBundlePreview } from '../../../shared/types/diagnostics'
import { Button, Dialog, ErrorState, LoadingState, toast } from '../../ui'
import { formatMainMessage, mainMessageFromError } from '../../i18n/messages'
import { humanizeError } from '../../utils/humanizeError'
import { formatBytes } from './diagnosticsFormat'
import styles from './Diagnostics.module.css'

/** The refusals of the export the main process sends as C3 codes (B8.3): the bundle is over a size cap. */
const SAVE_REFUSALS = ['diagnostics.bundle.fileTooLarge', 'diagnostics.bundle.tooLarge'] as const

/**
 * Export with a preview first: what the .zip will contain, already redacted, and only then the save dialog.
 * Nothing is written until the person presses Save, and nothing is sent anywhere.
 */
export function BundleExportDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('settings')
  const [preview, setPreview] = useState<DiagnosticsBundlePreview | null>(null)
  const api = window.oxe?.diagnostics
  // Empty text: the preview is not available in this version; ErrorState's title already says it failed.
  const [failure, setFailure] = useState<string | null>(() => api?.previewBundle ? null : '')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    if (!api?.previewBundle) return
    api.previewBundle().then(
      value => { if (alive) setPreview(value) },
      cause => { if (alive) setFailure(humanizeError(cause)) }
    )
    return () => { alive = false }
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (): Promise<void> => {
    if (!api?.exportBundle) return
    setSaving(true); setNote('')
    try {
      const path = await api.exportBundle()
      if (path) { toast({ title: t('diagnostics.bundle.saved'), description: path, intent: 'success' }); onClose() }
      else setNote(t('diagnostics.bundle.cancelled'))
    } catch (cause) {
      toast({ title: t('diagnostics.bundle.saveFailed'), description: mainMessageFromError(cause, SAVE_REFUSALS) ?? humanizeError(cause), intent: 'danger' })
    } finally { setSaving(false) }
  }

  return <Dialog title={t('diagnostics.bundle.title')} description={t('diagnostics.bundle.description')} onClose={() => { if (!saving) onClose() }} testId="diagnostics-bundle-preview"
    footer={<>
      <Button disabled={saving} onClick={onClose}>{t('ui.cancel', { ns: 'common' })}</Button>
      <Button variant="primary" loading={saving} disabled={!preview || !api?.exportBundle} onClick={() => { void save() }}>{t('diagnostics.bundle.save')}</Button>
    </>}>
    {failure !== null
      ? <ErrorState compact title={t('diagnostics.bundle.failed')} message={failure || undefined} onRetry={api?.previewBundle ? () => { setFailure(null); setAttempt(value => value + 1) } : undefined} />
      : !preview
        ? <LoadingState label={t('diagnostics.bundle.loading')} />
        : <div className={styles.bundle}>
          <h3 className={styles.bundleTitle}>{t('diagnostics.bundle.files')}</h3>
          <ul className={styles.bundleFiles}>
            {preview.files.map(file => <li key={file.name}>
              <code>{file.name}</code>
              <span className={styles.detail}>{formatBytes(file.bytes)}</span>
              <span className={styles.bundleSummary}>{formatMainMessage(file.summary)}</span>
            </li>)}
          </ul>
          <p className={styles.note}>{preview.redactions > 0 ? t('diagnostics.bundle.redactions', { count: preview.redactions }) : t('diagnostics.bundle.redactionsNone')}</p>
        </div>}
    {note && <p className={styles.note} role="status">{note}</p>}
  </Dialog>
}
