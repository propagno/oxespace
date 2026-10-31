import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Eye, Gauge, Pencil, RefreshCw, ShieldAlert, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread, ThreadConfiguration, ThreadModelCatalog, ThreadSnapshot } from '../../../shared/types/thread'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Popover, Spinner, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

export function ThreadConfigurationBar({ thread, onConfigured, onError, openControl, onControlClosed }: {
  thread: ConversationThread; onConfigured: (snapshot: ThreadSnapshot) => void; onError: (message: string) => void
  openControl: 'model' | 'effort' | 'permissions' | null; onControlClosed: () => void
}) {
  const { t } = useTranslation('thread')
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
    if (!api?.models) { setLoading(false); setError(t('config.restartModels')); return }
    void api.models(thread.id, refresh > 0).then(value => { if (active) setCatalog(value) }).catch(() => { if (active) setError(t('config.modelsFailed')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // t is stable for a language; the catalog does not reload when it changes.
  }, [thread.id, thread.provider, refresh]) // eslint-disable-line react-hooks/exhaustive-deps
  const desired = thread.pendingConfiguration ?? thread
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
      if (!window.oxe.thread?.configure) throw Error(t('config.restart'))
      const snapshot = await window.oxe.thread.configure(id, configuration, thread.configurationRevision ?? 0)
      if (identity.current === id) { onConfigured(snapshot); close() }
    } catch (error) { if (identity.current === id) onError(humanizeError(error, t('config.applyFailed'))) }
    finally { if (identity.current === id) setSaving(false) }
  }
  const selector = (kind: string, label: string, text: string, children: React.ReactNode, disabled = false, badge?: string, Icon?: LucideIcon) => <Popover open={opened === kind} onOpenChange={open => { if (open) setOpened(kind); else if (!proposedAccess && !proposedNetwork && !proposedNever && !proposedHooks) close() }}
    side="top" sideOffset={10} label={label} className="thread-config-popover"
    trigger={<button ref={kind === 'permissions' ? accessTrigger : undefined} type="button" className={`thread-config-trigger${kind === 'permissions' ? ' is-permissions' : ''}${Icon ? ' is-icon' : ''}`} aria-label={Icon ? label : `${label}: ${text}`} disabled={saving || disabled} title={Icon ? `${label}: ${text}` : text}>{Icon && <Icon size={14} aria-hidden="true" />}<span className={Icon ? 'sr-only' : undefined}>{text}</span>{badge && <i className="thread-config-badge">{badge}</i>}{saving ? <Spinner size="sm" label={t('config.saving')} /> : <ChevronDown size={12} />}</button>}>
      <header>{label}{kind !== 'permissions' && <button type="button" aria-label={t('config.refreshModels')} onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={14} /></button>}</header><div className="thread-config-scroll">{children}</div>
  </Popover>
  const planning = desired.mode === 'plan'
  const setMode = (plan: boolean) => { if (plan !== planning) void apply({ mode: plan ? 'plan' : desired.mode === 'acceptEdits' ? 'acceptEdits' : 'default' }) }
  const accessIcon = desired.access === 'full-access' ? ShieldAlert : desired.access === 'workspace-write' ? Pencil : Eye
  return <div className="thread-configuration" aria-label={t('config.label')}>
    <div className="thread-mode-toggle" role="group" aria-label={t('config.mode')} title={t('config.modeTitle')}>
      <button type="button" aria-pressed={planning} disabled={saving} onClick={() => setMode(true)}>{t('config.plan')}</button>
      <button type="button" aria-pressed={!planning} disabled={saving} onClick={() => setMode(false)}>{t('config.agent')}</button>
    </div>
    {selector('model', t('config.selectModel'), model?.label ?? desired.model ?? (loading ? t('config.loadingModels') : catalog.defaultKnown === false ? t('config.providerDefault') : t('config.selectModel')), <>
      {catalog.models.length > 8 && <TextField aria-label={t('config.filterModels')} placeholder={t('config.searchModels')} value={query} onChange={event => setQuery(event.target.value)} />}
      {error ? <ErrorState compact title={error} onRetry={() => setRefresh(value => value + 1)} retryLabel={t('common.tryAgain')} /> : loading ? <LoadingState label={t('config.loadingModels')} /> : !catalog.models.length ? <EmptyState compact title={t('config.noModels')} /> :<div className="thread-config-options">{catalog.models.filter(value => `${value.label} ${value.id}`.toLowerCase().includes(query.toLowerCase())).map(value => <button type="button" key={value.id} aria-pressed={modelId === value.id} onClick={() => void apply({ model: value.id, ...(effort && value.efforts.includes(effort) ? { reasoningEffort: effort } : value.defaultEffort ? { reasoningEffort: value.defaultEffort } : {}) })}><span><strong>{value.label}</strong>{' '}<small>{value.description}</small></span>{modelId === value.id && <Check size={14} />}</button>)}</div>}
    </>)}
    {selector('effort', t('config.selectEffort'), effort ? effort[0].toUpperCase() + effort.slice(1) : t('config.automatic'), <div className="thread-config-options">{effortOptions.map(value => <button type="button" key={value} aria-pressed={effort === value} onClick={() => void apply({ ...(model ? { model: model.id } : {}), reasoningEffort: value })}><span>{value[0].toUpperCase() + value.slice(1)}</span>{effort === value && <Check size={14} />}</button>)}</div>, !effortOptions.length, undefined, Gauge)}
    {selector('permissions', t('config.permissions'), desired.access === 'full-access' ? t('config.fullAccess') : desired.access === 'workspace-write' ? thread.provider === 'claude' ? t('config.nativePermissions') : t('config.workspaceAccess') : t('config.readOnly'), <div className="thread-config-options">
      <p className="thread-access-directory" title={thread.rootPath}>{thread.rootPath}</p>
      <p className="thread-config-section-label">{t('config.access')}</p>
      <button type="button" aria-pressed={desired.access === 'read-only' || !desired.access} onClick={() => void apply({ access: 'read-only', networkAccess: false, hooksEnabled: false })}><span><strong>{t('config.readOnly')}</strong><small>{thread.provider === 'claude' ? t('config.readOnlyClaude') : t('config.readOnlyCodex')}</small></span>{(!desired.access || desired.access === 'read-only') && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'workspace-write'} onClick={() => { setProposedAccess('workspace-write'); setOpened(null) }}><span><strong>{thread.provider === 'claude' ? t('config.nativePermissions') : t('config.workspaceAccess')}</strong><small>{thread.provider === 'claude' ? t('config.nativeHint') : t('config.workspaceHint')}</small></span>{desired.access === 'workspace-write' && <Check size={14} />}</button>
      <button type="button" aria-pressed={desired.access === 'full-access'} onClick={() => { setProposedAccess('full-access'); setOpened(null) }}><span><strong>{t('config.fullAccess')}</strong><small>{t('config.fullHint')}</small></span>{desired.access === 'full-access' && <Check size={14} />}</button>
      {thread.provider === 'codex' && desired.access === 'workspace-write' && <button type="button" aria-pressed={Boolean(desired.networkAccess)} onClick={() => { if (desired.networkAccess) void apply({ networkAccess: false }); else { setProposedNetwork(true); setOpened(null) } }}><span><strong>{t('config.network')}</strong><small>{desired.networkAccess ? t('config.networkAllowed') : t('config.networkBlocked')}</small></span>{desired.networkAccess && <Check size={14} />}</button>}
      {thread.provider === 'codex' && <><p className="thread-config-section-label">{t('config.approvals')}</p>{(['untrusted', 'on-request'] as const).map(policy => <button type="button" key={policy} aria-pressed={(desired.approvalPolicy ?? 'on-request') === policy} onClick={() => void apply({ approvalPolicy: policy })}><span><strong>{policy === 'untrusted' ? t('config.untrusted') : t('config.onRequest')}</strong></span>{(desired.approvalPolicy ?? 'on-request') === policy && <Check size={14} />}</button>)}<button type="button" aria-pressed={desired.approvalPolicy === 'never'} onClick={() => { setProposedNever(true); setOpened(null) }}><span><strong>{t('config.never')}</strong><small>{t('config.neverHint')}</small></span>{desired.approvalPolicy === 'never' && <Check size={14} />}</button></>}
      {thread.provider === 'claude' && (desired.access ?? 'read-only') !== 'read-only' && <><p className="thread-config-section-label">{t('config.native')}</p><button type="button" aria-pressed={Boolean(desired.hooksEnabled)} onClick={() => { if (desired.hooksEnabled) void apply({ hooksEnabled: false }); else { setProposedHooks(true); setOpened(null) } }}><span><strong>{t('config.hooks')}</strong><small>{desired.hooksEnabled ? t('config.hooksOn') : t('config.hooksOff')}</small></span>{desired.hooksEnabled && <Check size={14} />}</button></>}
      {thread.provider === 'claude' && desired.access === 'workspace-write' && <><p className="thread-config-section-label">{t('config.mode')}</p><button type="button" role="switch" aria-checked={desired.mode === 'acceptEdits'} className="thread-config-switch" onClick={() => void apply({ mode: desired.mode === 'acceptEdits' ? 'default' : 'acceptEdits' })}><span><strong>{t('config.autoAccept')}</strong><small>{t('config.autoAcceptHint')}</small></span><i aria-hidden="true" /></button></>}
      {thread.provider === 'codex' && <p className="thread-config-hint">{t('config.codexHint')}</p>}
    </div>, false, thread.provider === 'codex' && desired.access !== 'read-only' && desired.approvalPolicy === 'never' ? t('config.never') : undefined, accessIcon)}
    {proposedAccess && <ConfirmDialog cancelLabel={t('common.cancel')} returnFocusTo={() => accessTrigger.current} busy={saving} danger={proposedAccess === 'full-access'}
      title={proposedAccess === 'full-access' ? t('config.expandTitle') : t('config.changeTitle')}
      description={proposedAccess === 'full-access' ? t('config.expandBody') : thread.provider === 'claude' ? t('config.nativeBody') : t('config.workspaceBody')}
      confirmLabel={proposedAccess === 'full-access' ? t('config.expandConfirm') : t('config.applyAccess')}
      onCancel={() => setProposedAccess(null)} onConfirm={() => void apply({ access: proposedAccess })}>
      <p className="thread-access-directory">{thread.rootPath}</p>
      <p>{t('config.appliesHere')}</p>
    </ConfirmDialog>}
    {proposedNetwork && <ConfirmDialog cancelLabel={t('common.cancel')} returnFocusTo={() => accessTrigger.current} busy={saving} danger title={t('config.networkTitle')} description={t('config.networkBody')} confirmLabel={t('config.networkConfirm')} onCancel={() => setProposedNetwork(false)} onConfirm={() => void apply({ networkAccess: true })} />}
    {proposedNever && <ConfirmDialog cancelLabel={t('common.cancel')} returnFocusTo={() => accessTrigger.current} busy={saving} danger title={t('config.neverTitle')} description={t('config.neverBody')} confirmLabel={t('config.never')} onCancel={() => setProposedNever(false)} onConfirm={() => void apply({ approvalPolicy: 'never' })} />}
    {proposedHooks && <ConfirmDialog cancelLabel={t('common.cancel')} returnFocusTo={() => accessTrigger.current} busy={saving} danger title={t('config.hooksTitle')} description={t('config.hooksBody')} confirmLabel={t('config.hooksConfirm')} onCancel={() => setProposedHooks(false)} onConfirm={() => void apply({ hooksEnabled: true })} />}
    {thread.pendingConfiguration && <small className="thread-config-pending" title={t('config.nextTurnTitle')}>{t('config.nextTurn')}</small>}
    {desired.mode === 'acceptEdits' && <small>{t('config.autoEdit')}</small>}
  </div>
}
