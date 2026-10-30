import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { HardDrive, Trash2 } from 'lucide-react'
import type { ContainerEngine, DiskUsageRow, ImageInfo, NetworkInfo, ResourceKind, VolumeInfo } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

type Tab = 'images' | 'volumes' | 'networks'

/** Images, volumes and networks of the engine, with the space they take and a confirmed remove. */
export function ResourcesPanel({ engine, active }: { engine?: ContainerEngine; active: boolean }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [tab, setTab] = useState<Tab>('images')
  const [images, setImages] = useState<ImageInfo[]>([])
  const [volumes, setVolumes] = useState<VolumeInfo[]>([])
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [usage, setUsage] = useState<DiskUsageRow[]>([])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<{ kind: ResourceKind; id: string; label: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [a, b, c, d] = await Promise.all([
        oq('resources.images', { engine }), oq('resources.volumes', { engine }), oq('resources.networks', { engine }), oq('resources.usage', { engine }).catch(() => [] as DiskUsageRow[])
      ])
      setImages(a); setVolumes(b); setNetworks(c); setUsage(d); setError('')
    } catch (cause) { setError(errorMessage(cause)) }
  }, [engine])
  useEffect(() => { if (active) void load() }, [active, load])

  const remove = async (): Promise<void> => {
    if (!confirming) return
    try { await oq('resources.remove', { kind: confirming.kind, id: confirming.id, engine, confirmed: true }); setConfirming(null); await load() }
    catch (cause) { setError(errorMessage(cause)); setConfirming(null) }
  }

  const ask = (kind: ResourceKind, id: string, label: string): void => setConfirming({ kind, id, label })
  const count = { images: images.length, volumes: volumes.length, networks: networks.length }

  return <section className="oq-resources" aria-label={t('resources.label')}>
    <header>
      <HardDrive size={14} aria-hidden="true" />
      <div role="tablist" className="oq-segment">
        {(['images', 'volumes', 'networks'] as Tab[]).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} data-selected={tab === value} onClick={() => setTab(value)}>
          {t(`resources.tab.${value}`, { count: count[value] })}</button>)}
      </div>
      <span className="oq-spacer" />
      {usage.length > 0 && <small className="oq-muted">{usage.map(row => row.reclaimable ? t('resources.usageReclaimable', { type: row.type, size: row.size, reclaimable: row.reclaimable.replace(/\s*\(.*\)/, '') }) : t('resources.usage', { type: row.type, size: row.size })).join(' · ')}</small>}
    </header>
    {error && <p role="alert" className="oq-error">{error}</p>}
    {confirming && <ConfirmDialog danger title={t(`resources.removeTitle.${confirming.kind}`, { name: confirming.label })} confirmLabel={t('common.remove')} cancelLabel={t('common.cancel')}
      description={`${t(`resources.removeWarning.${confirming.kind}`)} ${t('resources.inUse')}`}
      onCancel={() => setConfirming(null)} onConfirm={() => void remove()} />}
    <div className="oq-table-wrap">
        {tab === 'images' && <table className="oq-table" aria-label={t('resources.tab.images', { count: images.length })}><thead><tr><th>{t('resources.column.repository')}</th><th>{t('resources.column.tag')}</th><th>{t('resources.column.size')}</th><th>{t('resources.column.created')}</th><th /></tr></thead>
          <tbody>{images.map(item => <tr key={item.id}><td>{item.repository}</td><td>{item.tag}</td><td>{item.size}</td><td>{item.created}</td>
            <td><button type="button" aria-label={t('resources.removeNamed.image', { name: `${item.repository}:${item.tag}` })} onClick={() => ask('image', item.id, `${item.repository}:${item.tag}`)}><Trash2 size={12} aria-hidden="true" /></button></td></tr>)}</tbody></table>}
        {tab === 'volumes' && <table className="oq-table" aria-label={t('resources.tab.volumes', { count: volumes.length })}><thead><tr><th>{t('resources.column.name')}</th><th>{t('resources.column.driver')}</th><th /></tr></thead>
          <tbody>{volumes.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.driver}</td>
            <td><button type="button" aria-label={t('resources.removeNamed.volume', { name: item.name })} onClick={() => ask('volume', item.name, item.name)}><Trash2 size={12} aria-hidden="true" /></button></td></tr>)}</tbody></table>}
        {tab === 'networks' && <table className="oq-table" aria-label={t('resources.tab.networks', { count: networks.length })}><thead><tr><th>{t('resources.column.name')}</th><th>{t('resources.column.driver')}</th><th>{t('resources.column.scope')}</th><th /></tr></thead>
          <tbody>{networks.map(item => <tr key={item.id || item.name}><td>{item.name}</td><td>{item.driver}</td><td>{item.scope}</td>
            <td>{['bridge', 'host', 'none'].includes(item.name) ? null : <button type="button" aria-label={t('resources.removeNamed.network', { name: item.name })} onClick={() => ask('network', item.name, item.name)}><Trash2 size={12} aria-hidden="true" /></button>}</td></tr>)}</tbody></table>}
    </div>
  </section>
}

/** Creates a PostgreSQL or MongoDB container and the connection to it in one step. */
export function NewDatabaseDialog({ engine, onClose }: { engine?: ContainerEngine; onClose: () => void }): ReactElement {
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
      const connection = await oq('containers.createDatabase', {
        engine: kind, name: name.trim(), tag: tag.trim(), ...(port.trim() ? { port: Number(port) } : {}), ...(engine ? { engineName: engine } : {})
      })
      await useOxeQueryStore.getState().refreshConnections()
      await useOxeQueryStore.getState().refreshContainers()
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
      <div role="radiogroup" aria-label={t('newDatabase.engine')} className="oq-segment">
        {(['postgres', 'mongodb'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={kind === value} data-selected={kind === value}
          onClick={() => { setKind(value); setTag(value === 'postgres' ? '17' : '8') }}>{value === 'postgres' ? 'PostgreSQL' : 'MongoDB'}</button>)}
      </div>
      <label>{t('newDatabase.name')}<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'postgres' ? 'pg-app' : 'mongo-app'} required autoFocus /></label>
      <label>{t('newDatabase.version')}<input value={tag} onChange={event => setTag(event.target.value)} aria-describedby="oq-tag-hint" required /></label>
      <small id="oq-tag-hint" className="oq-muted">{t('newDatabase.versionHint', { examples: kind === 'postgres' ? '17, 16-alpine' : '8, 7' })}</small>
      <label>{t('newDatabase.port')} <small className="oq-muted">{t('newDatabase.optional')}</small><input type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)} placeholder={t('newDatabase.portPlaceholder')} /></label>
      {error && <p role="alert" className="oq-error">{error}</p>}
    </form>
  </Dialog>
}
