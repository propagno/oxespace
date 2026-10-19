import { useEffect, useState, type ReactElement } from 'react'
import './WorkspaceMemorySettings.css'
import type { MemoryHandoff, MemoryStorageUsage, MemorySettings, MemoryRuntimeSettings, MemoryWorkspaceStatus } from '../../../shared/types/memory'
import { Button, Checkbox, Select, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const STAGE_LABEL: Record<string, string> = {
  unknown: 'Unknown (not observable)', disabled: 'Off', active: 'Accepting events', suspended: 'Suspended', failed: 'Failing',
  idle: 'Nothing waiting', pending: 'Waiting to send', delivering: 'Sending', running: 'Running'
}
const POLL_MS = 10_000

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

export function formatAge(from: number | undefined, now: number): string {
  if (!from) return 'never'
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

/** Counts and timestamps only — never memory content, tokens or paths. */
export function diagnosticsReport(status: MemoryWorkspaceStatus, now: number): string {
  return JSON.stringify({ generatedAt: new Date(now).toISOString(), projectId: status.projectId, settings: status.settings, runtimeMode: status.runtime.mode,
    health: { status: status.health.status, errorCode: status.health.errorCode, pipeline: status.health.pipeline }, outbox: status.outbox,
    openSessions: status.sessions.filter(s => !s.ended).length }, null, 2)
}

export function WorkspaceMemorySettings({ workspaceId }: { workspaceId: string }): ReactElement {
  const [status, setStatus] = useState<MemoryWorkspaceStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings>({ enabled: false, automaticCapture: false, automaticContext: false })
  const [runtime, setRuntime] = useState<MemoryRuntimeSettings>({ mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' })
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(false)
  const [memories, setMemories] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [offers, setOffers] = useState<{ state: 'idle' | 'loading' | 'error'; items: MemoryHandoff[]; error?: string }>({ state: 'idle', items: [] })
  const [storage, setStorage] = useState<MemoryStorageUsage | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [resumed, setResumed] = useState<MemoryHandoff | null>(null)
  useEffect(() => {
    let alive = true
    setStatus(null)
    setMemories([])
    setMessage('')
    if (!window.oxe?.memory) return
    void window.oxe.memory.status(workspaceId).then(value => {
      if (alive) { setStatus(value); setSettings(value.settings); setRuntime(value.runtime) }
    }).catch(() => { if (alive) setMessage('Memory service is unavailable') })
    return () => { alive = false }
  }, [workspaceId])
  const memoryReady = !!status?.settings.enabled && status.health.status === 'ready'
  const loadOffers = (): Promise<void> => {
    setOffers(current => ({ ...current, state: 'loading' }))
    return window.oxe.memory.handoffs(workspaceId).then(result => {
      setOffers(result.status === 'ok' ? { state: 'idle', items: result.value } : { state: 'error', items: [], error: result.message })
    }).catch(() => setOffers({ state: 'error', items: [], error: 'Could not read handoff offers.' }))
  }
  useEffect(() => {
    setDismissed([]); setResumed(null)
    if (memoryReady && typeof window.oxe?.memory?.handoffs === 'function') void loadOffers()
    else setOffers({ state: 'idle', items: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, memoryReady])
  useEffect(() => {
    setStorage(null)
    if (!status?.settings.enabled || typeof window.oxe?.memory?.storage !== 'function') return
    let alive = true
    void window.oxe.memory.storage().then(value => { if (alive) setStorage(value) }).catch(() => {})
    return () => { alive = false }
  }, [workspaceId, status?.settings.enabled])
  const available = offers.items.filter(offer => offer.state !== 'accepted' && !dismissed.includes(offer.id))
  // One status read at a time, only while the panel is visible and memory is on.
  useEffect(() => {
    if (!status?.settings.enabled || !window.oxe?.memory) return
    let alive = true
    let reading = false
    const timer = setInterval(() => {
      if (reading || document.hidden) return
      reading = true
      void window.oxe.memory.status(workspaceId).then(value => { if (alive) { setStatus(current => current && JSON.stringify(current.settings) === JSON.stringify(value.settings) ? value : current); setNow(Date.now()) } }).catch(() => {}).finally(() => { reading = false })
    }, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [workspaceId, status?.settings.enabled])
  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true); setMessage(''); setFailure(false)
    try { await fn() } catch (error) { setFailure(true); setMessage(humanizeError(error, 'Memory operation failed')) }
    finally { setBusy(false) }
  }
  const resume = (offer: MemoryHandoff): Promise<void> => act(async () => {
    const result = await window.oxe.memory.acceptHandoff({ workspaceId, handoffId: offer.id })
    if (result.status !== 'ok') { await loadOffers(); throw new Error('That offer is no longer available. The list was refreshed.') }
    setResumed(result.value)
    await loadOffers()
  })
  const handoffText = (handoff: MemoryHandoff): string => [handoff.summary, ...handoff.nextSteps.map(step => `- ${step}`), ...handoff.openQuestions.map(question => `? ${question}`),
    ...(handoff.filesTouched.length ? [`Files: ${handoff.filesTouched.join(', ')}`] : [])].join('\n')
  const dirty = !!status && (JSON.stringify(settings) !== JSON.stringify(status.settings) || JSON.stringify(runtime) !== JSON.stringify(status.runtime) || !!token)
  return <section className="ws-settings-section memory-settings" aria-labelledby="ws-memory-title" aria-busy={busy}>
    <header className="ws-settings-section-header"><h3 id="ws-memory-title">Shared Project Memory</h3><span className="memory-badge" data-state="beta" title="Opt-in and still being certified across providers and platforms">Beta</span></header>
    <div className="memory-status-line"><span>AI Memory</span><span className="memory-badge" data-state={status?.health.status}>{busy ? 'Working…' : status?.health.status ?? 'Loading…'}</span></div>
    {status?.health.message && <p className="memory-feedback" role="status">{status.health.message}</p>}
    <p>Local knowledge shared across this repository’s worktrees. Each agent keeps its own session.</p>
    <fieldset disabled={busy || !status} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <Checkbox checked={settings.enabled} disabled={busy} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} label="Enabled" />
    <br />
    <Checkbox checked={settings.automaticCapture} disabled={busy} onChange={e => setSettings({ ...settings, automaticCapture: e.target.checked })} label="Capture project activity (native Code hooks and supported Thread events)" />
    <br />
    <Checkbox checked={settings.automaticContext} disabled={busy} onChange={e => setSettings({ ...settings, automaticContext: e.target.checked })} label="Supply relevant context to new agent sessions" />
    <p className="memory-privacy">Captured prompts, tool activity and supported Claude assistant excerpts stay in the local memory service. Context supplied to a cloud agent can be sent to that agent’s vendor. No cloud model is configured for the managed memory service.</p>
    <h4 className="memory-runtime-heading">Runtime configuration</h4>
    <label>Runtime <Select value={runtime.mode} disabled={busy} onChange={e => setRuntime({ ...runtime, mode: e.target.value as MemoryRuntimeSettings['mode'] })}>
      <option value="managed">Managed local service</option><option value="connected">Existing local service</option>
    </Select></label>
    <br />
    <label>AI Memory executable <TextField value={runtime.executable} disabled={busy} onChange={e => setRuntime({ ...runtime, executable: e.target.value })} /></label>
    <br />
    <label>Local service URL <TextField value={runtime.url} disabled={busy} onChange={e => setRuntime({ ...runtime, url: e.target.value })} /></label>
    {runtime.mode === 'connected' && <><p>Existing service configuration controls external model calls. Connect only after reviewing its privacy settings.</p><label>Bearer token <TextField type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label></>}
    <p>Native Windows support is experimental. Agent terminals continue working when memory is unavailable.</p>
    <div>
      <button type="button" disabled={busy} onClick={() => void act(async () => { const executable = await window.oxe.memory.install(); setRuntime({ ...runtime, executable }); setMessage('Verified AI Memory 2.6.2 downloaded. Apply settings to upgrade with a retained rollback snapshot.') })}>Download local runtime</button>{' '}
      <Button variant="primary" disabled={busy} onClick={() => void act(async () => { const value = await window.oxe.memory.configure({ workspaceId, settings, runtime, ...(token ? { token } : {}) }); setStatus(value); setSettings(value.settings); setRuntime(value.runtime); setToken(''); setFailure(value.settings.enabled && value.health.status !== 'ready'); setMessage(!value.settings.enabled ? 'Settings saved. Memory is disabled. Select Enabled and apply to start the service.' : value.health.status === 'ready' ? 'Memory is ready. Configure agents, then start a new terminal.' : value.health.message || 'Settings saved, but the service could not start. Check the executable and local service URL, then apply again.') })}>Apply memory settings</Button>{' '}
      <button type="button" disabled={busy || dirty || status?.health.status !== 'ready' || !status?.settings.enabled} onClick={() => void act(async () => setMessage(await window.oxe.memory.setupAgents(workspaceId)))}>Configure Claude / Codex</button>{' '}
      {status?.rollbackAvailable && <button type="button" disabled={busy || dirty} onClick={() => void act(async () => {
        const value = await window.oxe.memory.rollback(workspaceId)
        setStatus(value); setRuntime(value.runtime); setSettings(value.settings)
        setMessage('Previous runtime and snapshot restored. Data written after the upgrade is preserved separately in the runtime upgrade directory.')
      })}>Restore previous runtime</button>}{' '}
      <button type="button" disabled={busy} onClick={() => void act(async () => { setStatus(await window.oxe.memory.status(workspaceId)); const result = await window.oxe.memory.recent(workspaceId); setMemories(result.status === 'ok' ? result.value.map(item => item.text) : []); if (result.status !== 'ok') setMessage(result.message) })}>Refresh</button>
    </div>
    </fieldset>
    <p className="memory-next-step">{dirty ? 'Unsaved changes. Apply memory settings before configuring agents.' : !status?.settings.enabled ? 'To get started: download the runtime, select Enabled, then apply settings.' : status.health.status !== 'ready' ? 'The service must be ready before agent setup. Check the error above and apply again.' : 'Configure Claude / Codex, then open new agent terminals and approve their hooks and MCP tools.'}</p>
    {status && <p>Project: {status.projectId} · Connected sessions: {status.sessions.filter(s => !s.ended).length}</p>}
    {memoryReady && <section className="memory-resume" aria-labelledby="memory-resume-title">
      <h4 id="memory-resume-title" className="memory-runtime-heading">Resume previous work</h4>
      {offers.state === 'loading' && <p role="status">Looking for handoff offers…</p>}
      {offers.state === 'error' && <p role="alert">{offers.error} <button type="button" onClick={() => void loadOffers()}>Try again</button></p>}
      {offers.state === 'idle' && available.length === 0 && !resumed && <p>No handoff offers for this project. Reading this list never consumes an offer.</p>}
      {available.map(offer => <article key={offer.id} className="memory-offer">
        <strong>{offer.summary || 'Untitled handoff'}</strong>
        <small>From {offer.cwd ?? 'an unknown checkout'}. This is history, not code: verify changes in Git.</small>
        {offer.nextSteps.length > 0 && <ul>{offer.nextSteps.slice(0, 3).map((step, index) => <li key={index}>{step}</li>)}</ul>}
        <div><Button variant="primary" disabled={busy} onClick={() => void resume(offer)}>Resume</Button>{' '}<button type="button" disabled={busy} onClick={() => setDismissed(current => [...current, offer.id])}>Dismiss</button></div>
      </article>)}
      {resumed && <div className="memory-offer" role="status"><strong>Accepted: {resumed.summary}</strong>
        <pre>{handoffText(resumed)}</pre>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(`Historical handoff (${resumed.cwd ?? 'unknown checkout'}; read-only):\n${handoffText(resumed)}`).then(() => setMessage('Handoff copied. Paste it into the composer to continue.')).catch(() => setMessage('Could not copy the handoff.'))}>Copy for composer</button></div>}
    </section>}
    {status?.health.pipeline && <dl className="memory-pipeline" aria-label="Memory pipeline">
      <div><dt>Capture</dt><dd>{STAGE_LABEL[status.health.pipeline.capture]}</dd></div>
      <div><dt>Delivery to memory service</dt><dd>{STAGE_LABEL[status.health.pipeline.delivery]}</dd></div>
      <div><dt>Consolidation</dt><dd>{STAGE_LABEL[status.health.pipeline.consolidation]}</dd></div>
    </dl>}
    {status?.outbox && <p>Local memory queue (all projects): {status.outbox.pending} pending{status.outbox.pending > 0 && status.outbox.oldestAt ? ` (oldest ${formatAge(status.outbox.oldestAt, now)})` : ''} · {status.outbox.quarantined} quarantined · {status.outbox.refused} refused · {Math.ceil(status.outbox.bytes / 1024)} KiB used · last delivery {formatAge(status.outbox.lastDeliveredAt, now)}{status.outbox.lastFailureAt ? ` · last failure ${formatAge(status.outbox.lastFailureAt, now)}` : ''}</p>}
    {storage && <p>Disk used by memory (read-only, this app never deletes it): {formatBytes(storage.totalBytes)}{storage.truncated ? '+' : ''}{Object.entries(storage.categories).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, bytes]) => ` · ${name} ${formatBytes(bytes)}`).join('')}{storage.truncated ? ' (partial scan)' : ''}</p>}
    {status && <p><button type="button" onClick={() => void navigator.clipboard?.writeText(diagnosticsReport(status, Date.now())).then(() => setMessage('Sanitized diagnostics copied (counts and timestamps only).')).catch(() => setMessage('Could not copy diagnostics.'))}>Copy diagnostics</button></p>}
    {message && <p className="memory-feedback" role={failure ? 'alert' : 'status'}>{message}</p>}
    {memories.length > 0 && <details><summary>Recent memories</summary>{memories.map((item, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item}</pre>)}</details>}
  </section>
}
