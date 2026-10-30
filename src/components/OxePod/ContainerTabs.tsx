import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { EyeOff } from 'lucide-react'
import type { ContainerEngine, ContainerExecResult, ContainerInspect, ContainerPort, ContainerStat, ContainerSummary } from '../../../shared/types/oxepod'
import { Button, EmptyState, ErrorState, LoadingState, Select, TextField } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import { TerminalPane } from '../Panes/TerminalPane'
import { errorMessage, pod } from './client'
import { EXAMPLE, SHELLS } from '../OxeQuery/examples'
import styles from './OxePod.module.css'

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const MAX_LOG_LINES = 2000
type Props = { container: ContainerSummary; engine?: ContainerEngine }

/** The live log, with a filter; pausing keeps the lines on screen still while the stream goes on. */
export function LogsTab({ container, engine }: Props): ReactElement {
  const { t } = useTranslation('pods')
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const pausedRef = useRef(false)
  const scroller = useRef<HTMLPreElement | null>(null)
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    let streamId = ''
    let cancelled = false
    const unsubscribe = window.oxe?.oxePod?.onEvent(event => {
      if (!streamId) return
      if (event.type === 'container-log' && event.streamId === streamId && !pausedRef.current) {
        setLines(current => [...current, ...event.lines.map(line => line.replace(ANSI, ''))].slice(-MAX_LOG_LINES))
      } else if (event.type === 'container-log-end' && event.streamId === streamId && event.reason !== 'stopped' && event.reason !== 'closed') setError(event.reason)
    })
    pod('containers.logsStart', { id: container.id, tail: 200, engine }).then(result => {
      if (cancelled) void pod('containers.logsStop', { streamId: result.streamId }).catch(() => undefined)
      else streamId = result.streamId
    }, cause => { if (!cancelled) setError(errorMessage(cause)) })
    return () => { cancelled = true; unsubscribe?.(); if (streamId) void pod('containers.logsStop', { streamId }).catch(() => undefined) }
  }, [container.id, engine])

  useEffect(() => { const element = scroller.current; if (element && !paused) element.scrollTop = element.scrollHeight }, [lines, paused])
  const needle = filter.toLowerCase()
  const shown = needle ? lines.filter(line => line.toLowerCase().includes(needle)) : lines
  return <div className={styles.pane}>
    <div className={styles.toolbar}>
      <input type="search" className={styles.search} aria-label={t('logs.filter')} placeholder={t('logs.filterPlaceholder')} value={filter} onChange={event => setFilter(event.target.value)} />
      <span className={styles.spacer} />
      <Button size="sm" variant="ghost" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? t('logs.resume') : t('logs.pause')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setLines([])}>{t('common.clear')}</Button>
    </div>
    {error && <ErrorState compact title={t('logs.failed')} message={error} />}
    <pre ref={scroller} className={styles.log} aria-label={t('logs.label')} tabIndex={0}>{shown.length ? shown.join('\n') : lines.length ? t('logs.noMatch') : t('logs.waiting')}</pre>
    {!paused && !error && container.state === 'running' && <small className={styles.live}>{t('logs.live')}</small>}
  </div>
}

/** Everything the engine measures about the running container. */
export function StatsTab({ container, stat }: { container: ContainerSummary; stat?: ContainerStat }): ReactElement {
  const { t } = useTranslation('pods')
  if (container.state !== 'running') return <EmptyState compact title={t('stats.notRunning')} />
  if (!stat) return <LoadingState label={t('stats.measuring')} />
  const rows: Array<[string, string]> = [
    [t('stats.cpu'), `${formatNumber(stat.cpuPercent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`],
    [t('stats.memory'), `${stat.memoryUsage} (${formatNumber(stat.memoryPercent, { maximumFractionDigits: 1 })}%)`],
    [t('stats.network'), stat.netIO], [t('stats.disk'), stat.blockIO], [t('stats.processes'), formatNumber(stat.pids)]
  ]
  return <dl className={styles.facts}>{rows.map(([label, value]) => <div key={label} className={styles.fact}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

/** The environment as the main process redacted it: a secret's value never reached this page. */
export function EnvironmentTab({ inspect, error }: { inspect: ContainerInspect | null; error: string }): ReactElement {
  const { t } = useTranslation('pods')
  if (error) return <ErrorState compact title={t('detail.unreadable')} message={error} />
  if (!inspect) return <LoadingState label={t('detail.loading')} />
  if (!inspect.environment.length) return <EmptyState compact title={t('environment.empty')} />
  const hidden = inspect.environment.filter(entry => entry.value === undefined).length
  return <div className={styles.pane}>
    <table className={styles.table} aria-label={t('tab.environment')}>
      <thead><tr><th>{t('environment.name')}</th><th>{t('environment.value')}</th></tr></thead>
      <tbody>{inspect.environment.map(entry => <tr key={entry.name}><td className={styles.mono}>{entry.name}</td>
        <td className={styles.mono}>{entry.value === undefined ? <span className={styles.hidden} title={t('environment.hiddenTitle')}><EyeOff size={12} aria-hidden="true" />{t('environment.hidden')}</span> : entry.value || '—'}</td></tr>)}</tbody>
    </table>
    {hidden > 0 && <p className={styles.note}>{t('environment.hiddenNote', { count: hidden })}</p>}
  </div>
}

/** Published ports first (with the address they listen on), then the ones only other containers reach. */
export function PortsTab({ ports }: { ports: ContainerPort[] }): ReactElement {
  const { t } = useTranslation('pods')
  if (!ports.length) return <EmptyState compact title={t('ports.none')} />
  const sorted = [...ports].sort((a, b) => Number(Boolean(b.hostPort)) - Number(Boolean(a.hostPort)) || a.containerPort - b.containerPort)
  return <table className={styles.table} aria-label={t('tab.ports')}>
    <thead><tr><th>{t('ports.host')}</th><th>{t('ports.container')}</th><th>{t('ports.protocol')}</th></tr></thead>
    <tbody>{sorted.map(port => <tr key={`${port.hostIp ?? ''}:${port.hostPort ?? ''}:${port.containerPort}/${port.protocol}`}>
      <td className={styles.mono}>{port.hostPort ? `${!port.hostIp || port.hostIp === '0.0.0.0' || port.hostIp === '::' ? 'localhost' : port.hostIp}:${port.hostPort}` : t('ports.internal')}</td>
      <td className={styles.mono}>{port.containerPort}</td><td>{port.protocol}</td></tr>)}</tbody>
  </table>
}

/** One command, run once without a shell; its output and exit code. */
export function RunTab({ container, engine }: Props): ReactElement {
  const { t } = useTranslation('pods')
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<ContainerExecResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const stopped = container.state !== 'running'
  const run = async (): Promise<void> => {
    // Split on spaces only. Quoting is deliberately not interpreted: the command is an argv, not a shell string.
    const argv = command.trim().split(/\s+/).filter(Boolean)
    if (!argv.length) return
    setRunning(true); setError(''); setResult(null)
    try { setResult(await pod('containers.exec', { id: container.id, argv, engine })) }
    catch (cause) { setError(errorMessage(cause)) } finally { setRunning(false) }
  }
  return <form className={styles.pane} onSubmit={event => { event.preventDefault(); void run() }}>
    <p className={styles.note}><Trans t={t} i18nKey="run.explain" values={{ name: container.name }} components={{ strong: <strong /> }} /></p>
    <div className={styles.toolbar}>
      <TextField className={styles.grow} aria-label={t('run.command')} mono placeholder={EXAMPLE.command} value={command} onChange={event => setCommand(event.target.value)} disabled={stopped} />
      <Button type="submit" size="sm" variant="primary" loading={running} disabled={running || stopped || !command.trim()}>{t('common.run')}</Button>
    </div>
    {stopped && <p className={styles.note}>{t('run.startFirst')}</p>}
    {error && <ErrorState compact title={t('run.failed')} message={error} />}
    {result && <div className={styles.pane}><p className={styles.note}>{result.timedOut ? t('run.timedOut') : t('run.exitCode', { code: result.exitCode })}{result.truncated ? ` · ${t('run.truncated')}` : ''}</p>
      <pre className={styles.log} aria-label={t('run.output')}>{result.stdout}{result.stderr && `\n${result.stderr}`}</pre></div>}
  </form>
}

/** An interactive shell inside the container, in a terminal of its own. */
export function ShellTab({ container, engine }: Props): ReactElement {
  const { t } = useTranslation('pods')
  const [paneId, setPaneId] = useState('')
  const [error, setError] = useState('')
  const [shell, setShell] = useState<'sh' | 'bash'>('sh')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let active = true
    setPaneId(''); setError('')
    if (container.state !== 'running') return
    pod('containers.shell', { id: container.id, shell, engine }).then(result => { if (active) setPaneId(result.paneId) }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [container.id, container.state, engine, shell, nonce])
  if (container.state !== 'running') return <EmptyState compact title={t('shell.startFirst')} />
  if (error) return <ErrorState compact title={t('shell.failed')} message={error} onRetry={() => setNonce(value => value + 1)} retryLabel={t('common.tryAgain')} />
  if (!paneId) return <LoadingState label={t('shell.opening')} />
  const pane = { id: paneId, workspaceId: 'oxepod', type: 'terminal' as const, rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle' as const, agentProfileId: null, agentName: null, displayName: t('shell.paneName', { name: container.name }), createdAt: null, rootPath: null }
  return <div className={styles.pane}>
    <div className={styles.toolbar}>
      <Select aria-label={t('shell.shell')} value={shell} onChange={event => setShell(event.target.value as 'sh' | 'bash')}>{SHELLS.map(name => <option key={name} value={name}>{name}</option>)}</Select>
      <Button size="sm" variant="ghost" onClick={() => setNonce(value => value + 1)}>{t('shell.newSession')}</Button>
    </div>
    <div className={styles.terminal}><TerminalPane key={paneId} pane={pane} workspaceId="oxepod" workspaceRootPath="" autoStart /></div>
  </div>
}
