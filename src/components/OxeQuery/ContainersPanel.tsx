import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Database, Play, RefreshCw, RotateCw, Square, SquareTerminal } from 'lucide-react'
import type { ContainerAction, ContainerExecResult, ContainerInspect, ContainerPort, ContainerSummary } from '../../../shared/types/oxequery'
import { TerminalPane } from '../Panes/TerminalPane'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

const REFRESH_MS = 3000
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const MAX_LOG_LINES = 2000

export function formatPorts(ports: ContainerPort[]): string {
  const published = ports.filter(port => port.hostPort).map(port => `${port.hostPort}→${port.containerPort}`)
  const internal = ports.filter(port => !port.hostPort).map(port => String(port.containerPort))
  return [...new Set(published), ...(published.length ? [] : [...new Set(internal)])].slice(0, 6).join(', ')
}

export function isDatabaseImage(image: string): boolean {
  return /postgres|postgis|timescale|pgvector|mongo/i.test(image)
}

export function ContainersPanel({ active }: { active: boolean }): ReactElement {
  const containers = useOxeQueryStore(state => state.containers)
  const error = useOxeQueryStore(state => state.containersError)
  const loading = useOxeQueryStore(state => state.containersLoading)
  const engine = useOxeQueryStore(state => state.engine)
  const engines = useOxeQueryStore(state => state.engines)
  const refresh = useOxeQueryStore(state => state.refreshContainers)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyRunning, setOnlyRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  useEffect(() => window.oxe?.oxeQuery?.onEvent(event => { if (event.type === 'containers-changed') void refresh() }), [refresh])

  const visible = useMemo(() => containers.filter(container => {
    if (onlyRunning && container.state !== 'running') return false
    const needle = query.trim().toLowerCase()
    return !needle || container.name.toLowerCase().includes(needle) || container.image.toLowerCase().includes(needle)
  }), [containers, onlyRunning, query])
  const selected = containers.find(container => container.id === selectedId) ?? null
  const available = engines.filter(info => info.available)

  const act = async (container: ContainerSummary, action: ContainerAction): Promise<void> => {
    setBusyId(container.id); setNotice('')
    try { await oq('containers.action', { id: container.id, action, engine }); await refresh() }
    catch (cause) { setNotice(errorMessage(cause)) } finally { setBusyId(null) }
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
    return <section className="oq-containers"><div className="oq-empty" role="alert"><h3>Containers unavailable</h3><p>{error}</p>
      <button type="button" onClick={() => void refresh()}><RefreshCw size={13} aria-hidden="true" />Try again</button></div></section>
  }

  return <section className="oq-containers" aria-label="Containers">
    <header className="oq-toolbar">
      <input type="search" placeholder="Filter containers" aria-label="Filter containers" value={query} onChange={event => setQuery(event.target.value)} />
      <label className="oq-check"><input type="checkbox" checked={onlyRunning} onChange={event => setOnlyRunning(event.target.checked)} />Running only</label>
      {available.length > 1 && <select aria-label="Container engine" value={engine} onChange={event => void refresh(event.target.value as 'docker' | 'podman')}>
        {available.map(info => <option key={info.engine} value={info.engine}>{info.engine}</option>)}</select>}
      {engine && <small className="oq-muted" title={available.find(info => info.engine === engine)?.version ?? ''}>{engine}{available.find(info => info.engine === engine)?.context ? ` · ${available.find(info => info.engine === engine)?.context}` : ''}</small>}
      <span className="oq-spacer" />
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh containers" title="Refresh"><RefreshCw size={14} aria-hidden="true" /></button>
    </header>
    {notice && <p role="alert" className="oq-error">{notice}</p>}
    <div className="oq-containers-body">
      <div className="oq-table-wrap">
        {visible.length === 0 ? <div className="oq-empty"><p>{containers.length ? 'No container matches the filter.' : 'No containers yet.'}</p></div> :
          <table className="oq-table" aria-label="Container list"><thead><tr><th>Name</th><th>Image</th><th>State</th><th>Ports</th><th aria-label="Actions" /></tr></thead>
            <tbody>{visible.map(container => <tr key={container.id} className={container.id === selectedId ? 'is-selected' : undefined} onClick={() => setSelectedId(container.id)}>
              <td><button type="button" className="oq-link" onClick={() => setSelectedId(container.id)}>{container.name}</button></td>
              <td title={container.image}>{container.image}</td>
              <td><span className="oq-state" data-state={container.state}>{container.state}</span><small className="oq-muted">{container.status}</small></td>
              <td>{formatPorts(container.ports)}</td>
              <td className="oq-actions" onClick={event => event.stopPropagation()}>
                {container.state === 'running'
                  ? <>
                    <button type="button" aria-label={`Restart ${container.name}`} title="Restart" disabled={busyId === container.id} onClick={() => void act(container, 'restart')}><RotateCw size={13} aria-hidden="true" /></button>
                    <button type="button" aria-label={`Stop ${container.name}`} title="Stop" disabled={busyId === container.id} onClick={() => void act(container, 'stop')}><Square size={13} aria-hidden="true" /></button>
                  </>
                  : <button type="button" aria-label={`Start ${container.name}`} title="Start" disabled={busyId === container.id} onClick={() => void act(container, 'start')}><Play size={13} aria-hidden="true" /></button>}
                {isDatabaseImage(container.image) && <button type="button" aria-label={`Connect to ${container.name}`} title="Create a connection to this database" disabled={busyId === container.id} onClick={() => void connect(container)}><Database size={13} aria-hidden="true" /></button>}
              </td>
            </tr>)}</tbody></table>}
      </div>
      {selected && <ContainerDetails key={selected.id} container={selected} engine={engine} onClose={() => setSelectedId(null)} />}
    </div>
  </section>
}

type DetailTab = 'overview' | 'logs' | 'run' | 'shell'

function ContainerDetails({ container, engine, onClose }: { container: ContainerSummary; engine?: 'docker' | 'podman'; onClose: () => void }): ReactElement {
  const [tab, setTab] = useState<DetailTab>('overview')
  return <aside className="oq-details" aria-label={`${container.name} details`}>
    <header><strong title={container.id}>{container.name}</strong><button type="button" aria-label="Close details" onClick={onClose}>×</button></header>
    <nav aria-label="Container sections">{(['overview', 'logs', 'run', 'shell'] as DetailTab[]).map(value =>
      <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'run' ? 'Run command' : value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
    {tab === 'overview' && <Overview container={container} engine={engine} />}
    {tab === 'logs' && <Logs container={container} engine={engine} />}
    {tab === 'run' && <RunCommand container={container} engine={engine} />}
    {tab === 'shell' && <Shell container={container} engine={engine} />}
  </aside>
}

function Overview({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
  const [inspect, setInspect] = useState<ContainerInspect | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    oq('containers.inspect', { id: container.id, engine }).then(value => { if (active) setInspect(value) }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [container.id, engine])
  if (error) return <p role="alert" className="oq-error">{error}</p>
  if (!inspect) return <p className="oq-muted">Loading…</p>
  return <dl className="oq-overview">
    <dt>Image</dt><dd>{inspect.image}</dd>
    <dt>Command</dt><dd><code>{inspect.command || '—'}</code></dd>
    {inspect.health && <><dt>Health</dt><dd>{inspect.health}</dd></>}
    {inspect.restartPolicy && <><dt>Restart</dt><dd>{inspect.restartPolicy}</dd></>}
    {inspect.startedAt && <><dt>Started</dt><dd>{new Date(inspect.startedAt).toLocaleString()}</dd></>}
    <dt>Ports</dt><dd>{formatPorts(inspect.ports) || '—'}</dd>
    <dt>Networks</dt><dd>{inspect.networks.join(', ') || '—'}</dd>
    <dt>Environment</dt><dd>{inspect.envNames.length ? inspect.envNames.join(', ') : '—'}<small className="oq-muted"> (names only)</small></dd>
    <dt>Mounts</dt><dd>{inspect.mounts.length ? inspect.mounts.map(mount => `${mount.source} → ${mount.destination}`).join('\n') : '—'}</dd>
  </dl>
}

function Logs({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
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
    <div className="oq-toolbar"><input type="search" aria-label="Filter logs" placeholder="Filter" value={filter} onChange={event => setFilter(event.target.value)} />
      <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
      <button type="button" onClick={() => setLines([])}>Clear</button></div>
    {error && <p role="alert" className="oq-error">{error}</p>}
    <pre ref={scroller} aria-label="Container logs" tabIndex={0}>{shown.length ? shown.join('\n') : 'Waiting for output…'}</pre>
  </div>
}

function RunCommand({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
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
    <p className="oq-muted">Runs once inside <strong>{container.name}</strong> without a shell, so pipes and quotes are not interpreted. Use the Shell tab for interactive work.</p>
    <div className="oq-toolbar"><input aria-label="Command" placeholder="ls -la /var/lib" value={command} onChange={event => setCommand(event.target.value)} disabled={container.state !== 'running'} />
      <button type="submit" className="oq-primary" disabled={running || container.state !== 'running' || !command.trim()}>Run</button></div>
    {container.state !== 'running' && <p className="oq-muted">Start the container to run commands.</p>}
    {error && <p role="alert" className="oq-error">{error}</p>}
    {result && <div className="oq-run-result"><p>{result.timedOut ? 'Timed out after 30 s' : `Exit code ${result.exitCode}`}{result.truncated ? ' · output truncated' : ''}</p>
      <pre aria-label="Command output">{result.stdout}{result.stderr && `\n${result.stderr}`}</pre></div>}
  </form>
}

function Shell({ container, engine }: { container: ContainerSummary; engine?: 'docker' | 'podman' }): ReactElement {
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
  if (container.state !== 'running') return <p className="oq-muted">Start the container to open a shell.</p>
  if (error) return <p role="alert" className="oq-error">{error}</p>
  if (!paneId) return <p className="oq-muted">Opening shell…</p>
  const pane = { id: paneId, workspaceId: 'oxequery', type: 'terminal' as const, rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'idle' as const, agentProfileId: null, agentName: null, displayName: `${container.name} shell`, createdAt: null, rootPath: null }
  return <div className="oq-term">
    <div className="oq-toolbar"><SquareTerminal size={14} aria-hidden="true" /><select aria-label="Shell" value={shell} onChange={event => setShell(event.target.value as 'sh' | 'bash')}><option value="sh">sh</option><option value="bash">bash</option></select>
      <button type="button" onClick={() => setNonce(value => value + 1)}>New session</button></div>
    <div className="oq-shell-terminal"><TerminalPane key={paneId} pane={pane} workspaceId="oxequery" workspaceRootPath="" autoStart /></div>
  </div>
}
