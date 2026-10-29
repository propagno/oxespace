import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Boxes, ChevronDown, ChevronRight, Database, Play, Plus, RefreshCw, RotateCw, Square, SquareTerminal } from 'lucide-react'
import type { ContainerAction, ContainerEngineInfo, ContainerExecResult, ContainerInspect, ContainerPort, ContainerStat, ContainerSummary } from '../../../shared/types/oxequery'
import { TerminalPane } from '../Panes/TerminalPane'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'
import { NewDatabaseDialog, ResourcesPanel } from './ResourcesPanel'
import { EngineBar } from './EngineBar'
import { Select } from '../../ui/Field'
import { LoadingState } from '../../ui'
import { formatDateTime, formatNumber } from '../../utils/formatTime'
import { EXAMPLE, SHELLS } from './examples'

const STATS_MS = 5000
const COMPOSE_LABEL = 'com.docker.compose.project'

const REFRESH_MS = 3000
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const MAX_LOG_LINES = 2000
const KNOWN_STATES = new Set(['running', 'exited', 'created', 'paused', 'restarting', 'dead', 'removing'])

export function formatPorts(ports: ContainerPort[]): string {
  const published = ports.filter(port => port.hostPort).map(port => `${port.hostPort}→${port.containerPort}`)
  const internal = ports.filter(port => !port.hostPort).map(port => String(port.containerPort))
  return [...new Set(published), ...(published.length ? [] : [...new Set(internal)])].slice(0, 6).join(', ')
}

export function isDatabaseImage(image: string): boolean {
  return /postgres|postgis|timescale|pgvector|mongo/i.test(image)
}

export function ContainersPanel({ active }: { active: boolean }): ReactElement {
  const { t } = useTranslation('oxequery')
  const containers = useOxeQueryStore(state => state.containers)
  const error = useOxeQueryStore(state => state.containersError)
  const loading = useOxeQueryStore(state => state.containersLoading)
  const engine = useOxeQueryStore(state => state.engine)
  const engines = useOxeQueryStore(state => state.engines)
  const connections = useOxeQueryStore(state => state.connections)
  const refresh = useOxeQueryStore(state => state.refreshContainers)
  const selectedId = useOxeQueryStore(state => state.selectedContainer)
  const setSelectedId = useOxeQueryStore(state => state.selectContainer)
  const [query, setQuery] = useState('')
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, ContainerStat>>({})
  const [project, setProject] = useState('')
  const [newDatabase, setNewDatabase] = useState(false)
  const [showResources, setShowResources] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ container: ContainerSummary; action: ContainerAction } | null>(null)

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  useEffect(() => window.oxe?.oxeQuery?.onEvent(event => { if (event.type === 'containers-changed') void refresh() }), [refresh])

  // CPU and memory only for what is running, and only while this page is in front.
  const anyRunning = containers.some(container => container.state === 'running')
  useEffect(() => {
    if (!active || !anyRunning) { setStats({}); return }
    let alive = true
    const load = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      try {
        const list = await oq('containers.stats', engine ? { engine } : {})
        if (alive) setStats(Object.fromEntries(list.flatMap(item => [[item.id.slice(0, 12), item], [item.name, item]])))
      } catch { /* stats are optional */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), STATS_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [active, anyRunning, engine])

  const projects = useMemo(() => [...new Set(containers.map(container => container.labels?.[COMPOSE_LABEL]).filter((value): value is string => Boolean(value)))].sort(), [containers])

  const visible = useMemo(() => containers.filter(container => {
    if (onlyRunning && container.state !== 'running') return false
    if (project && container.labels?.[COMPOSE_LABEL] !== project) return false
    const needle = query.trim().toLowerCase()
    return !needle || container.name.toLowerCase().includes(needle) || container.image.toLowerCase().includes(needle)
  }).sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)), [containers, onlyRunning, project, query])
  const selected = containers.find(container => container.id === selectedId) ?? null
  const available = engines.filter(info => info.available)
  const databaseContainers = containers.filter(container => isDatabaseImage(container.image)).length

  const act = async (container: ContainerSummary, action: ContainerAction): Promise<void> => {
    setBusyId(container.id); setNotice('')
    try { await oq('containers.action', { id: container.id, action, engine }); await refresh() }
    catch (cause) { setNotice(errorMessage(cause)) } finally { setBusyId(null) }
  }

  /** Stopping or restarting a database interrupts whoever is using it, so it asks first. */
  const request = (container: ContainerSummary, action: ContainerAction): void => {
    if (isDatabaseImage(container.image) && (action === 'stop' || action === 'restart')) setPendingAction({ container, action })
    else void act(container, action)
  }

  // One Compose project at a time: its folder is read from its containers' labels by the main process.
  const [composeBusy, setComposeBusy] = useState('')
  const [composeOutput, setComposeOutput] = useState<{ title: string; text: string } | null>(null)
  const [confirmDown, setConfirmDown] = useState(false)
  const projectContainers = project ? containers.filter(container => container.labels?.[COMPOSE_LABEL] === project) : []
  const compose = async (action: 'up' | 'down' | 'start' | 'stop' | 'restart' | 'logs', confirmed = false): Promise<void> => {
    const first = projectContainers[0]
    if (!first) return
    setComposeBusy(action); setNotice(''); setConfirmDown(false)
    try {
      const result = await oq('containers.compose', { id: first.id, action, engine, confirmed, ...(action === 'logs' ? { tail: 200 } : {}) })
      setComposeOutput(action === 'logs' || result.output ? { title: t('compose.outputTitle', { project, action: t(`compose.${action}`) }), text: result.output || t('compose.done') } : null)
      if (action !== 'logs') await refresh()
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setConfirmDown(true)
      else setNotice(errorMessage(cause))
    } finally { setComposeBusy('') }
  }

  const connect = async (container: ContainerSummary): Promise<void> => {
    setBusyId(container.id); setNotice('')
    try {
      const connection = await oq('connections.fromContainer', { id: container.id, engine })
      await useOxeQueryStore.getState().refreshConnections()
      useOxeQueryStore.getState().openConnection(connection)
    } catch (cause) { setNotice(errorMessage(cause)) } finally { setBusyId(null) }
  }

  if (error && containers.length === 0) {
    return <EngineProblem message={error} engines={engines} loading={loading} onRetry={() => void refresh()} />
  }
  const running = containers.filter(container => container.state === 'running').length
  const info = available.find(item => item.engine === engine)
  const context = info?.context
  const remoteContext = context && !['default', 'desktop-linux', 'desktop-windows', 'orbstack', 'colima', 'rancher-desktop'].includes(context) ? context : ''

  return <section className="oq-containers" aria-label={t('view.tab.containers')}>
    <header className="oq-toolbar">
      <input type="search" placeholder={t('containers.filter')} aria-label={t('containers.filter')} value={query} onChange={event => setQuery(event.target.value)} />
      <label className="oq-check"><input type="checkbox" checked={onlyRunning} onChange={event => setOnlyRunning(event.target.checked)} />{t('containers.onlyRunning')}</label>
      {projects.length > 0 && <Select className="oq-select" aria-label={t('containers.composeProject')} value={project} onChange={event => setProject(event.target.value)}><option value="">{t('containers.allProjects')}</option>{projects.map(value => <option key={value} value={value}>{value}</option>)}</Select>}
      {available.length > 1 && <Select className="oq-select" aria-label={t('containers.engine')} value={engine} onChange={event => void refresh(event.target.value as 'docker' | 'podman')}>
        {available.map(item => <option key={item.engine} value={item.engine}>{item.engine}</option>)}</Select>}
      {engine && <small className="oq-muted" title={info?.version ? t('containers.engineVersion', { version: info.version }) : t('containers.engine')}>{context ? t('containers.engineWithContext', { engine, where: context }) : t('containers.engineName', { engine })}</small>}
      <span className="oq-spacer" />
      <button type="button" onClick={() => setNewDatabase(true)} title={t('containers.newDatabaseTitle')}><Database size={13} aria-hidden="true" />{t('containers.newDatabase')}</button>
      <button type="button" data-oq-action="newConnection" onClick={() => useOxeQueryStore.getState().openDialog(null)}><Plus size={13} aria-hidden="true" />{t('connections.new')}</button>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label={t('sidebar.refresh')} title={t('common.refresh')}><RefreshCw size={14} aria-hidden="true" /></button>
    </header>
    {containers.length > 0 && <div className="oq-summary" aria-label={t('containers.summary')}>
      <span><Trans t={t} i18nKey="containers.runningCount" count={running} values={{ value: formatNumber(running) }} components={{ strong: <strong /> }} /></span>
      <span><Trans t={t} i18nKey="containers.stoppedCount" count={containers.length - running} values={{ value: formatNumber(containers.length - running) }} components={{ strong: <strong /> }} /></span>
      <span><Trans t={t} i18nKey="containers.databaseCount" count={databaseContainers} values={{ value: formatNumber(databaseContainers) }} components={{ strong: <strong /> }} /></span>
      {loading && <span className="oq-muted">{t('containers.updating')}</span>}</div>}
    {connections.length === 0 && databaseContainers > 0 && <p className="oq-hint" role="note">
      <Database size={14} aria-hidden="true" /><span><Trans t={t} i18nKey="containers.queryHint" components={{ strong: <strong /> }} /></span>
    </p>}
    <EngineBar active={active} shown={containers.length} />
    {notice && <p role="alert" className="oq-error">{notice}</p>}
    {project && <section className="oq-compose" aria-label={t('compose.label')}>
      <strong>{project}</strong><small className="oq-muted">{t('compose.running', { running: projectContainers.filter(container => container.state === 'running').length, count: projectContainers.length })}</small>
      {(['up', 'start', 'stop', 'restart', 'logs'] as const).map(action => <button key={action} type="button" disabled={composeBusy !== ''} onClick={() => void compose(action)}>
        {composeBusy === action ? '…' : t(`compose.${action}`)}</button>)}
      <button type="button" className="oq-danger" disabled={composeBusy !== ''} onClick={() => void compose('down')}>{t('compose.downAsk')}</button>
      {confirmDown && <ConfirmDialog danger title={t('compose.downTitle', { project })} confirmLabel={t('compose.downConfirm')} cancelLabel={t('common.cancel')}
        description={t('compose.downDescription')}
        onCancel={() => setConfirmDown(false)} onConfirm={() => void compose('down', true)} />}
      {composeOutput && <div className="oq-compose-output"><header><strong>{composeOutput.title}</strong><button type="button" aria-label={t('compose.closeOutput')} onClick={() => setComposeOutput(null)}>{t('common.close')}</button></header><pre>{composeOutput.text}</pre></div>}
    </section>}
    {remoteContext && <p className="oq-hint" role="note"><Trans t={t} i18nKey="containers.remoteContext" values={{ where: remoteContext }} components={{ strong: <strong /> }} /></p>}
    {pendingAction && <ConfirmDialog danger title={t(pendingAction.action === 'stop' ? 'containers.stopTitle' : 'containers.restartTitle', { name: pendingAction.container.name })} confirmLabel={t(pendingAction.action === 'stop' ? 'containers.stop' : 'containers.restart')} cancelLabel={t('common.cancel')}
      description={<>{t('containers.databaseWarning')}{pendingAction.container.labels?.['oxequery.managed'] === '1' && ` ${t('containers.managedVolume')}`}</>}
      onCancel={() => setPendingAction(null)} onConfirm={() => { const { container, action } = pendingAction; setPendingAction(null); void act(container, action) }} />}
    <div className="oq-containers-body">
      <div className="oq-table-wrap">
        {visible.length === 0 ? <div className="oq-empty"><p>{containers.length ? t('containers.noMatch') : t('containers.emptyTitle')}</p></div> :
          <table className="oq-table" aria-label={t('containers.list')}><thead><tr><th>{t('containers.column.name')}</th><th>{t('containers.column.image')}</th><th>{t('containers.column.state')}</th><th>{t('containers.column.usage')}</th><th>{t('containers.column.ports')}</th><th className="oq-actions-head">{t('containers.column.actions')}</th></tr></thead>
            <tbody>{visible.map(container => <tr key={container.id} className={container.id === selectedId ? 'is-selected' : undefined} onClick={() => setSelectedId(container.id)}>
              <td><button type="button" className="oq-link" onClick={() => setSelectedId(container.id)}>{container.name}</button>{container.labels?.[COMPOSE_LABEL] && <small className="oq-muted"> {container.labels[COMPOSE_LABEL]}</small>}</td>
              <td title={container.image}>{container.image}</td>
              <td><span className="oq-state" data-state={container.state}>{KNOWN_STATES.has(container.state) ? t(`containers.state.${container.state}` as 'containers.state.running') : container.state}</span><small className="oq-muted">{container.status}</small></td>
              <td><div className="oq-stats">{(() => { const stat = stats[container.id.slice(0, 12)] ?? stats[container.name]; return container.state === 'running' && stat ? <><span>{formatNumber(stat.cpuPercent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span><small className="oq-muted">{stat.memoryUsage.split('/')[0].trim()} · {formatNumber(stat.memoryPercent, { maximumFractionDigits: 0 })}%</small></> : <span className="oq-muted">–</span> })()}</div></td>
              <td>{formatPorts(container.ports)}</td>
              <td onClick={event => event.stopPropagation()}><div className="oq-actions">
                {container.state === 'running'
                  ? <>
                    <button type="button" aria-label={t('containers.restartNamed', { name: container.name })} title={t('containers.restartTitleShort')} disabled={busyId === container.id} onClick={() => request(container, 'restart')}><RotateCw size={13} aria-hidden="true" /><span>{t('containers.restart')}</span></button>
                    <button type="button" aria-label={t('containers.stopNamed', { name: container.name })} title={t('containers.stopTitleShort')} disabled={busyId === container.id} onClick={() => request(container, 'stop')}><Square size={13} aria-hidden="true" /><span>{t('containers.stop')}</span></button>
                  </>
                  : <button type="button" aria-label={t('containers.startNamed', { name: container.name })} title={t('containers.startTitleShort')} disabled={busyId === container.id} onClick={() => void act(container, 'start')}><Play size={13} aria-hidden="true" /><span>{t('containers.start')}</span></button>}
                {isDatabaseImage(container.image) && <button type="button" className="oq-connect" aria-label={t('containers.connectNamed', { name: container.name })} title={t('containers.connectTitle')} disabled={busyId === container.id || container.state !== 'running'} onClick={() => void connect(container)}><Database size={13} aria-hidden="true" /><span>{t('containers.query')}</span></button>}
              </div></td>
            </tr>)}</tbody></table>}
      </div>
      {selected && <ContainerDetails key={selected.id} container={selected} engine={engine} onClose={() => setSelectedId(null)} />}
    </div>
    <button type="button" className="oq-disclosure" aria-expanded={showResources} onClick={() => setShowResources(value => !value)}>{showResources ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{t('resources.label')}</button>
    {showResources && <ResourcesPanel engine={engine} active={active} />}
    {newDatabase && <NewDatabaseDialog engine={engine} onClose={() => setNewDatabase(false)} />}
  </section>
}

type DetailTab = 'overview' | 'logs' | 'run' | 'shell'

function ContainerDetails({ container, engine, onClose }: { container: ContainerSummary; engine?: 'docker' | 'podman'; onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [tab, setTab] = useState<DetailTab>('overview')
  return <aside className="oq-details" aria-label={t('details.label', { name: container.name })}>
    <header><strong title={container.id}>{container.name}</strong><button type="button" aria-label={t('details.close')} onClick={onClose}>×</button></header>
    <nav aria-label={t('details.sections')}>{(['overview', 'logs', 'run', 'shell'] as DetailTab[]).map(value =>
      <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{t(`details.tab.${value}`)}</button>)}</nav>
    {tab === 'overview' && <Overview container={container} engine={engine} />}
    {tab === 'logs' && <Logs container={container} engine={engine} />}
    {tab === 'run' && <RunCommand container={container} engine={engine} />}
    {tab === 'shell' && <Shell container={container} engine={engine} />}
  </aside>
}

function Overview({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [inspect, setInspect] = useState<ContainerInspect | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    oq('containers.inspect', { id: container.id, engine }).then(value => { if (active) setInspect(value) }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [container.id, engine])
  if (error) return <p role="alert" className="oq-error">{error}</p>
  if (!inspect) return <LoadingState label={t('details.loading')} />
  return <dl className="oq-overview">
    <dt>{t('details.image')}</dt><dd>{inspect.image}</dd>
    <dt>{t('details.command')}</dt><dd><code>{inspect.command || '—'}</code></dd>
    {inspect.health && <><dt>{t('details.health')}</dt><dd>{inspect.health}</dd></>}
    {inspect.restartPolicy && <><dt>{t('details.restartPolicy')}</dt><dd>{inspect.restartPolicy}</dd></>}
    {inspect.startedAt && <><dt>{t('details.started')}</dt><dd>{formatDateTime(inspect.startedAt)}</dd></>}
    <dt>{t('details.ports')}</dt><dd>{formatPorts(inspect.ports) || '—'}</dd>
    <dt>{t('details.networks')}</dt><dd>{inspect.networks.join(', ') || '—'}</dd>
    <dt>{t('details.environment')}</dt><dd>{inspect.envNames.length ? inspect.envNames.join(', ') : '—'}<small className="oq-muted"> {t('details.namesOnly')}</small></dd>
    <dt>{t('details.mounts')}</dt><dd>{inspect.mounts.length ? inspect.mounts.map(mount => `${mount.source} → ${mount.destination}`).join('\n') : '—'}</dd>
  </dl>
}

function Logs({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const pausedRef = useRef(false)
  const scroller = useRef<HTMLPreElement | null>(null)
  pausedRef.current = paused

  useEffect(() => {
    let streamId = ''
    let cancelled = false
    const unsubscribe = window.oxe?.oxeQuery?.onEvent(event => {
      if (!streamId) return
      if (event.type === 'container-log' && event.streamId === streamId && !pausedRef.current) {
        setLines(current => [...current, ...event.lines.map(line => line.replace(ANSI, ''))].slice(-MAX_LOG_LINES))
      } else if (event.type === 'container-log-end' && event.streamId === streamId && event.reason !== 'stopped' && event.reason !== 'closed') setError(event.reason)
    })
    oq('containers.logsStart', { id: container.id, tail: 200, engine }).then(result => {
      if (cancelled) void oq('containers.logsStop', { streamId: result.streamId }).catch(() => undefined)
      else streamId = result.streamId
    }, cause => { if (!cancelled) setError(errorMessage(cause)) })
    return () => { cancelled = true; unsubscribe?.(); if (streamId) void oq('containers.logsStop', { streamId }).catch(() => undefined) }
  }, [container.id, engine])

  useEffect(() => { const element = scroller.current; if (element && !paused) element.scrollTop = element.scrollHeight }, [lines, paused])
  const shown = filter ? lines.filter(line => line.toLowerCase().includes(filter.toLowerCase())) : lines
  return <div className="oq-logs">
    <div className="oq-toolbar"><input type="search" aria-label={t('logs.filter')} placeholder={t('logs.filterPlaceholder')} value={filter} onChange={event => setFilter(event.target.value)} />
      <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? t('logs.resume') : t('logs.pause')}</button>
      <button type="button" onClick={() => setLines([])}>{t('common.clear')}</button></div>
    {error && <p role="alert" className="oq-error">{error}</p>}
    <pre ref={scroller} aria-label={t('logs.label')} tabIndex={0}>{shown.length ? shown.join('\n') : t('logs.waiting')}</pre>
  </div>
}

function RunCommand({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<ContainerExecResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const run = async (): Promise<void> => {
    // Split on spaces only. Quoting is deliberately not interpreted: the command is an argv, not a shell string.
    const argv = command.trim().split(/\s+/).filter(Boolean)
    if (!argv.length) return
    setRunning(true); setError(''); setResult(null)
    try { setResult(await oq('containers.exec', { id: container.id, argv, engine })) }
    catch (cause) { setError(errorMessage(cause)) } finally { setRunning(false) }
  }
  return <form className="oq-run" onSubmit={event => { event.preventDefault(); void run() }}>
    <p className="oq-muted"><Trans t={t} i18nKey="run.explain" values={{ name: container.name }} components={{ strong: <strong /> }} /></p>
    <div className="oq-toolbar"><input aria-label={t('run.command')} placeholder={EXAMPLE.command} value={command} onChange={event => setCommand(event.target.value)} disabled={container.state !== 'running'} />
      <button type="submit" className="oq-primary" disabled={running || container.state !== 'running' || !command.trim()}>{t('common.run')}</button></div>
    {container.state !== 'running' && <p className="oq-muted">{t('run.startFirst')}</p>}
    {error && <p role="alert" className="oq-error">{error}</p>}
    {result && <div className="oq-run-result"><p>{result.timedOut ? t('run.timedOut') : t('run.exitCode', { code: result.exitCode })}{result.truncated ? ` · ${t('run.truncated')}` : ''}</p>
      <pre aria-label={t('run.output')}>{result.stdout}{result.stderr && `\n${result.stderr}`}</pre></div>}
  </form>
}

function Shell({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [paneId, setPaneId] = useState('')
  const [error, setError] = useState('')
  const [shell, setShell] = useState<'sh' | 'bash'>('sh')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let active = true
    setPaneId('')
    if (container.state !== 'running') return
    oq('containers.shell', { id: container.id, shell, engine }).then(result => { if (active) setPaneId(result.paneId) }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [container.id, container.state, engine, shell, nonce])
  if (container.state !== 'running') return <p className="oq-muted">{t('shell.startFirst')}</p>
  if (error) return <p role="alert" className="oq-error">{error}</p>
  if (!paneId) return <p className="oq-muted">{t('shell.opening')}</p>
  const pane = { id: paneId, workspaceId: 'oxequery', type: 'terminal' as const, rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle' as const, agentProfileId: null, agentName: null, displayName: t('shell.paneName', { name: container.name }), createdAt: null, rootPath: null }
  return <div className="oq-term">
    <div className="oq-toolbar"><SquareTerminal size={14} aria-hidden="true" /><Select className="oq-select" aria-label={t('shell.shell')} value={shell} onChange={event => setShell(event.target.value as 'sh' | 'bash')}>{SHELLS.map(name => <option key={name} value={name}>{name}</option>)}</Select>
      <button type="button" onClick={() => setNonce(value => value + 1)}>{t('shell.newSession')}</button></div>
    <div className="oq-shell-terminal"><TerminalPane key={paneId} pane={pane} workspaceId="oxequery" workspaceRootPath="" autoStart /></div>
  </div>
}

function EngineProblem({ message, engines, loading, onRetry }: { message: string; engines: ContainerEngineInfo[]; loading: boolean; onRetry: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const stopped = engines.find(info => info.state === 'stopped' || info.state === 'denied')
  const missing = !stopped && engines.length > 0 && engines.every(info => info.state === 'missing')
  const linux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
  const heading = missing ? t('engine.missingTitle') : stopped?.state === 'denied' ? t('engine.deniedTitle') : stopped ? t('engine.stoppedTitle', { engine: stopped.engine === 'docker' ? 'Docker' : 'Podman' }) : t('engine.unavailableTitle')
  return <section className="oq-containers"><div className="oq-empty oq-engine-problem" role="alert">
    <Boxes size={28} aria-hidden="true" />
    <h3>{heading}</h3>
    <p>{message}</p>
    {stopped?.state === 'denied' && <p className="oq-muted"><Trans t={t} i18nKey="engine.deniedFix" components={{ code: <code /> }} /></p>}
    {stopped?.state === 'stopped' && <p className="oq-muted">{linux ? <Trans t={t} i18nKey="engine.startLinux" components={{ code: <code /> }} /> : stopped.engine === 'docker' ? t('engine.startDesktop') : <Trans t={t} i18nKey="engine.startPodman" components={{ code: <code /> }} />} {t('engine.checksAgain')}</p>}
    {missing && <p className="oq-muted">{t('engine.install')}</p>}
    <button type="button" onClick={onRetry} disabled={loading}><RefreshCw size={13} aria-hidden="true" />{loading ? t('engine.checking') : t('engine.checkAgain')}</button>
  </div></section>
}
