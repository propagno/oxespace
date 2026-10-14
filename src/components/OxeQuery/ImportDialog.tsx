import { useEffect, useState, type ReactElement } from 'react'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { Upload } from 'lucide-react'
import type { ImportConflict, ImportPreview, ImportReadOptions, ImportResult, ImportTarget, OxeQueryConnection } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'

/**
 * Import a CSV, JSON or NDJSON file into a table or collection. The file is
 * chosen in a native dialog and only an opaque id reaches this page. A dry run
 * executes the whole import inside a transaction and rolls it back, so the first
 * constraint violation is found before anything is written.
 */
export function ImportButton({ connection, target, onImported }: { connection: OxeQueryConnection; target: ImportTarget; onImported: () => void }): ReactElement | null {
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
    <button type="button" disabled={busy !== ''} onClick={() => void choose()}><Upload size={13} aria-hidden="true" />Import</button>
    {error && !preview && <span role="alert" className="oq-error">{error}</span>}
    {preview && <Dialog title={`Import into ${destination}`} size="lg" onClose={() => { if (busy === '') close() }}
      footer={<>
        <Button onClick={close}>Close</Button>
        <Button disabled={busy !== '' || mapped === 0} onClick={() => void run(true)}>Dry run</Button>
        <Button variant="primary" disabled={busy !== '' || mapped === 0} onClick={() => void run(false)}>Import</Button>
      </>}>
        <p className="oq-muted">{preview.fileName} · {preview.format.toUpperCase()} · {(preview.bytes / 1024).toFixed(1)} KB</p>

        {preview.format === 'csv' && <fieldset className="oq-import-options">
          <legend>How the file is read</legend>
          <label>Delimiter<select aria-label="Delimiter" value={options.delimiter ?? 'auto'} onChange={event => void reread({ ...options, delimiter: event.target.value as ImportReadOptions['delimiter'] })}>
            <option value="auto">Detect{preview.detected ? ` (${preview.detected.delimiter === '\t' ? 'tab' : preview.detected.delimiter})` : ''}</option>
            <option value=",">Comma ,</option><option value=";">Semicolon ;</option><option value={'\t'}>Tab</option><option value="|">Pipe |</option></select></label>
          <label>Encoding<select aria-label="Encoding" value={options.encoding ?? 'auto'} onChange={event => void reread({ ...options, encoding: event.target.value as ImportReadOptions['encoding'] })}>
            <option value="auto">Detect{preview.detected ? ` (${preview.detected.encoding})` : ''}</option><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252 (Excel, Western Europe)</option>
            <option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
          <label className="oq-inline"><input type="checkbox" aria-label="First row is a header" checked={options.hasHeader !== false} onChange={event => void reread({ ...options, hasHeader: event.target.checked })} />First row is a header</label>
        </fieldset>}

        <table className="oq-import-map">
          <thead><tr><th>File field</th><th>Sample</th><th>Goes to</th></tr></thead>
          <tbody>{preview.fields.map((field, index) => <tr key={field}>
            <td>{field}</td>
            <td className="oq-muted">{preview.sample.slice(0, 2).map(row => row[index]).filter(Boolean).join(' · ').slice(0, 60)}</td>
            <td>{target.kind === 'table'
              ? <select aria-label={`Column for ${field}`} value={mapping[field] ?? ''} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))}>
                <option value="">— skip —</option>
                {preview.targetColumns.filter(column => !column.generated).map(column => <option key={column.name} value={column.name}>{column.name} ({column.type})</option>)}
              </select>
              : <input aria-label={`Field name for ${field}`} value={mapping[field] ?? ''} placeholder="— skip —" onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))} />}</td>
          </tr>)}</tbody>
        </table>
        {target.kind === 'table' && <fieldset className="oq-import-options">
          <legend>If a row with the same key already exists</legend>
          <label>Then<select aria-label="When a key exists" value={conflict.mode} onChange={event => setConflict({ ...conflict, mode: event.target.value as ImportConflict['mode'] })}>
            <option value="error">Stop the import (nothing is kept)</option><option value="skip">Skip that row</option><option value="update">Update that row</option></select></label>
          {conflict.mode !== 'error' && <div role="group" aria-label="Key columns" className="oq-import-keys">
            <span className="oq-muted">Rows match on {conflict.mode === 'update' ? '' : '(optional) '}the columns that make up a unique key:</span>
            {[...new Set(Object.values(mapping).filter(Boolean))].map(column => <label key={column} className="oq-inline"><input type="checkbox" checked={conflict.columns.includes(column)}
              onChange={event => setConflict({ ...conflict, columns: event.target.checked ? [...conflict.columns, column] : conflict.columns.filter(item => item !== column) })} />{column}</label>)}
          </div>}
        </fieldset>}
        {target.kind === 'table' && <label className="oq-inline"><input type="checkbox" checked={emptyAsNull} onChange={event => setEmptyAsNull(event.target.checked)} />Empty values become NULL (when the column allows it)</label>}
        {target.kind === 'collection' && preview.format === 'csv' && <p className="oq-muted">CSV values are imported as text.</p>}

        {busy === 'dry' || busy === 'import' ? <p role="status">{busy === 'dry' ? 'Checking' : 'Importing'}… {progress.toLocaleString()} rows
          <button type="button" onClick={() => void oq('import.cancel', { importId: preview.importId }).catch(() => undefined)}>Cancel</button></p> : null}
        {error && <p role="alert" className="oq-error">{error}</p>}
        {result && <div role="status" className="oq-import-result">
          {result.cancelled ? <strong>Cancelled. Nothing was imported.</strong>
            : result.dryRun ? <strong>Dry run: {result.inserted.toLocaleString()} row{result.inserted === 1 ? '' : 's'} would be imported, {result.rejected.toLocaleString()} rejected. Nothing was written.</strong>
              : <strong>Imported {result.inserted.toLocaleString()} row{result.inserted === 1 ? '' : 's'}{result.updated ? `, updated ${result.updated.toLocaleString()}` : ''}{result.skipped ? `, skipped ${result.skipped.toLocaleString()} that already existed` : ''}; {result.rejected.toLocaleString()} rejected.</strong>}
          {result.rejects.length > 0 && <ul>{result.rejects.slice(0, 8).map(item => <li key={item.row}>Row {item.row}: {item.reason}</li>)}</ul>}
          {result.rejectsPath && <p className="oq-muted">Rejected rows saved to {result.rejectsPath.split(/[\\/]/).pop()}.</p>}
        </div>}
        {confirm && <ConfirmDialog danger title="Confirm this import" confirmLabel="Import anyway" cancelLabel="Back"
          description="Check these before anything is written."
          onCancel={() => setConfirm(null)} onConfirm={() => void run(false, true)}>
          <ul>{confirm.map(item => <li key={item}>{item}</li>)}</ul>
        </ConfirmDialog>}
    </Dialog>}
  </>
}
