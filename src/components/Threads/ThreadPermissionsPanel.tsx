import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ThreadAuditEntry, ThreadPermissionRule } from '../../../shared/types/thread'
import { useTranslation } from 'react-i18next'
import { Checkbox, EmptyState, ErrorState, Select, TextField, LoadingState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

/** Examples of the pattern syntax; code, so the same in every language. */
const PLACEHOLDER: Record<ThreadPermissionRule['kind'], string> = { command: 'npm run test   or   /^git (status|diff)/', path: 'src/**   or   .env*', tool: 'github/create_issue   or   github/*' }

/** Saved permission rules for the conversation's project, and the decisions recorded for it. */
export default function ThreadPermissionsPanel({ threadId }: { threadId: string }) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const [rules, setRules] = useState<ThreadPermissionRule[] | null>(null)
  const [autoReads, setAutoReads] = useState<boolean | null>(null)
  const [audit, setAudit] = useState<ThreadAuditEntry[]>([])
  const [scope, setScope] = useState<'thread' | 'project'>('thread')
  const [kind, setKind] = useState<ThreadPermissionRule['kind']>('command')
  const [decision, setDecision] = useState<ThreadPermissionRule['decision']>('allow')
  const [global, setGlobal] = useState(false)
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!api?.permissionRules || !api.auditLog) return
    const [nextRules, nextAudit, nextReads] = await Promise.all([api.permissionRules(threadId), api.auditLog(threadId, { scope, limit: 200 }), api.autoApproveReads?.() ?? Promise.resolve(null)])
    setRules(nextRules)
    setAutoReads(nextReads)
    setAudit(nextAudit)
  }, [api, threadId, scope])
  useEffect(() => { void load().catch(cause => setError(humanizeError(cause, t('permissions.loadFailed')))) }, [load])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work(); await load() } catch (cause) { setError(humanizeError(cause, t('permissions.saveFailed'))) } finally { setBusy(false) }
  }

  if (!api?.permissionRules) return <EmptyState compact title={t('permissions.unavailable')} />
  return <div className="thread-permissions">
    {error && <ErrorState compact title={error} />}
    {autoReads !== null && api.setAutoApproveReads && <section>
      <h3>{t('permissions.readOnly')}</h3>
      <Checkbox checked={autoReads} disabled={busy} label={t('permissions.autoReads')} onChange={event => void run(() => api.setAutoApproveReads!(event.target.checked))} />
      <p>{t('permissions.autoReadsHint')}</p>
    </section>}
    <section>
      <h3>{t('permissions.rules')}</h3>
      <p>{t('permissions.rulesHint')}</p>
      {rules === null ? <LoadingState label={t('permissions.loading')} /> : rules.length === 0 ? <EmptyState compact title={t('permissions.none')}>{t('permissions.noneHint')}</EmptyState> : <ul className="thread-permissions-rules">
        {rules.map(rule => <li key={rule.id}>
          <span className={`thread-permissions-decision is-${rule.decision}`}>{t(`permissions.${rule.decision}`)}</span>
          <span>{t(`permissions.kind.${rule.kind}`)}</span>
          <code>{rule.pattern}</code>
          <small>{rule.projectRoot ? t('permissions.thisProject') : t('permissions.allProjects')}</small>
          <button type="button" aria-label={t('permissions.remove', { pattern: rule.pattern })} title={t('permissions.removeTitle')} disabled={busy} onClick={() => void run(() => api.removePermissionRule!(threadId, rule.id))}><Trash2 size={14} /></button>
        </li>)}
      </ul>}
      <form className="thread-permissions-add" onSubmit={event => { event.preventDefault(); void run(async () => { await api.addPermissionRule!(threadId, { kind, pattern, decision, scope: global ? 'global' : 'project' }); setPattern('') }) }}>
        <Select aria-label={t('permissions.decision')} value={decision} onChange={event => setDecision(event.target.value as ThreadPermissionRule['decision'])}><option value="allow">{t('permissions.allow')}</option><option value="deny">{t('permissions.deny')}</option></Select>
        <Select aria-label={t('permissions.kindLabel')} value={kind} onChange={event => setKind(event.target.value as ThreadPermissionRule['kind'])}><option value="command">{t('permissions.kind.command')}</option><option value="path">{t('permissions.kind.path')}</option><option value="tool">{t('permissions.kind.tool')}</option></Select>
        <TextField aria-label={t('permissions.pattern')} value={pattern} maxLength={500} placeholder={PLACEHOLDER[kind]} onChange={event => setPattern(event.target.value)} />
        <Checkbox checked={global} onChange={event => setGlobal(event.target.checked)} label={t('permissions.allProjects')} />
        <button type="submit" disabled={busy || !pattern.trim()}>{t('permissions.add')}</button>
      </form>
    </section>
    <section>
      <h3>{t('permissions.recent')}</h3>
      <div className="thread-permissions-scope" role="radiogroup" aria-label={t('permissions.scope')}>
        <label><input type="radio" name="audit-scope" checked={scope === 'thread'} onChange={() => setScope('thread')} />{t('permissions.thisConversation')}</label>
        <label><input type="radio" name="audit-scope" checked={scope === 'project'} onChange={() => setScope('project')} />{t('permissions.wholeProject')}</label>
      </div>
      {audit.length === 0 ? <EmptyState compact title={t('permissions.noDecisions')}>{t('permissions.noDecisionsHint')}</EmptyState> : <ol className="thread-permissions-audit">
        {audit.map(entry => <li key={entry.id} title={entry.detail}>
          <time dateTime={new Date(entry.at).toISOString()}>{formatDateTime(entry.at)}</time>
          <span className={`thread-permissions-actor is-${entry.actor}`}>{t(`permissions.actor.${entry.actor}`)}</span>
          <span>{entry.summary}</span>
        </li>)}
      </ol>}
    </section>
  </div>
}
