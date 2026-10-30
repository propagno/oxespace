import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { Upload } from 'lucide-react'
import type { ImportConflict, ImportPreview, ImportReadOptions, ImportResult, ImportTarget, OxeQueryConnection } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { Select } from '../../ui/Field'
import { toast } from '../../ui/Toast'
import { formatNumber } from '../../utils/formatTime'
import { ErrorState } from '../../ui/Display'
import { formatBytes } from './catalog'
import { PLAIN_ENCODINGS } from './examples'

/**
 * Import a CSV, JSON or NDJSON file into a table or collection. The file is
 * chosen in a native dialog and only an opaque id reaches this page. A dry run
 * executes the whole import inside a transaction and rolls it back, so the first
 * constraint violation is found before anything is written.
 */
export function ImportButton({ connection, target, onImported }: { connection: OxeQueryConnection; target: ImportTarget; onImported: () => void }): ReactElement | null {
  const { t } = useTranslation('oxequery')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [emptyAsNull, setEmptyAsNull] = useState(true)
  const [options, setOptions] = useState<ImportReadOptions>({ delimiter: 'auto', hasHeader: true, encoding: 'auto' })
  const [conflict, setConflict] = useState<ImportConflict>({ mode: 'error', columns: [] })
  const [busy, setBusy] = useState<'' | 'choosing' | 'dry' | 'import'>('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<string[] | null>(null)

  useEffect(() => {
    const api = window.oxe?.oxeQuery
    if (!api?.onEvent || !preview) return
    return api.onEvent(event => { if (event.type === 'import-progress' && event.importId === preview.importId) setProgress(event.rows) })
  }, [preview])

  if (connection.readOnly) return null

  const choose = async (): Promise<void> => {
    setBusy('choosing'); setError(''); setResult(null)
    try {
      const value = await oq('import.preview', { connectionId: connection.id, target })
      if (value.dismissed) return
      setPreview(value); setMapping(value.mapping); setOptions(value.options ?? { delimiter: 'auto', hasHeader: true, encoding: 'auto' }); setConflict({ mode: 'error', columns: [] })
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy('') }
  }

  // The same file read another way: another delimiter or encoding, or a first row that is data.
  const reread = async (next: ImportReadOptions): Promise<void> => {
    if (!preview) return
    setOptions(next); setError(''); setResult(null)
    try {
      const value = await oq('import.reparse', { connectionId: connection.id, importId: preview.importId, target, options: next })
      setPreview(current => current ? { ...current, fields: value.fields, sample: value.sample, detected: value.detected } : current)
      setMapping(value.mapping)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  const run = async (dryRun: boolean, confirmed = false): Promise<void> => {
    if (!preview) return
    setBusy(dryRun ? 'dry' : 'import'); setError(''); setResult(null); setProgress(0)
    try {
      const outcome = await oq('import.run', { connectionId: connection.id, importId: preview.importId, target, mapping, dryRun, emptyAsNull, confirmed, options, ...(target.kind === 'table' && conflict.mode !== 'error' ? { conflict } : {}) })
      setResult(outcome); setConfirm(null)
      if (!dryRun) toast({ title: t('import.finished'), description: t('import.finishedText', { count: outcome.inserted, formatted: formatNumber(outcome.inserted), rejected: formatNumber(outcome.rejected) }), intent: outcome.rejected ? 'warning' : 'success' })
      if (!dryRun && !outcome.cancelled) onImported()
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setConfirm(cause.reasons)
      else setError(errorMessage(cause))
    } finally { setBusy('') }
  }

  const close = (): void => { setPreview(null); setResult(null); setError(''); setConfirm(null); setProgress(0) }
  const mapped = Object.values(mapping).filter(Boolean).length
  const destination = target.kind === 'table' ? `${target.schema}.${target.table}` : `${target.database}.${target.collection}`

  return <>
    <button type="button" disabled={busy !== ''} onClick={() => void choose()}><Upload size={13} aria-hidden="true" />{t('common.import')}</button>
    {error && !preview && <ErrorState compact title={t('import.failed')} message={error} />}
    {preview && <Dialog className="oq-scope" title={t('import.title', { destination })} size="lg" closeLabel={t('common.close')} onClose={() => { if (busy === '') close() }}
      footer={<>
        <Button onClick={close}>{t('common.close')}</Button>
        <Button disabled={busy !== '' || mapped === 0} onClick={() => void run(true)}>{t('import.dryRun')}</Button>
        <Button variant="primary" disabled={busy !== '' || mapped === 0} onClick={() => void run(false)}>{t('common.import')}</Button>
      </>}>
        <p className="oq-muted">{preview.fileName} · {preview.format.toUpperCase()} · {formatBytes(preview.bytes)}</p>

        {preview.format === 'csv' && <fieldset className="oq-import-options">
          <legend>{t('import.howRead')}</legend>
          <label>{t('import.delimiter')}<Select className="oq-select" aria-label={t('import.delimiter')} value={options.delimiter ?? 'auto'} onChange={event => void reread({ ...options, delimiter: event.target.value as ImportReadOptions['delimiter'] })}>
            <option value="auto">{preview.detected ? t('import.detected', { value: preview.detected.delimiter === '\t' ? t('import.tab') : preview.detected.delimiter }) : t('import.detect')}</option>
            <option value=",">{t('import.comma')}</option><option value=";">{t('import.semicolon')}</option><option value={'\t'}>{t('import.tabName')}</option><option value="|">{t('import.pipe')}</option></Select></label>
          <label>{t('import.encoding')}<Select className="oq-select" aria-label={t('import.encoding')} value={options.encoding ?? 'auto'} onChange={event => void reread({ ...options, encoding: event.target.value as ImportReadOptions['encoding'] })}>
            <option value="auto">{preview.detected ? t('import.detected', { value: preview.detected.encoding }) : t('import.detect')}</option><option value="windows-1252">{t('import.windows1252')}</option>
            {PLAIN_ENCODINGS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>
          <label className="oq-inline"><input type="checkbox" aria-label={t('import.header')} checked={options.hasHeader !== false} onChange={event => void reread({ ...options, hasHeader: event.target.checked })} />{t('import.header')}</label>
        </fieldset>}

        <table className="oq-import-map">
          <thead><tr><th>{t('import.fileField')}</th><th>{t('import.sample')}</th><th>{t('import.goesTo')}</th></tr></thead>
          <tbody>{preview.fields.map((field, index) => <tr key={field}>
            <td>{field}</td>
            <td className="oq-muted">{preview.sample.slice(0, 2).map(row => row[index]).filter(Boolean).join(' · ').slice(0, 60)}</td>
            <td>{target.kind === 'table'
              ? <Select className="oq-select" aria-label={t('import.columnFor', { field })} value={mapping[field] ?? ''} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))}>
                <option value="">{t('import.skip')}</option>
                {preview.targetColumns.filter(column => !column.generated).map(column => <option key={column.name} value={column.name}>{column.name} ({column.type})</option>)}
              </Select>
              : <input aria-label={t('import.fieldFor', { field })} value={mapping[field] ?? ''} placeholder={t('import.skip')} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))} />}</td>
          </tr>)}</tbody>
        </table>
        {target.kind === 'table' && <fieldset className="oq-import-options">
          <legend>{t('import.conflictLegend')}</legend>
          <label>{t('import.then')}<Select className="oq-select" aria-label={t('import.whenKeyExists')} value={conflict.mode} onChange={event => setConflict({ ...conflict, mode: event.target.value as ImportConflict['mode'] })}>
            <option value="error">{t('import.conflict.error')}</option><option value="skip">{t('import.conflict.skip')}</option><option value="update">{t('import.conflict.update')}</option></Select></label>
          {conflict.mode !== 'error' && <div role="group" aria-label={t('import.keyColumns')} className="oq-import-keys">
            <span className="oq-muted">{conflict.mode === 'update' ? t('import.matchOn') : t('import.matchOnOptional')}</span>
            {[...new Set(Object.values(mapping).filter(Boolean))].map(column => <label key={column} className="oq-inline"><input type="checkbox" checked={conflict.columns.includes(column)}
              onChange={event => setConflict({ ...conflict, columns: event.target.checked ? [...conflict.columns, column] : conflict.columns.filter(item => item !== column) })} />{column}</label>)}
          </div>}
        </fieldset>}
        {target.kind === 'table' && <label className="oq-inline"><input type="checkbox" checked={emptyAsNull} onChange={event => setEmptyAsNull(event.target.checked)} />{t('import.emptyAsNull')}</label>}
        {target.kind === 'collection' && preview.format === 'csv' && <p className="oq-muted">{t('import.csvAsText')}</p>}

        {busy === 'dry' || busy === 'import' ? <p role="status">{t(busy === 'dry' ? 'import.checking' : 'import.importing', { count: progress, formatted: formatNumber(progress) })}
          <button type="button" onClick={() => void oq('import.cancel', { importId: preview.importId }).catch(() => undefined)}>{t('common.cancel')}</button></p> : null}
        {error && <ErrorState compact title={t('import.failed')} message={error} />}
        {result && <div role="status" className="oq-import-result">
          {result.cancelled ? <strong>{t('import.cancelled')}</strong>
            : result.dryRun ? <strong>{t('import.dryRunResult', { count: result.inserted, formatted: formatNumber(result.inserted), rejected: formatNumber(result.rejected) })}</strong>
              : <strong>{[t('import.imported', { count: result.inserted, formatted: formatNumber(result.inserted) }), result.updated ? t('import.updated', { formatted: formatNumber(result.updated) }) : '', result.skipped ? t('import.skipped', { formatted: formatNumber(result.skipped) }) : ''].filter(Boolean).join(', ')}; {t('import.rejected', { formatted: formatNumber(result.rejected) })}</strong>}
          {result.rejects.length > 0 && <ul>{result.rejects.slice(0, 8).map(item => <li key={item.row}>{t('import.rejectRow', { number: item.row, reason: item.reason })}</li>)}</ul>}
          {result.rejectsPath && <p className="oq-muted">{t('import.rejectsSaved', { file: result.rejectsPath.split(/[\\/]/).pop() })}</p>}
        </div>}
        {confirm && <ConfirmDialog danger title={t('import.confirmTitle')} confirmLabel={t('import.confirmAnyway')} cancelLabel={t('common.back')}
          description={t('import.confirmDescription')}
          onCancel={() => setConfirm(null)} onConfirm={() => void run(false, true)}>
          <ul>{confirm.map(item => <li key={item}>{item}</li>)}</ul>
        </ConfirmDialog>}
    </Dialog>}
  </>
}
