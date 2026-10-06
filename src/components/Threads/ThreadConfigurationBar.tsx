import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Loader2, RefreshCw, Shield } from 'lucide-react'
import { Popover } from 'radix-ui'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import type { ConversationThread, ThreadConfiguration, ThreadModelCatalog, ThreadSnapshot } from '../../../shared/types/thread'

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
  const modelId = desired.model || catalog.defaultModel
  const model = catalog.models.find(model => model.id === modelId)
  const effort = desired.reasoningEffort || model?.defaultEffort
  const close = () => { setOpened(null); setQuery(''); setProposedAccess(null); setProposedNetwork(false); setProposedNever(false); setProposedHooks(false); onControlClosed() }
  const apply = async (configuration: ThreadConfiguration) => {
    const id = thread.id
    setSaving(true)
    try {
      if (!window.oxe.thread?.configure) throw Error('Restart the updated application')
      const snapshot = await window.oxe.thread.configure(id, configuration, thread.configurationRevision ?? 0)
      if (identity.current === id) { onConfigured(snapshot); close() }
    } catch (error) { if (identity.current === id) onError(error instanceof Error ? error.message : 'Could not apply configuration') }
    finally { if (identity.current === id) setSaving(false) }
  }
  const selector = (kind: string, label: string, text: string, children: React.ReactNode, disabled = false) => <Popover.Root open={opened === kind} onOpenChange={open => { if (open) setOpened(kind); else if (!proposedAccess) close() }}>
    <Popover.Trigger asChild><button ref={kind === 'permissions' ? accessTrigger : undefined} type="button" className="thread-config-trigger" aria-label={label} disabled={saving || disabled} title={text}>{kind === 'permissions' && <Shield size={12} />}<span>{text}</span>{saving ? <Loader2 size={12} className="thread-spin" /> : <ChevronDown size={12} />}</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="thread-config-popover" side="top" align="start" sideOffset={10} collisionPadding={16} aria-label={label}>
      <header>{label}<button type="button" aria-label="Refresh models" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={13} /></button></header>{children}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
  return <div className="thread-configuration" aria-label="Conversation configuration">
    {selector('model', 'Select model', model?.label ?? desired.model ?? (loading ? 'Loading models…' : 'Select model'), <>
      {catalog.models.length > 8 && <input aria-label="Filter models" placeholder="Search models…" value={query} onChange={event => setQuery(event.target.value)} />}
      {error ? <p role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></p> : loading ? <p role="status">Loading models…</p> : !catalog.models.length ? <p>No models available.</p> : <div className="thread-config-options">{catalog.models.filter(value => `${value.label} ${value.id}`.toLowerCase().includes(query.toLowerCase())).map(value => <button type="button" key={value.id} aria-pressed={modelId === value.id} onClick={() => void apply({ model: value.id, ...(effort && value.efforts.includes(effort) ? { reasoningEffort: effort } : value.defaultEffort ? { reasoningEffort: value.defaultEffort } : {}) })}><span><strong>{value.label}</strong><small>{value.description}</small></span>{modelId === value.id && <Check size={14} />}</button>)}</div>}
    </>)}
    {selector('effort', 'Select effort', effort ? effort[0].toUpperCase() + effort.slice(1) : 'Automatic', <div className="thread-config-options">{model?.efforts.map(value => <button type="button" key={value} aria-pressed={effort === value} onClick={() => void apply({ model: model.id, reasoningEffort: value })}><span>{value[0].toUpperCase() + value.slice(1)}</span>{effort === value && <Check size={14} />}</button>)}</div>, !model?.efforts.length)}
    {selector('permissions', 'Permissions', desired.access === 'full-access' ? 'Full access' : desired.access === 'workspace-write' ? thread.provider === 'claude' ? 'Native permissions' : 'Workspace access' : 'Read only', <div className="thread-config-options">
      <p className="thread-access-directory">{thread.rootPath}</p>
      <button type="button" aria-pressed={desired.access === 'read-only' || !desired.access} onClick={() => void apply({ access: 'read-only', networkAccess: false, hooksEnabled: false })}><span><strong>Read only</strong><small>{thread.provider === 'claude' ? 'Read, search and answer questions. Shell, agents and MCP tools are disabled.' : 'Explore the project without writing files.'}</small></span>{(!desired.access || desired.access === 'read-only') && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'workspace-write'} onClick={() => { setProposedAccess('workspace-write'); setOpened(null) }}><span><strong>{thread.provider === 'claude' ? 'Native permissions' : 'Workspace access'}</strong><small>{thread.provider === 'claude' ? 'Use tools and MCP with Claude’s saved rules and approval requests.' : 'Allow edits inside this project. External paths still require approval.'}</small></span>{desired.access === 'workspace-write' && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'full-access'} onClick={() => { setProposedAccess('full-access'); setOpened(null) }}><span><strong>Full access</strong><small>Run tools with expanded access under your operating system account.</small></span>{desired.access === 'full-access' && <Check size={14} />}</button>
      {thread.provider === 'codex' && desired.access === 'workspace-write' && <button type="button" aria-pressed={Boolean(desired.networkAccess)} onClick={() => desired.networkAccess ? void apply({ networkAccess: false }) : setProposedNetwork(true)}><span><strong>Network access</strong><small>{desired.networkAccess ? 'Allowed for workspace commands.' : 'Blocked for workspace commands.'}</small></span>{desired.networkAccess && <Check size={14} />}</button>}
      {proposedNetwork && <div className="thread-access-confirm"><p>Allow workspace commands to access the network?</p><button type="button" onClick={() => void apply({ networkAccess: true })}>Allow network</button><button type="button" onClick={() => setProposedNetwork(false)}>Cancel</button></div>}
      {thread.provider === 'codex' && <><p className="thread-config-section-label">Approval policy</p>{(['untrusted', 'on-request'] as const).map(policy => <button type="button" key={policy} aria-pressed={(desired.approvalPolicy ?? 'on-request') === policy} onClick={() => void apply({ approvalPolicy: policy })}><span><strong>{policy === 'untrusted' ? 'Only untrusted commands' : 'Ask when needed'}</strong></span>{(desired.approvalPolicy ?? 'on-request') === policy && <Check size={14} />}</button>)}<button type="button" aria-pressed={desired.approvalPolicy === 'never'} onClick={() => setProposedNever(true)}><span><strong>Never ask</strong><small>Reject approval prompts instead of asking.</small></span>{desired.approvalPolicy === 'never' && <Check size={14} />}</button></>}
      {proposedNever && <div className="thread-access-confirm"><p>Actions that require approval will be rejected automatically. Continue?</p><button type="button" onClick={() => void apply({ approvalPolicy: 'never' })}>Never ask</button><button type="button" onClick={() => setProposedNever(false)}>Cancel</button></div>}
      {thread.provider === 'claude' && (desired.access ?? 'read-only') !== 'read-only' && <><p className="thread-config-section-label">Native configuration</p><button type="button" aria-pressed={Boolean(desired.hooksEnabled)} onClick={() => desired.hooksEnabled ? void apply({ hooksEnabled: false }) : setProposedHooks(true)}><span><strong>Provider hooks</strong><small>{desired.hooksEnabled ? 'Hooks from the active Claude configuration can run.' : 'Disabled for this conversation.'}</small></span>{desired.hooksEnabled && <Check size={14} />}</button></>}
      {proposedHooks && <div className="thread-access-confirm"><p>Provider hooks can execute configured commands before or after tool calls. Enable them for this conversation?</p><button type="button" onClick={() => void apply({ hooksEnabled: true })}>Enable hooks</button><button type="button" onClick={() => setProposedHooks(false)}>Cancel</button></div>}
      <button type="button" onClick={() => void apply({ mode: desired.mode === 'plan' ? 'default' : 'plan' })}><span>{desired.mode === 'plan' ? 'Leave planning mode' : 'Planning mode'}</span></button>
    </div>)}
    {proposedAccess && <DesktopDialog className="thread-access-dialog" returnFocusTo={() => accessTrigger.current} title={proposedAccess === 'full-access' ? 'Allow expanded access?' : 'Change conversation access?'} description="Review the access this agent will receive before applying it." onClose={() => { if (!saving) setProposedAccess(null) }}>
      <div className="desktop-dialog-body"><p className="thread-access-directory">{thread.rootPath}</p><p>{proposedAccess === 'full-access' ? 'Tools can modify files and run processes beyond this project. Native permission prompts may be bypassed; operating system restrictions still apply.' : thread.provider === 'claude' ? 'Claude will use its native tool and MCP permissions, including saved rules. Requests that require a decision will appear in this conversation. This mode does not provide a project filesystem sandbox.' : 'The agent can modify files in this project. Access outside the workspace remains subject to native approvals.'}</p><p>Applies to this conversation. An active turn keeps its current configuration.</p></div>
      <footer className="desktop-dialog-footer"><button type="button" disabled={saving} onClick={() => setProposedAccess(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void apply({ access: proposedAccess })}>{saving ? 'Applying…' : proposedAccess === 'full-access' ? 'Allow expanded access' : 'Apply access'}</button></footer>
    </DesktopDialog>}
    {thread.pendingConfiguration && <small className="thread-config-pending" title="The current turn keeps its configuration. Your selection applies to the next message.">Next turn</small>}
    {desired.mode === 'plan' && <small>Plan</small>}
  </div>
}
