import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { Database, HardDrive, Trash2 } from 'lucide-react'
import type { ContainerEngine, DiskUsageRow, ImageInfo, NetworkInfo, ResourceKind, VolumeInfo } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

type Tab = 'images' | 'volumes' | 'networks'

/** Images, volumes and networks of the engine, with the space they take and a confirmed remove. */
export function ResourcesPanel({ engine, active }: { engine?: ContainerEngine; active: boolean }): ReactElement {
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

  return <section className="oq-resources" aria-label="Images, volumes and networks">
    <header>
      <HardDrive size={14} aria-hidden="true" />
      <div role="tablist" className="oq-segment">
        {(['images', 'volumes', 'networks'] as Tab[]).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} data-selected={tab === value} onClick={() => setTab(value)}>
          {value} ({value === 'images' ? images.length : value === 'volumes' ? volumes.length : networks.length})</button>)}
      </div>
      <span className="oq-spacer" />
      {usage.length > 0 && <small className="oq-muted">{usage.map(row => `${row.type}: ${row.size}${row.reclaimable ? ` (${row.reclaimable.replace(/\s*\(.*\)/, '')} reclaimable)` : ''}`).join(' · ')}</small>}
    </header>
    {error && <p role="alert" className="oq-error">{error}</p>}
    {confirming && <ConfirmDialog danger title={`Remove ${confirming.kind} ${confirming.label}?`} confirmLabel="Remove"
      description={<>{confirming.kind === 'volume' ? 'The data in this volume is deleted and cannot be recovered.' : confirming.kind === 'image' ? 'Containers can no longer be created from it until it is pulled again.' : 'Containers attached to this network are not affected, but it is removed.'} The engine refuses when it is still in use.</>}
      onCancel={() => setConfirming(null)} onConfirm={() => void remove()} />}
    <div className="oq-table-wrap">
      {tab === 'images' && <table className="oq-table" aria-label="Images"><thead><tr><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th><th /></tr></thead>
        <tbody>{images.map(item => <tr key={item.id}><td>{item.repository}</td><td>{item.tag}</td><td>{item.size}</td><td>{item.created}</td>
          <td><button type="button" aria-label={`Remove image ${item.repository}:${item.tag}`} onClick={() => ask('image', item.id, `${item.repository}:${item.tag}`)}><Trash2 size={12} aria-hidden="true" /></button></td></tr>)}</tbody></table>}
      {tab === 'volumes' && <table className="oq-table" aria-label="Volumes"><thead><tr><th>Name</th><th>Driver</th><th /></tr></thead>
        <tbody>{volumes.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.driver}</td>
          <td><button type="button" aria-label={`Remove volume ${item.name}`} onClick={() => ask('volume', item.name, item.name)}><Trash2 size={12} aria-hidden="true" /></button></td></tr>)}</tbody></table>}
      {tab === 'networks' && <table className="oq-table" aria-label="Networks"><thead><tr><th>Name</th><th>Driver</th><th>Scope</th><th /></tr></thead>
        <tbody>{networks.map(item => <tr key={item.id || item.name}><td>{item.name}</td><td>{item.driver}</td><td>{item.scope}</td>
          <td>{['bridge', 'host', 'none'].includes(item.name) ? null : <button type="button" aria-label={`Remove network ${item.name}`} onClick={() => ask('network', item.name, item.name)}><Trash2 size={12} aria-hidden="true" /></button>}</td></tr>)}</tbody></table>}
    </div>
  </section>
}

/** Creates a PostgreSQL or MongoDB container and the connection to it in one step. */
export function NewDatabaseDialog({ engine, onClose }: { engine?: ContainerEngine; onClose: () => void }): ReactElement {
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

  return <Dialog title="New database" size="md" onClose={() => { if (!busy) onClose() }}
    description={<>Starts a container bound to <code>127.0.0.1</code> with a named volume and a generated password, then connects to it. The first start may need to download the image.</>}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" form="oq-new-database-form" variant="primary" disabled={busy || !name.trim()} loading={busy}>{busy ? 'Creating…' : 'Create and connect'}</Button>
    </>}>
    <form id="oq-new-database-form" className="oq-dialog-form" onSubmit={event => void submit(event)}>
      <div role="group" aria-label="Engine" className="oq-segment">
        {(['postgres', 'mongodb'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={kind === value} data-selected={kind === value}
          onClick={() => { setKind(value); setTag(value === 'postgres' ? '17' : '8') }}>{value === 'postgres' ? 'PostgreSQL' : 'MongoDB'}</button>)}
      </div>
      <label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'postgres' ? 'pg-app' : 'mongo-app'} required autoFocus /></label>
      <label>Version<input value={tag} onChange={event => setTag(event.target.value)} aria-describedby="oq-tag-hint" required /></label>
      <small id="oq-tag-hint" className="oq-muted">An image tag such as {kind === 'postgres' ? '17, 16-alpine' : '8, 7'}.</small>
      <label>Host port <small className="oq-muted">(optional)</small><input type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)} placeholder="first free port" /></label>
      {error && <p role="alert" className="oq-error">{error}</p>}
    </form>
  </Dialog>
}
