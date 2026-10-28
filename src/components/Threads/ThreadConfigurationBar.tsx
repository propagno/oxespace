import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Eye, Gauge, Loader2, Pencil, RefreshCw, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { ConversationThread, ThreadConfiguration, ThreadModelCatalog, ThreadSnapshot } from '../../../shared/types/thread'
import { ConfirmDialog, Popover, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

export function ThreadConfigurationBar({ thread, onConfigured, onError, openControl, onControlClosed }: {
  thread: ConversationThread; onConfigured: (snapshot: ThreadSnapshot) => void; onError: (message: string) => void
  openControl: 'model' | 'effort' | 'permissions' | null; onControlClosed: () => void
}) {
  const [catalog, setCatalog] = useState<ThreadModelCatalog>({ models: [] }), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [saving, setSaving] = useState(false), [query, setQuery] = useState(''), [opened, setOpened] = useState<string | null>(null), [refresh, setRefresh] = useState(0)
  const [proposedAccess, setProposedAccess] = useState<ThreadConfiguration['access'] | null>(null), [proposedNetwork, setProposedNetwork] = useState(false), [proposedNever, setProposedNever] = useState(false), [proposedHooks, setProposedHooks] = useState(false)
  const accessTrigger = useRef<HTMLButtonElement>(null)
  const identity = useRef(thread.id); identity.current = thread.id
  useEffect(() => { if (openControl) setOpened(openControl) }, [openControl])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setCatalog({ models: [] })
    const api = window.oxe.thread
    if (!api?.models) { setLoading(false); setError('Restart the updated app to load models.'); return }
    void api.models(thread.id, refresh > 0).then(value => { if (active) setCatalog(value) }).catch(() => { if (active) setError('Could not load models. Try again.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [thread.id, thread.provider, refresh])
  const desired = thread.pendingConfiguration ?? thread
  const approvalLabel = (desired.approvalPolicy ?? 'on-request') === 'never' ? 'No command prompts' : desired.approvalPolicy === 'untrusted' ? 'Ask for untrusted commands' : 'Ask when needed'
  const modelId = desired.model || catalog.defaultModel
  const model = catalog.models.find(model => model.id === modelId)
  const effort = desired.reasoningEffort || model?.defaultEffort
  // With no known default the provider still chooses the model, so offer the efforts any model supports.
  const effortOptions = model?.efforts ?? (!desired.model && catalog.defaultKnown === false ? [...new Set(catalog.models.flatMap(value => value.efforts))] : [])
  const close = () => { setOpened(null); setQuery(''); setProposedAccess(null); setProposedNetwork(false); setProposedNever(false); setProposedHooks(false); onControlClosed() }
  const apply = async (configuration: ThreadConfiguration) => {
    const id = thread.id
    setSaving(true)
    try {
      if (!window.oxe.thread?.configure) throw Error('Restart the updated application')
      const snapshot = await window.oxe.thread.configure(id, configuration, thread.configurationRevision ?? 0)
      if (identity.current === id) { onConfigured(snapshot); close() }
    } catch (error) { if (identity.current === id) onError(humanizeError(error, 'Could not apply configuration')) }
    finally { if (identity.current === id) setSaving(false) }
  }
  const selector = (kind: string, label: string, text: string, children: React.ReactNode, disabled = false, badge?: string, Icon?: LucideIcon) => <Popover open={opened === kind} onOpenChange={open => { if (open) setOpened(kind); else if (!proposedAccess && !proposedNetwork && !proposedNever && !proposedHooks) close() }}
    side="top" sideOffset={10} label={label} className="thread-config-popover"
    trigger={<button ref={kind === 'permissions' ? accessTrigger : undefined} type="button" className={`thread-config-trigger${kind === 'permissions' ? ' is-permissions' : ''}${Icon ? ' is-icon' : ''}`} aria-label={Icon ? label : `${label}: ${text}`} disabled={saving || disabled} title={Icon ? `${label}: ${text}` : text}>{Icon && <Icon size={14} aria-hidden="true" />}<span className={Icon ? 'sr-only' : undefined}>{text}</span>{badge && <i className="thread-config-badge">{badge}</i>}{saving ? <Loader2 size={12} className="thread-spin" /> : <ChevronDown size={12} />}</button>}>
      <header>{label}{kind !== 'permissions' && <button type="button" aria-label="Refresh models" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={14} /></button>}</header><div className="thread-config-scroll">{children}</div>
  </Popover>
  const planning = desired.mode === 'plan'
  const setMode = (plan: boolean) => { if (plan !== planning) void apply({ mode: plan ? 'plan' : desired.mode === 'acceptEdits' ? 'acceptEdits' : 'default' }) }
  const accessIcon = desired.access === 'full-access' ? ShieldAlert : desired.access === 'workspace-write' ? Pencil : Eye
  return <div className="thread-configuration" aria-label="Conversation configuration">
    <div className="thread-mode-toggle" role="group" aria-label="Mode" title="Plan: the agent plans first and changes nothing until you approve. Agent: it works on the task.">
      <button type="button" aria-pressed={planning} disabled={saving} onClick={() => setMode(true)}>Plan</button>
      <button type="button" aria-pressed={!planning} disabled={saving} onClick={() => setMode(false)}>Agent</button>
    </div>
    {selector('model', 'Select model', model?.label ?? desired.model ?? (loading ? 'Loading models…' : catalog.defaultKnown === false ? 'Provider default' : 'Select model'), <>
      {catalog.models.length > 8 && <TextField aria-label="Filter models" placeholder="Search models…" value={query} onChange={event => setQuery(event.target.value)} />}
      {error ? <p role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></p> : loading ? <p role="status">Loading models…</p> : !catalog.models.length ? <p>No models available.</p> : <div className="thread-config-options">{catalog.models.filter(value => `${value.label} ${value.id}`.toLowerCase().includes(query.toLowerCase())).map(value => <button type="button" key={value.id} aria-pressed={modelId === value.id} onClick={() => void apply({ model: value.id, ...(effort && value.efforts.includes(effort) ? { reasoningEffort: effort } : value.defaultEffort ? { reasoningEffort: value.defaultEffort } : {}) })}><span><strong>{value.label}</strong>{' '}<small>{value.description}</small></span>{modelId === value.id && <Check size={14} />}</button>)}</div>}
    </>)}
    {selector('effort', 'Select effort', effort ? effort[0].toUpperCase() + effort.slice(1) : 'Automatic', <div className="thread-config-options">{effortOptions.map(value => <button type="button" key={value} aria-pressed={effort === value} onClick={() => void apply({ ...(model ? { model: model.id } : {}), reasoningEffort: value })}><span>{value[0].toUpperCase() + value.slice(1)}</span>{effort === value && <Check size={14} />}</button>)}</div>, !effortOptions.length, undefined, Gauge)}
    {selector('permissions', 'Permissions', desired.access === 'full-access' ? 'Full access' : desired.access === 'workspace-write' ? thread.provider === 'claude' ? 'Native permissions' : 'Workspace access' : 'Read only', <div className="thread-config-options">
      <p className="thread-access-directory" title={thread.rootPath}>{thread.rootPath}</p>
      <p className="thread-config-section-label">Access</p>
      <button type="button" aria-pressed={desired.access === 'read-only' || !desired.access} onClick={() => void apply({ access: 'read-only', networkAccess: false, hooksEnabled: false })}><span><strong>Read only</strong><small>{thread.provider === 'claude' ? 'Read, search and answer questions. Shell, agents and MCP tools are disabled.' : 'Explore the project without writing files.'}</small></span>{(!desired.access || desired.access === 'read-only') && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'workspace-write'} onClick={() => { setProposedAccess('workspace-write'); setOpened(null) }}><span><strong>{thread.provider === 'claude' ? 'Native permissions' : 'Workspace access'}</strong><small>{thread.provider === 'claude' ? 'Use tools and MCP with Claude’s saved rules and approval requests.' : 'Allow edits inside this project. External paths still require approval.'}</small></span>{desired.access === 'workspace-write' && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'full-access'} onClick={() => { setProposedAccess('full-access'); setOpened(null) }}><span><strong>Full access</strong><small>Run tools with expanded access under your operating system account.</small></span>{desired.access === 'full-access' && <Check size={14} />}</button>
      {thread.provider === 'codex' && desired.access === 'workspace-write' && <button type="button" aria-pressed={Boolean(desired.networkAccess)} onClick={() => { if (desired.networkAccess) void apply({ networkAccess: false }); else { setProposedNetwork(true); setOpened(null) } }}><span><strong>Network access</strong><small>{desired.networkAccess ? 'Allowed for workspace commands.' : 'Blocked for workspace commands.'}</small></span>{desired.networkAccess && <Check size={14} />}</button>}
      {thread.provider === 'codex' && <><p className="thread-config-section-label">Approvals</p>{(['untrusted', 'on-request'] as const).map(policy => <button type="button" key={policy} aria-pressed={(desired.approvalPolicy ?? 'on-request') === policy} onClick={() => void apply({ approvalPolicy: policy })}><span><strong>{policy === 'untrusted' ? 'Only untrusted commands' : 'Ask when needed'}</strong></span>{(desired.approvalPolicy ?? 'on-request') === policy && <Check size={14} />}</button>)}<button type="button" aria-pressed={desired.approvalPolicy === 'never'} onClick={() => { setProposedNever(true); setOpened(null) }}><span><strong>Never ask</strong><small>Reject approval prompts instead of asking.</small></span>{desired.approvalPolicy === 'never' && <Check size={14} />}</button></>}
      {thread.provider === 'claude' && (desired.access ?? 'read-only') !== 'read-only' && <><p className="thread-config-section-label">Native configuration</p><button type="button" aria-pressed={Boolean(desired.hooksEnabled)} onClick={() => { if (desired.hooksEnabled) void apply({ hooksEnabled: false }); else { setProposedHooks(true); setOpened(null) } }}><span><strong>Provider hooks</strong><small>{desired.hooksEnabled ? 'Hooks from the active Claude configuration can run.' : 'Disabled for this conversation.'}</small></span>{desired.hooksEnabled && <Check size={14} />}</button></>}
      {thread.provider === 'claude' && desired.access === 'workspace-write' && <><p className="thread-config-section-label">Mode</p><button type="button" role="switch" aria-checked={desired.mode === 'acceptEdits'} className="thread-config-switch" onClick={() => void apply({ mode: desired.mode === 'acceptEdits' ? 'default' : 'acceptEdits' })}><span><strong>Auto-accept edits</strong><small>File edits in this project are applied without asking. Commands and other tools still ask.</small></span><i aria-hidden="true" /></button></>}
      {thread.provider === 'codex' && <p className="thread-config-hint">Access and approvals are separate. MCP servers may still ask, even with Never ask.</p>}
    </div>, false, thread.provider === 'codex' && desired.access !== 'read-only' && desired.approvalPolicy === 'never' ? 'Never ask' : undefined, accessIcon)}
    {proposedAccess && <ConfirmDialog returnFocusTo={() => accessTrigger.current} busy={saving} danger={proposedAccess === 'full-access'}
      title={proposedAccess === 'full-access' ? 'Allow expanded access?' : 'Change conversation access?'}
      description={proposedAccess === 'full-access' ? 'Tools can modify files and run processes beyond this project. Native permission prompts may be bypassed; operating system restrictions still apply.' : thread.provider === 'claude' ? 'Claude will use its native tool and MCP permissions, including saved rules. Requests that require a decision will appear in this conversation. This mode does not provide a project filesystem sandbox.' : 'The agent can modify files in this project. Access outside the workspace remains subject to native approvals.'}
      confirmLabel={proposedAccess === 'full-access' ? 'Allow expanded access' : 'Apply access'}
      onCancel={() => setProposedAccess(null)} onConfirm={() => void apply({ access: proposedAccess })}>
      <p className="thread-access-directory">{thread.rootPath}</p>
      <p>Applies to this conversation. An active turn keeps its current configuration.</p>
    </ConfirmDialog>}
    {proposedNetwork && <ConfirmDialog returnFocusTo={() => accessTrigger.current} busy={saving} danger title="Allow network access?" description="Workspace commands in this conversation will be able to reach the network." confirmLabel="Allow network" onCancel={() => setProposedNetwork(false)} onConfirm={() => void apply({ networkAccess: true })} />}
    {proposedNever && <ConfirmDialog returnFocusTo={() => accessTrigger.current} busy={saving} danger title="Never ask for approval?" description="Actions that require approval will be rejected automatically instead of asking you. MCP servers may still ask." confirmLabel="Never ask" onCancel={() => setProposedNever(false)} onConfirm={() => void apply({ approvalPolicy: 'never' })} />}
    {proposedHooks && <ConfirmDialog returnFocusTo={() => accessTrigger.current} busy={saving} danger title="Enable provider hooks?" description="Hooks from the active Claude configuration can run commands before or after tool calls in this conversation." confirmLabel="Enable hooks" onCancel={() => setProposedHooks(false)} onConfirm={() => void apply({ hooksEnabled: true })} />}
    {thread.pendingConfiguration && <small className="thread-config-pending" title="The current turn keeps its configuration. Your selection applies to the next message.">Next turn</small>}
    {desired.mode === 'acceptEdits' && <small>Auto-edit</small>}
  </div>
}
