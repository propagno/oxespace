import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import type { ContainerEngine, DiskUsageRow, ImageInfo, NetworkInfo, PruneKind, ResourceKind, VolumeInfo } from '../../../shared/types/oxepod'
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, SegmentedControl, toast } from '../../ui'
import { errorMessage, pod } from './client'
import { useOxePodStore } from './oxepod.store'
import styles from './OxePod.module.css'

type Tab = 'images' | 'volumes' | 'networks'
/** The engine's own networks; it refuses to remove them, so no button is offered. */
const BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none', 'podman'])

/** Images, volumes and networks of the engine, with the space they take, a confirmed remove and confirmed clean-ups. */
export function ResourcesPanel({ engine, active }: { engine?: ContainerEngine; active: boolean }): ReactElement {
  const { t } = useTranslation('pods')
  const [tab, setTab] = useState<Tab>('images')
  const [images, setImages] = useState<ImageInfo[]>([])
  const [volumes, setVolumes] = useState<VolumeInfo[]>([])
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [usage, setUsage] = useState<DiskUsageRow[]>([])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<{ kind: ResourceKind; id: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingPrune = useOxePodStore(state => state.pendingPrune)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [a, b, c, d] = await Promise.all([
        pod('resources.images', { engine }), pod('resources.volumes', { engine }), pod('resources.networks', { engine }), pod('resources.usage', { engine }).catch(() => [] as DiskUsageRow[])
      ])
      setImages(a); setVolumes(b); setNetworks(c); setUsage(d); setError('')
    } catch (cause) { setError(errorMessage(cause)) }
  }, [engine])
  useEffect(() => { if (active) void load() }, [active, load])

  const remove = async (): Promise<void> => {
    if (!confirming) return
    setBusy(true)
    try { await pod('resources.remove', { kind: confirming.kind, id: confirming.id, engine, confirmed: true }); setConfirming(null); await load() }
    catch (cause) { setError(errorMessage(cause)); setConfirming(null) } finally { setBusy(false) }
  }

  const prune = async (kind: PruneKind): Promise<void> => {
    setBusy(true)
    try {
      const result = await pod('resources.prune', { kind, engine, confirmed: true })
      toast({ title: t(`prune.done.${kind}`), description: result.output.split('\n').pop() || undefined, intent: 'success' })
      useOxePodStore.getState().askPrune(null)
      await Promise.all([load(), useOxePodStore.getState().refresh()])
    } catch (cause) { setError(errorMessage(cause)); useOxePodStore.getState().askPrune(null) } finally { setBusy(false) }
  }

  const count = { images: images.length, volumes: volumes.length, networks: networks.length }
  const ask = (kind: ResourceKind, id: string, label: string): void => setConfirming({ kind, id, label })
  const removeButton = (kind: ResourceKind, id: string, label: string): ReactElement =>
    <IconButton size="sm" label={t(`resources.removeNamed.${kind}`, { name: label })} icon={<Trash2 size={13} aria-hidden="true" />} onClick={() => ask(kind, id, label)} />

  return <section className={styles.resources} aria-label={t('resources.label')}>
    <header className={styles.viewHeader}>
      <HardDrive size={15} aria-hidden="true" />
      <h2 className={styles.title}>{t('resources.label')}</h2>
      <span className={styles.spacer} />
      <Button size="sm" variant="ghost" icon={<Eraser size={13} aria-hidden="true" />} onClick={() => useOxePodStore.getState().askPrune('containers')}>{t('prune.containers')}</Button>
      <Button size="sm" variant="ghost" icon={<Eraser size={13} aria-hidden="true" />} onClick={() => useOxePodStore.getState().askPrune('images')}>{t('prune.images')}</Button>
      <IconButton size="sm" label={t('common.refresh')} icon={<RefreshCw size={13} aria-hidden="true" />} onClick={() => void load()} />
    </header>
    <div className={styles.toolbar}>
      <SegmentedControl label={t('resources.kind')} value={tab} onChange={setTab} options={(['images', 'volumes', 'networks'] as Tab[]).map(value => ({ value, label: t(`resources.tab.${value}`, { count: count[value] }) }))} />
      <span className={styles.spacer} />
      {usage.length > 0 && <small className={styles.muted}>{usage.map(row => row.reclaimable ? t('resources.usageReclaimable', { type: row.type, size: row.size, reclaimable: row.reclaimable.replace(/\s*\(.*\)/, '') }) : t('resources.usage', { type: row.type, size: row.size })).join(' · ')}</small>}
    </div>
    {error && <div className={styles.inset}><ErrorState compact title={t('resources.failed')} message={error} onRetry={() => void load()} retryLabel={t('common.tryAgain')} /></div>}
    <div className={styles.scroll}>
      {tab === 'images' && (images.length === 0 ? <EmptyState compact title={t('resources.empty.images')} /> : <table className={styles.table} aria-label={t('resources.tab.images', { count: images.length })}>
        <thead><tr><th>{t('resources.column.repository')}</th><th>{t('resources.column.tag')}</th><th>{t('resources.column.size')}</th><th>{t('resources.column.created')}</th><th><span className={styles.srOnly}>{t('resources.column.actions')}</span></th></tr></thead>
        <tbody>{images.map(item => <tr key={item.id}><td>{item.repository}</td><td>{item.tag}</td><td>{item.size}</td><td>{item.created}</td><td className={styles.cellAction}>{removeButton('image', item.id, `${item.repository}:${item.tag}`)}</td></tr>)}</tbody></table>)}
      {tab === 'volumes' && (volumes.length === 0 ? <EmptyState compact title={t('resources.empty.volumes')} /> : <table className={styles.table} aria-label={t('resources.tab.volumes', { count: volumes.length })}>
        <thead><tr><th>{t('resources.column.name')}</th><th>{t('resources.column.driver')}</th><th><span className={styles.srOnly}>{t('resources.column.actions')}</span></th></tr></thead>
        <tbody>{volumes.map(item => <tr key={item.name}><td className={styles.mono}>{item.name}</td><td>{item.driver}</td><td className={styles.cellAction}>{removeButton('volume', item.name, item.name)}</td></tr>)}</tbody></table>)}
      {tab === 'networks' && (networks.length === 0 ? <EmptyState compact title={t('resources.empty.networks')} /> : <table className={styles.table} aria-label={t('resources.tab.networks', { count: networks.length })}>
        <thead><tr><th>{t('resources.column.name')}</th><th>{t('resources.column.driver')}</th><th>{t('resources.column.scope')}</th><th><span className={styles.srOnly}>{t('resources.column.actions')}</span></th></tr></thead>
        <tbody>{networks.map(item => <tr key={item.id || item.name}><td>{item.name}</td><td>{item.driver}</td><td>{item.scope}</td><td className={styles.cellAction}>{BUILT_IN_NETWORKS.has(item.name) ? null : removeButton('network', item.name, item.name)}</td></tr>)}</tbody></table>)}
    </div>
    {confirming && <ConfirmDialog danger busy={busy} title={t(`resources.removeTitle.${confirming.kind}`, { name: confirming.label })} confirmLabel={t('common.remove')} cancelLabel={t('common.cancel')}
      description={`${t(`resources.removeWarning.${confirming.kind}`)} ${t('resources.inUse')}`} onCancel={() => setConfirming(null)} onConfirm={() => void remove()} />}
    {pendingPrune && <ConfirmDialog danger busy={busy} title={t(`prune.title.${pendingPrune}`)} confirmLabel={t('prune.confirm')} cancelLabel={t('common.cancel')}
      description={t(`prune.description.${pendingPrune}`)} onCancel={() => useOxePodStore.getState().askPrune(null)} onConfirm={() => void prune(pendingPrune)} />}
  </section>
}
