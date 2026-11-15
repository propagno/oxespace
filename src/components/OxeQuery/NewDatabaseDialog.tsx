import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Dialog } from '../../ui'
import { Notice } from '../../ui/Display'
import { SegmentedControl, TextField } from '../../ui/Field'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

/** Product names, the same in every language. */
const ENGINES: Array<{ id: 'postgres' | 'mongodb'; name: string }> = [{ id: 'postgres', name: 'PostgreSQL' }, { id: 'mongodb', name: 'MongoDB' }]

/**
 * Creates a PostgreSQL or MongoDB container and the connection to it in one step. It stays in OxeQuery: the person
 * asked for a database, and lands on it here; the container it starts shows up in OxePod like any other.
 */
export function NewDatabaseDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [kind, setKind] = useState<'postgres' | 'mongodb'>('postgres')
  const [name, setName] = useState('')
  const [tag, setTag] = useState('17')
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const connection = await oq('connections.createInContainer', { engine: kind, name: name.trim(), tag: tag.trim(), ...(port.trim() ? { port: Number(port) } : {}) })
      await useOxeQueryStore.getState().refreshConnections()
      useOxeQueryStore.getState().openConnection(connection)
      onClose()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  return <Dialog title={t('newDatabase.title')} size="md" closeLabel={t('common.close')} onClose={() => { if (!busy) onClose() }}
    description={<Trans t={t} i18nKey="newDatabase.description" components={{ code: <code /> }} />}
    actions={{
      cancel: { label: t('common.cancel'), disabled: busy },
      // The form submits itself, so the browser still checks the required fields.
      primary: { label: busy ? t('newDatabase.creating') : t('newDatabase.create'), loading: busy, disabled: !name.trim(), onClick: () => formRef.current?.requestSubmit() }
    }}>
    <form ref={formRef} id="oq-new-database-form" className="oq-scope oq-dialog-form" onSubmit={event => void submit(event)}>
      <SegmentedControl label={t('newDatabase.engine')} className="oq-engine-choice" value={kind} onChange={value => { setKind(value); setTag(value === 'postgres' ? '17' : '8') }}
        options={ENGINES.map(({ id, name }) => ({ value: id, label: name }))} />
      {/* The src/ui fields: the label above, the hint under, the field as wide as the form (OXE-160: a field the browser
          sized cut "first free port" to "first free p", and labels sat inline with their fields). */}
      <TextField label={t('newDatabase.name')} value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'postgres' ? 'pg-app' : 'mongo-app'} required autoFocus />
      <TextField label={t('newDatabase.version')} hint={t('newDatabase.versionHint', { examples: kind === 'postgres' ? '17, 16-alpine' : '8, 7' })} value={tag} onChange={event => setTag(event.target.value)} required />
      <TextField label={<>{t('newDatabase.port')} <span className="oq-muted">{t('newDatabase.optional')}</span></>} type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)} placeholder={t('newDatabase.portPlaceholder')} />
      {error && <Notice intent="danger">{error}</Notice>}
    </form>
  </Dialog>
}
