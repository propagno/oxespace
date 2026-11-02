import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary } from '../../../shared/types/session'
import type { SessionSearchResult } from '../../../shared/types/session-search'

import { Dialog, EmptyState, Notice, TextField } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'

export function ProviderSessionFinder({ workspaceId, rootPath, onClose }: { workspaceId: string; rootPath: string; onClose: () => void }) {
  const { t } = useTranslation('code')
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
        if (results.some(result => result.status === 'rejected')) setError(t('sessions.loadFailed'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, rootPath, t])

  const matches = useMemo(() => sessions.filter(session => `${session.provider} ${session.sessionId} ${session.modelId ?? ''} ${session.firstMessagePreview ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [sessions, query])
  const copy = async (value: string, key: string) => {
    try {
      if (!(await window.oxe.clipboard.writeText(value))) throw Error('Clipboard unavailable')
      setCopied(key)
      setError('')
    } catch { setError(t('sessions.copyFailed')) }
  }

  return <Dialog className="desktop-provider-sessions-dialog" size="lg" title={t('sessions.title')} description={t('sessions.description')} onClose={onClose}>
    <p className="terminal-session-identity-note">{t('sessions.identityNote')}</p>
    <label className="desktop-provider-session-search"><Search size={14} aria-hidden="true" /><TextField type="search" aria-label={t('sessions.search')} placeholder={t('sessions.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <Notice intent="danger">{error}</Notice>}
    {loading ? <p role="status">{t('sessions.loading')}</p> : matches.length ? <div className="desktop-provider-session-list">
      {matches.map(session => <article key={`${session.provider}:${session.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{session.firstMessagePreview || t('sessions.untitled', { provider: session.provider === 'codex' ? 'Codex' : 'Claude' })}</strong><span>{session.provider === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{t('sessions.meta', { model: session.modelId || t('sessions.unknownModel'), updated: formatDateTime(session.lastUpdatedMs), count: session.requestCount })}</p>
        <div className="desktop-provider-session-id"><code>{session.sessionId}</code><div><button type="button" aria-label={t('sessions.copyIdLabel', { session: `${session.provider} ${session.sessionId}` })} onClick={() => void copy(session.sessionId, `id:${session.sessionId}`)}>{copied === `id:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `id:${session.sessionId}` ? t('sessions.copied') : t('sessions.copyId')}</button><button type="button" aria-label={t('sessions.copyCommandLabel', { session: `${session.provider} ${session.sessionId}` })} onClick={() => void copy(`${session.provider === 'claude' ? 'claude --resume' : 'codex resume'} ${session.sessionId}`, `command:${session.sessionId}`)}>{copied === `command:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `command:${session.sessionId}` ? t('sessions.copied') : t('sessions.copyCommand')}</button></div></div>
      </article>)}
    </div> : <EmptyState compact title={query ? t('sessions.noMatch') : t('sessions.none')} />}
    {content && content.hits.length > 0 && <div className="desktop-provider-session-list" aria-label={t('sessions.contentResults')}>
      <p className="terminal-session-identity-note">{content.indexing ? t('sessions.inContentIndexing') : t('sessions.inContent')}</p>
      {content.hits.map(hit => <article key={`hit:${hit.agent}:${hit.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{hit.title || t('sessions.untitled', { provider: hit.agent === 'codex' ? 'Codex' : 'Claude' })}</strong><span>{hit.agent === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{hit.snippet}</p>
        <div className="desktop-provider-session-id"><code>{hit.sessionId}</code><div><button type="button" aria-label={t('sessions.copyCommandLabel', { session: `${hit.agent} ${hit.sessionId}` })} onClick={() => void copy(hit.resumeCommand, `hit:${hit.sessionId}`)}>{copied === `hit:${hit.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `hit:${hit.sessionId}` ? t('sessions.copied') : t('sessions.copyCommand')}</button></div></div>
      </article>)}
    </div>}
    {content && content.hits.length === 0 && content.indexing && <p className="terminal-session-identity-note" role="status">{t('sessions.indexing')}</p>}
    <p className="desktop-provider-session-help">{t('sessions.resumeBefore')} <code>/resume &lt;{t('sessions.resumeId')}&gt;</code> {t('sessions.resumeAfter')}</p>
  </Dialog>
}
