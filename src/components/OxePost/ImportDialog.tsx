import { useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import { Badge, Button, Checkbox, Dialog, ErrorState, SegmentedControl, TextArea, toast } from '../../ui'
import { messageOf, post } from './client'
import { parseImport, type ImportKind as Kind, type ParsedImport as Parsed } from './import-parse'
import { useOxePostStore } from './oxepost.store'
import styles from './OxePost.module.css'

/** Request files from a pasted cURL command or an OpenAPI 3 document (JSON or YAML). */
export function ImportDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('post')
  const [kind, setKind] = useState<Kind>('curl')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [makeEnvironment, setMakeEnvironment] = useState(true)
  const file = useRef<HTMLInputElement>(null)
  const environments = useOxePostStore(state => state.environments)

  const parsed = useMemo<{ value?: Parsed; error?: string }>(() => {
    if (!text.trim()) return {}
    try { return { value: parseImport(kind, text) } } catch (error) { return { error: messageOf(error) } }
  }, [kind, text])

  const readFile = async (selected: File | undefined): Promise<void> => {
    if (!selected) return
    if (selected.size > 10 * 1024 * 1024) { setFailure(t('import.tooLarge')); return }
    setFailure(''); setKind('openapi'); setText(await selected.text())
  }

  const run = async (): Promise<void> => {
    const value = parsed.value
    const { workspaceId } = useOxePostStore.getState()
    if (!value || !workspaceId) return
    setBusy(true); setFailure('')
    try {
      for (const item of value.requests) await post('save', { workspaceId, request: item.request, folder: item.folder })
      if (kind === 'openapi' && makeEnvironment && value.baseUrl && !environments.some(env => env.name.toLowerCase() === 'api')) {
        await post('envSave', { workspaceId, environment: { name: 'api', production: false, variables: { baseUrl: value.baseUrl }, secrets: [] } })
      }
      await useOxePostStore.getState().load(workspaceId)
      toast({ title: t('import.done', { count: value.requests.length }), intent: 'success' })
      onClose()
    } catch (error) { setFailure(messageOf(error)) } finally { setBusy(false) }
  }

  const count = parsed.value?.requests.length ?? 0
  return <Dialog title={t('import.title')} description={t('import.description')} size="lg" onClose={onClose} closeLabel={t('common.close')}
    footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" loading={busy} disabled={count === 0} onClick={() => void run()}>{t('import.run', { count })}</Button>
    </>}>
    <div className={styles.dialogStack}>
      <SegmentedControl label={t('import.kind')} value={kind} onChange={next => { setKind(next); setFailure('') }} options={[{ value: 'curl', label: 'cURL' }, { value: 'openapi', label: 'OpenAPI 3' }]} />
      <TextArea mono className={styles.importArea} aria-label={t('import.source')} placeholder={kind === 'curl' ? t('import.curlPlaceholder') : t('import.openapiPlaceholder')} spellCheck={false} value={text} onChange={event => setText(event.target.value)} />
      {kind === 'openapi' && <div>
        <input ref={file} type="file" accept=".json,.yaml,.yml,application/json" hidden aria-label={t('import.file')} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = '' }} />
        <Button size="sm" icon={<Upload size={13} aria-hidden="true" />} onClick={() => file.current?.click()}>{t('import.chooseFile')}</Button>
      </div>}
      {parsed.error && <p className={styles.warn} role="note">{parsed.error}</p>}
      {parsed.value && <section aria-label={t('import.preview')} className={styles.preview}>
        <p className={styles.hint}>{parsed.value.title ? t('import.found', { count, title: parsed.value.title }) : t('import.foundOne')}</p>
        <ul className={styles.previewList}>
          {parsed.value.requests.slice(0, 50).map((item, index) => <li key={index}><Badge>{item.request.method}</Badge> <span>{item.folder ? `${item.folder}/` : ''}{item.request.name}</span></li>)}
          {count > 50 && <li className={styles.hint}>{t('import.more', { count: count - 50 })}</li>}
        </ul>
        {parsed.value.warnings.map((warning, index) => <p key={index} className={styles.warn} role="note">{warning}</p>)}
        {kind === 'openapi' && parsed.value.baseUrl && <Checkbox label={t('import.makeEnvironment', { url: parsed.value.baseUrl })} checked={makeEnvironment} onChange={event => setMakeEnvironment(event.target.checked)} />}
      </section>}
      {failure && <ErrorState compact title={t('import.failed')} message={failure} />}
    </div>
  </Dialog>
}
