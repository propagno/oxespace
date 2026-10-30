import { useEffect, useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Play, RotateCw, Square, SquareTerminal, Trash2 } from 'lucide-react'
import type { ContainerAction, ContainerEngine, ContainerInspect, ContainerStat, ContainerSummary } from '../../../shared/types/oxepod'
import { Button, ConfirmDialog, ErrorState, Meter, Tabs } from '../../ui'
import { formatNumber, formatRelative } from '../../utils/formatTime'
import { errorMessage, pod } from './client'
import { useOxePodStore } from './oxepod.store'
import { KNOWN_STATES, databaseKind, memoryOf, statFor } from './pods-model'
import { formatBytes } from '../OxeQuery/catalog'
import { EnvironmentTab, LogsTab, PortsTab, RunTab, ShellTab, StatsTab } from './ContainerTabs'
import { AboutCard, ComposeCard, DatabaseCard } from './ContainerCards'
import styles from './OxePod.module.css'

const STATS_MS = 5000
export type DetailTab = 'logs' | 'stats' | 'environment' | 'ports' | 'terminal' | 'command'
const TABS: DetailTab[] = ['logs', 'stats', 'environment', 'ports', 'terminal', 'command']

type Pending = { kind: 'stop' | 'restart' | 'remove' } | null

/** One container: its actions, what it prints and uses, its environment and ports, and what it connects to. */
export function ContainerDetail({ container, engine, active }: { container: ContainerSummary; engine?: ContainerEngine; active: boolean }): ReactElement {
  const { t } = useTranslation('pods')
  const [tab, setTab] = useState<DetailTab>('logs')
  const [inspect, setInspect] = useState<ContainerInspect | null>(null)
  const [inspectError, setInspectError] = useState('')
  const [stats, setStats] = useState<ContainerStat[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const running = container.state === 'running'
  const database = databaseKind(container.image)

  useEffect(() => {
    let alive = true
    pod('containers.inspect', { id: container.id, engine }).then(value => { if (alive) { setInspect(value); setInspectError('') } }, cause => { if (alive) setInspectError(errorMessage(cause)) })
    return () => { alive = false }
  }, [container.id, container.state, engine])

  // CPU and memory only while the container runs and this page is in front.
  useEffect(() => {
    if (!active || !running) return
    let alive = true
    const load = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      try { const list = await pod('containers.stats', engine ? { engine } : {}); if (alive) setStats(list) } catch { /* usage is optional */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), STATS_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [active, running, engine, container.id])

  const act = async (action: ContainerAction | 'remove'): Promise<void> => {
    setBusy(true); setNotice('')
    try {
      if (action === 'remove') await pod('containers.remove', { id: container.id, engine, confirmed: true })
      else await pod('containers.action', { id: container.id, action, engine })
      await useOxePodStore.getState().refresh()
    } catch (cause) { setNotice(errorMessage(cause)) } finally { setBusy(false) }
  }
  /** Stopping or restarting a database interrupts whoever uses it, so it asks first; removing always asks. */
  const request = (action: 'stop' | 'restart'): void => { if (database) setPending({ kind: action }); else void act(action) }

  const stat = active && running ? statFor(stats, container) : undefined
  const memory = stat ? memoryOf(stat) : null
  const state = KNOWN_STATES.has(container.state) ? t(`state.${container.state}` as 'state.running') : container.state
  const since = running && inspect?.startedAt ? t('detail.runningSince', { when: formatRelative(Math.min(inspect.startedAt, Date.now())) }) : state
  const volumes = [...new Set((inspect?.mounts ?? []).map(mount => mount.volume).filter((name): name is string => Boolean(name)))]

  return <div className={styles.detail}>
    <section className={styles.card} aria-label={t('detail.label', { name: container.name })}>
      <header className={styles.detailHeader}>
        <div className={styles.titleBlock}><h2 className={styles.title} title={container.id}>{container.name}</h2><span className={styles.muted}>{container.image} · {since}</span></div>
        <div className={styles.actions} role="group" aria-label={t('detail.actions')}>
          {running ? <>
            <Button size="sm" icon={<Square size={13} aria-hidden="true" />} disabled={busy} aria-label={t('actions.stopNamed', { name: container.name })} onClick={() => request('stop')}>{t('actions.stop')}</Button>
            <Button size="sm" icon={<RotateCw size={13} aria-hidden="true" />} disabled={busy} aria-label={t('actions.restartNamed', { name: container.name })} onClick={() => request('restart')}>{t('actions.restart')}</Button>
          </> : <Button size="sm" icon={<Play size={13} aria-hidden="true" />} disabled={busy} aria-label={t('actions.startNamed', { name: container.name })} onClick={() => void act('start')}>{t('actions.start')}</Button>}
          <Button size="sm" icon={<SquareTerminal size={13} aria-hidden="true" />} disabled={!running} title={running ? undefined : t('shell.startFirst')} onClick={() => setTab('terminal')}>{t('actions.terminal')}</Button>
          <Button size="sm" variant="ghost" className={styles.dangerText} icon={<Trash2 size={13} aria-hidden="true" />} disabled={busy} aria-label={t('actions.removeNamed', { name: container.name })} onClick={() => setPending({ kind: 'remove' })}>{t('actions.remove')}</Button>
        </div>
      </header>
      {notice && <div className={styles.inset}><ErrorState compact title={t('actions.failed')} message={notice} /></div>}
      <Tabs className={styles.tabs} label={t('detail.sections')} value={tab} onChange={setTab} tabs={TABS.map(value => ({
        value, label: t(`tab.${value}`),
        content: value === 'logs' ? <LogsTab container={container} engine={engine} />
          : value === 'stats' ? <StatsTab container={container} stat={stat} />
            : value === 'environment' ? <EnvironmentTab inspect={inspect} error={inspectError} />
              : value === 'ports' ? <PortsTab ports={inspect?.ports ?? container.ports} />
                : value === 'terminal' ? <ShellTab container={container} engine={engine} />
                  : <RunTab container={container} engine={engine} />
      }))} />
      {running && stat && <footer className={styles.usage} aria-label={t('stats.label')}>
        <Meter label={t('stats.cpu')} value={Math.min(100, stat.cpuPercent)} detail={`${formatNumber(stat.cpuPercent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} />
        <Meter label={t('stats.memory')} value={stat.memoryPercent} detail={memory ? t('stats.memoryOf', { used: formatBytes(memory.used), limit: formatBytes(memory.limit) }) : `${formatNumber(stat.memoryPercent, { maximumFractionDigits: 0 })}%`} />
      </footer>}
    </section>
    <aside className={styles.side} aria-label={t('detail.context')}>
      {database && <DatabaseCard container={container} kind={database} engine={engine} active={active} />}
      <ComposeCard container={container} engine={engine} />
      <AboutCard inspect={inspect} />
    </aside>
    {pending?.kind === 'remove' && <ConfirmDialog danger title={t('remove.title', { name: container.name })} confirmLabel={t('remove.confirm')} cancelLabel={t('common.cancel')}
      description={<>{running && `${t('remove.running')} `}{volumes.length ? <Trans t={t} i18nKey="remove.volumes" count={volumes.length} values={{ volumes: volumes.join(', ') }} components={{ strong: <strong /> }} /> : t('remove.noVolumes')} {t('remove.final')}</>}
      onCancel={() => setPending(null)} onConfirm={() => { setPending(null); void act('remove') }} />}
    {(pending?.kind === 'stop' || pending?.kind === 'restart') && <ConfirmDialog danger title={t(pending.kind === 'stop' ? 'actions.stopTitle' : 'actions.restartTitle', { name: container.name })}
      confirmLabel={t(pending.kind === 'stop' ? 'actions.stop' : 'actions.restart')} cancelLabel={t('common.cancel')}
      description={<>{t('actions.databaseWarning')}{container.labels?.['oxequery.managed'] === '1' && ` ${t('actions.managedVolume')}`}</>}
      onCancel={() => setPending(null)} onConfirm={() => { const kind = pending.kind as 'stop' | 'restart'; setPending(null); void act(kind) }} />}
  </div>
}
