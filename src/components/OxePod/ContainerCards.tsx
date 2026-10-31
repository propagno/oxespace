import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Layers } from 'lucide-react'
import type { ContainerEngine, ContainerInspect, ContainerSummary } from '../../../shared/types/oxepod'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { Button, ConfirmDialog, ErrorState } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'
import { OxePodClientError, errorMessage, pod } from './client'
// OxePod reads which connections OxeQuery already saved for a container: the one renderer call across the two products.
import { oq } from '../OxeQuery/client'
import { requestOxeQueryConnect } from '../OxeQuery/oxequery-bridge'
import { useOxePodStore } from './oxepod.store'
import { COMPOSE_LABEL, firstHostPort, formatPorts, type DatabaseKind } from './pods-model'
import styles from './OxePod.module.css'

const ENGINE_NAMES: Record<DatabaseKind, string> = { postgres: 'PostgreSQL', mongodb: 'MongoDB' }

/**
 * A recognized database container offers OxeQuery with host and port filled in (roadmap P5). The password is typed
 * there and kept in the vault, or comes from the vault when a connection to this container is already saved; it never
 * passes through this page and agents never see it.
 */
export function DatabaseCard({ container, kind, engine, active }: { container: ContainerSummary; kind: DatabaseKind; engine?: ContainerEngine; active: boolean }): ReactElement {
  const { t } = useTranslation('pods')
  const [saved, setSaved] = useState<OxeQueryConnection | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Looked up again each time OxePod comes to the front: the connection may have been made in OxeQuery meanwhile.
  useEffect(() => {
    if (!active) return
    let alive = true
    oq('connections.list', {}).then(list => { if (alive) setSaved(list.find(item => item.containerRef === container.name && !item.ephemeral) ?? null) }, () => undefined)
    return () => { alive = false }
  }, [container.name, active])

  const port = firstHostPort(container.ports)
  const running = container.state === 'running'
  const connect = async (): Promise<void> => {
    setError('')
    if (saved) { requestOxeQueryConnect({ connectionId: saved.id }); return }
    setBusy(true)
    try {
      const suggestion = await pod('containers.suggestConnection', { id: container.id, engine })
      if (!suggestion || !suggestion.port) { setError(t('bridge.unpublished')); return }
      requestOxeQueryConnect({ draft: { engine: suggestion.engine, name: suggestion.name, host: suggestion.host, port: suggestion.port, database: suggestion.database ?? '', username: suggestion.username ?? '', containerRef: suggestion.name } })
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <section className={styles.sideCard} aria-label={t('bridge.title')}>
    <h3 className={styles.cardTitle}><Database size={14} aria-hidden="true" />{t('bridge.title')}</h3>
    <p className={styles.muted}>{port ? t('bridge.where', { engine: ENGINE_NAMES[kind], host: 'localhost', port }) : t('bridge.unpublished')}</p>
    {saved && <p className={styles.muted}>{t('bridge.saved', { name: saved.name })}</p>}
    <Button size="sm" variant="primary" loading={busy} disabled={busy || !port || !running} title={running ? undefined : t('bridge.startFirst')} onClick={() => void connect()}>
      {saved ? t('bridge.open') : t('bridge.connect')}</Button>
    {!running && port !== undefined && <p className={styles.note}>{t('bridge.startFirst')}</p>}
    {error && <ErrorState compact title={t('bridge.failed')} message={error} />}
    <p className={styles.note}>{t('bridge.password')}</p>
  </section>
}

type ComposeAction = 'up' | 'start' | 'stop' | 'restart' | 'logs' | 'down'

/** The Compose project the container belongs to: its services together, with the project's own commands. */
export function ComposeCard({ container, engine }: { container: ContainerSummary; engine?: ContainerEngine }): ReactElement | null {
  const { t } = useTranslation('pods')
  const containers = useOxePodStore(state => state.containers)
  const [busy, setBusy] = useState<ComposeAction | ''>('')
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null)
  const [error, setError] = useState('')
  const [confirmDown, setConfirmDown] = useState(false)
  const project = container.labels?.[COMPOSE_LABEL]
  if (!project) return null
  const services = containers.filter(item => item.labels?.[COMPOSE_LABEL] === project)
  const running = services.filter(item => item.state === 'running').length

  // The folder and files are read from the container's labels by the main process; nothing about the path comes from here.
  const run = async (action: ComposeAction, confirmed = false): Promise<void> => {
    setBusy(action); setError(''); setConfirmDown(false)
    try {
      const result = await pod('containers.compose', { id: container.id, action, engine, confirmed, ...(action === 'logs' ? { tail: 200 } : {}) })
      setOutput(action === 'logs' || result.output ? { title: t('compose.outputTitle', { project, action: t(`compose.${action}`) }), text: result.output || t('compose.done') } : null)
      if (action !== 'logs') await useOxePodStore.getState().refresh()
    } catch (cause) {
      if (cause instanceof OxePodClientError && cause.code === 'confirm') setConfirmDown(true)
      else setError(errorMessage(cause))
    } finally { setBusy('') }
  }
  return <section className={styles.sideCard} aria-label={t('compose.label', { project })}>
    <h3 className={styles.cardTitle}><Layers size={14} aria-hidden="true" />{project}</h3>
    <p className={styles.muted}>{t('compose.services', { count: services.length })} · {t('compose.running', { running, count: services.length })}</p>
    <div className={styles.cardActions}>
      {(['up', 'stop', 'restart', 'logs'] as const).map(action => <Button key={action} size="sm" loading={busy === action} disabled={busy !== ''} onClick={() => void run(action)}>{t(`compose.${action}`)}</Button>)}
      <Button size="sm" variant="ghost" className={styles.dangerText} disabled={busy !== ''} onClick={() => setConfirmDown(true)}>{t('compose.downAsk')}</Button>
    </div>
    {error && <ErrorState compact title={t('compose.failed')} message={error} />}
    {output && <div className={styles.output}><div className={styles.outputHead}><strong>{output.title}</strong><Button size="sm" variant="ghost" aria-label={t('compose.closeOutput')} onClick={() => setOutput(null)}>{t('common.close')}</Button></div><pre className={styles.log}>{output.text}</pre></div>}
    {confirmDown && <ConfirmDialog danger title={t('compose.downTitle', { project })} confirmLabel={t('compose.downConfirm')} cancelLabel={t('common.cancel')}
      description={t('compose.downDescription')} onCancel={() => setConfirmDown(false)} onConfirm={() => void run('down', true)} />}
  </section>
}

/** Image, command, health, restart policy, networks and mounts. */
export function AboutCard({ inspect }: { inspect: ContainerInspect | null }): ReactElement | null {
  const { t } = useTranslation('pods')
  if (!inspect) return null
  const rows: Array<[string, string]> = [
    [t('about.image'), inspect.image],
    [t('about.command'), inspect.command || '—'],
    ...(inspect.health ? [[t('about.health'), inspect.health] as [string, string]] : []),
    ...(inspect.restartPolicy ? [[t('about.restartPolicy'), inspect.restartPolicy] as [string, string]] : []),
    ...(inspect.startedAt ? [[t('about.started'), formatDateTime(inspect.startedAt)] as [string, string]] : []),
    [t('about.ports'), formatPorts(inspect.ports) || '—'],
    [t('about.networks'), inspect.networks.join(', ') || '—'],
    [t('about.mounts'), inspect.mounts.length ? inspect.mounts.map(mount => `${mount.volume ?? mount.source} → ${mount.destination}`).join('\n') : '—']
  ]
  return <section className={styles.sideCard} aria-label={t('about.title')}>
    <h3 className={styles.cardTitle}>{t('about.title')}</h3>
    <dl className={styles.about}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}
