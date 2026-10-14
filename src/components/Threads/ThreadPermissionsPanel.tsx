import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ThreadAuditEntry, ThreadPermissionRule } from '../../../shared/types/thread'
import { Checkbox, Select, TextField } from '../../ui'

const ACTOR: Record<ThreadAuditEntry['actor'], string> = { user: 'You', policy: 'Rule', system: 'OXESpace' }
const KIND: Record<ThreadPermissionRule['kind'], string> = { command: 'Command', path: 'Files', tool: 'MCP tool' }
const PLACEHOLDER: Record<ThreadPermissionRule['kind'], string> = { command: 'npm run test   or   /^git (status|diff)/', path: 'src/**   or   .env*', tool: 'github/create_issue   or   github/*' }

/** Saved permission rules for the conversation's project, and the decisions recorded for it. */
export default function ThreadPermissionsPanel({ threadId }: { threadId: string }) {
  const api = window.oxe?.thread
  const [rules, setRules] = useState<ThreadPermissionRule[] | null>(null)
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
    const [nextRules, nextAudit] = await Promise.all([api.permissionRules(threadId), api.auditLog(threadId, { scope, limit: 200 })])
    setRules(nextRules)
    setAudit(nextAudit)
  }, [api, threadId, scope])
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load permission rules')) }, [load])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work(); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'The change was not saved') } finally { setBusy(false) }
  }

  if (!api?.permissionRules) return <p>Permission rules are not available in this build.</p>
  return <div className="thread-permissions">
    {error && <p role="alert">{error}</p>}
    <section>
      <h3>Rules</h3>
      <p>OXESpace answers the agent's approval prompts with these rules. Allow rules approve only when every command in a line, or every file, is covered; deny rules decline. Anything else still asks you. A denied MCP tool is also removed from the agent's tools when its next session starts.</p>
      {rules === null ? <p>Loading…</p> : rules.length === 0 ? <p>No rules yet. Use "Always allow" on an approval, or add one below.</p> : <ul className="thread-permissions-rules">
        {rules.map(rule => <li key={rule.id}>
          <span className={`thread-permissions-decision is-${rule.decision}`}>{rule.decision === 'allow' ? 'Allow' : 'Deny'}</span>
          <span>{KIND[rule.kind]}</span>
          <code>{rule.pattern}</code>
          <small>{rule.projectRoot ? 'This project' : 'All projects'}</small>
          <button type="button" aria-label={`Remove rule ${rule.pattern}`} title="Remove rule" disabled={busy} onClick={() => void run(() => api.removePermissionRule!(threadId, rule.id))}><Trash2 size={14} /></button>
        </li>)}
      </ul>}
      <form className="thread-permissions-add" onSubmit={event => { event.preventDefault(); void run(async () => { await api.addPermissionRule!(threadId, { kind, pattern, decision, scope: global ? 'global' : 'project' }); setPattern('') }) }}>
        <Select aria-label="Rule decision" value={decision} onChange={event => setDecision(event.target.value as ThreadPermissionRule['decision'])}><option value="allow">Allow</option><option value="deny">Deny</option></Select>
        <Select aria-label="Rule kind" value={kind} onChange={event => setKind(event.target.value as ThreadPermissionRule['kind'])}><option value="command">Command</option><option value="path">Files</option><option value="tool">MCP tool</option></Select>
        <TextField aria-label="Rule pattern" value={pattern} maxLength={500} placeholder={PLACEHOLDER[kind]} onChange={event => setPattern(event.target.value)} />
        <Checkbox checked={global} onChange={event => setGlobal(event.target.checked)} label="All projects" />
        <button type="submit" disabled={busy || !pattern.trim()}>Add rule</button>
      </form>
    </section>
    <section>
      <h3>Recent decisions</h3>
      <div className="thread-permissions-scope" role="radiogroup" aria-label="Audit scope">
        <label><input type="radio" name="audit-scope" checked={scope === 'thread'} onChange={() => setScope('thread')} />This conversation</label>
        <label><input type="radio" name="audit-scope" checked={scope === 'project'} onChange={() => setScope('project')} />Whole project</label>
      </div>
      {audit.length === 0 ? <p>No decisions recorded yet. Approvals, rule changes, undo and rewind appear here for 180 days.</p> : <ol className="thread-permissions-audit">
        {audit.map(entry => <li key={entry.id} title={entry.detail}>
          <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time>
          <span className={`thread-permissions-actor is-${entry.actor}`}>{ACTOR[entry.actor]}</span>
          <span>{entry.summary}</span>
        </li>)}
      </ol>}
    </section>
  </div>
}
