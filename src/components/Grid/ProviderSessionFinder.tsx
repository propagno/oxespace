import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary } from '../../../shared/types/session'
import type { SessionSearchResult } from '../../../shared/types/session-search'

import { Dialog, EmptyState, Notice, Spinner, TextField } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'

let finderRequestSeq = 0
const EMPTY_SESSIONS: SessionSummary[] = []

function mergeSessions(byProvider: Map<string, SessionSummary[]>): SessionSummary[] {
  const deduped = new Map<string, SessionSummary>()
  for (const list of byProvider.values()) {
    for (const session of list) deduped.set(`${session.provider}:${session.sessionId}`, session)
  }
  return [...deduped.values()].sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs || a.sessionId.localeCompare(b.sessionId))
}

export function ProviderSessionFinder({ workspaceId, rootPath, onClose }: { workspaceId: string; rootPath: string; onClose: () => void }) {
  const { t } = useTranslation('code')
  const scopeKey = `${workspaceId}|${rootPath}`
  const [scan, setScan] = useState<{ scopeKey: string; sessions: SessionSummary[]; loading: boolean; error: string }>({
    scopeKey,
    sessions: [],
    loading: true,
    error: ''
  })
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollTopRef = useRef(0)
  // Full-text hits from the transcript index; the list above only matches the
  // first message, which is rarely what a person remembers a session by.
  const [content, setContent] = useState<{ query: string; rootPath: string; result: SessionSearchResult } | null>(null)

  const trimmedQuery = query.trim()
  const activeContent = trimmedQuery.length >= 2 && content && content.query === trimmedQuery && content.rootPath === rootPath
    ? content.result
    : null

  const sessions = scan.scopeKey === scopeKey ? scan.sessions : EMPTY_SESSIONS
  const loading = scan.scopeKey === scopeKey ? scan.loading : true
  const error = copyError || (scan.scopeKey === scopeKey ? scan.error : '')

  useEffect(() => {
    if (trimmedQuery.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void Promise.resolve(window.oxe.session.search?.({ query: trimmedQuery, cwd: rootPath, limit: 12 }))
        .then((result) => {
          if (active) setContent(result ? { query: trimmedQuery, rootPath, result } : null)
        })
        .catch(() => { if (active) setContent(null) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [trimmedQuery, rootPath])

  useEffect(() => {
    let active = true
    const loadSeq = ++finderRequestSeq
    const providers: Array<'codex' | 'claude'> = ['codex', 'claude']
    const byProvider = new Map<'codex' | 'claude', SessionSummary[]>()
    const settled = new Set<'codex' | 'claude'>()
    const activeRequests = new Map<string, 'codex' | 'claude'>()

    const unsubscribe = window.oxe.session.onPartial?.((event) => {
      if (!active) return
      const provider = activeRequests.get(event.requestId)
      if (!provider || settled.has(provider)) return
      byProvider.set(provider, event.sessions)
      const next = mergeSessions(byProvider)
      setScan(prev => ({
        scopeKey,
        sessions: next,
        loading: prev.scopeKey === scopeKey ? prev.loading : true,
        error: prev.scopeKey === scopeKey ? prev.error : ''
      }))
    })

    const requests = providers.map(provider => {
      const requestId = `resume:${loadSeq}:${provider}`
      activeRequests.set(requestId, provider)
      return window.oxe.session.list({ workspaceId, workspaceRootPath: rootPath, provider, requestId })
        .then(list => {
          if (!active) return
          settled.add(provider)
          activeRequests.delete(requestId)
          byProvider.set(provider, list)
          const next = mergeSessions(byProvider)
          setScan(prev => ({
            scopeKey,
            sessions: next,
            loading: prev.scopeKey === scopeKey ? prev.loading : true,
            error: prev.scopeKey === scopeKey ? prev.error : ''
          }))
        })
    })

    void Promise.allSettled(requests)
      .then(results => {
        if (!active) return
        const failed = results.some(result => result.status === 'rejected')
        setScan(prev => ({
          scopeKey,
          sessions: prev.scopeKey === scopeKey ? prev.sessions : [],
          loading: false,
          error: failed ? t('sessions.loadFailed') : ''
        }))
      })
      .finally(() => {
        if (!active) return
        unsubscribe?.()
      })

    return () => {
      active = false
      activeRequests.clear()
      unsubscribe?.()
    }
  }, [scopeKey, workspaceId, rootPath, t])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && scrollTopRef.current > 0 && list.scrollTop !== scrollTopRef.current) {
      list.scrollTop = scrollTopRef.current
    }
  }, [sessions])

  const matches = useMemo(() => sessions.filter(session => `${session.provider} ${session.sessionId} ${session.modelId ?? ''} ${session.firstMessagePreview ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [sessions, query])

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(matches.length - 1, index + 1)
      : Math.max(0, index - 1)
    const target = matches[nextIndex]
    if (!target) return
    setSelectedSessionId(target.sessionId)
    const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-session-id]')
    const card = cards ? Array.from(cards).find(el => el.dataset.sessionId === target.sessionId) : null
    card?.focus()
  }

  const copy = async (value: string, key: string) => {
    try {
      if (!(await window.oxe.clipboard.writeText(value))) throw Error('Clipboard unavailable')
      setCopied(key)
      setCopyError('')
    } catch { setCopyError(t('sessions.copyFailed')) }
  }

  return <Dialog size="lg" title={t('sessions.title')} description={t('sessions.description')} onClose={onClose}>
    <p className="terminal-session-identity-note">{t('sessions.identityNote')}</p>
    <label className="desktop-provider-session-search"><Search size={14} aria-hidden="true" /><TextField type="search" aria-label={t('sessions.search')} placeholder={t('sessions.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <Notice intent="danger">{error}</Notice>}
    {matches.length > 0 && <div
      ref={listRef}
      className="desktop-provider-session-list"
      onScroll={event => { scrollTopRef.current = event.currentTarget.scrollTop }}
    >
      {matches.map((session, index) => {
        const isSelected = selectedSessionId === session.sessionId
        return <article
          key={`${session.provider}:${session.sessionId}`}
          className="desktop-provider-session-card"
          data-session-id={session.sessionId}
          data-selected={isSelected ? 'true' : 'false'}
          aria-current={isSelected ? 'true' : undefined}
          tabIndex={isSelected || (!selectedSessionId && index === 0) ? 0 : -1}
          onClick={() => setSelectedSessionId(session.sessionId)}
          onKeyDown={event => handleCardKeyDown(event, index)}
        >
          <div className="desktop-provider-session-heading"><strong>{session.firstMessagePreview || t('sessions.untitled', { provider: session.provider === 'codex' ? 'Codex' : 'Claude' })}</strong><span>{session.provider === 'codex' ? 'Codex' : 'Claude'}</span></div>
          <p>{t('sessions.meta', { model: session.modelId || t('sessions.unknownModel'), updated: formatDateTime(session.lastUpdatedMs), count: session.requestCount })}</p>
          <div className="desktop-provider-session-id"><code>{session.sessionId}</code><div><button type="button" aria-label={t('sessions.copyIdLabel', { session: `${session.provider} ${session.sessionId}` })} onClick={() => void copy(session.sessionId, `id:${session.sessionId}`)}>{copied === `id:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `id:${session.sessionId}` ? t('sessions.copied') : t('sessions.copyId')}</button><button type="button" aria-label={t('sessions.copyCommandLabel', { session: `${session.provider} ${session.sessionId}` })} onClick={() => void copy(`${session.provider === 'claude' ? 'claude --resume' : 'codex resume'} ${session.sessionId}`, `command:${session.sessionId}`)}>{copied === `command:${session.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `command:${session.sessionId}` ? t('sessions.copied') : t('sessions.copyCommand')}</button></div></div>
        </article>
      })}
    </div>}
    {loading && <div className="desktop-provider-session-progress" role="status" aria-live="polite">
      <Spinner size="sm" decorative />
      <span>{sessions.length > 0 ? t('sessions.loadingMore') : t('sessions.loading')}</span>
    </div>}
    {!loading && matches.length === 0 && <EmptyState compact title={query ? t('sessions.noMatch') : t('sessions.none')} />}
    {activeContent && activeContent.hits.length > 0 && <div className="desktop-provider-session-list" aria-label={t('sessions.contentResults')}>
      <p className="terminal-session-identity-note">{activeContent.indexing ? t('sessions.inContentIndexing') : t('sessions.inContent')}</p>
      {activeContent.hits.map(hit => <article key={`hit:${hit.agent}:${hit.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{hit.title || t('sessions.untitled', { provider: hit.agent === 'codex' ? 'Codex' : 'Claude' })}</strong><span>{hit.agent === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{hit.snippet}</p>
        <div className="desktop-provider-session-id"><code>{hit.sessionId}</code><div><button type="button" aria-label={t('sessions.copyCommandLabel', { session: `${hit.agent} ${hit.sessionId}` })} onClick={() => void copy(hit.resumeCommand, `hit:${hit.sessionId}`)}>{copied === `hit:${hit.sessionId}` ? <Check size={14} /> : <Copy size={14} />}{copied === `hit:${hit.sessionId}` ? t('sessions.copied') : t('sessions.copyCommand')}</button></div></div>
      </article>)}
    </div>}
    {activeContent && activeContent.hits.length === 0 && activeContent.indexing && <p className="terminal-session-identity-note" role="status">{t('sessions.indexing')}</p>}
    <p className="desktop-provider-session-help">{t('sessions.resumeBefore')} <code>/resume &lt;{t('sessions.resumeId')}&gt;</code> {t('sessions.resumeAfter')}</p>
  </Dialog>
}
