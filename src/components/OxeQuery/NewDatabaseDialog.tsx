import { useState, type FormEvent, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { Notice } from '../../ui/Display'
import { SegmentedControl } from '../../ui/Field'
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

  return <Dialog className="oq-scope" title={t('newDatabase.title')} size="md" closeLabel={t('common.close')} onClose={() => { if (!busy) onClose() }}
    description={<Trans t={t} i18nKey="newDatabase.description" components={{ code: <code /> }} />}
    footer={<>
      <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      <Button type="submit" form="oq-new-database-form" variant="primary" disabled={busy || !name.trim()} loading={busy}>{busy ? t('newDatabase.creating') : t('newDatabase.create')}</Button>
    </>}>
    <form id="oq-new-database-form" className="oq-dialog-form" onSubmit={event => void submit(event)}>
      <SegmentedControl label={t('newDatabase.engine')} className="oq-engine-choice" value={kind} onChange={value => { setKind(value); setTag(value === 'postgres' ? '17' : '8') }}
        options={ENGINES.map(({ id, name }) => ({ value: id, label: name }))} />
      <label>{t('newDatabase.name')}<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'postgres' ? 'pg-app' : 'mongo-app'} required autoFocus /></label>
      <label>{t('newDatabase.version')}<input value={tag} onChange={event => setTag(event.target.value)} aria-describedby="oq-tag-hint" required /></label>
      <small id="oq-tag-hint" className="oq-muted">{t('newDatabase.versionHint', { examples: kind === 'postgres' ? '17, 16-alpine' : '8, 7' })}</small>
      <label>{t('newDatabase.port')} <small className="oq-muted">{t('newDatabase.optional')}</small><input type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)} placeholder={t('newDatabase.portPlaceholder')} /></label>
      {error && <Notice intent="danger">{error}</Notice>}
    </form>
  </Dialog>
}
