import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import type { SessionSummary } from '../../../shared/types/session'
import type { SessionSearchResult } from '../../../shared/types/session-search'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { TextField } from '../../ui'

export function ProviderSessionFinder({ workspaceId, rootPath, onClose }: { workspaceId: string; rootPath: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  // Full-text hits from the transcript index; the list above only matches the
  // first message, which is rarely what a person remembers a session by.
  const [content, setContent] = useState<SessionSearchResult | null>(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) { setContent(null); return }
    let active = true
    const timer = window.setTimeout(() => {
      void Promise.resolve(window.oxe.session.search?.({ query: text, cwd: rootPath, limit: 12 }))
        .then((result) => { if (active) setContent(result ?? null) })
        .catch(() => { if (active) setContent(null) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, rootPath])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void Promise.allSettled(['codex', 'claude'].map(provider => window.oxe.session.list({ workspaceId, workspaceRootPath: rootPath, provider: provider as 'codex' | 'claude' })))
      .then(results => {
        if (!active) return
        setSessions(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs))
        if (results.some(result => result.status === 'rejected')) setError('Could not load every session. Check that Codex and Claude are installed.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, rootPath])

  const matches = useMemo(() => sessions.filter(session => `${session.provider} ${session.sessionId} ${session.modelId ?? ''} ${session.firstMessagePreview ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [sessions, query])
  const copy = async (value: string, key: string) => {
    try {
      if (!(await window.oxe.clipboard.writeText(value))) throw Error('Clipboard unavailable')
      setCopied(key)
      setError('')
    } catch { setError('Could not copy the session ID.') }
  }

  return <DesktopDialog className="desktop-provider-sessions-dialog" title="Codex and Claude sessions" description="Native conversations saved in this directory. Identify the session by the start of the conversation and its time." onClose={onClose}>
    <p className="terminal-session-identity-note">Terminal (PTY), pane and workspace IDs do not resume a provider conversation. A terminal may have opened several native sessions.</p>
    <label className="desktop-provider-session-search"><Search size={14} aria-hidden="true" /><TextField type="search" aria-label="Search native sessions" placeholder="Search message, model or session ID" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <p className="desktop-provider-session-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading native sessions…</p> : matches.length ? <div className="desktop-provider-session-list">
      {matches.map(session => <article key={`${session.provider}:${session.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{session.firstMessagePreview || `${session.provider === 'codex' ? 'Codex' : 'Claude'} session`}</strong><span>{session.provider === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{session.modelId || 'Unknown model'} · Updated {new Date(session.lastUpdatedMs).toLocaleString()} · {session.requestCount} {session.requestCount === 1 ? 'request' : 'requests'}</p>
        <div className="desktop-provider-session-id"><code>{session.sessionId}</code><div><button type="button" aria-label={`Copy session ID ${session.provider} ${session.sessionId}`} onClick={() => void copy(session.sessionId, `id:${session.sessionId}`)}>{copied === `id:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `id:${session.sessionId}` ? 'Copied' : 'Copy ID'}</button><button type="button" aria-label={`Copy command to resume ${session.provider} ${session.sessionId}`} onClick={() => void copy(`${session.provider === 'claude' ? 'claude --resume' : 'codex resume'} ${session.sessionId}`, `command:${session.sessionId}`)}>{copied === `command:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `command:${session.sessionId}` ? 'Copied' : 'Copy command'}</button></div></div>
      </article>)}
    </div> : <p className="desktop-provider-session-empty">{query ? 'No session matches the search.' : 'No Codex or Claude session found in this directory.'}</p>}
    {content && content.hits.length > 0 && <div className="desktop-provider-session-list" aria-label="Results in conversation content">
      <p className="terminal-session-identity-note">In conversation content{content.indexing ? ' (indexing in progress)' : ''}:</p>
      {content.hits.map(hit => <article key={`hit:${hit.agent}:${hit.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{hit.title || `${hit.agent === 'codex' ? 'Codex' : 'Claude'} session`}</strong><span>{hit.agent === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{hit.snippet}</p>
        <div className="desktop-provider-session-id"><code>{hit.sessionId}</code><div><button type="button" aria-label={`Copy command to resume ${hit.agent} ${hit.sessionId}`} onClick={() => void copy(hit.resumeCommand, `hit:${hit.sessionId}`)}>{copied === `hit:${hit.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `hit:${hit.sessionId}` ? 'Copied' : 'Copy command'}</button></div></div>
      </article>)}
    </div>}
    {content && content.hits.length === 0 && content.indexing && <p className="terminal-session-identity-note" role="status">Indexing conversations…</p>}
    <p className="desktop-provider-session-help">In Thread, use <code>/resume &lt;native session ID&gt;</code> to open the same conversation in this project.</p>
  </DesktopDialog>
}
