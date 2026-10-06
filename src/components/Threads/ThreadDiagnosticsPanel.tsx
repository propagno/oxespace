import { Activity, Check, Clipboard, RefreshCw, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { ThreadSnapshot } from '../../../shared/types/thread'

export function ThreadDiagnosticsPanel({ snapshot }: { snapshot: ThreadSnapshot }) {
  const [copied, setCopied] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const pendingRequests = snapshot.events.filter(event => event.type === 'request' && event.request.state === 'pending').length
  const runningTools = snapshot.events.filter(event => (event.type === 'tool' || event.type === 'subagent') && event.state === 'running').length
  const diagnostics = {
    capturedAt: new Date().toISOString(),
    threadId: snapshot.thread.id,
    workspaceId: snapshot.thread.workspaceId,
    projectId: snapshot.thread.projectId,
    provider: snapshot.thread.provider,
    providerVersion: snapshot.thread.capabilities?.providerVersion ?? 'Not observed',
    protocolVersion: snapshot.thread.capabilities?.protocolVersion ?? 'Not observed',
    platform: snapshot.thread.capabilities?.platform ?? 'Not observed',
    nativeSessionId: snapshot.thread.nativeSessionId,
    directory: snapshot.thread.rootPath,
    generation: snapshot.thread.generation ?? 1,
    status: snapshot.thread.status,
    connection: snapshot.thread.connection,
    providerObservation: snapshot.thread.providerObservation,
    configuration: {
      model: snapshot.thread.model ?? 'provider-default', effort: snapshot.thread.reasoningEffort ?? 'automatic',
      access: snapshot.thread.access ?? 'read-only', network: snapshot.thread.networkAccess ?? false,
      approvals: snapshot.thread.approvalPolicy ?? 'on-request', mode: snapshot.thread.mode ?? 'default'
    },
    counters: { events: snapshot.page?.total ?? snapshot.events.length, loadedEvents: snapshot.events.length, turns: snapshot.turns?.length ?? 0, queued: snapshot.thread.queue?.length ?? 0, pendingRequests, runningTools },
    recentLifecycle: snapshot.events.filter(event => ['request', 'request-resolved', 'subagent', 'completed'].includes(event.type)).slice(-30).map(event => ({ type: event.type, id: 'id' in event ? event.id : undefined, state: 'state' in event ? event.state : event.type === 'request' ? event.request.state : event.type === 'completed' ? event.status : undefined })),
    capabilities: Object.fromEntries(Object.entries(snapshot.thread.capabilities?.features ?? {}).map(([name, value]) => [name, { availability: value.availability, enabled: value.enabled, authorized: value.authorized, implemented: value.implemented, verified: value.verified, reason: value.reason }]))
  }
  const rows = [
    ['Thread ID', diagnostics.threadId], ['Native session', diagnostics.nativeSessionId ?? 'Not started'], ['Directory', diagnostics.directory],
    ['Provider', diagnostics.provider], ['Status', diagnostics.status], ['Connection', diagnostics.connection?.state ?? 'closed'],
    ['Provider version', diagnostics.providerVersion], ['Protocol', diagnostics.protocolVersion], ['Platform', diagnostics.platform],
    ['Last provider signal', diagnostics.connection?.lastNativeSignalAt ? new Date(diagnostics.connection.lastNativeSignalAt).toLocaleString() : 'Not observed'],
    ['Generation', String(diagnostics.generation)], ['Events', `${diagnostics.counters.loadedEvents} loaded / ${diagnostics.counters.events} imported${snapshot.thread.nativeHistoryCursor ? ' · earlier native history available' : ''}`],
    ['Turns', String(diagnostics.counters.turns)], ['Queue', String(diagnostics.counters.queued)], ['Pending requests', String(pendingRequests)], ['Running activities', String(runningTools)]
  ]
  return <div className="thread-diagnostics">
    <header><span><Activity size={15} aria-hidden="true" />Runtime diagnostics</span><button type="button" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }}><Clipboard size={13} />{copied ? 'Copied' : 'Copy report'}</button></header>
    <section className="thread-provider-observation" aria-live="polite">
      <button type="button" disabled={checking || !window.oxe.thread?.observe} onClick={async () => {
        setChecking(true); setCheckError('')
        try { await window.oxe.thread?.observe?.(snapshot.thread.id) }
        catch (error) { setCheckError(error instanceof Error ? error.message : 'Could not check provider state.') }
        finally { setChecking(false) }
      }}><RefreshCw size={13} aria-hidden="true" />{checking ? 'Checking provider…' : 'Check provider state'}</button>
      {diagnostics.providerObservation && <><strong>Provider: {diagnostics.providerObservation.state}</strong><p>{diagnostics.providerObservation.detail}</p><small>{diagnostics.providerObservation.source} · {new Date(diagnostics.providerObservation.observedAt).toLocaleString()}</small></>}
      {checkError && <p role="alert">{checkError}</p>}
    </section>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
    <section><h3>Capabilities</h3>{Object.entries(snapshot.thread.capabilities?.features ?? {}).map(([name, value]) => <div className="thread-diagnostic-capability" key={name}>{value.enabled && value.authorized && value.implemented ? <Check size={12} aria-label="Available" /> : <XCircle size={12} aria-label="Unavailable" />}<strong>{name}</strong><span>{value.availability} · {value.verified}</span>{value.reason && <small>{value.reason}</small>}</div>)}</section>
  </div>
}
